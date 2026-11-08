# Import reconciliation CPU indexes

**Verified, November 8, 2026:** The pure synthetic import matcher now builds import-local indexes instead of scanning all observations and activities for every incoming row. No persistent format, identity rule, financial policy, storage path, or production gate changes.

## Design and correctness

- Source observations are grouped by provider ID within the requested account. Activity IDs stay in first-observation order. IDs resolve when each row runs, including dangling observations that acquire a newly created target during the file.
- Activity lookup preserves the original first duplicate ID. Historical evidence validity still uses the last duplicate ID, matching the previous implementation. Reversals only see activities that existed before this import.
- A small transition map records the latest pending-to-posted state without replaying every prior event for each row.
- Composite indexes are built only when a row without a source ID needs them. Nested Map keys include institution, account, currency, date, description and action. They preserve object identity without serializing open-ended fields. Separate raw-money and exact-decimal keys retain money equivalence without floating-point conversion. Each exact bucket deduplicates activity IDs before matching.
- Every composite candidate still passes the original equality check. Bucket collisions do not establish identity. Historical evidence remains review-only, and new same-file activities do not enter the composite index.
- Both match paths stop after finding two distinct candidates, because that already establishes ambiguity. Output observations, events, row ordering, and counts remain unchanged.
- Coverage extrema are accumulated without sorting the date array.

The indexes use additional memory proportional to existing observations and evidence. This trades transient memory for fewer repeated scans. Repeated equivalent historical representations of one activity occupy one candidate entry per exact-money bucket. Browser memory and whole-pipeline import time are separate acceptance work.

## Verification

The frozen scan implementation in tests/fixtures/import-reconciliation-scan-oracle.mjs comes from baseline c41448b. It is test-only, not imported by application code.

Run:

- node --test tests/import-reconciliation-indexes.test.mjs
- node --test tests/import-reconciliation.test.mjs tests/canonical-import*.test.mjs
- node tests/benchmark-import-reconciliation.mjs

Differential coverage compares the complete result, including activity and event order. It covers 250 seeded adversarial imports, an exhaustive matrix of null/missing money, decimal scales, zero signs and supported/unknown currencies, duplicate activity IDs, dangling references, current-file ID collisions, source conflicts, historical evidence and reversals. Operation-count tests bound field reads for 5,000 existing activities and 1,000 incoming rows, including large ambiguous buckets and 50,000 historical representations of one candidate. Additional oracle checks cover BigInt, Symbol, cyclic object and function fields, object identity and property order, NaN, negative zero, and the original shallow reference aliases in returned records.

## Synthetic benchmark

**Verified:** One Node 24.22.1 run in the development container, with 1,000 overlapping rows. Every timed result was checked against the scan oracle. These are CPU measurements, not browser, Drive or end-to-end guarantees.

| Existing activities | Match path | Scan ms | Indexed ms | Speedup |
| ---: | --- | ---: | ---: | ---: |
| 1,000 | Source ID | 104.7 | 10.1 | 10.4x |
| 10,000 | Source ID | 455.3 | 21.1 | 21.6x |
| 50,000 | Source ID | 2273.9 | 71.5 | 31.8x |
| 1,000 | Composite | 39.2 | 18.6 | 2.1x |
| 10,000 | Composite | 293.4 | 70.9 | 4.1x |
| 50,000 | Composite | 1301.5 | 300.3 | 4.3x |

The benchmark keeps merchant and date identical while varying amounts. The composite gain therefore depends on the exact-money index, not just convenient descriptions or dates. The later ambiguity early-exit change has separate operation-count coverage.

**Open:** Independent browser/device measurements and deployment validation. No real financial data, live Drive actions, push, merge or deployment were used.


## Pure API boundary

**Verified:** Open-ended action and normalized-description values are compared by their original strict equality. They do not need to be JSON-serializable. Source field objects keep their prior shallow aliases in newly returned activities and observations.

**Open:** Inputs with side-effecting getters, or an idFactory callback that mutates existing inputs while reconciliation is running, are not covered by equivalence guarantees. The indexes describe the import's initial evidence. Canonical callers supply immutable records; this does not change their accepted data contract. This is a narrower execution assumption than the old scan algorithm's incidental visibility of callback-driven mutations.

## Repeated historical evidence

**Verified:** The hardened nested-Map version compared complete results with the same scan oracle for 1,000 repeated incoming rows matching one activity through retained exact-decimal evidence:

| Retained representations | Scan ms | Indexed ms | Speedup |
| ---: | ---: | ---: | ---: |
| 1,000 | 2524.6 | 15.8 | 159.8x |
| 10,000 | 32185.4 | 33.5 | 960.8x |

A deterministic 50,000-representation operation-count test also passes. These represent a deliberately pathological repeated-history case, not typical imports. The standalone benchmark includes a 50,000-representation scan and can take several minutes.
