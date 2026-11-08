# Canonical import retry CPU

**Verified locally:** Canonical retry preparation now builds first-match indexes for observation IDs and source row ordinals. Lifecycle event creation uses a row-ordinal index, and retry command deduplication uses an operation-local set that includes newly appended commands. Run refresh finds the latest active effective date with one maximum pass instead of sorting dates.

No index is persisted or retained across operations. First-match behavior matters when a supplied retry contains duplicate ordinals: the first row remains authoritative for exact normalization comparison. Final graph validation still rejects duplicate durable IDs. Candidate normalization, accepted identities, source evidence, retry counts/audit and lifecycle source links are unchanged. This changes local lookup work, not storage or financial semantics.

## Reproduction

Use only the invented fixtures in `tests/helpers/canonical-retry-fixture.mjs`.

```
git show 52603c1:js/canonical-import.mjs > js/.canonical-import-retry-baseline.mjs
node tests/benchmark-canonical-retry.mjs js/.canonical-import-retry-baseline.mjs
rm js/.canonical-import-retry-baseline.mjs
node --test tests/canonical-import-retry-indexes.test.mjs
```

The benchmark compares complete returned objects with the unchanged baseline before reporting measurements. Both implementations receive identical IDs and timestamps. The overlap fixture includes unresolved reviews, an accepted row and a malformed row. The lifecycle fixture posts previously pending rows using stable source IDs.

One Node 24.22.1 run in the development container measured:

| Scenario | Rows | Baseline ms | Indexed ms | Ratio |
| --- | ---: | ---: | ---: | ---: |
| Retry overlap | 1,000 | 313.2 | 198.2 | 1.58x |
| Retry overlap | 10,000 | 6687.4 | 1863.9 | 3.59x |
| Pending to posted | 1,000 | 108.5 | 103.1 | 1.05x |
| Pending to posted | 10,000 | 1790.8 | 1212.4 | 1.48x |

**Verified:** All four complete output comparisons passed. Four focused tests passed, covering bounded find-callback counts at 1k/10k, immutable input and accepted evidence, retry audit counts, first-match duplicate ordinals, normalization/missing-row failures, and lifecycle links. The combined canonical suites passed 85/85 after the additions. Module syntax and diff checks passed. The complete repository suite was also started; its result is not included in this focused validation claim.

These are single-run wall-clock measurements while other tests were running, not a browser performance guarantee. Validation, cloning, reconciliation and replay still contribute to total runtime. The deterministic callback budgets prevent the specific nested find scans from returning without relying on timing thresholds.

**Open:** Browser/device timing and independent review. No real financial data, live Drive action, push, merge or deployment was used.
