# PR #25 — End-to-end acceptance and production-readiness evidence

**Status:** Active implementation and synthetic verification; production persistence is not approved.  
**Last reviewed:** 2026-11-02  
**Branch:** `feat/production-readiness-acceptance`

This record separates code implemented in PR #25 from tests that can run in CI, live provider rehearsals, and owner-only configuration checks. A green synthetic test suite is not a production go-live decision.

## Implemented in this branch

### Verified snapshot backup primitive

`js/portable-backup.mjs` adds `createVerifiedSnapshotBackup` for adapters scoped to a source primary and a separately prepared destination folder.

- Requires an active primary manifest and a matching, SHA-256-verified commit record.
- Reads each object in the committed snapshot and verifies its exact hash before copying.
- Writes new immutable destination objects and verifies destination read-back.
- Creates a destination commit record with the copied object locators while preserving the logical commit identity and history.
- Assigns a new physical `copyId`, backup role, and explicit destination storage binding.
- Re-reads the source manifest after copying; if it changed, the backup is not accepted.
- Writes the backup manifest last and verifies its exact read-back.
- Requires the caller to hold the active session's serialized source-operation gate for the entire copy, and requires an explicit quarantine callback. Partial copies must not be classified as backups, restored, or promoted. No cleanup is attempted because partial files are evidence.
- Resolves ambiguous destination create responses only by exact pre-generated-ID read-back and SHA-256 verification.

**Boundary:** the helper is adapter-driven and covered by in-memory synthetic tests. It is not yet wired into the dashboard lifecycle or exercised against live Google Drive. Destination folder creation and durable quarantine marking must be provided by the caller/adapter.



### Architecture reconciliation — owner decision recorded

**Decision (2026-11-02): preserve accepted ADR §81 and redesign physical object resolution.** Do not revise the ADR to accommodate the current PR #23 implementation.

The current PR #23 engine stores `fileId` alongside `sha256` in each commit snapshot reference. That is a mismatch, not the desired contract. The target commit snapshot is a complete logical map of `logicalPath -> sha256`; Drive IDs remain copy-specific physical locators and must be resolved outside immutable commit records.

Implementation must update the transaction engine, recovery verifier, backup/restore flow, and synthetic fault-injection tests together. A backup must retain byte-identical logical commit history while using its own physical object locators. Recovery must resolve each logical path/hash against the active copy's locator data and fail closed for missing, duplicate, mismatched, or ambiguous mappings.


**Owner decision (2026-11-02):** the database's logical history describes what the data is (logical paths and content hashes); a separate per-copy mapping describes where those objects are physically stored. This principle is accepted. The concrete locator-catalog format and publication protocol are not yet approved.


**Owner decision (2026-11-02):** each per-copy locator catalog must cover every physical object required by the copy's retained commit history, not only the latest snapshot. Historical commits remain resolvable and verifiable through that copy's catalog.


**Owner decision (2026-11-02):** locator-catalog publication is copy-on-write and manifest-last. Build a new immutable catalog covering the copy's retained history, upload it, read it back, and verify it before updating the authoritative manifest to reference it alongside the new committed revision. A crash before manifest publication leaves the previous manifest/catalog authoritative; an unreferenced new catalog is unpublished data, not active state.

**Owner confirmation (2026-11-02):** the locator catalog is understood as a per-copy lookup index connecting each logical object/version (logical path plus SHA-256) to its physical Drive file. The owner also recognizes the potential performance benefit: once a catalog is retrieved and verified, the app can resolve object locations directly rather than repeatedly searching Drive. This is an expected efficiency benefit, not yet a measured performance result. This confirms the conceptual model only; exact entry schema, integrity binding, caching/invalidation, and publication/recovery details still require specification.

**Owner decision (2026-11-02):** the per-copy locator catalog covers all immutable objects required for normal operation and recovery: data objects, commit records, journal events, and other immutable protocol objects. The catalog itself is excluded from self-lookup; its identity and integrity are anchored directly by the manifest. This is a scope decision, not approval of an exact schema or implementation.



**Owner decision (2026-11-02):** history retention should be configurable. History compaction is an accepted design direction: preserve a verifiable summary/checkpoint of the database's older state while allowing the detailed events represented by that checkpoint to be discarded. Compaction must be an explicit, auditable maintenance operation, distinct from routine cleanup. The retention duration, checkpoint contents/integrity contract, compaction procedure, and recovery/backup implications remain to be specified; no history is authorized for deletion by this decision alone.



