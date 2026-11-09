# Provider CSV hashing

## Verified implementation

CSV source-row SHA-256 operations use batches of at most 16 jobs rather than one round trip per row. Every rejection is observed immediately. All jobs in a batch settle before its earliest source-row failure is reported, and a failed batch prevents the next batch from starting. Final file hashing still follows the row hashes. The parser does not offer cancellation.

Whole-file CSV syntax validation still happens first. This preserves quoting-error precedence over header errors. Fields, fingerprint serialization, input-byte copying, multiline physical lines, row ordinals, invalid-row error precedence, and output order remain unchanged. Processed intermediate row arrays are released without allocating a second all-rows slice. This is not a streaming or constant-memory parser: input and output remain proportional to file size.

## Verified synthetic Node observations

Run `node --expose-gc tests/benchmark-provider-csv.mjs`. An optional module path selects a preserved baseline. Three sequential runs per size used entirely invented merchant descriptions, amounts and dates. Baseline and changed modules ran sequentially; shared-host contention still makes timings noisy.

Median wall time for baseline / final implementation:
- 1,000 rows: 902 / 179 ms.
- 10,000 rows: 3,606 / 678 ms.
- 50,000 rows: 7,347 / 3,272 ms.

Median CPU time at 50,000 rows was 5,827 / 4,529 ms. Maximum end-of-parse heap sample at 50,000 rows was 105 / 112 MiB; this is not a peak-memory measurement or evidence of a general memory reduction. An intermediate batching-only prototype retained 163 MiB in the same sample, motivating release of consumed row arrays. Browser and Safari performance remain open; no device-speed claim is made.

## Validation

All 14 pre-existing provider tests and five bounded-hashing tests pass. The latter cover 1,031 rows, reordered digest completion, the 16-job ceiling, earliest-row digest failure, draining all failed work without unhandled rejections, no subsequent batch after failure, syntax error precedence, ArrayBuffer/Uint8Array mutation isolation, and final file-digest failure. Seventy neighboring canonical import, reconciliation and contract-fixture tests also pass.

An external differential check compared complete baseline and final outputs at 1,000, 10,000 and 50,000 invented rows, including multiline quoted descriptions, blanks, malformed amounts/statuses and surplus cells. This was kept outside production modules. No real financial data, network access, merge, deployment or production activation was involved.

## Deferred design

A streaming row iterator could reduce intermediate allocation further, but naive streaming changes which error is reported first. A separate syntax-validation pass would preserve precedence at the cost of parsing twice. That larger change is deferred until browser memory profiles justify it.
