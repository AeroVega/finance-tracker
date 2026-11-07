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

Independent immutable history reads use a bounded pool. Financial publication, catalog finalization, session updates, and other mutations remain ordered. A failed read stops admission of more reads and waits for already-started reads to settle before reporting failure.

For Google Drive, fresh complete folder enumerations provide metadata for the retained objects before and after their body reads. This replaces individual metadata requests. Every requested file must appear exactly once with a valid location, kind, transaction binding, and hash. Incomplete pages, duplicate IDs, missing files, or changed bindings fail closed. Every body is still fetched and hashed. Adapters without bulk metadata support retain their individual metadata reads; a failed bulk request never silently falls back or returns a partial result.

Folder enumeration is not an atomic snapshot. The two listings bracket the body reads and detect binding changes during that interval, but they do not turn Drive or the session marker into a server-enforced transaction or lock. No metadata or body verification is cached across calls.

The Drive adapter can return the metadata and bytes it actually read back after an immutable create. The outer storage verifier rechecks their exact identity, location, kind, transaction binding, and SHA-256. A successful upload response or a hash-only return value is insufficient. Adapters without a complete receipt and ambiguous outcomes still use exact-ID read-back.

Recovery can reuse a journal's already-verified bytes within that same recovery operation only when the folder enumeration agrees with its catalog binding. New or unindexed journal files still require a full read. Recovery retains its final history check, and transaction staging can use that result only after confirming the exact manifest has not changed. Verification remains separate before financial publication, before catalog finalization, and after commit.

A changed canonical save checks fresh ownership and the exact expected manifest before handing off to the engine. The engine then verifies all retained history before any mutation. This avoids a duplicate preflight history scan. An unchanged save still performs its full storage verification. Stale proposals and corrupted unselected history remain failures.

File IDs are allocated lazily in batches of 16. Batch validation rejects incomplete, duplicate, or reused IDs. An assigned ID remains unchanged through an ambiguous create and recovery; batching does not retry or replace a write.

## Request counters

Request metrics observe the shared fetch path used by both the transaction and session adapters. They report aggregate counts, HTTP methods and status classes, rejected fetches, duration, and concurrent requests. Fetch duration ends when response headers arrive; phase elapsed time also includes body reads and verification. They do not retain or copy URLs, file or folder identifiers, tokens, headers, request/response bodies, financial records, or raw error messages. Metrics stay in memory and are not restored after reload.

Metrics are diagnostic evidence, not proof that a financial operation passed. A slow or failed request must not be converted into a successful acceptance result. Instrumentation failure must not change the fetch result or bypass a storage check.

## Acceptance

**Verified locally:** the complete suite passed 527/527 tests on Node 24.22.1 and Node 26.13.0, with no failures or skips. Module syntax and diff checks passed. Independent safety review found no blocker in the metadata brackets, bounded reads, create receipts, exact-base handoff, recovery, ID batching, or metric privacy. These results do not replace live Google/Safari acceptance of the published commit.

- The same 25 live assertions remain, including the separate human reconnect check. The manual device, interruption, and new-folder backup/restore checks remain separate.
- Synthetic regression tests use the real HTTP adapters and the bulk snapshot path, and enforce request budgets for the complete recipe and repeated small saves.
- Concurrency tests check the bound, out-of-order completion, deterministic results, and drainage after failures.
- Integrity tests retain corrupted historical objects, changed manifests, mismatched journal bindings, ambiguous creates, interrupted writes, and lost ownership as failures or recovery-required states.
- Metrics tests cover rejected fetches, observer failures, overlapping or closed measurement windows, and sanitized output.
- Live elapsed time, Google throttling, Safari responsiveness, and device memory remain **Open** until tested on the published commit. Local request counts do not establish those results.

The work remains synthetic-only under the PR27 production gate. This change does not authorize real-data activation, merging, deployment, or changes to Drive sharing.
