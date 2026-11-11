# Canonical v5 matched synthetic evidence

Verified November 11, 2026. This is a cumulative comparison of the v5 changes, including owned preparation, against the repaired v4 baseline. It does not isolate the preparation change.

## Sources and method

- Baseline: `1993fb6a3d0e19f9909f48277257c03cad656c41`, tree-identical to published `89a29b612747cc56cefeefd4bbb6bf2a818a939a`.
- Candidate: `39b3d1eea8b80c575a67fcd776980c1745503c23`, tree-identical to publication code commit `d9d04c7`.
- Node 24.22.1; fresh serial processes; 768 MiB heap limit; A1, B1, B2, A2 for each fixture. No overlapping benchmark/test workloads.
- Same invented ledgers and command digests across both arms. Each run verified save/reopen results, final ledger/history and generated-page replay. All create/update attempts succeeded; absence-probe 404 responses are included in total requests, not omitted as retries.
- Harness SHA256: `a891fe18b95e1716f8bb8e4c18792acb67915ac6ff7bc86defee8f6012a39083`.
- Runner SHA256: `467ec9660385371c67e997746aaeb9874dd812f671aaff3efa5435ec1e6a8b07`.

## Results

All counts and byte totals were identical across the two runs within each arm. Bytes below are complete attempted HTTP request bodies, including multipart overhead. Timing is the sum of measured phases, not the untimed generated-page replay.

### standard253

Fixture SHA256: `bc1da7ad6dc32cd3230285b71bedc5ae05357da9e2957dd1ae2d567ca261d5a3`.

| Metric | Baseline A1 / A2 | Candidate B1 / B2 |
| --- | --- | --- |
| Total requests | 1669 | 1628 |
| Total uploaded request bytes | 2336588 | 2063101 |
| Total response bytes | 19814867 | 18417352 |
| Mutation attempts | 131 | 127 |
| Timed phase total (s) | 17.51 / 17.11 | 17.34 / 17.06 |
| Cumulative max RSS (MiB) | 254.9 / 248.5 | 257.1 / 251.3 |
| seed requests | 666 | 666 |
| seed uploaded bytes | 1514122 | 1514122 |
| seed time (s) | 2.65 / 2.71 | 2.94 / 3.34 |
| save-mixed requests | 357 | 339 |
| save-mixed uploaded bytes | 448793 | 316719 |
| save-mixed time (s) | 3.27 / 3.19 | 3.18 / 3.28 |
| save-retained requests | 318 | 299 |
| save-retained uploaded bytes | 363231 | 221783 |
| save-retained time (s) | 5.37 / 5.15 | 5.07 / 4.86 |
| warm-reopen requests | 22 | 22 |
| warm-reopen uploaded bytes | 0 | 0 |
| warm-reopen time (s) | 1.81 / 1.58 | 1.56 / 1.56 |
| cold-reopen requests | 165 | 161 |
| cold-reopen uploaded bytes | 214 | 214 |
| cold-reopen time (s) | 3.05 / 3.12 | 3.27 / 2.65 |

### dense2340

Fixture SHA256: `08e1bd4bb674f45743faf48d6869c8c6e93a792bce38b505efbe3ab0ab22e93b`.

| Metric | Baseline A1 / A2 | Candidate B1 / B2 |
| --- | --- | --- |
| Total requests | 13282 | 12907 |
| Total uploaded request bytes | 13682137 | 10530969 |
| Total response bytes | 427929057 | 407572899 |
| Mutation attempts | 402 | 356 |
| Timed phase total (s) | 114.68 / 112.46 | 112.34 / 104.07 |
| Cumulative max RSS (MiB) | 500.1 / 507.0 | 517.3 / 483.4 |
| seed requests | 4166 | 4172 |
| seed uploaded bytes | 9744634 | 9744634 |
| seed time (s) | 17.73 / 21.13 | 19.25 / 17.78 |
| save-mixed requests | 2094 | 1990 |
| save-mixed uploaded bytes | 2000809 | 434188 |
| save-mixed time (s) | 22.10 / 21.26 | 22.53 / 19.85 |
| save-retained requests | 3105 | 2893 |
| save-retained uploaded bytes | 1926252 | 341670 |
| save-retained time (s) | 33.84 / 31.37 | 32.44 / 30.17 |
| warm-reopen requests | 1087 | 1095 |
| warm-reopen uploaded bytes | 0 | 0 |
| warm-reopen time (s) | 10.99 / 10.36 | 10.05 / 9.55 |
| cold-reopen requests | 2165 | 2092 |
| cold-reopen uploaded bytes | 214 | 214 |
| cold-reopen time (s) | 20.39 / 18.87 | 18.34 / 17.48 |

## Interpretation and limits

Dense mixed-save upload fell 78.3%, and retained-save upload fell 82.3%. Whole-run request reductions are much smaller: 2.5% for the standard fixture and 2.8% for the dense fixture. Dense seeding and warm reopen used slightly more requests. Full semantic and history verification remain.

Timing variation is substantial with only two runs per arm. Do not claim a precise latency gain or a memory improvement. Cumulative max RSS includes fake Drive storage, request logs and benchmark capture; it is not browser/device peak memory. This exercises the synthetic seeder/session/lifecycle HTTP path, not real Drive latency, physical Safari or the UI connection controller.

## Correctness gate

Both ordinary and required extended suites passed 1,972/1,972 on the candidate, with no failures, skips or cancellations. Syntax and documentation checks passed. Independent review covered owned preparation, exact-base binding and adjacent physical/session lifetimes. The regression test reproduces a newer revision arriving between the application base read and baseline verification; the fix rejects before preparation or writes.

The publication retains the independently prepared status documentation. Final publication checks and CI are tracked in [project status](PROJECT_STATUS.md). No merge, deployment, owner-data access or production activation was performed.