**Owner decision (2026-11-02):** history retention should be configurable. History compaction is an accepted design direction: preserve a verifiable summary/checkpoint of the database's older state while allowing the detailed events represented by that checkpoint to be discarded. Compaction must be an explicit, auditable maintenance operation, distinct from routine cleanup. The retention duration, checkpoint contents/integrity contract, compaction procedure, and recovery/backup implications remain to be specified; no history is authorized for deletion by this decision alone.

**Owner decision (2026-11-02):** compaction establishes a new historical baseline. The compacted checkpoint preserves verified long-term financial reporting; newer activity remains detailed after the checkpoint; a cryptographic link anchors the checkpoint to the history it replaces. Once checkpoint verification and required backup safeguards pass, the represented old detailed events may be discarded. Compaction must preserve comparable long-term reporting across the boundary, including monthly income and expense totals, category totals, account balances, and investment summaries.  **Owner clarification (2026-11-02):** category totals, account balances, and investment summaries are retained at monthly granularity as well. **Owner clarification (2026-11-02):** monthly investment summaries retain both total portfolio market value and a holdings breakdown identifying individual securities, quantities, and values, so long-term reporting preserves both portfolio growth and changes in composition. **Owner decision (2026-11-02):** retain monthly investment cash-flow and performance components as well: contributions/deposits, withdrawals, dividends and interest, investment fees, and realized gains/losses. The reporting contract must distinguish external cash flows from investment performance; portfolio market-value change alone must not be presented as investment return. **Owner decision (2026-11-02):** nominal historical values remain the authoritative retained financial record. Inflation-adjusted figures are an optional derived presentation feature, not a replacement for nominal history; calculate them from nominal values using an explicitly identified inflation index and reference date rather than storing them as authoritative financial facts.

**Owner decision (2026-11-02):** closing or disconnecting an account must not create gaps in long-term reporting. Retain that account's historical monthly balances and its contribution to income, expense, category, and investment summaries in compacted checkpoints, together with stable historical account identity and closure status. Historical reporting remains available after the account is closed; this does not require retaining every underlying transaction indefinitely. Monthly income and expense totals, category totals, account-balance snapshots, and investment summaries therefore remain available for each retained reporting month; annual and longer-term views can be derived from those monthly records. Preserve the reporting semantics needed to interpret those measures consistently over time (currency, period boundaries, account/category identity and history, and treatment of transfers, pending activity, refunds, reversals, corrections, and investment activity). The objective is to retain durable financial insight, not reconstruct individual old purchases. **Owner decision (2026-11-02):** preserve historical categorization as recorded at the time. Later additions or refinements to the category taxonomy apply prospectively and do not automatically reclassify old transactions or rewrite compacted historical category totals. Historical category identity and name must remain exactly as recorded for old transactions and reports. Category additions, refinements, and renames apply prospectively only; a rename must not change the displayed name in historical reports or compacted historical summaries. A rename preserves the category's underlying identity for new activity; a change in meaning or a split into distinct classifications creates new category identities. Historical records retain the name and identity that applied when they were recorded. Do not automatically recategorize old transactions, rewrite compacted category totals, or retroactively rename historical category labels. Retrospective changes are out of scope unless separately specified and explicitly authorized in a future change. **Owner decision (2026-11-02):** category merging is allowed prospectively. When categories are merged, new activity uses the surviving destination category; historical transactions, category identities, names, and compacted summaries remain unchanged. A merge must not retroactively rewrite historical reports.  **Owner decision (2026-11-02):** categories may optionally contain subcategories. A category without subcategories may receive transactions directly. Once it has subcategories, it is a reporting parent only and transactions must be assigned to one of its subcategories; parent totals are calculated from the child totals and must not double-count them. When a category is split into subcategories, transactions already assigned directly to the parent remain assigned there as historical records; new transactions must use a subcategory. Do not automatically redistribute historical parent-level transactions. Historical category/subcategory assignments and names remain as recorded; hierarchy changes apply prospectively and do not move old transactions. The category hierarchy is limited to two classification levels: Sum Total → Category → Subcategory. Subcategories cannot contain further nested categories. Sum Total is the overall aggregate, not a user-assigned transaction category. This is a design decision, not authorization to implement deletion or enable production persistence. **Owner decision (2026-11-02):** users may manually reassign an existing transaction to a different category or subcategory. This is an explicit correction, not automatic recategorization. The correction must preserve an auditable record of the prior assignment, replacement assignment, and correction time; it must not silently overwrite the original classification history. **Owner decision (2026-11-02):** manual transaction corrections update the effective historical reports for the transaction's original reporting period (corrected-history approach). The audit trail must still preserve the original assignment, replacement assignment, and correction time. The reporting and compaction design must provide a verifiable way to apply such corrections to already-compacted monthly summaries without erasing the prior classification or silently rewriting checkpoint history; the exact append-only adjustment/checkpoint mechanism remains to be specified.

