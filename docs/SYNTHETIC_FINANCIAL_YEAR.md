# Synthetic financial year

## Current creation route

Use **Storage → Create new synthetic year** in the [main workspace](../index.html#storage). The workspace prepares invented data, requests Google authorization from the click gesture, and uses Picker to select a fresh empty synthetic folder. An already-open local preview uses **Save preview to a new folder** and preserves its staged edits. Open saved synthetic year never initializes an empty folder.

The selected storage format is [full-snapshot v1](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md). Older layouts are unsupported and are not migrated, overwritten or deleted. The standalone synthetic-year seeder and old copy guides were retired during PR46 cleanup. Supported file import and portable backup/restore remain outstanding requirements, not available actions.

The default recipe is calendar year **2025**, the last complete year when implemented. It offers one reproducible invented dataset, not a production dashboard, investment engine or projection implementation. Production remains **NO-GO**. This document grants no deployment, merge, live Drive or real-data authorization; consult [current state](CURRENT_STATE.md).

## Recipe and financial meaning

The versioned pure generator `createSyntheticFinancialYear` constructs invented provider-shaped CSV bytes in memory. It uses the existing parser, canonical import and append-only event APIs. It returns the same identities, values and fixture timestamps on repeated calls with the same year. These fixed UUID-shaped identities and timestamps belong only to the invented recipe; they are not a source for production identity or import-time generation. The generator accepts no files, account details or private input.

- Four accounts and annual imports: Wells Fargo-shaped checking and credit card, SoFi-shaped savings, and Fidelity-shaped brokerage.
- 253 activities and source observations, 207 classification/correction/refund audit events, and 722 logical canonical objects including the index.
- Twelve months of twice-monthly pay, rent, utilities, insurance, savings interest, card purchases, subscriptions and seasonal purchases. December pay and spending vary. These are representative recurring entries, not daily spending coverage.
- Savings transfers and both sides of credit-card payments balance exactly. Card purchases count as spending once; payments do not count again. Brokerage contributions and trades do not inflate ordinary income or spending.
- An invented January utility overcharge is corrected by a separate event. A partial refund of June travel posts in July. Original descriptions and amounts remain preserved in the source observations.
- Fidelity actions, quantities, prices and settlement evidence are retained. The current engine does not support their full classification or posted lifecycle; all 48 investment activities are explicitly excluded from known income/spending, with unknown lifecycle reported. This is test material for future investment work, not investment performance or holdings calculations.

**Verified fixture expectations:** annual known income is **$73,739.50** and known spending is **$30,381.00**. Tests compare every monthly total to separately computed recipe expectations, check card/transfer conservation and inspect correction/refund evidence. Currency is explicitly USD.

Balances, historical valuations, net worth, investment performance and complete-history claims remain unavailable. The current engine's cash subtotal excludes transfers and card activity; it is not total bank movement or a balance. The synthetic declared coverage is source-confirmed by the authored recipe, but `coverageReconciled` remains false. Original CSV bytes are available only in memory, not uploaded as retained files. Canonical retention fields honestly remain `not-retained`; preserved row-level source evidence is not a full-file retention claim.

## Save and overwrite boundaries

1. Use a new empty synthetic folder for creation. Do not clear an old or uncertain folder to make it appear empty.
2. Cancelled sign-in or Picker leaves the local preview available. Creation refuses a nonempty destination.
3. Wait for verified success before staging another operation. A successful HTTP response alone is not a verified save.
4. Stage a correction, choose Save changes once, then independently reopen the saved copy to verify persistence.
5. Release the session before moving to a different tab or device. Release does not erase the saved copy.

## Interruption and retry

After a failed or uncertain save, preserve the folder and local draft. Do not blindly retry or delete files. Recover if offered, then perform a verified full reopen to establish what reached Drive. Recovery alone does not seed a save baseline or prove the intended draft was persisted. An uncertain release does not announce successful handoff. See the [current protocol](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md) and [owner guide](OWNER_ACCEPTANCE.md).

## Historical performance and acceptance

The sections below preserve earlier seeder/storage experiments. Commands, UI steps, format compatibility and limits apply only to those historical revisions, not the current workspace.

### Historical grouped canonical experiment (deprecated)

**Historical implementation, superseded by the current policy above:** the earlier synthetic-year page offered a grouped `chunks-v2` layout as an opt-in performance experiment. Standalone grouped-v2 copies are now rejected and the old writer/selector has been removed. The measurements below remain historical evidence only; they are not the current seeder format. It groups each canonical collection into fixed append-order buckets of at most 64 records and at most 128 KiB of stored UTF-8 JSON per chunk. The same 722 logical objects become **15 physical payload objects**. The largest fixture chunk is 128,922 bytes, below the 131,072-byte limit.

The index remains at the existing canonical index path but declares version 2. Old clients reject the unsupported version rather than interpreting the copy as empty. Current clients read per-record v1 and fragmented v3. Standalone grouped v2 is rejected. An existing version-1 ledger continues writing version 1 even if a caller requests chunks. No existing copy is migrated, compacted or rewritten; historical snapshots retain their original format. A conversion tool is not part of this work.

All record identities, source observations, collection order and events remain unchanged. Before packing, the store performs the same per-record immutable-history, source-evidence, retry and metadata checks as before. Grouping changes physical placement, not financial meaning. New records extend the last bucket or add a bucket. Corrections append events; mutable review records can change only under the existing logical rules. Unchanged chunks reuse their content hashes. A chunk's old bytes remain in immutable retained history after replacement.

Chunk boundaries do not move when a record changes size. An oversized chunk fails before any write instead of repartitioning, truncating or silently changing formats. Readers enforce raw-byte size as well as exact chunk identity, inventory, record order and envelope keys. Missing, extra, mixed or malformed canonical paths fail closed. The 128 KiB limit is a synthetic implementation bound, not a Google service limit. The historical grouped-v2 writer refused these oversized groups. Fragmented v3 later replaced that experiment; new copies now use [canonical v5](PARTITIONED_CANONICAL_STORAGE.md).

The existing engine still saves changed payloads and their journals serially. Ownership and exact-base checks, independent read-back, hash verification of all retained history, recovery and backup/export/restore validation remain in force. No persistent cache or verification shortcut was introduced. Repeated edits still retain historical chunks, so this is not a solution to unlimited retained-history growth or production scale.

### Category-correction scope and remaining size limit

**Verified before the scoped-rule fix, at `c41448b`:** with 1,000 distinct posted activities, each category-correction event copied every existing activity ID. Four corrections produced 158,821 bytes of event JSON and exceeded the fixed 128 KiB chunk cap.

**Implemented and verified with invented data:** new rules retain only pre-existing activities with the same account, institution, currency, normalized description and source action. Inactive matching activities remain included. Blank descriptions disable future matching and retain only the explicitly corrected target. The old version-1 inventories remain readable and immutable. No migration or history rewrite occurs.

The same 1,000-distinct-activity, four-correction case now produces 2,977 bytes and packs within the unchanged cap. In the 253-activity year, correcting a utility category retains 12 matching IDs instead of 253. Tests cover late imports with older financial dates, unchanged earlier peers, bank corrections, lifecycle transitions, linked refunds, legacy rules, packed save/reopen, export and fresh-copy restore. See [category-rule scope and evidence](CATEGORY_RULE_SCOPING.md).

**Remaining limit:** the inventory still grows with the number of historical activities in one exact matching scope. Four corrections with 1,000 same-key peers still exceed the cap and fail before a storage transaction. Previously persisted oversized full-ledger inventories are not made smaller. Retrying version 2 does not make an oversized chunk fit. The explicit version-3 option described below handles oversized groups in new copies; an immutable rule-creation boundary remains separate future work. This improvement does not establish unrestricted ledger scale or authorize production persistence, merge or deployment.

### Measured synthetic HTTP comparison

The same seeder admission, save/independent-reopen, repeat verification and release ran through the real application lifecycle, Google adapter and catalog/session engine backed by invented in-memory HTTP responses. Default adapter pagination is included. Setup/connect requests, OAuth/Picker, retries/backoff, periodic heartbeats and browser CORS requests are excluded from the phase request counts.

| Measure | Per-record version 1 | Grouped version 2 |
| --- | ---: | ---: |
| Fresh-copy admission requests | 8 | 8 |
| Save and independent reopen requests | 21,175 | 566 |
| Repeat verification requests | 2,192 | 63 |
| Release requests | 17 | 9 |
| Selected canonical payloads | 722 | 15 |
| Retained catalog entries | 2,174 | 53 |
| Immutable creates during save/reopen | 2,175 | 54 |
| Peak immutable-read concurrency | 4 | 4 |
| Peak durable-mutation concurrency | 1 | 1 |

**Verified in this simulation:** save/reopen uses **97.3% fewer HTTP requests**. Its version-1 request mix was 3,594 listings, 136 ID allocations, 2,184 metadata reads, 13,084 body reads, 2,175 creates and two updates. Version 2 used 85 listings, four ID allocations, 63 metadata reads, 358 body reads, 54 creates and two updates.

Run `node tests/benchmark-synthetic-year.mjs` to compare per-record v1 with fragmented v3, or pass `--layout=fragments-v3` / `--layout=records-v1` to run one. The benchmark uses invented HTTP responses only and asserts full ledger equality; it does not contact Google.

A single local end-to-end run including setup, generation, repeat verification and release took 82.407 seconds for version 1 and 4.868 seconds for version 2. These are local synthetic measurements, not Google latency, iPhone performance, a quota limit or a live speed guarantee. Live timing and quota behavior remain to be measured; token expiry still requires revalidation and recovery rather than skipping verification.

**Verified locally, November 8, 2026:** the complete `node --test tests/*.test.mjs` suite passed **746/746** on Node **24.22.1** and **26.13.0**, without failures, cancellations or skips. All JavaScript module syntax checks and `git diff --check` passed. The final request-budget assertion was then verified by rerunning all 12 seeder tests on both versions. The synthetic-year save/reopen budget is at most 600 simulated HTTP requests, with no elapsed-time assertion.

The new packed-storage suite passes 25 tests, including interruption at every one of 17 durable boundaries of a packed correction, safe retry, immutable evidence/order, corrupt and oversized chunks, unknown envelope keys, v1 format preservation, the frozen legacy index guard contract, and backup/export/restore. Existing legacy canonical/snapshot tests pass 57/57, including their 38-boundary interruption matrix. Independent correctness review found no outstanding blocker after raw-byte limits and retention-maintenance scope were tightened.

Local Chromium checked 320×740, 390×844, 768×1024, 844×390 and 1440×1000 layouts without document-level horizontal overflow. With Google/Drive requests stubbed, checks passed for no automatic authorization/upload, local preview counts, OAuth/Picker cancellation, GET-only nonempty-folder refusal, duplicate-click protection, offline controls and workspace/hub navigation. Additional browser checks used a local storage stub with the real UI, generator, canonical serializer and seeder: an uncertain committed response remained a failure until recovery verified the exact saved graph; repeated verification added no financial write; failed release never appeared successful; verified release allowed further actions. No page errors were observed. These checks do not establish live OAuth, Drive or mobile Safari acceptance.

**Open:** owner-run live synthetic Drive acceptance, live duration/quota behavior, Google authorization/Picker on iPhone and iPad, and Safari/WebKit verification. No live Google credentials, Drive reads or writes were used during development. A green local test or CI run is not live acceptance or production authorization.

### Historical grouped-v2 owner procedure

The procedure below belongs to the deprecated grouped-v2 experiment and preserves its expected counts. Do not run it against the current seeder. Use [the current owner acceptance guide](OWNER_ACCEPTANCE.md) for v5, only after a separately authorized deployment.

1. Preview locally. Confirm 253 activities and 722 logical canonical objects grouped into 15 storage objects. Confirm no Drive connection occurs for preview.
2. Try a nonempty disposable synthetic folder and cancel Picker once. Both must stop without a new upload. Do not use a real-data folder for refusal tests.
3. Choose a new empty synthetic folder, keep this tab awake and observe progress. Success requires “Uploaded and independently verified.” Record elapsed time privately; do not publish folder IDs, tokens or personal account details.
4. Verify again; no second financial commit should occur. Release, reload, reconnect to the saved year and verify the same graph. Release before opening the workbench.
5. Inspect monthly summaries and preserved correction/refund evidence in the canonical workbench. Missing balances and excluded investment activity must remain qualified.
6. If any operation fails, preserve the folder and use the documented reconnect/recovery path. An interrupted initial setup or post-reload empty copy requires a new folder, not deletion or repeated blind upload.


## Historical canonical-v5 storage

**Implemented, synthetic-only:** new copies use [canonical v5](PARTITIONED_CANONICAL_STORAGE.md). Existing per-record v1, fragmented v3 and canonical v4 copies retain their interpretation; the [retired copy-guide source](https://github.com/AeroVega/finance-tracker/blob/86d1f2b3bf510fe75f678e4d4dcd28cd8d50d32d/prototype/pr25-acceptance.html) offers explicit v1/v3 migration into a fresh v5 folder while preserving source history. V4-to-v5 migration is not implemented. Full ledger/history verification still materializes data. The earlier v1/v3 benchmarks above do not measure the current app path or establish device capacity.
