# Performance experiments (Nov 2026)

Open and save were slow on the retired paged-storage routes. These experiments tried to shorten them before the owner selected [full-snapshot v1](../FULL_SNAPSHOT_STORAGE.md). All used invented data, mostly a 253-activity synthetic year and a dense 2,340-activity case, with artificial per-request delay. None is live acceptance. Timings are synthetic and device-independent.

Originals are recoverable at commit `a089861`:

```sh
git show a089861:docs/<FILE>.md
```

Raw measurements remain in [`evidence/`](../evidence): [PR37 session storage](../evidence/pr37-session-storage.csv) and [PR38 save latency](../evidence/pr38-save-latency.csv).

## What worked

| Change | Result | Source |
| --- | --- | --- |
| Reuse verified bytes at three boundaries (exact GET receipts, shared metadata brackets, a guarded session-marker cache) | One save of the 253-activity year: 209 → 132 requests (−36.8%). Same 23 immutable files, same two manifest publications. | `ACTIVE_SAVE_REQUESTS` |
| Overlap fixed-ID existence probes and body reads, only for recognized internal adapters | PR38 one-edit save at 400 ms per request: 116.8 s → 66.3 s median (−43%). Requests 290 → 193. Dense year: 1,936 → 361 requests; downloaded bytes 57.4 MB → 8.5 MB. | `PR38_SAVE_PERFORMANCE`, `OWNED_PREPARATION_READERS` |
| Raise owned read admission from four to eight | Open 38.0 s → 34.9 s on the synthetic harness. Save unchanged at about 58 s. Request counts unchanged. | `READ_WIDTH_EXPERIMENT`, `OPEN_SAVE_PERFORMANCE` |
| Session-private verified-byte reuse across operations | Fewer repeated history reads. Every operation still re-read the current catalog and checked ancestry. | `DRIVE_HISTORY_VERIFICATION` |
| Operation-local catalog lookup | A complete history scan stopped revalidating every catalog entry for each path and commit lookup. | `CATALOG_LOOKUP_PERFORMANCE` |

## What did not, or was inconclusive

| Experiment | Outcome | Source |
| --- | --- | --- |
| Write-enabled stage probe (prefetch four fixed-ID reads before serial preparation) | Rejected. Save gained about 5 s (8%) and requests stayed 198/144. It also changed when preparation callbacks run. | `OPEN_SAVE_PERFORMANCE` |
| Overlapped read-only stage verification | Removed. 63.7 s vs about 63.5 s save at 400 ms, identical requests: no convincing end-to-end gain. |
| Publication-readback and nested-ownership shortcuts | Rejected. Gains were about 1.6 s each and would have weakened the publication boundary or needed a new proof architecture. | `OPEN_SAVE_PERFORMANCE` |
| Global most-recently-used cache eviction | Tested and rejected. The dense save rose to 3,940 requests. | `PR38_SAVE_PERFORMANCE` |
| Cross-index reads in groups of four | Superseded by the width-eight candidate. | `CROSS_INDEX_EXPERIMENT` |
| Owned staging width eight; owned first/final receipt audit; native local read-audit guard; native clean → published → clean; complete-tree phase memo | Local candidates for the incremental-save branch. They were never adopted; full-snapshot v1 replaced that route. | `OWNED_STAGE_WIDTH8`, `OWNED_RECEIPT_AUDIT`, `NATIVE_LOCAL_AUDIT_EXPERIMENT`, `NATIVE_CLEAN_PUBLISHED_EXPERIMENT`, `COMPLETE_TREE_PHASE_MEMO`, `EXPERIMENTAL_INCREMENTAL_SAVE` |
| PR37 v5-only cleanup rerun | Identical request counts and bytes on both sides; the 24.7 s vs 26.1 s difference came from single runs under other load and shows no speed or memory change. | `PR37_V5_ONLY_CLEANUP` |
| Canonical v5 versus repaired v4 | 1,669 → 1,628 requests; uploaded bytes −11%; timed phases 17.5 s → 17.3 s. The comparison is cumulative, not isolated to one change. | `V5_MATCHED_SYNTHETIC_EVIDENCE` |

## Instrumentation and measurements

| Document | Contents |
| --- | --- |
| `TIER0_SAVE_MEASUREMENT` | Benchmark telemetry with fixed category labels, request counts and request/response bytes only. No ledger contents or identifiers. |
| `TIER1_SAVE_PERFORMANCE` | A bounded-save candidate whose runtime was byte-identical to an earlier preservation head. |
| `PR28_STORAGE_PERFORMANCE` | Per-record route: three save-and-reopen checkpoints cost 965, 1,825 and 3,829 requests; reopen cost 460. Repeated small saves grew with retained history. |
| `SYNTHETIC_HISTORY_REHEARSAL` | Multi-year synthetic save and encrypted restore rehearsal (`tests/benchmark-synthetic-history-rehearsal.mjs`). |

## Lessons

- In these runs, request count tracked open and save latency: the largest gains cut round trips.
- A speedup is only valid with identical financial results. Every candidate re-ran exact-ledger assertions and checked an unchanged source fingerprint.
- Run baseline and candidate sequentially on the same machine, more than once, and report concurrent load. Single runs under load are not evidence of improvement.
- Do not trade verification for speed. The rejected shortcuts each weakened ownership, exact-manifest or publication checks for roughly a second or two.
- Concurrency bounds apply per invocation, not process-wide.

Current benchmark commands are in [Testing](../TESTING.md). Current CPU-side notes are in [CPU performance](../CPU_PERFORMANCE.md).