**Still open:** choose and specify the durable per-copy locator representation and its publication/recovery contract before changing the engine. Until that design is accepted and implemented, the PR #25 backup helper's current `fileId + sha256` compatibility shape is transitional and must not be described as ADR-compliant or production-ready.

### Portable export and restore planning

`createPortableBackup`, `verifyPortableBackup`, and `planPortableRestore` provide a versioned JSON archive contract.

- Archive envelope and each object are SHA-256 verified.
- The archive must contain exactly the logical objects in the commit snapshot; missing, extra, duplicate, or modified objects fail closed.
- A structural-validation callback is required at verification time.
- Portable archives omit Drive file IDs and replace the source storage binding with a portable marker; they are not tied to the original Drive folder.
- Restore planning requires a new physical copy ID and explicit destination binding, preserves logical database/commit lineage, and returns verified object bytes.
- Restore planning is deliberately inert. It does not write a destination folder or publish a manifest. A persistence workflow must upload objects under new Drive IDs, rebuild the commit snapshot references, and publish the restored manifest only after verification.

### 540-day original-source retention policy

`js/original-retention-policy.mjs` implements pure retention-state primitives:

- Expiry is exactly 540 × 24 hours from successful private retention.
- Eligibility is separate from provider-confirmed deletion.
- Failed eligible deletions preserve the locator, record the failure/attempt, and remain retryable.
- The live locator is cleared only after provider-confirmed absence.
- Backup metadata preserves the original retention timestamp and expiry.
- Restore omits expired or confirmed-deleted originals and never restarts their clock.

**Boundary:** this state machine is not yet connected to an original-CSV upload/import record, a scheduled deletion worker, Google Drive deletion calls, or backup/restore persistence. Production retention is therefore **not implemented end to end**.

### Existing transaction fault-injection coverage

PR #23's transaction-engine suite injects lost responses after all 11 durable mutation boundaries and exercises deterministic recovery against the in-memory synthetic Drive. This coverage remains useful and must stay green. It is not a substitute for real browser termination/reload rehearsals against Drive.

## Automated CI evidence

**Verified on the previous tested code head:** both GitHub Actions workflows completed successfully on Node.js 26.

- Finance Tracker contract tests — run #224; dashboard/browser syntax checks and complete Node contract suite passed.
- Node contract tests — run #338.
- That tested head reported **222 passed, 0 failed**.

One additional edge-case test was added afterward (genesis commit with a null parent), alongside a restore copy-ID collision assertion and corresponding validation changes. The current branch therefore contains **223 tests**, but needs a fresh run before it can be called green. Trigger the existing `Finance Tracker contract tests` workflow manually from the Actions tab if the latest PR synchronization did not start a run. These automated synthetic tests do not replace live Google Drive or iOS Safari acceptance.

## Current Google authorization, quota, and cost review

**Verified from current official documentation on 2026-11-02:**

