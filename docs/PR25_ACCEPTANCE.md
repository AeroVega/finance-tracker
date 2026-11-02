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

