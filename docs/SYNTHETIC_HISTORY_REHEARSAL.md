# Multi-year synthetic save and encrypted restore rehearsal

Run from the repository root with Node:

```sh
node --max-old-space-size=768 tests/benchmark-synthetic-history-rehearsal.mjs
```

The invented workload covers January 2023 through December 2025: one
checking account, 50 activities per month, 1,800 activities total. It seeds
one copy, makes six distinct saved category corrections, releases, opens a
fresh application instance against the original copy, and compares the full
ledger. It then generates an encrypted archive, previews it locally without
provider requests, and restores it to a separate in-memory simulated Drive
with fresh-instance verification and exact ledger comparison.

Measured against application tree `3899db5` on Node v24.22.3, stable simulator
profile, with no injected network delay:

| Phase | Provider requests | Media requests | Request bytes | Response bytes |
| --- | ---: | ---: | ---: | ---: |
| Seed | 100 | 23 | 3,524,908 | 10,598,382 |
| Each changed save (min–max of six) | 80 | 19 | 3,524,533–3,529,096 | 14,117,072–14,135,591 |
| Cold reopen | 75 | 18 | 214 | 24,698,298 |
| Encrypted export | 64 | 16 | 0 | 24,688,494 |
| Local backup preview | 0 | 0 | 0 | 0 |
| Restore and independently verify | 134 | 30 | 3,530,806 | 14,153,092 |

The canonical ledger grew from 3,520,429 to 3,525,888 bytes. The encrypted
archive was 4,701,716 bytes. Request counts include session coordination;
byte totals come from the simulator's request and response accounting, not
network framing or Google billing. The export includes a fresh history audit.
Cold reopen included a session-marker claim, not a ledger write.

This proves the stated workload and simulator path only. It does not establish
Google quotas, costs, OAuth, effective permissions, browser/physical-device
capacity or peak memory, latency on Drive, behavior near storage limits,
multi-account workloads, or production acceptance. Do not
use real data in this rehearsal.
