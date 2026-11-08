# PR28 storage performance

## Evidence and limits

**Verified in an invented HTTP simulation:** at commit `b9229cdcc3c90b83b932d742c3d9282bab3abe02`, the 24-step live recipe before human reconnect made 9,590 Drive API requests. The simulation used the actual live runner, application lifecycle, catalog transaction engine, Google Drive transaction adapter, and session adapter. Fetch returned invented in-memory files. It exercised the deployed bulk snapshot path, not the older per-record test fallback.

The count excludes initial connection and folder initialization, OAuth, fixture downloads, periodic heartbeats, retries, pagination, and browser CORS requests. It is not a measurement of Google latency, Safari performance, or a quota limit. The final same-copy reconnect assertion runs separately after the tester reconnects.

The three save-and-reopen checkpoints accounted for 965, 1,825, and 3,829 requests. The final snapshot selected 66 objects, while its catalog retained 226 entries, including 154 journal events. Reopening this state cost 460 requests. Repeated small saves increased their cost as retained history grew.

**Verified with the same synthetic HTTP recipe after these changes:** 4,633 requests, down 4,957, or 51.7%. Independent immutable reads reached concurrency four; durable mutations remained serial. All 24 recipe assertions and the separate same-copy reconnect assertion passed. This is a request-count improvement, not a prediction of live elapsed time.

| Phase | Before | After |
| --- | ---: | ---: |
| Fresh-base checks | 24 | 27 |
| First save and reopen | 965 | 582 |
| Unchanged repeated import/save | 117 | 63 |
| Reviewed checkpoint save and reopen | 1,825 | 857 |
| Discard unsaved probe/reopen | 218 | 115 |
| Final save and reopen | 3,829 | 1,804 |
| Immutable rewrite refusal/reopen | 460 | 236 |
| Portable verification | 459 | 235 |
| Session revalidation/reopen | 1,684 | 705 |
| Verified release | 9 | 9 |
| Total before human reconnect | 9,590 | 4,633 |

Other classification, correction, mapping, and review steps make no Drive requests. The new total comprises 3,762 media reads, 265 metadata reads, 353 folder listings, 15 ID-allocation calls, 231 immutable creates, and seven updates. The extra ownership checks and metadata brackets are included.

Ten successive small save-and-reopen operations, each adding one invented account and its changed index, now cost 201, 279, 357, 435, 513, 591, 669, 747, 825, and 903 requests. The same baseline probe cost 293 through 2,345, increasing by 228 per save rather than 78. Retained-history growth remains: cumulative work across many small commits is still quadratic. These fixes do not introduce compaction or change the per-record storage format.

## Changes and safety boundaries

The performance work preserves the existing storage format, immutable history, exact manifest comparisons, session ownership checks, and recovery protocol. It does not introduce a persistent or cross-operation verification cache. Every application read and save still verifies retained history, including objects no longer selected by the current snapshot.

Independent immutable history reads use a bounded pool. Canonical transaction writes, financial publication, catalog finalization and session updates remain ordered. The backup follow-up below separately permits up to four independent immutable destination copies. A failed read stops admission of more reads and waits for already-started reads to settle before reporting failure.

For Google Drive, fresh complete folder enumerations provide metadata for the retained objects before and after their body reads. This replaces individual metadata requests. Every requested file must appear exactly once with a valid location, kind, transaction binding, and hash. Incomplete pages, duplicate IDs, missing files, or changed bindings fail closed. Every body is still fetched and hashed. Adapters without bulk metadata support retain their individual metadata reads; a failed bulk request never silently falls back or returns a partial result.

Folder enumeration is not an atomic snapshot. The two listings bracket the body reads and detect binding changes during that interval, but they do not turn Drive or the session marker into a server-enforced transaction or lock. No metadata or body verification is cached across calls.

The Drive adapter can return the metadata and bytes it actually read back after an immutable create. The outer storage verifier rechecks their exact identity, location, kind, transaction binding, and SHA-256. A successful upload response or a hash-only return value is insufficient. Adapters without a complete receipt and ambiguous outcomes still use exact-ID read-back.

Recovery can reuse a journal's already-verified bytes within that same recovery operation only when the folder enumeration agrees with its catalog binding. New or unindexed journal files still require a full read. Recovery retains its final history check, and transaction staging can use that result only after confirming the exact manifest has not changed. Verification remains separate before financial publication, before catalog finalization, and after commit.

A changed canonical save checks fresh ownership and the exact expected manifest before handing off to the engine. The engine then verifies all retained history before any mutation. This avoids a duplicate preflight history scan. An unchanged save still performs its full storage verification. Stale proposals and corrupted unselected history remain failures.

File IDs are allocated lazily in batches of 16. Batch validation rejects incomplete, duplicate, or reused IDs. An assigned ID remains unchanged through an ambiguous create and recovery; batching does not retry or replace a write.

