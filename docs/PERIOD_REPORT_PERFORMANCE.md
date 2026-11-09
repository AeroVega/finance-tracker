# Explicit period report batches

**Implemented:** `summarizeLedgerPeriods(ledger, scopes)` accepts an explicit array of the same scope objects as `summarizeLedger`. It returns reports in scope order, validating and projecting the full ledger once for that operation. Empty lists still validate the ledger. Invalid lists fail with `invalid-report-scopes`; invalid scopes fail without returning partial results.

The private context reuses the validation account map, active activities and unresolved observations. Each report keeps its own account selection, exact decimal totals, exclusions and insertion-ordered reasons. Coverage checks, refund posting-date exclusions and incomplete-history qualifications are unchanged. Duplicate account IDs do not duplicate activities. No input is mutated, no context is exposed, and no ledger state or validation result survives between calls. The ordinary single-report API retains its validation and scope error behavior, including malformed non-array account selections.

Only the invented-year generator adopts the batch API: its annual report and twelve monthly reports share one operation. There is no UI, storage, persistence format, network or real-data change.

## Local evidence

**Verified November 8, 2026, Node 24.22.1, Linux x64:** three alternating measurements per operation against the canonical implementation published at `86e8e38f492e44a27258407168ce2156ddabe1ac`, using the dense invented fixture. Thirteen scopes comprise its full range and twelve first-year months. Complete outputs, including exclusions and reason order, match separate baseline reports.

| Invented years | Activities | Events | Separate median ms | Batch median ms | Speedup |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 2,340 | 2,316 | 780.20 | 104.90 | 7.44× |
| 5 | 11,700 | 11,580 | 5,239.40 | 618.10 | 8.48× |
| 10 | 23,400 | 23,160 | 7,987.24 | 908.62 | 8.79× |

Event-type reads fell exactly 13×: 331,032 → 25,464; 1,655,160 → 127,320; and 3,310,320 → 254,640. Regression tests assert operation counts rather than timing thresholds. Concurrent local testing can distort timings; these are not browser, iPhone, Google latency or production-scale guarantees.

The batch holds one validation/replay context plus activity/observation references for its duration and returns all requested reports. It does not retain thirteen replay contexts. Peak memory was not isolated: the combined benchmark process reached approximately 829 MiB RSS after generating and measuring the largest fixture; that is not an incremental batch-memory measurement. Returned exclusions still scale with the requested reports. A huge arbitrary scope list remains caller-controlled work, not a constant-memory API.

**Verified:** baseline differential tests cover overlapping periods, account subsets and duplicates, empty selection, different currency, missing coverage, pending/unknown lifecycle, review/rejected observations, inactive retained activities, missing refund posting dates and malformed account selections. Thirty additional malformed ledger/scope combinations had identical single-summary error name/message. Complete invented generator JSON is byte-equal to the baseline for 2024, 2025 and 2026.

Run `node --test tests/canonical-period-reports.test.mjs` for focused regression checks. Set `PERIOD_BASELINE` to an absolute path to a compatible prior canonical module for differential checks. Run `node tests/benchmark-period-reports.mjs [absolute-baseline-module-path]` for dense timing and output comparisons; `DENSE_YEARS` and `DENSE_REPEATS` restrict its workload. Baseline modules are temporary local test material and must not be included in static release artifacts.

**Verified locally:** the full suite passed 791/791 tests. After reusing the existing validation account map, the final report/generator suites passed 14/14; module syntax and `git diff --check` passed. No browser or live-service checks were performed.

**Open:** real-device timing and isolated peak-memory profiling. This local change does not authorize production persistence, live data, publication, merge or deployment.
