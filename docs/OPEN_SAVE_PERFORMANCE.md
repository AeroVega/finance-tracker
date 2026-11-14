# Open/save performance iterations

## Scope and recovery status

November 14, 2026. Base: `be43951a7b4a09c8e54c1984b1fb41dc39401636`.
Synthetic only. No owner Drive access, unresolved-folder changes, real data,
merge, deployment or production authorization. Alpha targets under 30 seconds
per operation; under 10 seconds is the later goal.

The original local candidate 455c33e and documentation follow-up 9acbff9 were not
published. Their temporary checkout became unavailable after an executor change.
The implementation, tests and benchmark were reconstructed from recorded write
commands and diffs in a persistent workspace. The original commit/tree identity
is not established. Historical measurements below come from recorded results,
not recovered raw logs. Fresh reconstruction validation is recorded separately.

## Implemented safeguards and changes

- Verify at most eight owned-adapter immutable bodies concurrently per invocation, retaining
  full traversal, cross-index, binding, byte/hash, scope and closure checks.
- Stage independent locator pages at most four at a time, children before parents
  and root last. Generic/custom adapters remain serial. Every issued write settles
  before return or failure. Manifest publication remains serial.
- Inspect planned fixed IDs in read-only batches of eight for the owned adapter.
  Descriptor order, uniqueness, generated evidence, complete plan traversal and
  exact occupied-ID checks remain mandatory before admission or staging.
- Preserve causal body errors after draining when a concurrent index read sees
  the resulting scope expiration. Do not loosen the legacy missing-body assertion.

These changes do not complete selective loading, bounded whole-ledger memory,
production controls, recovery acceptance or historical workbook ingestion.

## Reproducible benchmark

Run `FAST_SEED=1 DELAY=400 node tests/benchmark-open-save.mjs` on each revision.
`DELAY` adds a fixed artificial delay in milliseconds to every modeled HTTP
request. FAST_SEED excludes setup latency; effective delay is reported. The
in-memory provider cannot fall through to real networking or credentials.
The fixture starts with 4 accounts, 253 activities and 207 events. The harness
saves one posting correction, releases, independently reopens and asserts exact
graph equality. `PRIOR_EDITS=5` probes five earlier persisted corrections without
claiming to reconstruct the owner's data. Subphase times are nested/inclusive,
not additive. Browser rendering, Safari/device costs and real Drive variability
are absent. Node 24.22.1 was used for the historical measurements.

## Historical local measurements

Seconds, rounded. One run unless repeated rows are shown. Concurrent test load
can add CPU noise; fixed-latency results are proxies, not acceptance thresholds.

| Candidate | Delay | Save | Cold reopen |
| --- | ---: | ---: | ---: |
| Main |100ms|18.288|15.966|
| Body verification overlap |100ms|18.500|11.171|
| Plus level-ordered catalog staging |100ms|18.425|11.621|
| Main |400ms|71.045|61.940|
| Catalog staging candidate run 1 |400ms|67.134|39.650|
| Catalog staging candidate run 2 |400ms|66.821|39.746|
| Plus bounded preflight |100ms|17.619|11.310|
| Preflight candidate run 1 |400ms|63.510|39.495|
| Preflight candidate run 2 |400ms|63.627|39.407|
| Final source with causal-error fix |400ms|63.462|39.389|

With five earlier corrections at 100 ms, main measured 37.149/35.833 seconds and
the catalog-staging candidate 32.218/25.096 for save/reopen. Both made 282/272
requests and reopened the exact graph. This noisy single comparison demonstrates
history sensitivity; it does not establish a reliable larger-history prediction.
An early benchmark attempt correctly rejected an unchanged posting-status edit;
that failed attempt was excluded, and the target activity was corrected.

Transaction execution dominated the 400 ms save: about 55.751 seconds, compared
with 3.130 baseline verification, 0.456 financial-root preparation and 4.105 plan
preparation in the catalog-staging iteration. It made 198 requests including a
heartbeat: 46 lists, 93 metadata reads, 34 body reads, 19 creates, 5 updates and 1 ID
allocation. CPU workers alone would not address that measured dominant cost.

