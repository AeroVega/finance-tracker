# Drive history verification

## Scope

**User-confirmed, November 8, 2026:** reduce repeated reads of growing transaction history without removing integrity and recovery protection. The implementation remains synthetic-only. Production persistence is **NO-GO**. No live Drive testing, data migration, history deletion, merge or deployment is part of this change.

**Implemented:** a catalog engine can keep private, in-memory verified bytes between operations in the same session. Every verification still reads the current catalog, validates every retained locator, verifies journal chains and complete commit ancestry, and checks the manifest against its commit. Nothing changes in stored records, archive formats, journal order, publication order, or session ownership checks.

## What permits reuse

1. A successful verification downloaded the exact file bytes, verified their SHA-256, checked their location and typed identity, and completed all history checks. Upload content and successful create responses cannot populate this cache.
2. The same adapter, folder, database and physical copy are still selected. The current locator has exactly the same file ID, kind, logical identity, hash and journal binding.
3. A fresh complete folder enumeration finds every retained file and validates its tags, location, trash state and Drive version. The version must exactly match the version that bracketed the earlier verified bytes. Versions remain strings, so large 64-bit values are never rounded through JavaScript numbers.
4. Cached bytes are copied and hashed again. Changed versions and uncached objects are downloaded and hashed. A second complete enumeration must still agree on every retained binding and version before the result can succeed.
5. Only a successful full history verification can replace the private evidence. Returned byte buffers, catalog objects and version maps cannot mutate it. Missing files, malformed or incomplete listings, duplicate IDs, invalid versions, changed bindings and verification failures fail closed.

**Verified provider contract:** Google's [Drive File resource documentation](https://developers.google.com/workspace/drive/api/reference/rest/v3/files#File), checked November 8, 2026, defines `version` as a server-managed increasing number reflecting every server-side change. Reuse relies on that contract. An unchanged application-supplied hash tag alone is insufficient. Drive transaction requests use `cache: "no-store"` so browser HTTP caching cannot satisfy these freshness checks.

Folder listings are not an atomic server snapshot. Neither fresh versions nor the session marker prevent a change after the last check or create a server-enforced lock. This change preserves the existing best-effort single-device concurrency limits. A provider returning stale metadata or changing bytes without changing its version would violate the cache's freshness assumption. Full remote verification remains available for the boundaries below.

## Full-read boundaries and limits

- Explicit recovery and reconnect discard prior evidence before their opening history scan. The remainder of that recovery may reuse bytes only after fresh metadata checks.
- Any non-ready lifecycle transition, failed readiness/ownership check, engine-operation error or history-verification error clears the cache. Release, offline, authorization/ownership uncertainty and failed reads therefore cannot carry old evidence into resumed work.
- A clear increments an internal generation. A verification already in progress cannot refill the cache after that clear, even if its asynchronous reads later finish successfully.
- A different adapter, folder, database, copy, cryptographic provider or lower manifest revision starts without prior evidence. Lower revision does not authorize rollback. Recovery still enumerates durable journals and rejects inconsistent later evidence before writing.
- Backup/export and Drive destination verification download and verify every retained object, including old snapshots. Archive validation rehashes and verifies all embedded retained bytes using its in-memory archive adapter. These paths do not use the session cache. No backup or restore format changes.
- Adapters without batch version metadata continue to download all bytes. A malformed or failed batch is an error, not a reason to bypass verification.
- Each engine retains at most 16 MiB of byte payloads and 20,000 entries. These limits do not cap total browser memory. The catalog, binding strings, maps, current verification output and concurrent operations need additional memory. Objects that do not fit are downloaded again. Nothing is persisted in localStorage, IndexedDB, a service worker, or a file.

Every save still checks ownership before durable mutations and rechecks the exact base manifest before publication. Fresh enumeration still discovers unindexed crash journals. An indexed journal can reuse its bytes during recovery only if the new enumeration also matches its verified version. Changed or new journals are downloaded.

## Measurements

**Verified in invented HTTP tests:** the real application lifecycle, catalog engine, Google Drive adapter and session adapter completed the existing assisted canonical recipe in 2,153 requests, compared with 4,633 before this change. That is 2,480 fewer requests, or 53.5%. The same financial assertions passed, and the separate reconnect assertion passed. The count includes ownership checks and both metadata brackets. Initial connection, OAuth, fixture downloads, periodic heartbeats, retries and browser CORS requests are excluded.

Ten successive small saves that each add one invented account, followed by exact reopen, now use 159 requests each. The prior counts were 201, 279, 357, 435, 513, 591, 669, 747, 825 and 903. Independent reads remain bounded at four, and durable mutations remain serial. The regression budget now rejects a return to history-sized body downloads within this workload.

**Verified with the original one-activity growth recipe:** save 1 stores an unclassified invented activity; saves 2 through 30 append one classification each. Using the grouped layout and baseline `e55faec`, save-only requests changed as follows:

| Save | Before | After |
| --- | ---: | ---: |
| 1 | 250 | 204 |
| 2 | 287 | 149 |
| 5 | 482 | 149 |
| 10 | 807 | 149 |
| 20 | 1,457 | 149 |
| 30 | 2,107 | 149 |

Across saves 2 through 30, the new path uses 148 or 149 requests. The one-request variation comes from ID-allocation batch boundaries. The 30th save uses 92.9% fewer requests. Its separate exact reopen costs 10 requests instead of 410. Both variants retain the same 400 catalog entries and 537,190 payload bytes after the run. Nothing was pruned.

Run `node tests/benchmark-history-reads.mjs --baseline-ref=e55faec --saves=30` to reproduce this comparison. It uses identical invented checkpoints, actual HTTP adapters, exact reopen after every save and a full portable verification afterward. The original probe reopened only at selected checkpoints; adding other read-only reopens does not change these save-only counts. The optional baseline runs the selected committed modules in a temporary directory without changing the checkout or contacting Drive.

**Verified for the full invented year:** the grouped seed plus independent reopen uses 406 requests, compared with 566 before this change. Repeat verification uses 10 instead of 63. All 53 retained entries and financial assertions remain. Run `node tests/benchmark-synthetic-year.mjs --layout=chunks-v2` for the current measurement.

**Remaining growth:** this removes redundant body downloads while evidence fits in memory. It does not compact history. Folder listings still page through growing files, the catalog grows, and hashing, journal verification and ancestry validation still inspect retained history. After a cache limit is reached, uncached payloads are downloaded again. Reconnect and archive operations intentionally pay the full history read cost. These counts are not Google latency, quota or Safari-memory measurements and do not establish constant cost for an unlimited ledger.

## Verification and release status

**Verified locally:** dedicated tests cover warm-cache interruption at every durable mutation, corrupt historical bytes with a changed server version, changed metadata at both brackets, missing and rebound files, large version strings, detached returned buffers, failed-verification invalidation, clear-during-read races, cache limits, cold reconnect, failed leases, rollback refusal and uncached archive verification. The existing transaction, backup, restore and financial tests remain applicable.

**Verified locally on November 8, 2026:** the complete suite passed 789/789 tests on Node 24.22.1 and Node 26.13.0, with no failures or skips. Browser-module syntax and diff checks passed. Independent read-only review found no correctness or security blocker and separately exercised the concurrent-failure invalidation race. Browser/Safari and live Google acceptance remain **Open**. The code is not deployed by these local checks. Existing copies need no conversion, but production activation remains separately gated.
