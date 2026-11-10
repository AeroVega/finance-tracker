# PR30 integrated performance work

**Implemented, synthetic-only:** this follow-up combines the approved repeated-history-read solution with further canonical computation, import and oversized-record improvements. PR30 merged November 9, 2026. This report preserves its measured evidence; [project status](PROJECT_STATUS.md) tracks later changes. Production persistence is **NO-GO**. No live Google Drive, real financial records, merge or deployment was used or authorized by these checks.

## What changed

- [Verified history bytes](DRIVE_HISTORY_VERIFICATION.md) are privately retained within an engine session, with fresh complete metadata checks at both ends, exact bindings and versions, repeated hashing, bounded payload retention and invalidation on uncertainty. Full reconnect and archive checks remain.
- [Category rules](CATEGORY_RULE_SCOPING.md) retain only existing peers in their exact immutable matching scope. Legacy records remain accepted and unchanged.
- [Chronological replay](LEDGER_REPLAY_CPU.md), [import candidate indexes](IMPORT_RECONCILIATION_CPU.md), [retry indexes](CANONICAL_RETRY_CPU.md), [ordered command batches](FINANCIAL_COMMAND_BATCHES.md) and [batched period reports](PERIOD_REPORT_PERFORMANCE.md) avoid repeated work while preserving complete outputs and errors.
- [Owned ledger sessions](LEDGER_SESSION.md) keep frozen state and private replay indexes for repeated workbench edits and reads. Local generation/revision checks, immutable ownership, atomic failure rollback and boundary invalidation prevent stale cache reuse; actual storage verification remains unchanged. The session binding is diagnostic, not remote authority. Save/export still fully validate.
- [CSV ingestion](PROVIDER_CSV_CPU.md) caps admitted hash work at 16 and releases consumed row references without changing whole-file quote validation, row order or failure precedence.
- [Operation-local catalog lookup maps](CATALOG_LOOKUP_PERFORMANCE.md) replace repeated catalog validation inside each traversal. Original and detached bindings are rechecked before backup/copy can continue after callbacks.
- [Fragmented storage](FRAGMENTED_CANONICAL_STORAGE.md) lets a fresh synthetic copy explicitly choose version 3. It splits oversized logical records and inventories into bounded physical objects while retaining exact financial records and the existing transaction, ownership, history, recovery and backup protocol. That was PR30's tested compatibility policy. The later [current format policy](FRAGMENTED_CANONICAL_STORAGE.md#current-policy-v3-only-for-grouped-storage-successors) makes v3 the default, keeps v1 readable and rejects standalone v2. Historical measurements below do not restore v2 support.

## Measured evidence

**Verified with invented fixtures:** the original one-activity recipe's 30th save fell from 2,107 to 149 requests. The grouped invented-year seed plus independent reopen fell from 566 to 406. Every retained record stayed present. An extended 80-save probe reached 187 requests once metadata enumeration required another page, so this is not an unlimited constant-cost claim.

Four category corrections on 1,000 distinct activities shrank from 158,821 to 2,977 event-JSON bytes. For the full recipe's utility correction, membership fell from 253 IDs to 12. Dense same-key memberships still grow; version 3 solves their physical object-size refusal within its explicit limits rather than changing logical history.

A ten-year owned-session CPU fixture with 23,400 activities and 23,160 existing events produced exactly the same validated final graph as pure commands. Session command median was 0.34 ms versus 2,507 ms for pure commands, but initial opening and full export still took seconds. Retained heap increased from 70.7 to 82.1 MiB. These shared-host timings are illustrative, not controlled browser promises.

Serial fresh-process version-3 storage checks saved and independently reopened one, five and ten dense invented years exactly. At ten years, an 852,703-byte import record was representable, with 1,518 physical objects and a largest object of 88,211 bytes. Peak process RSS was 1,074 MiB. **This is not a safe-device capacity claim.** The adapter reconstructs complete graphs and is not a streaming browser database.

## Final combined verification

The component records above distinguish earlier isolated results from the final combined repository run. The final run uses `node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs` on Node 24.22.1 and 26.13.0. Both CI workflows use this serial mode so dense fixtures do not compete across files. Default tests include one dense year and a 4,000-peer oversized rule. Five- and ten-year storage checks remain explicit, separately run measurements.

**Verified locally on November 8, 2026:** the complete integrated suite passed **914/914 tests on Node 24.22.1 and 26.13.0**, with zero failures, cancellations or skips on either version. Each serial run took about 228 seconds. Browser-module syntax checks, workflow YAML parsing and `git diff --check` passed. The verified application/test source is published at [`799ccf0d1ecb904100f8d6930cb0c92cf5342c48`](https://github.com/AeroVega/finance-tracker/commit/799ccf0d1ecb904100f8d6930cb0c92cf5342c48). The final application and test source was unchanged after these runs; the follow-up records evidence and the matching serial CI command.

Independent component review covered cache trust and invalidation, legacy structured-value compatibility, ordered replay and import matching, owned-session rollback and the failed-save recovery fence, callback mutation of catalog bindings, and fragmented corruption/interruption/backup behavior. Review-found defects were corrected and regression-tested before integration.

**Verified in local Chromium 153:** the workbench passed event/read/save, uncertain-write recovery, offline/reopen and release checks with invented storage. The synthetic-year page separately passed both v2 and v3 preview/save/release and opposite-selector reconnect checks using actual seeding/serialization with a storage stub. Both sets covered five viewport sizes with no document overflow or page errors. The dropdown test observed one write per selected-layout save and none on preview/reconnect. All Google requests were blocked or stubbed, not live.

## Remaining acceptance and limits

- History, catalogs, metadata pagination, retained snapshots and full boundary validation still grow. The history cache retains at most 16 MiB of payload bytes, not total browser memory, and intentionally falls back to downloads beyond its budget.
- Version 3 admits at most 128 KiB per physical object, 16 MiB per logical object, 128 MiB reconstructed JSON and 256 MiB reserved fragment capacity. The root inventory can hit its own cap earlier. These limits do not establish a safe phone memory budget.
- Fresh Drive versions and best-effort session ownership are not a server-enforced lock or atomic listing. Concurrent external changes and network partitions retain the existing limitations.
- Local Chromium with invented storage is not real iPhone/iPad Safari, live Google authorization, network throughput, or production acceptance. Those checks and separately authorized deployment remain open.
- No history pruning, source removal, format migration, production activation, merge or deployment occurs in this work.