## Prediction and remaining gate

Owner-reported anchors are approximately 65 seconds save and 73 seconds open.
Use separate ratios, not a shared multiplier:

- predicted save = 65 × candidate internal save / main internal save;
- predicted open = 73 × candidate internal open / main internal open.

The final historical candidate estimates about 58 seconds save and 47 seconds
open. It does NOT meet 30 seconds. Corresponding internal 400 ms thresholds would
be 32.8 seconds save and 25.5 seconds open. These are planning estimates, not live
improvements or confidence intervals. Exact history, browser CPU cost and request
mix differ; uploads, lists and reads need not scale equally. Fixed UI/auth/startup
overhead may not scale with request reductions. Heartbeat boundaries
can change counts discontinuously. Recalibrate with one consolidated synthetic
live test when a candidate is promising, not repeated speculative deployments.

## Rejected follow-up and tradeoffs

A fourth local trial overlapped read-only ready/receipt-stage verification. It
passed 102 focused tests and independent review. The preserved candidate at 400 ms
measured 63.704/39.417 seconds; trial runs measured 63.516/39.307 and 63.416/39.534,
with identical 198/144 requests. This was not convincing end-to-end improvement.
Existing verified proofs already serve much of that path. The trial was removed
and is not included in the reconstruction.

Publication-readback shortcuts were also rejected. The lower adapter returns
original manifest input, not a metadata-bound receipt, and an afterMutation hook
can intervene before return. An opaque receipt might remove four media GETs,
about 1.6 seconds at 400 ms, before proof overhead. Nested ownership deduplication
needs an unforgeable operation-scoped capability, not a callback flag or TTL;
its estimated four-listing gain is another 1.6 seconds. Blindly overlapping
ownership and exact-manifest checks can move the manifest check earlier relative
to dispatch. Those modest gains do not justify weakening the publication boundary
or forcing a new proof architecture solely to claim 30 seconds.

## Rejected write-enabled stage probe experiment

A separate local worktree based on `79681135` prefetched four complete fixed-ID
reads before serial preparation and bounded writes. Two 400 ms runs measured
save 58.138/58.623 seconds and reopen 39.439/39.459 seconds, with unchanged
198/144 requests and exact graph equality. Compared with reconstructed controls,
the save gain is about 5.2 seconds (8%). Seventeen focused safety tests passed;
independent source review found no integrity blocker. No full suite was run for
this rejected candidate.

The trial changes preparation-callback occurrence: if callback A creates fixed
ID B after its prefetched absence result, callback B now runs where the serial
path would have found B and skipped that callback. Exact-ID reconciliation still
protects bytes, but owned-adapter gating does not establish arbitrary preparation
callback purity. Rechecking before each callback loses the main gain; a private
trusted-preparation capability adds a new contract. The current trial was not
adopted because the modest gain does not justify that compatibility change and
extra protocol complexity. It would still predict roughly 53 seconds save, not
30. Its patch, focused test and raw measurements remain separate local evidence;
none of that trial is in the retained candidate.

## Owned preparation follow-up

A narrower follow-up restores the stage-probe gain without changing arbitrary
callback occurrence. The factory constructs a pure reader from privately copied
reachable preparation bytes; it never brands a caller callback. The concurrent
path requires both the owned physical adapter and this exact registered reader.
All other preparation callbacks keep their original serial probe path. The
[reader contract](OWNED_PREPARATION_READERS.md) describes ownership, cancellation,
physical checks and the temporary extra reachable-byte copy.

At source `a35f429` (identical tree to integration `c6554d2`), sequential 400 ms
runs bracketed an unchanged `a0a9600` control:

| Run | Save seconds | Cold reopen seconds | Requests save/open |
| --- | ---: | ---: | ---: |
| Owned reader candidate 1 |58.311|39.260|198/144|
| Published checkpoint control |63.511|39.293|198/144|
| Owned reader candidate 2 |58.453|39.582|198/144|

