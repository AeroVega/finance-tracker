# Active workspace save requests

## Scope and result

**User-confirmed, November 11, 2026:** two corrections to one review activity took about three minutes to save on the owner's deployment of `5e9c8966ddda10161f18d5483ff579a8a09e534a`. This report measures an invented local HTTP reproduction, not that live delay.

**Implemented and locally verified:** the existing main workspace, canonical ledger store, catalog transaction engine and Drive adapters now reuse verified bytes at three specific boundaries. No isolated paged-storage module is activated. Stored formats, journal events, commit ancestry and publication order are unchanged. Writes remain explicit, mutations remain serial, and failed saves keep the staged draft.

The unchanged 253-activity invented year and two-edit sequence classify the first invented brokerage fee as spending and assign its category. One save uses 132 requests instead of 209, a 36.8% reduction. Both variants write 23 immutable files and publish the manifest twice. This reduces request amplification; it does not make saving a constant-time operation.

## Checks behind the reduction

- A queued transaction may retain exact-ID metadata/media GET receipts, after their bindings and bytes pass verification. Only `writeVerified` can mint an opaque receipt. It binds the adapter, cryptographic implementation, physical identity, hash, server version and live collector. Callers cannot inject raw bytes, substitute mutable metadata during hashing, or use a collector after its scope closes. These candidates are not verified history. Each reuse still needs fresh metadata and version agreement, a fresh byte hash and the complete journal/ancestry checks before it can contribute to session history evidence.
- Each full verification on the active Drive adapter uses one fresh complete opening enumeration and one closing enumeration for both catalog structure and retained objects. Both enumerations check every used binding and version, including an explicit untrashed state. Every verification enumerates again. Metadata is never reused across verifications. Custom adapters retain their existing per-file/batch path, including a closing bracket for reused catalog receipts even when the cache is full.
- The session adapter can retain one private session record only after a complete folder listing, media GET and matching exact-ID metadata GET. Every ownership guard still enumerates the whole folder, rejects duplicate or malformed marker candidates and checks the same server version and physical binding. The coordinator checks expiry and ownership on every use. Writes invalidate the record before exact read-back; lifecycle uncertainty clears it. A marker replaced by an identical record at another file ID cannot authorize a PATCH of the former ID.

The transaction readback budget is at most 16 MiB and 20,000 entries, separate from the existing equally bounded session history-byte budget. This bounds retained cache payloads, not total memory. Full folder listings, materialized catalogs, verification results and ledger objects still require memory. Entries outside a cache budget are downloaded again. No aggregate database-size ceiling is introduced. Nothing is persisted to browser storage or a local cache file.

Recovery/reconnect still starts with cold history bytes. Full export and backup verification do not use either history or transaction receipt reuse. The session marker cache stores only its bounded coordination record, not ledger data. It does not replace the best-effort single-device policy with a server-enforced lock. The existing Google server-version assumption and non-atomic listing limitations remain.

## Measurements

**Verified:** Node 24.22.1, invented in-memory HTTP provider, real application/lifecycle/adapter code, fragmented v3. Three repetitions per variant, alternating variant order, compare the deployed baseline to the working patch. All saves verify exact equality internally, separately reopen, preserve observations, and finish with uncached portable history verification.

For the first two-edit save:

| Metric | Baseline `5e9c896` | Patch |
| --- | ---: | ---: |
| HTTP requests | 209 | 132 |
| Lists | 56 | 46 |
| Metadata GETs | 32 | 25 |
| Media GETs | 95 | 35 |
| Creates / updates / ID batches | 23 / 2 / 1 | 23 / 2 / 1 |
| No-delay time, median | 337.4 ms | 290.8 ms |
| No-delay time, observed range | 281.0–345.8 ms | 277.3–298.7 ms |
| 20 ms injected per-request delay, median | 4444.5 ms | 3065.9 ms |
| 20 ms delay, observed range | 4322.3–4490.1 ms | 3057.0–3070.6 ms |

No-delay ranges overlap; they do not establish a CPU speedup. The delayed proxy median improves by 31.0%. That injected delay is not a Google latency model or an explanation of the owner's full three-minute observation. OAuth, CORS, retry/backoff, periodic heartbeats, real network conditions and device memory are not measured.

Six successive two-edit revisions use 209–210 requests before and 132–133 after. Both retain 200 catalog entries. The one-request variation is generated-ID batch allocation. The separate existing one-activity, 30-save growth recipe retains 586 entries in both variants. Save 30 uses 210 requests before and 133 after, and each warm reopen uses 12 before and 6 after. Nothing is pruned. After enough history, folder pagination, cache misses and full-history CPU/memory work still grow.

Reproduce:

```sh
node tests/benchmark-workspace-save.mjs --baseline-ref=5e9c896 --saves=6 --repeats=3 --delay-ms=0
node tests/benchmark-workspace-save.mjs --baseline-ref=5e9c896 --saves=1 --repeats=3 --delay-ms=20
node tests/benchmark-history-reads.mjs --baseline-ref=5e9c896 --saves=30
```

## Verification and remaining work

**Verified locally:** 294 affected tests passed. New coverage includes 25 active-workspace mutation interruption boundaries, exact recovered old/new ledgers, dirty-draft retention, repeated corrections, uncached portable verification, catalog/root/retained metadata mutation, fresh write corruption, receipt ownership/injection/lifetime/budget checks, missing trash state, session expiry, duplicate markers, same-ID owner changes, marker replacement IDs and clear-during-read races. Independent review reran 222 tests after fixing its reproduced findings. An earlier full suite passed 1,396 of 1,398 tests; the two old concurrency assertions assumed warm saves must download immutable bodies. The updated tests permit cache hits and separately prove cold reads still overlap within the four-read bound. The final integrated CI-equivalent run, with extended storage coverage enabled, passed 1,507/1,507 tests on Node 24.22.1 with no failures, cancellations or skips.

**Open:** live Drive latency and quota behavior, Safari/device acceptance and the owner's retest. No live Drive, real financial data, merge or deployment was used. Production persistence remains **NO-GO**. The 132-request save still has substantial serial coordination, journal and exact-readback work. Further reduction needs a separately reviewed protocol or storage change, not deletion of safety checks.