- The prototype requests `https://www.googleapis.com/auth/drive.file`. Google classifies `drive.file` as a **non-sensitive** scope: it grants per-file access to files created by the app or opened/shared with it through Picker. This is preferable to the broad restricted `drive` scope. See [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
- The checked browser flow uses Google Identity Services token-client authorization and keeps the access token in page memory. The prototype clears its token when expired and requires an interactive reconnect. It does not persist a refresh token. This avoids long-lived browser refresh-token storage but means reauthorization is expected.
- Google's current OAuth help says apps in Testing are limited to listed test users and user authorizations expire after seven days. A personal-use app with fewer than 100 users may qualify for an exception from verification, but that does not remove the need to obey the Google API Services User Data Policy. Confirm the actual Cloud Console publishing status and exception applicability before relying on it. See [Manage app audience](https://support.google.com/cloud/answer/15549945?hl=en) and [When verification is not needed](https://support.google.com/cloud/answer/13464323?hl=en).
- Google Drive's current quota documentation lists 1,000,000 quota units per minute per project, 325,000 per minute per user/project, and a 1 TB/day project egress limit. It currently says standard Drive API use is available at no additional cost. The same page describes a 400,000,000 quota-unit daily billing threshold and says charges above it are planned for later in 2026, with further billing details to be shared after at least 90 days' notice. See [Drive API usage limits](https://developers.google.com/workspace/drive/api/guides/limits) and [Google Workspace standardized model](https://developers.google.com/workspace/tools-safety).

**Not verified / owner action required:**

- The actual Cloud Console OAuth publishing status, listed test users, declared scopes, API restrictions/referrer restrictions, and project billing configuration have not been inspected by this code review.
- Live expiry, revocation, wrong-account, denied-scope, and 401/403 recovery tests have not been run against the owner's Google account.
- The future billing details and effective date for over-threshold Drive usage remain subject to Google's updates. The $0 constraint cannot be guaranteed solely from the published standard-use statement; the project must remain below the applicable threshold and must not silently enable billing-dependent behavior.
- The live usage and quotas assigned to the owner's Cloud project have not been retrieved.

The current scope is appropriately narrow at the prototype level. It is not a substitute for live OAuth and project-configuration acceptance.

## Required owner-run acceptance before this workstream can close

Use only a dedicated synthetic Drive folder and invented data. Never use the canonical ledger folder or real financial records.

1. **Live backup:** from a synthetic primary, create a backup in a separate synthetic folder. Confirm same `databaseId`, revision and `commitId`; different `copyId` and storage binding; all object hashes match; backup manifest appears last; and reopening the backup succeeds.
2. **Failure/quarantine:** deliberately interrupt or corrupt a destination object/commit/manifest during backup. Confirm the source primary is unchanged, partial destination is quarantined and cannot be selected/restored/promoted, and retry starts from a fresh destination.
3. **Portability:** export the verified synthetic backup to a local file, move it outside the Drive folder, verify it independently, and restore it into a separate synthetic folder with a new `copyId`. Verify object hashes, structural references, revision and commit lineage. Do not treat the inert restore plan as a completed restore.
4. **Fault rehearsal:** use a disposable synthetic database and rehearse real browser termination/reload around every transaction mutation boundary. Verify reconnect recovery, preserved evidence, no duplicate commit, and fail-closed behavior. Existing in-memory 11-boundary tests are the automated baseline.
5. **OAuth:** test expired token/401, explicit revocation, wrong Google account, missing folder grant, denied permissions/403, and interactive reauthorization. Confirm no empty-folder inference, automatic replacement, or write attempt after authorization loss.
6. **Retention:** use synthetic source files and a simulated clock at one millisecond before and exactly at day 540. Verify expiry eligibility, provider-confirmed deletion, failure/retry, backup clock preservation, and no resurrection on restore. The Drive delete operation must be read back/confirmed before clearing the locator.
7. **Cost and terms:** inspect the actual Cloud project, confirm Drive API enabled, review current quotas/usage and billing configuration, and record whether billing is disabled. Recheck the official Google quota/billing announcement before any production authorization.
8. **Security/privacy:** inspect the deployed artifact and browser storage/network behavior. Confirm no client secret, token, financial data, CSV contents, account identifiers, or private diagnostics are shipped, stored in public Pages assets, or emitted to logs.
9. **Owner acceptance:** review all evidence, open limitations, and the accepted single-active-device constraint. Production persistence requires a separate explicit authorization after PR #25; merging PR #25 alone must not enable it.

## Release decision

**Current decision: NO-GO for production financial-data persistence.**

Reasons: live Drive backup/restore/portability, real interruption rehearsals, OAuth failure-mode validation, end-to-end original-source deletion, actual Cloud billing/quota inspection, and owner acceptance remain outstanding. The current branch contributes reusable code and synthetic evidence but does not close those gates.

