# Tier 0 save measurement

This change instruments the synthetic benchmark, not the live app. No provider
requests, credentials, ledger contents, identifiers, URLs or free-text errors
are added to its aggregate telemetry. `requestMetrics` uses fixed category/kind
labels, counts and request/response bytes. Unknown labels collapse to fixed
buckets. This guarantee applies only to the new `requestMetrics` helper, not
all benchmark stdout: existing `byKind` output is dynamic and the optional
concurrency-note environment value is printed verbatim. Byte totals are fixture
payload bytes, not headers, compression or total wire traffic. Session-marker traffic is visible but marker listings may remain in
`unknown`; do not describe the other buckets as heartbeat-free.

Configured save latency now applies to the initial staged save and every retained
save, restoring the previous delay even on failure. `effectiveDelayMs` is the
configured synthetic delay, not a measured network latency. Setup, no-op save
and reopen remain at zero delay. Do not compare their elapsed times as if they
used the same network conditions. The helper assumes sequential operations.

## Reproduction baseline, not an enforced budget

The following measurements used the production tree published at `18aaed4`,
with only the benchmark retained-delay correction for the 120ms run. Both runs
passed final exact-reopen assertions. These are single synthetic observations,
not live predictions or timing thresholds.

| Fixture/action | Artificial delay | Requests | Response bytes | Elapsed |
| --- | --- | --- | --- | --- |
| Standard 253 activities, first save | 120ms | 186 | 637,784 | 18.325s |
| Standard, fifth retained revision | 120ms | 271 | 1,157,489 | 32.385s |
| Dense 2,340 activities, first save | 0ms | 362 | 8,488,601 | 12.214s |

Standard zero-delay retained-save request counts were 186, 203, 215, 227, 239,
271, 295 for the initial save through revision six. Long runs can cross heartbeat
and catalog-split thresholds; do not treat these as immutable exact budgets or
fit a linear per-revision latency model. Physical IDs and session timers are not
fully deterministic. Repeated matched runs are needed for improvement claims.

`complexity` records explicitly say `targetStatus: not-enforced` and
`acceptance: measurement-only`. There is no passing 30-second acceptance claim
or expected-failure test masquerading as an enforced performance guardrail.
Targets for fixed fixtures/history depths should be agreed separately, then
added as explicit gates without relaxing integrity tests.

## Checks and commands

- `node --test tests/benchmark-save-metrics.test.mjs` checks delay restoration,
  rejection, fixed-label aggregation, absence of input strings in output and an
  actual one-revision benchmark subprocess. That subprocess must exit cleanly,
  including final equality checks, not merely print a successful phase.
- `V5_BENCH_SINGLE_EDIT=1 V5_BENCH_REVISIONS=6 node --max-old-space-size=1536 tests/benchmark-v5-workspace.mjs`
- `V5_BENCH_DENSE=1 V5_BENCH_SINGLE_EDIT=1 V5_BENCH_REVISIONS=0 node --max-old-space-size=2048 tests/benchmark-v5-workspace.mjs`
- `V5_BENCH_SAVE_LATENCY_MS=120 V5_BENCH_SINGLE_EDIT=1 V5_BENCH_REVISIONS=5 node tests/benchmark-v5-workspace.mjs`

This is coarse operation-level measurement. Internal phase tracing, exclusive
critical-path attribution, complete-history protocol changes and live diagnostic
instrumentation are not implemented here. Do not add overlapping inclusive
phase durations or multiply total requests by latency to predict elapsed time.
