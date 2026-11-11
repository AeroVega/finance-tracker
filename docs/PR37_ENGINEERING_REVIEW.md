# PR37 engineering review

Review began November 11, 2026 at remote head
`288795b63ebf228f2527eef37cd5b0f370c1eb16`. The original checkout was clean;
implementation uses a separate worktree. No concurrent local candidate or
`7d51767126dd835e47a672dbf48320d314f685e6` object was available. Existing
PR and documentation changes are retained. Current direction remains in
[project status](PROJECT_STATUS.md).

## Findings and changes

**Verified:** a single omitted post-create listing reproduces the owner-reported
symptoms through the real session adapter and coordinator against synthetic HTTP.
The marker persists, acquisition fails, and no database initialization occurs.
**Hypothesis:** this could explain the live failure; neither the live folder nor
its marker has been accessed to establish that cause.

The [session contract](SESSION_COORDINATION.md#delayed-marker-visibility-and-cancelled-acquisition)
defines the repair, finite read retries, operation deadlines and cancellation.
Marker verification retries reads only. Known marker identity survives uncertain
outcomes, so a second acquisition cannot create another marker merely because the
first is absent from a listing. Initial claim cancellation is now observed before
manifest initialization; listeners are attached during connection as well as
normal operation. A dispatched request can still commit remotely after abort.

Session ownership queries exclude unrelated database objects while retaining
all candidate markers, pagination and duplicate checks. This removes repeated
transmission and parsing of irrelevant ledger metadata, without removing a
fresh ownership check. Physical verification still inventories the database.

Removed the seeder's unused layout setting and its two constructor-option
assertions. Actual writer selection already belongs to the connected lifecycle
and verified stored profile; legacy-v3 and integrated-v5 roundtrips remain.
Corrected the existing benchmark's default output label from v4 to v5. Its
historical filename is retained to preserve existing commands and evidence links.
No supported format, recovery scenario or historical evidence was removed.

## End-to-end storage trace

| Stage | Active path and authority |
| --- | --- |
| Select/connect | `DashboardSyntheticStorage.connect` authorizes/selects the synthetic folder and checks empty/existing-copy requirements. `ApplicationStorageLifecycle.start` claims the session before initializing a manifest. |
| Seed | The page requests `partitions-v5`; `SyntheticYearSeeder` admits only a verified pristine genesis, prepares the invented year, checks for an exact existing recipe, saves, then independently loads and compares the saved ledger. |
| Acquire/renew | `SessionCoordinator` serializes marker operations independently of financial writes. The Drive adapter checks previous state, performs one mutation and verifies exact bytes. The coordinator verifies its state transition. |
| View/detail/month | `PagedCanonicalLedgerStore.loadVerified` obtains a pinned physical snapshot, fully audits source and derived data, closes current-manifest/ownership evidence and builds the in-memory month index. Workspace views and detail currently use that complete ledger. The partition reader has root-pinned record/month APIs, but they are not a selective cold app open. |
| Edit/save | `CanonicalWorkspaceSession` retains an explicit draft. The store checks append-only transition and exact base; v5 coalesces changed trees. Preparation is owned and audited before `PhysicalRootBinding` publishes recoverable plans, objects, receipts and the root. Save then verifies/readbacks the selected ledger. |
| Reopen | A verified full load, including retained logical/physical history. Byte reuse is private and requires fresh metadata and ownership closure. |
| Backup/restore | `paged-canonical-backup` pins and verifies the source; framed export/restore verifies commitments and fresh destination identity. A late source change blocks publication. Blob fallback, source evidence and inventories still have memory costs. |
| Interrupted write | Uncertain dispatched mutations require exact-state recovery. Pending publication and receipts are retained. Cancellation is not rollback and is not evidence that no remote write occurred. |

## Safeguard inventory

| Safeguard | Failure addressed and decision |
| --- | --- |
| Candidate enumeration, strict shape and duplicate refusal | Ambiguous owner, malformed or hidden second marker. Retained; exclude only unrelated ledger objects from this query. |
| Pre-write marker recheck, exact readback and coordinator verification | Another owner arriving between inspection, dispatch and ownership admission; lost mutation responses. Retained. These checks cannot provide atomic exclusion. |
| Heartbeat with independent marker queue | Long uploads must renew their lease rather than starve behind their own transaction. Retained. |
| Expiry, future-clock and explicit stale recovery checks | Suspended/crashed tabs and uncertain device handoff. Retained; no automatic takeover. |
| Read retry only for absence/exact old record | Transient visibility after our one mutation. Added; errors and conflicting identities do not become successful retries. |
| Cancellation generation and abort deadline | Queued or late claim work after offline/pagehide or stalled network I/O. Added; no authority from a late completion. |
| Financial-write admission/drain and physical operation lifetime | Writes dispatched before cancellation/release may still commit. Retained unchanged; session cancellation cannot replace these guards. |
| Exact base, root/profile binding, hashes and readback | Wrong copy/profile, concurrent changes, missing or modified objects. Retained. |
| Complete semantic source/derived and immutable-transition audit | Self-consistently rehashed wrong totals, omissions or rewritten history. Retained. An index hash cannot replace this proof. |
| Pending plans, receipts, final source pin and recovery | Lost responses, interruption between durable boundaries, stale backup publication. Retained. |
| Fresh version-checked byte/body evidence with bounded lifetime | Avoid rereading immutable bytes while detecting rebinding or stale authority. Retained; caches are not persistent trust. |

## Design assessment and unfinished scope

**Verified:** canonical v5 is integrated, but the desired scalable *application*
is unfinished. Full audit calls the whole-ledger validator, retained commits
validate complete transitions, the store clones the ledger and the workspace
keeps another baseline. Copying the partition reader into the UI would not
remove this work. It would add a second read path and risk presenting derived
results without their source-completeness proof.

Keep one canonical writer and lifecycle per verified profile. New copies remain
v5. Do not add v6 merely to address the marker bug. Existing v4 profiles are
supported data, not disposable scaffolding. V1/v3 fresh-copy migration preserves
legacy evidence; v4-to-v5 migration remains unsupported. Grouped v2 is refused.
No existing folder is silently migrated, pruned or deleted.

A complete next storage milestone requires a bounded semantic audit over source
partitions and relations, history transition validation without whole-ledger
clones, then one root-bound app query interface for summaries, detail and edits.
Position/reconciliation require their complete evidence dependencies, not just
spending totals. Only after equivalent adversarial coverage exists can the old
materializing runtime and its now-redundant tests be removed. This review does
not claim that work implemented, or introduce a partial-database selector/cap.

## Device acceptance

Use a separately approved deployment of the exact reviewed commit. No deployment
was performed in this review. Preserve the originally affected folder and marker.
Use a different newly created empty synthetic folder, and stop other tabs/devices.

1. Preview locally, then explicitly seed the fresh synthetic folder. Verify the
   reported v5 format and complete saved-year readback. A zero durable-write
   counter does not include marker writes.
2. Release and verify the session, then open the saved year on iPhone/iPad Safari.
   Check account/month navigation, transaction detail and monthly summaries.
3. Stage an amount, category and posting-status correction with rationale. Check
   the draft/history, explicitly save, release and reopen on the other device.
4. Keep one session active and confirm the second device refuses acquisition.
   Test background/resume separately from explicit, confirmed stale recovery.
5. Export a backup and restore into another fresh synthetic folder, with the
   source unavailable. Compare source evidence, audit history and exact amounts.
6. Use a disposable synthetic copy for interruption/offline checks. Preserve an
   uncertain result and follow recovery; do not repeatedly press Upload or delete
   markers to force a retry. Stop and report the commit, fixed error code, phase,
   elapsed time and aggregate request counts if ownership is unknown.

Automated HTTP does not model real Drive indexing latency, permission visibility,
Safari timer suspension, OAuth privacy controls or physical-device memory.
Production remains NO-GO; no real-data acceptance is requested.

## Validation and matched measurements

**Verified on code/review head `c07d141a4380c1f1dae597b4638e4d112d442c44`:**
Node 26.13.0, `FINANCE_EXTENDED_STORAGE_TESTS=1`, 768 MiB heap limit and
`--test-concurrency=1` passed **1,988 tests**, no failures, skips or cancellations,
in 326.643 seconds. All browser-module syntax checks and the documentation
checker passed. Chromium loaded the synthetic position preview at 1440×1000
and 390×844 without page errors or page overflow. This is not Safari acceptance.
The two omitted-list regressions independently fail on baseline `288795b` with
`ownership-unknown`, with both successful and lost create responses.

The committed [per-phase CSV](evidence/pr37-session-storage.csv) contains all
72 measured phases, including CPU and memory samples. Eight fresh serial
processes ran A-B-B-A at each fixture size, with no competing local test or
benchmark workload. A is `288795b63ebf228f2527eef37cd5b0f370c1eb16`; B is
`c07d141a4380c1f1dae597b4638e4d112d442c44`, whose runtime implementation is
`d87623c`. Source fingerprints stayed unchanged throughout every run.

Both arms use canonical **v5**, the same invented fixtures and correction
commands, the same 8 MiB physical byte cache, and real lifecycle heartbeat timers.
The baseline harness incorrectly prints v4; its pinned default initialization
and verifier select v5. B corrects that output label. This comparison is not
v4 versus v5 and does not remeasure the earlier 78% upload reduction.

The measured phases are initialization, empty open, seed, open, two-edit save,
no-op save, one retained-history save, warm reopen and cold-adapter reopen.
Every phase completed and verified exact results. Release between reopen phases
and final cleanup are outside the timing/count sums. Body bytes exclude URL,
header and TLS overhead. Dense runs created 336 or 338 physical objects, while marker-request totals
were identical. The physical-layout count variation was not isolated in this
comparison; corresponding A/B samples have identical request and upload-body
counts.

| Activities | Arm | Requests | Upload-body bytes | Response-body bytes | Sum of phase times, seconds |
| ---: | --- | ---: | ---: | ---: | --- |
| 253 | A | 1,530 | 1,949,951 | 16,725,390 | 13.381, 13.926 |
| 253 | B | 1,530 | 1,949,951 | 7,713,861 | 13.254, 13.318 |
| 2,340 | A | 12,260 / 12,288 | 10,415,675 / 10,418,128 | 384,486,364 / 384,878,979 | 88.858, 92.372 |
| 2,340 | B | 12,260 / 12,288 | 10,415,675 / 10,418,128 | 335,702,144 / 335,733,940 | 92.049, 90.818 |

| Activities | Arm | Two-edit save, seconds | Warm reopen, seconds | Cold-adapter reopen, seconds | Cumulative process max RSS, MiB |
| ---: | --- | --- | --- | --- | --- |
| 253 | A | 2.608, 2.839 | 1.328, 1.370 | 2.448, 2.521 | 206.1, 206.4 |
| 253 | B | 2.772, 2.484 | 1.479, 1.381 | 2.238, 2.584 | 207.6, 216.5 |
| 2,340 | A | 18.027, 19.708 | 8.969, 9.852 | 16.299, 17.006 | 424.0, 425.6 |
| 2,340 | B | 18.324, 19.313 | 10.050, 8.865 | 16.848, 16.334 | 449.2, 414.3 |

Response-body volume falls **53.9%** and approximately **12.7%**, respectively.
Requests and upload bodies are unchanged in matched samples. Two runs per arm,
variable GC and synthetic provider CPU do not establish a latency or memory
improvement. The large workload still has expensive full-history/materializing
reads. RSS includes the fake Drive store, request logs, heap and native memory;
these are not browser/device capacity or per-phase memory peaks. No injected
network delay, CORS, OAuth, real Drive indexing latency or physical-device test
is represented. Backup/recovery correctness is covered by the extended suite;
this comparison does not time backup or physical interruption recovery.

To reproduce, check out each named commit separately and run its existing
harness in A-B-B-A order, once with `V4_BENCH_DENSE=0` and once with `=1`:

```sh
V4_BENCH_DENSE=0 V4_BENCH_COLD_REOPEN=1 V4_BENCH_REVISIONS=1 \
  node --max-old-space-size=768 tests/benchmark-v4-workspace.mjs
```

Remote CI is separate. [The published code-head run](https://github.com/AeroVega/finance-tracker/actions/runs/43097313469)
was still queued when this report was prepared; it is not a passing result.
The final evidence commit changes documentation/CSV only. Check its exact remote
head before merge consideration. No merge or deployment was performed.

## Initial-copy readback failure on deployed 56cafc2

**User-confirmed:** deployed `56cafc2815ccfce226bb91ff71cdce885d79cdd1`
reported `write-unresolved`, four verified writes, and five visible files after
26 seconds. Progress remained "Starting…". The failure is in locator publication
inside initial-copy setup, before the synthetic year's seeding phase. The failed
folder and tab must be preserved; no agent inspected their Drive contents.

**Verified synthetically against that exact baseline:** a metadata version
advance between a newly created locator's independent before/after reads
produces the same four-write/five-file state, with nested `version-mismatch`.
A post-create exact-ID metadata 404 produces the same visible state with nested
`object-not-found`. The screenshot and counter do not identify the live cause.
Drive's rounded "0 KB" display does not establish that a file is empty.

The candidate permits up to two additional reads of a newly created page
only after a successful create and an otherwise exact version-bracket failure.
The waits are 100 and 200 ms. Every attempt checks exact identity, folder, kind,
transaction, size and SHA-256, and requires a stable metadata version. Retry
rechecks ownership and the original read lifetime. No POST is repeated, no new
physical ID is allocated for the retry, and no file is deleted. Persistent
version movement, changed bindings/bytes, lost ownership, cancellation and
expired lifetimes leave the exact write unresolved. Historical reads remain
strict; this is not a general retry policy for corrupt history or absent files.

The seeder now explains unresolved writes without recommending a blind reconnect.
A fixed-code diagnostic distinguishes create outcome from later readback failure,
including bounded HTTP status/check-count fields where already available.
It excludes raw messages, file/folder IDs, hashes, URLs, tokens, records and
provider response bodies. It runs locally from the caught error and issues no
Drive requests. A subsequent user action clears the displayed diagnostic.
Initial connection progress now identifies session/setup work instead of keeping
"Starting…" throughout it.

**Verified local normal-path comparison:** exact deployed baseline and candidate
initialization both reached ready with 99 requests, 9,715 request-body bytes,
46,869 response-body bytes, eight transaction-adapter verified writes and eight
files. This is a single synthetic HTTP operation-count check, not a latency or
memory claim. The session marker accounts for the ninth HTTP mutation. The
settled-version regression fails on the baseline and passes on the candidate,
which also seeds and independently reopens an exact two-activity ledger.
Persistent changes, corrupt/rebound pages, offline state, retry cancellation,
strict historical version checks and diagnostic privacy remain covered.

**Publication boundary:** at this incident's review the Pages API again reported
`feat/scalable-storage-foundation` as its publishing source. The candidate is isolated on `fix/pr37-immutable-readback`. PR37 and its Pages
publishing branch remain unchanged at `56cafc2`. Updating that branch would have
deployment effects and requires coordination; no merge or deployment is
authorized by the troubleshooting report alone.
Live cause, device behavior and live acceptance remain open.


**Candidate validation:** runtime `6900bcee518dd448b8dc9dfdcfb10e13b6fd58d1`
passed 1,999 extended tests on Node 26.13.0 with the documented 768 MiB heap,
serial test concurrency and extended-storage flag, no failures/skips/cancellations,
in 316.656 seconds. The targeted locator/seeder/diagnostic run passed 128 tests;
the actual seeder controller passed ten tests. All changed module syntax,
whitespace and 96-document checks passed. Chromium rendered the actual diagnostic
module at 390×844 and 1440×1000 without page errors or horizontal overflow, with
external HTTPS blocked. This does not establish iPhone/iPad Safari or real Drive
behavior. No affected-folder access, merge or deployment was performed. Remote CI
on the isolated branch remains separate from these local results.