Mean save is 58.382 seconds versus 63.511 control, about 5.13 seconds (8.1%)
faster. Open is unchanged within run variation. Both candidates reopened the
exact saved graph and peaked at four concurrent requests. Using the original
71.045-second internal main baseline and the single 65-second owner save anchor
predicts about 53 seconds save, not 30; this remains a rough model, not live
acceptance. Independent source review found no blocker. Focused protocol tests
passed; final integrated full-suite validation is recorded below.

## Bounded cross-index follow-up

The owned locator verifier overlaps identities/files index lookups only when
fewer than three body reads are pending, preserving the four-read ceiling
within that verification invocation. Both lookups settle before mapping acceptance or the next body read.
Generic providers remain serial; full traversal, each mapping check and closing
witness validation remain mandatory. Substantive failure causes are preserved
when a sibling sees a closed verification scope.

At source `f839e834`, two 400 ms runs reopened in 37.914/37.983 seconds versus
the fresh `a0a9600` control's 39.293 seconds. Save measured 63.318/63.553 versus
63.511 control, so no save improvement is claimed for this change. Counts stayed
198/144 and peak concurrency four; exact graph equality passed. Seven focused
tests passed, including corrupt indexes, cancellation and the combined read cap.
This was retained for combined final validation, not interpreted as live
acceptance. Detailed results are in [the cross-index note](CROSS_INDEX_EXPERIMENT.md).

## Combined incremental candidate

The combined code at `b9ee4f7` (documentation successor `ae96e3c`) measured:

| 400 ms run | Save seconds | Cold reopen seconds | Requests save/open |
| --- | ---: | ---: | ---: |
| Combined 1 |58.175|37.997|198/144|
| Combined 2 |58.308|38.215|198/144|

Mean save/open are 58.241/38.106 seconds, versus the interleaved published
checkpoint control's 63.511/39.293. This is about 8.3% faster save and 3.0% faster
open relative to that checkpoint. Both runs retained exact reopened graph
equality and observed peak concurrency four. Separate original-main owner-anchor
ratios predict roughly 53 seconds save and 45 seconds open. These two synthetic
repeats do not establish real-device latency, confidence intervals or the
30-second target. Independent source reviews cleared both retained changes;
full integrated validation is recorded below.

## Selected read width

The current candidate raises only owned verification/preflight read admission
from four to eight. Generic readers remain serial; immutable writes, catalog
staging and pure-preparation stage probes remain at four. The paired-index guard
admits two lookups only with fewer than seven pending body reads, preserving an
eight-read bound within that verification invocation, not a process-global cap.

| Width | Save run 1/run 2 seconds | Open run 1/run 2 seconds | Requests save/open |
| --- | --- | --- | --- |
| 4 |58.175 / 58.308|37.997 / 38.215|198/144|
| 6 |58.020 / 58.328|36.040 / 36.110|198/144|
| 8 |58.206 / 58.195|35.050 / 34.793|198/144|

At width eight (`25ef336`), mean open is 34.921 seconds: 3.185 seconds (8.4%)
faster than width four and 1.154 seconds (3.2%) faster than width six. Save is
unchanged within variation for this width adjustment. Every run independently
reopened the exact saved graph. Peak requests were the selected width; observed
save/open mutations stayed at four/one. Corruption, cancellation, actual HTTP 429,
exact batch drainage and nonmultiple tails have focused tests. No retry or
provider-quota setting changes were made.

Relative to the published checkpoint control, the combined current changes
improve mean save by about 8.4% and open by about 11.1%. Original-main owner-anchor
ratios now predict approximately 53 seconds save and 41 seconds open, still not
30 seconds or live acceptance. Eight reads increase burst pressure; four extra
64-KiB bodies represent up to 256 KiB additional raw admission capacity, not a
whole-process heap bound. See [the read-width note](READ_WIDTH_EXPERIMENT.md) for
separate memory profiling and its limitations. No broader opening-flow shortcut
or write-width increase is included.

## Deferred combined-open design