## Backup and portable restore

**Verified in the same invented HTTP simulation:** the completed canonical recipe selects 66 current objects but retains 226 objects: 68 data objects, four commit records and 154 journal events. Backup and restore must copy all 226. Their 229 immutable creates also include a preparation marker, a locator catalog and the final manifest. One ordered update marks the preparation ready. This fixture has no retained original CSV files; the separate original-file retention workflow is unchanged.

The serial baseline is `catalog-backup.mjs` at `70728162c4c20918c152a08a90856f2e0328dbfa`. Both versions use the same current HTTP transaction/session adapters and complete live-recipe source. The comparison first passes all 25 recipe assertions, then checks the exact portable archive, every retained byte and logical binding, distinct physical IDs, and complete reopened canonical graphs and collection order. The source manifest stays unchanged.

| Operation | Before requests | After requests |
| --- | ---: | ---: |
| Portable export | 235 | 235 |
| Verify portable archive in memory | 0 | 0 |
| Backup into a fresh destination | 1,874 | 1,874 |
| Reopen canonical graph from backup | 238 | 238 |
| Restore archive into a fresh destination | 1,635 | 1,635 |
| Reopen canonical graph from restore | 238 | 238 |

The counts include source verification and final source-manifest recheck for backup, per-mutation ownership checks, exact-ID create read-back, and full destination history verification before and after manifest publication. Connection, folder initialization, session release, periodic heartbeats, OAuth, fixture downloads, retries, pagination and browser CORS requests are excluded. Independent test-only history comparisons occur outside the measured operation. The original 24-step recipe still uses 4,633 requests before human reconnect.

The improvement comes from overlapping up to four independent retained-object copies. It does not remove requests or integrity checks. Each admitted copy keeps its assigned physical ID and completes its ownership check, create and exact-ID verification. Catalog entries retain their input order even when uploads finish out of order. After a failure, the pool stops admitting objects and drains every started operation before quarantine or releasing either session gate. Preparation, original-import restoration, catalog creation and final manifest publication stay ordered. The full source recheck and both destination verifications remain mandatory.

**Verified local delay experiment on Node 24.22.1, Linux x64:** with an invented 2 ms wait before every simulated HTTP response, three runs gave the medians below. These times include local hashing, validation and timer scheduling. They demonstrate overlapping waits in this experiment and are not Google latency estimates, live backup times or Safari measurements. No regression test imposes an elapsed-time threshold.

| Operation | Serial median, ms | Bounded-copy median, ms |
| --- | ---: | ---: |
| Backup | 3,213.65 | 1,321.88 |
| Restore | 3,040.38 | 1,118.96 |

The delayed experiment observed one concurrent immutable create before and four after. Periodic heartbeats are disabled only in this simulation. Production source and destination heartbeats continue unchanged and may overlap these requests, so four is a retained-copy worker limit, not a global HTTP-concurrency limit. The original canonical save recipe still has serial durable writes.

Run `node tests/benchmark-backup.mjs --baseline-ref=7072816 --latency-ms=2 --runs=3` to repeat the comparison. The benchmark loads that committed backup module into a temporary local file and uses current shared adapters and fixture assertions for both versions. It does not check out another branch or contact Drive. Omitting `--baseline-ref` measures only the current implementation; omitting `--latency-ms` adds no timer delay. Request budgets run with `node --test tests/pr28-backup-budget.test.mjs tests/pr28-request-budget.test.mjs`. The original recipe tests keep their existing assertions through a shared fixture helper.

The PR25 page now reports fixed copy phases, verified-object counts, elapsed time and final duration. A count measures objects that completed their individual verification; it is not an estimate of time remaining or proof that the copy is usable. The page reports success only after final verification and destination-session release. Its timer includes time spent choosing a destination, so it is not a network-only measurement. Missing clocks remain unmeasured. Progress callbacks receive no file identifiers or object bytes, and callback failures cannot change storage outcomes. Archive-file loading uses the same busy guard as copying to prevent overlapping actions from replacing its result.

## Request counters

Request metrics observe the shared fetch path used by both the transaction and session adapters. They report aggregate counts, HTTP methods and status classes, rejected fetches, duration, and concurrent requests. Fetch duration ends when response headers arrive; phase elapsed time also includes body reads and verification. They do not retain or copy URLs, file or folder identifiers, tokens, headers, request/response bodies, financial records, or raw error messages. Metrics stay in memory and are not restored after reload.

Metrics are diagnostic evidence, not proof that a financial operation passed. A slow or failed request must not be converted into a successful acceptance result. Instrumentation failure must not change the fetch result or bypass a storage check.

