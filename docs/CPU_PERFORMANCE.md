# CPU performance of ledger operations

This page records the in-memory optimizations in the import, replay, report and provider-CSV code, with their invariants and benchmark commands. Storage and network performance is a separate subject; see [performance experiments](archive/PERFORMANCE_EXPERIMENTS.md).

**Evidence class.** All figures are **Verified** on invented data with Node 24.22.1 on a shared host (Nov 8, 2026). They are CPU measurements, not browser, iPhone, Google Drive or end-to-end guarantees. **Open:** browser and device timing, isolated peak memory.

## Invariants every optimization preserves

- Stored formats, identity rules, financial policy and audit history do not change.
- The complete graph is still validated. An index narrows lookups; it never replaces a check.
- Indexes live for one operation only. Nothing is cached across calls or trusted after the input changes.
- Complete outputs, including event order and error precedence, match the unoptimized baseline. Differential tests compare whole results.

## Changes

| Area | Change | Measured effect |
| --- | --- | --- |
| Chronological replay | Validation and projection share one replay. Each event is checked against current indexed state, then applied once. Replaces a quadratic replay of earlier events. | 1,000 activities, 6,000 events: validate 349 → 19 ms, project 407 → 30 ms, summary 469 → 24 ms. |
| Dense multi-year ledgers | Same replay on the dense fixture. | 10 years (23,400 activities): validate 12,024 → 587 ms, project 31,250 → 899 ms. Retained ledger heap 70.6 MiB. |
| Import reconciliation | Import-local indexes replace per-row scans of all observations and activities. Source-ID and composite match paths build only the indexes they use. Matching stops at two candidates, because two already means ambiguous. | 1,000 rows against 50,000 activities: source ID 2,274 → 72 ms, composite 1,302 → 300 ms. |
| Canonical retry | First-match indexes for observation IDs and row ordinals. Run refresh uses one maximum pass instead of sorting dates. | 10,000-row retry overlap 6,687 → 1,864 ms. |
| Explicit command batches | `applyFinancialEvents` validates and clones the ledger once for an ordered command array. Each command still passes event-history checks, and any invalid intermediate state fails the whole batch with no partial ledger. | 100 classifications 608 → 7.5 ms. Invented-year recipe 2,737 → 326 ms. |
| Period report batches | `summarizeLedgerPeriods(ledger, scopes)` validates and projects once for many scopes, with reports in scope order. | 13 reports on a 10-year ledger 7,987 → 909 ms. Event-type reads fell exactly 13×. |
| Provider CSV hashing | Source-row SHA-256 runs in batches of at most 16 jobs. Whole-file syntax validation still runs first, so quoting errors keep precedence over header errors. | 10,000 rows 3,606 → 678 ms. 50,000 rows 7,347 → 3,272 ms. |

## Limits that remain

- Every public operation validates the complete graph, and mutating operations clone it. Hundreds of separate commands repeat that linear work; use the batch API.
- The CSV parser is not streaming. Input and output memory scale with file size. A streaming iterator would change which error is reported first, so it waits for browser memory profiles.
- Composite import matching trades transient memory proportional to existing evidence for fewer scans.
- Batch and report APIs hold one validation context plus references for their duration. A very large caller-supplied scope list remains caller-controlled work.
- Import matching assumes immutable inputs. Side-effecting getters or an `idFactory` that mutates inputs mid-import are outside the equivalence guarantee.
- Invented fixtures do not test provider CSV parsers, source retention, opening balances or investment performance.

## Reproduce

Use only invented fixtures. Set `DENSE_YEARS` (default `1,5,10`) and `DENSE_REPEATS` (default `3`) to shrink the dense workloads. Pass an absolute path to a preserved baseline module for differential comparison; a baseline module is temporary local test material and must not ship in release artifacts.

| Subject | Tests | Benchmark |
| --- | --- | --- |
| Chronological replay | `node --test tests/canonical-event-replay.test.mjs` | `node tests/benchmark-ledger-replay.mjs <baseline>` |
| Dense ledger | `node --test tests/dense-ledger-fixture.test.mjs` | `node tests/benchmark-dense-ledger.mjs <baseline>`; memory: `node --expose-gc tests/benchmark-dense-ledger-memory.mjs <years>` |
| Import reconciliation | `node --test tests/import-reconciliation-indexes.test.mjs` | `node tests/benchmark-import-reconciliation.mjs` (the 50,000-representation case takes minutes) |
| Canonical retry | `node --test tests/canonical-import-retry-indexes.test.mjs` | `node tests/benchmark-canonical-retry.mjs <baseline>` |
| Event batches | `node --test tests/canonical-event-batch.test.mjs` | `node tests/benchmark-event-batch.mjs` |
| Period reports | `node --test tests/canonical-period-reports.test.mjs` (`PERIOD_BASELINE` selects a baseline) | `node tests/benchmark-period-reports.mjs [<baseline>]` |
| Provider CSV | `node --test tests/provider-csv*.test.mjs` | `node --expose-gc tests/benchmark-provider-csv.mjs [<baseline>]` |

The dense fixture uses four persistent accounts and 195 invented activities per month: 2,340, 11,700 and 23,400 activities for one, five and ten years. It supplies parsed-input records directly, so it tests canonical import and replay, not CSV parsing. Its coverage is invented, not reconciled completeness.

A frozen scan oracle in `tests/fixtures/import-reconciliation-scan-oracle.mjs` is test-only and never imported by application code.
