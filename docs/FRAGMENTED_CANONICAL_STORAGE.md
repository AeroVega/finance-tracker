# Bounded fragmented canonical storage

## Current policy: v3 only for grouped-storage successors

**Current decision (PR32):** fragmented v3 is the default for new canonical stores and fresh synthetic copies. Its logical inventory is a distinct version-3 group index; bounded physical fragments are a transport/storage concern. It does not use the deprecated grouped-v2 schema.

Standalone grouped storage v2 is deprecated and rejected outright by both the canonical store and snapshot/backup validator. The application no longer exports a v2 writer or offers a v2 layout option. Existing per-record v1 copies remain readable and retain their v1 layout. Existing fragmented-v3 copies created with the earlier logical v2 envelope remain readable and are upgraded to the current v3 group schema only when the owner explicitly saves; reads never rewrite a folder. A v2 fixture builder exists only in tests to prove standalone-v2 rejection and read compatibility for older fragmented-v3 copies.

Do not reintroduce grouped-v2 support or make v3 opt-in. Preserve the existing transaction engine, fragment bounds, verified read-back, immutable history, ownership and recovery checks. This policy does not authorize live Drive actions, production persistence, merge or deployment.

---

## Historical scope and selection (superseded)

**Historical experiment, superseded by the current policy above:** `fragments-v3` was originally an explicit choice beside grouped `chunks-v2`. That grouped-v2 option and its standalone format are now deprecated. Version-1 per-record copies remain compatible; new stores use v3. No real financial records, live Drive use, production activation, merge or deployment is part of this implementation.

## Format

Version 3 keeps the canonical index at `synthetic/canonical-v1/index.json`, with a version-3 fragment root. Reassembled logical content uses the distinct version-3 group index. Existing per-record v1 remains a separate compatible layout. Clients supporting only version 1 reject the v3 root at their existing guard. This is a tested guard contract, not an assertion that every old browser build was exercised.

The root has exactly `format`, `version`, `syntheticOnly` and `fragments`. Its inventory maps each logical group path to an exact byte length and fragment count. The reconstructed index is the version-3 logical group inventory. Each collection uses stable groups of up to 64 records; unlike v2, there is no 128 KiB grouped-object cap because physical fragmentation bounds transport.

Every logical object, including the logical index, is canonical JSON encoded as UTF-8. It is split at fixed 65,536-byte boundaries, then each slice is base64 encoded in an exact-key JSON envelope containing `format`, `version`, `path`, `ordinal` and `data`. A fragment path is derived from the logical path and zero-based ordinal. Bytes are joined before UTF-8 decoding, so a boundary inside an emoji or another multibyte character preserves the original text. Readers require canonical base64, exact envelope keys and identities, exact lengths, valid UTF-8, canonical reconstructed JSON, and the complete physical and logical inventories.

Canonical financial records, identifiers, array order, provenance and append-only history are unchanged. The same logical-record checks run before packing. Fragments use the existing immutable content hashes, transaction journals, ownership checks, exact-base checks, independent read-back and recovery. Backup/export/restore reconstruct and validate every retained canonical snapshot. No verification cache or storage-layer exception is added.

## Limits and shrinking groups

Admission rejects a save before any transaction if it exceeds any bound:

- 128 KiB per physical root or fragment object, including JSON overhead. Readers also enforce raw stored-byte length, including whitespace.
- 64 KiB of decoded bytes per fragment.
- 16 MiB per reconstructed logical group or index object.
- 128 MiB of total reconstructed logical JSON per snapshot.
- 256 MiB of total reserved fragment capacity per snapshot, including empty padding.

The root inventory itself can reach its limit before the aggregate-byte limits. These are implementation limits, not Google limits or a production capacity promise.

A mutable review group can become smaller. The writer retains the previous number of fragments for that logical group, writing empty data into any trailing fragments. Readers require those trailing fragments to be empty. Fragment counts therefore never decrease, no selected canonical path is dropped, and an unchanged save is a no-op. Encoding is deterministic for the ledger and the previous root inventory. A freshly encoded equivalent ledger need not have the same padding inventory as a copy with a larger earlier group. Historical bytes remain retained and verifiable.