The guided page shows elapsed time beside each live result and an overall active-run time. A phase measures the named operation and its assertions together. Reconnect attempts accumulate in one explicitly labeled total. The 13 local fixture assertions share one measured recipe duration, including fixture loading; those times must not be added together. Missing and historical timings remain unmeasured. Detailed request counts are available separately, and timing values are not persisted across reloads.

## Local ledger work

**Verified with invented data on Node 24.22.1, Linux x64:** repeated activity projection and validation lookups were separate growth bottlenecks. The baseline below is commit `8bc8099a47640a65caec35d6ac2c3af1145e1bad`. Each number is the median of three calls on the same synthetic shape, with one account, one import, one observation per activity, and no existing events or network calls.

| Operation | Activities | Before, ms | After, ms |
| --- | ---: | ---: | ---: |
| Effective activity projection | 250 | 34.41 | 2.52 |
| Effective activity projection | 500 | 255.00 | 4.00 |
| Effective activity projection | 1,000 | 1,931.94 | 7.44 |
| Validate ledger | 10,000 | 755.86 | 50.90 |
| Apply one classification | 10,000 | 2,107.74 | 187.54 |
| Summarize ledger | 10,000 | 1,143.59 | 85.86 |

Activity projection now scans observation membership once per call. Validation builds temporary ID and membership indexes while retaining its validation order and checks. These indexes are discarded after the call. No ledger or verification result is cached between operations.

Run `node tests/benchmark-canonical.mjs` to repeat the synthetic CPU measurements. The regression suite checks bounded access counts instead of imposing machine-dependent timing thresholds.

**Verified in an actual-handler DOM simulation:** the review screen previously created 1,001,000 match options for 1,000 activities and 1,000 pending observations. It now renders ten pending items at a time and creates no match options until their native controls are opened. Each picker displays 50 scoped activities per page, a blank choice and, when needed, one selected target from another page. All ten open pickers therefore contain at most 520 options. Search and page controls keep every eligible target accessible. Previous decisions are also paginated. Typed review fields survive paging and unrelated edits in this tab; a successful explicit reopen clears them. A selected target remains subject to the financial engine's current-state checks when the user applies the decision.

Collapsed collection and rule JSON is generated only when opened. The evidence remains available; its serialization is no longer repeated for every closed section after each edit. Observation and activity tables still render their full contents, so the entire page does not have a constant DOM size.

These measurements do not explain the tiny bundled fixture's live Drive delay and are not device responsiveness measurements. Event-heavy replay, full-ledger cloning and retained storage history still grow with the ledger. This change does not redesign their audit records or recovery boundaries.

## Acceptance

**Verified locally after the backup-copy follow-up:** the complete suite passed 627/627 tests on Node 24.22.1 and Node 26.13.0, with no failures or skips. All browser-module syntax and diff checks passed. Independent storage review found no blocker. New coverage includes failed-copy drainage through actual session release, continuing heartbeats, ambiguous creates, changed ownership, corruption before and after publication, safe progress observers, exact HTTP copy budgets, and actual-handler progress/cancellation/archive-loading behavior. Rendered browser/Safari layout and live Google performance of these changes remain **Open**. The implementation was held locally while the owner tested the existing deployment.

**Verified locally after the timing and local-performance follow-up:** the complete suite passed 599/599 tests on Node 24.22.1 and Node 26.13.0, with no failures or skips. Module syntax and diff checks passed. Independent safety review found no blocker in the metadata brackets, bounded reads, create receipts, exact-base handoff, recovery, ID batching, or metric privacy. The later canonical/UI review compared 22 workflow snapshots and 6,641 malformed-ledger cases against the prior implementation with identical financial results and validation errors. These results do not replace live Google/Safari acceptance of the published commit.

- The same 25 live assertions remain, including the separate human reconnect check. The manual device, interruption, and new-folder backup/restore checks remain separate.
- Synthetic regression tests use the real HTTP adapters and the bulk snapshot path, and enforce request budgets for the complete recipe and repeated small saves.
- Concurrency tests check the bound, out-of-order completion, deterministic results, and drainage after failures.
- Integrity tests retain corrupted historical objects, changed manifests, mismatched journal bindings, ambiguous creates, interrupted writes, and lost ownership as failures or recovery-required states.
- Metrics tests cover rejected fetches, observer failures, overlapping or closed measurement windows, and sanitized output.
- Timing tests cover unavailable clocks, shared fixture runs, cumulative reconnect retries, interruption and historical evidence without changing acceptance outcomes.
- Canonical tests bound lookup work without timing thresholds. Review UI tests cover every page, retained choices and drafts, explicit matching, invalid or inactive targets, reversals, busy controls, successful and failed reopen, and lazy evidence.
- Live elapsed time, Google throttling, Safari responsiveness, and device memory remain **Open** until tested on the published commit. Local request counts do not establish those results.

The work remains synthetic-only under the PR27 production gate. This change does not authorize real-data activation, merging, deployment, or changes to Drive sharing.