A separate combined recovery/materialization experiment passed 84 focused tests
but failed an actual Dashboard-to-Workspace integration regression. Dashboard
retention and callbacks run after recovery; moving the store audit before them
allowed a callback to change retained body bytes/version under the same manifest
without the optimized open rejecting it. The original ordering correctly refused
that case. A final manifest-only check is insufficient. Moving retention inside
recovery also risks nesting the ownership write queue and changing recovery
boundaries. This experiment is not included. Further open-flow changes need an
explicit design preserving those final witnesses and callback ordering.

## Preparation-lifetime regression check

The first combined extended run passed 2076/2077 tests. The one failure expected
an escaped output preparation reader to report `verification-scope-closed` when
asked for an unprepared base object. Independent review confirmed that this was
an assumption about the old fallback, not the actual base-reader authority: the
new output map has no storage fallback and reports `object-not-found`.

The integration test now captures both readers. It still requires the callback's
base reader to expire with exactly `verification-scope-closed`. It separately
requires the returned immutable map to reject the missing base hash during and
after preparation without provider I/O, while prepared bytes remain readable and
isolated from returned-buffer mutation. The production implementation was not
relaxed to satisfy the test. Fifty focused preparation tests passed after this
correction; the fresh aggregate run below subsequently passed.

## Validation

**Final selected code `00cd939`: 2083/2083 extended tests passed**, zero failures,
skips or cancellations, in 484.5 seconds. Command:
`FINANCE_EXTENDED_STORAGE_TESTS=1 node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs`.
Node 24.22.1. All JavaScript/prototype syntax, registered diagnostic-code audit
(zero unregistered sites), generated reference, documentation and diff checks
passed. Independent source reviews cleared the pure-reader gate, paired-index
lookup and selected read bound. Later changes only record results in documents.
The full pass includes the strengthened preparation-lifetime regression; no
failed assertion was deleted or broadened to accept either error code.
No live Drive/device acceptance, remote CI pass, merge or deployment is claimed.


Historical candidate: 2057/2057 extended tests passed, zero skipped, in 533.7s.
Independent review found no remaining blocker; the missing legacy-body regression
passed eight repeated focused runs. Syntax, registered-code audit, generated
reference, documentation and diff checks passed. These historical results do not
substitute for reconstruction verification.

Fresh reconstruction at `79681135`: targeted concurrency/legacy suite 17/17
passed. Syntax, registered-code audit, generated reference, documentation and
diff checks passed. Full extended suite passed 2057/2057, zero skipped, in
516.6 seconds (serial, 768 MiB heap). Two fresh 400 ms runs
measured save 63.541/63.607 seconds and reopen 39.223/39.595 seconds, with the
same 198/144 requests and exact graph equality. These support the earlier rough
58-second save / 47-second open prediction, not the 30-second gate. No remote CI
or actual Drive/device acceptance has been established for this local work.

A deeper source review found no small safe shortcut capable of closing the gap.
The owned semantic scope already caches two audited ledgers and 128 verified
edges; repeated call sites do not mean repeated full validation costs. Fresh
profiling places 52.20 seconds in the save transaction, 3.16 in baseline
verification and 0.50 in financial preparation. Open's second baseline costs
4.28 seconds inside a 9.00-second ledger-load phase. Even eliminating that
entire phase would not close the approximately 14-second internal open gap.
Opaque exact-root recovery/materialization proofs and publication/ownership
receipts would require separately designed contracts and invalidation tests,
not bypassing checks. Larger architectural changes are not included here.

Do not remove integrity fields, replace complete inventory with partial listings,
relax uncertain-write handling, reorder authority publication or use unbounded
concurrency. Drive batch requests exclude media transfers, have no execution-order
guarantee and count every part toward quota ([Drive performance guidance](https://developers.google.com/workspace/drive/api/guides/performance)).

Provider quotas were not verified for the actual Cloud project. Google's current
[Drive limits guidance](https://developers.google.com/workspace/drive/api/guides/limits)
notes project-dependent quota rules and additional backend rate limiting. A wider
local read cap does not prove absence of live throttling. No retry, billing or
quota-setting changes are included; the separate cost/production review remains.
