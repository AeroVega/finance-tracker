# Synthetic financial year

## Scope and authorization

**User-confirmed request, November 8, 2026:** after PR #29 merged, the owner requested a button to upload a year's worth of invented financial data into an empty Google Drive folder of their choosing, for visualization, insight and projection testing.

**Implemented:** [Seed a synthetic year](../prototype/synthetic-year.html), linked from the main workspace and prototype hub. The default recipe is calendar year **2025**, the last complete calendar year at implementation time. The UI intentionally offers one reproducible version rather than importing user files. It is not a production dashboard, an investment engine or a projection implementation.

Production financial-data persistence remains **NO-GO** under [PR #27](PR27_PRODUCTION_PERSISTENCE_PROPOSAL.md). No real-data test, live Drive action, merge, deployment, or production activation is authorized or claimed by this implementation. No paid service, framework or new authentication scope was introduced. After the owner asked to rethink storage for speed, this feature added an opt-in grouped canonical payload layout for new synthetic copies; the catalog, transaction, recovery and session protocols are unchanged. Existing prototype pages and earlier acceptance records remain intact.

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

## Upload and overwrite boundaries

1. Nothing connects or uploads on page load. Only public deployment configuration and Google libraries load. Local preview generates invented records without requesting a token or calling Drive.
2. The owner creates and checks a new empty Drive folder whose name contains `synthetic`, separate from all real financial data. A checkbox and the selected-folder confirmation explain what will be uploaded.
3. The existing Picker verifies folder identity, MIME type and nontrashed status. The production folder name is blocked. The same `drive.file` scope is retained.
4. Strict empty-folder enumeration runs **before** session creation or manifest initialization. Every visible child, even an existing synthetic manifest or session marker, blocks a fresh upload. The existing initializer checks again before bootstrap.
5. **Scope limit:** `drive.file` cannot prove absence of files outside app access. The owner must confirm actual emptiness in Drive. These checks do not turn a limited listing into a complete Drive inventory, and a concurrent external change can still race enumeration. Session coordination remains best-effort, not a server-enforced lock.
6. The page pins the freshly admitted folder/database/copy identity in this tab only. The seeder requires a verified revision-zero primary synthetic manifest with an empty logical snapshot before the first financial commit.
7. The existing `CanonicalLedgerStore`, application lifecycle and catalog engine save the canonical graph with all current ownership, offline, exact-base, provenance, immutable-history, journal and recovery safeguards. A new store independently reopens and compares the complete graph before success is shown.
8. An exact previously saved recipe verifies without another financial commit. A different ledger, an unrelated logical object, a backup destination or changed empty-copy identity cannot be replaced or appended to by this page. Existing record history and unsupported folders are preserved.

The main workspace's four-row synthetic dashboard snapshot is a separate payload. It does not automatically display this canonical year. After release, use the existing canonical import workbench for inspection and its summaries, or the existing backup/export/restore tools. Future visualizations should consume canonical records and their qualifications rather than infer complete balances from this fixture.

## Interruption and retry

Repeated clicks are gated. Upload, preview, reconnect, recovery and release share a UI busy state; the seeder also rejects overlapping financial operations. Controls and status stay beside the action. Progress reports verified durable writes and elapsed time, not a percentage or proof of success.

A failed save may have reached Drive. The page never deletes partial files or blindly starts another transaction. Reconnect uses an existing-copy-only preflight and cannot initialize a new folder. Existing lifecycle revalidation and recovery run before the recipe is examined. An exact committed graph verifies without reseeding. A verified return to the original empty primary copy permits one explicit user-triggered safe retry, only while that folder's admission identity remains in the same tab. Retry can be requested again after another verified recovery; no background retry runs.

After reload, admission permission is gone. An exact complete year can still be verified using its deterministic recipe, but an empty/aborted or unrecognized existing copy cannot be seeded. Preserve it and choose a new empty folder. An interruption during initial bootstrap without a valid manifest also fails closed and requires a new folder; automatic cleanup and bootstrap reconstruction are not part of this feature.

Reconnection and verification still perform the existing session/recovery operations, including session-marker updates and journal recovery. “No financial records added” does not mean zero Drive requests or zero maintenance writes. A stopped session requires explicit confirmation that other tabs/devices have stopped. Release must verify before the owner switches tools or devices. Token expiry or offline transitions stop writes through the existing lifecycle; reconnect and verify rather than assuming the upload failed harmlessly.

Beforeunload asks the browser to warn while an operation or session is active. Mobile termination and browser warning limitations remain; keep the tab open, online and awake. Nothing stores tokens, folder IDs or record data in localStorage/sessionStorage. No new telemetry or public reports are introduced. The year page opts out of original-source retention maintenance, so selecting an unrelated synthetic copy cannot trigger original-file retention or deletion before the recipe is checked. Other tools retain their existing maintenance behavior.

## Performance and acceptance

### Grouped canonical payloads

**User-confirmed follow-up:** the owner asked to rethink the storage format as an opportunity to improve speed. The new year uses the opt-in `chunks-v2` layout. It groups each canonical collection into fixed append-order buckets of at most 64 records and at most 128 KiB of stored UTF-8 JSON per chunk. The same 722 logical objects become **15 physical payload objects**. The largest fixture chunk is 128,922 bytes, below the 131,072-byte limit.

The index remains at the existing canonical index path but declares version 2. Old clients reject the unsupported version rather than interpreting the copy as empty. New clients read versions 1 and 2. An existing version-1 ledger continues writing version 1 even if a caller requests chunks. No existing copy is migrated, compacted or rewritten; historical snapshots retain their original format. A conversion tool is not part of this work.

All record identities, source observations, collection order and events remain unchanged. Before packing, the store performs the same per-record immutable-history, source-evidence, retry and metadata checks as before. Grouping changes physical placement, not financial meaning. New records extend the last bucket or add a bucket. Corrections append events; mutable review records can change only under the existing logical rules. Unchanged chunks reuse their content hashes. A chunk's old bytes remain in immutable retained history after replacement.

Chunk boundaries do not move when a record changes size. An oversized chunk fails before any write instead of repartitioning, truncating or silently changing formats. Readers enforce raw-byte size as well as exact chunk identity, inventory, record order and envelope keys. Missing, extra, mixed or malformed canonical paths fail closed. The 128 KiB limit is a synthetic implementation bound, not a Google service limit. Very large source descriptions or future ledger sizes may need a separate, reviewed chunking extension.

The existing engine still saves changed payloads and their journals serially. Ownership and exact-base checks, independent read-back, hash verification of all retained history, recovery and backup/export/restore validation remain in force. No persistent cache or verification shortcut was introduced. Repeated edits still retain historical chunks, so this is not a solution to unlimited retained-history growth or production scale.

### Category-correction scope and remaining size limit

**Verified before the scoped-rule fix, at `c41448b`:** with 1,000 distinct posted activities, each category-correction event copied every existing activity ID. Four corrections produced 158,821 bytes of event JSON and exceeded the fixed 128 KiB chunk cap.

**Implemented and verified with invented data:** new rules retain only pre-existing activities with the same account, institution, currency, normalized description and source action. Inactive matching activities remain included. Blank descriptions disable future matching and retain only the explicitly corrected target. The old version-1 inventories remain readable and immutable. No migration or history rewrite occurs.

The same 1,000-distinct-activity, four-correction case now produces 2,977 bytes and packs within the unchanged cap. In the 253-activity year, correcting a utility category retains 12 matching IDs instead of 253. Tests cover late imports with older financial dates, unchanged earlier peers, bank corrections, lifecycle transitions, linked refunds, legacy rules, packed save/reopen, export and fresh-copy restore. See [category-rule scope and evidence](CATEGORY_RULE_SCOPING.md).

**Remaining limit:** the inventory still grows with the number of historical activities in one exact matching scope. Four corrections with 1,000 same-key peers still exceed the cap and fail before a storage transaction. Previously persisted oversized full-ledger inventories are not made smaller. Neither retrying nor another folder makes an oversized chunk fit. A compact immutable creation boundary or a reviewed byte-bounded chunking extension remains future work. This improvement does not establish unrestricted ledger scale or authorize production persistence, merge or deployment.

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

Run `node tests/benchmark-synthetic-year.mjs` to repeat both layouts, or pass `--layout=chunks-v2` / `--layout=records-v1` to run one. The benchmark uses invented HTTP responses only and asserts full ledger equality; it does not contact Google.

A single local end-to-end run including setup, generation, repeat verification and release took 82.407 seconds for version 1 and 4.868 seconds for version 2. These are local synthetic measurements, not Google latency, iPhone performance, a quota limit or a live speed guarantee. Live timing and quota behavior remain to be measured; token expiry still requires revalidation and recovery rather than skipping verification.

**Verified locally, November 8, 2026:** the complete `node --test tests/*.test.mjs` suite passed **746/746** on Node **24.22.1** and **26.13.0**, without failures, cancellations or skips. All JavaScript module syntax checks and `git diff --check` passed. The final request-budget assertion was then verified by rerunning all 12 seeder tests on both versions. The synthetic-year save/reopen budget is at most 600 simulated HTTP requests, with no elapsed-time assertion.

The new packed-storage suite passes 25 tests, including interruption at every one of 17 durable boundaries of a packed correction, safe retry, immutable evidence/order, corrupt and oversized chunks, unknown envelope keys, v1 format preservation, the frozen legacy index guard contract, and backup/export/restore. Existing legacy canonical/snapshot tests pass 57/57, including their 38-boundary interruption matrix. Independent correctness review found no outstanding blocker after raw-byte limits and retention-maintenance scope were tightened.

Local Chromium checked 320×740, 390×844, 768×1024, 844×390 and 1440×1000 layouts without document-level horizontal overflow. With Google/Drive requests stubbed, checks passed for no automatic authorization/upload, local preview counts, OAuth/Picker cancellation, GET-only nonempty-folder refusal, duplicate-click protection, offline controls and workspace/hub navigation. Additional browser checks used a local storage stub with the real UI, generator, canonical serializer and seeder: an uncertain committed response remained a failure until recovery verified the exact saved graph; repeated verification added no financial write; failed release never appeared successful; verified release allowed further actions. No page errors were observed. These checks do not establish live OAuth, Drive or mobile Safari acceptance.

**Open:** owner-run live synthetic Drive acceptance, live duration/quota behavior, Google authorization/Picker on iPhone and iPad, and Safari/WebKit verification. No live Google credentials, Drive reads or writes were used during development. A green local test or CI run is not live acceptance or production authorization.

### Suggested bounded owner check, only after a separately authorized deployment

1. Preview locally. Confirm 253 activities and 722 logical canonical objects grouped into 15 storage objects. Confirm no Drive connection occurs for preview.
2. Try a nonempty disposable synthetic folder and cancel Picker once. Both must stop without a new upload. Do not use a real-data folder for refusal tests.
3. Choose a new empty synthetic folder, keep this tab awake and observe progress. Success requires “Uploaded and independently verified.” Record elapsed time privately; do not publish folder IDs, tokens or personal account details.
4. Verify again; no second financial commit should occur. Release, reload, reconnect to the saved year and verify the same graph. Release before opening the workbench.
5. Inspect monthly summaries and preserved correction/refund evidence in the canonical workbench. Missing balances and excluded investment activity must remain qualified.
6. If any operation fails, preserve the folder and use the documented reconnect/recovery path. An interrupted initial setup or post-reload empty copy requires a new folder, not deletion or repeated blind upload.