Base64 adds about one third to encoded payload size, plus envelope and inventory overhead. This adapter reconstructs whole logical objects and keeps several representations in memory. It is not a streaming reader and does not make total retained history bounded. Mobile memory, device responsiveness, live Drive throughput and production scale remain **Open**. The aggregate limits prevent unbounded declared reconstruction, but are not safe-device memory guarantees.

## Verification

**Verified locally with invented data:** exact Unicode roundtrip, oversized imports and category-rule memberships, oversized logical groups and indexes, no-op saves, v1 compatibility, standalone v2 rejection, immutable source/history guards, shrinking groups, malformed/missing/extra/reordered/duplicate fragments, wrong identities, nonempty trailing padding, raw-byte limits, root and reconstruction admission bounds, archive verification and fresh-copy restore.

The interruption test writes a new correction whose evidence spans several fragments. It injects a failure at every durable mutation and requires recovery to return either the complete old ledger or the complete new ledger, followed by a safe retry. No partial logical record is accepted.

Run `node --test tests/canonical-fragmented-storage.test.mjs tests/canonical-packed-storage.test.mjs tests/synthetic-year-seeder.test.mjs` for the focused regression set. Run a larger storage regression separately with `FRAGMENT_TEST_YEARS=5 node --max-old-space-size=768 --test tests/canonical-fragmented-storage.test.mjs`, then use `FRAGMENT_TEST_YEARS=10` in a fresh process. Do not run these alongside other memory-heavy work. Run `node tests/benchmark-fragmented-storage.mjs` for the one-, five- and ten-year exact-output adapter measurement. It runs each size in a fresh process with a 768 MiB JavaScript heap limit. The benchmark uses an invented in-memory lifecycle, not Google or catalog HTTP. Separate small fixtures exercise the actual catalog transaction, archive and recovery engines.

## Local dense measurement, November 8, 2026

**Verified on Node 24.22.1:** each size ran in a fresh process, with exact complete-ledger comparisons after save/read-back and an independent reopen. Canonical snapshot validation also passed. These are adapter-only measurements, not end-to-end catalog or Google timings.

| Years | Activities | Largest import bytes | Physical objects | Largest physical bytes | Physical payload bytes | Peak process RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2,340 | 86,113 | 156 | 87,529 | 8,512,785 | 330 |
| 5 | 11,700 | 426,822 | 761 | 87,529 | 42,599,395 | 744 |
| 10 | 23,400 | 852,703 | 1,518 | 88,211 | 85,327,632 | 1,074 |

Root inventories were 9,225, 44,261 and 88,211 bytes respectively. Save plus internal read-back took 3.45, 10.06 and 21.17 seconds; independent reopen took 1.91, 6.34 and 14.08 seconds. Setup and final snapshot validation are outside these operation timings. Timing varies with host load and garbage collection. RSS includes the runtime, fixture, retained original and reopened ledgers, string maps, temporary buffers and final validation. The 768 MiB JavaScript heap ceiling is not a process-RSS ceiling.

Earlier concurrent dense runs were killed by resource pressure. The successful measurements above used serial fresh processes. This is evidence of exact storage representation at these sizes, not evidence that a phone or browser can safely hold a ten-year copy. No hard browser-memory admission threshold is established.

The default regression suite includes one dense year and a separate 4,000-peer category rule. The latter has both an import observation inventory and one prospective-rule event individually larger than 128 KiB. Both save and reopen exactly with v3. The larger five- and ten-year cases remain available through the explicit test environment option above rather than adding them to every full-suite run.

**Verified on Node 24.22.1 and 26.13.0:** the final focused command passed 80/80 tests on each version, with no failures or skips. It used `--max-old-space-size=768 --test-concurrency=1`. This includes all 32 durable boundaries of the oversized fragmented correction. Syntax checks and `git diff --check` passed. Independent code review found no outstanding integrity defect. The reviewer independently reran the final one-year and 4,000-peer target cases, passing 2/2.

The earlier local Chromium check covered the now-retired v2/v3 selector and is historical evidence only. The current synthetic-year page has no format selector and writes v3. The current UI regression suite exercises the v3 path with an invented storage stub; physical Safari/mobile interaction and memory, live Google authorization and live upload acceptance remain **Open**. The [final full-repository integration](archive/PR30_PERFORMANCE_INTEGRATION.md) passed 914/914 tests on both Node versions, separately from these focused results.
