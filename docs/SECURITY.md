# Security and Privacy Requirements

**Status:** Required production controls. Synthetic storage is implemented; production financial-data persistence remains **NO-GO**.
**Last reconciled:** 2026-11-10

[PR27](PR27_PRODUCTION_PERSISTENCE_PROPOSAL.md) merged the production plan only. [Project status](PROJECT_STATUS.md) distinguishes source, tests, owner observations and deployment. The requirements below are not a claim that the production path passes them.

## Objective
Keep personal financial records private while allowing the owner to import, review, analyze, synchronize, export, and recover them. Security and financial correctness are MVP1 requirements.

## Public repository rules
Treat all committed content, branches, issues, pull requests, workflow output, and Git history as potentially public. Never commit:
- Real transaction CSVs, statements, account exports, or holdings.
- Real balances, income, spending, net worth, account identifiers, or other identifying financial details.
- Passwords, access tokens, refresh tokens, API keys, private keys, cookies, database credentials, or production environment files.
- Logs, screenshots, fixtures, or bug reports containing sensitive data.

Synthetic fixtures must be deliberately authored with invented values. Do not create them by copying a real export and replacing only amounts. Keep owner-provided samples outside this public repository by default.

## GitHub Pages boundary
GitHub Pages serves public static content. Never publish private ledger records as JSON, CSV, JavaScript constants, reports, or downloadable assets. Obfuscation, minification, hiding links, or shipping an encryption key in the same frontend does not make data private. Anything delivered to a browser must be treated as visible to the user and potentially extractable.

## Google Drive and OAuth requirements
Google Drive is the selected storage direction, but production use remains gated on verification and testing.

- Use Google's authorized OAuth flow. Never collect, transmit, or store the user's Google password.
- Request the narrowest practical Drive scope and explain access in user-facing terms. Verify the scope's actual file/folder behavior before implementation.
- Never embed a client secret in browser code. Public OAuth client identifiers are not passwords, but must still be configured according to Google's current guidance.
- Keep working financial data and access tokens in memory. Clear them on sign-out or normal orderly release after safe draining, recovery-state handling and verified release. Retain only the approved non-authoritative inventory/recovery metadata. Do not persist a ledger, financial cache, refresh token or offline write queue. Current synthetic draft retention does not meet the production clearing requirement.
- Handle token expiry, sign-out, revocation, and reauthorization explicitly.
- Bind one designated Google account and database. Reject wrong accounts/folders and verify ownership/authorization for every operation. A multiple-authorized-account switching workflow is out of scope. Do not rely on obscurity of file IDs.
- Treat Drive as file storage, not a transactional database. Avoid destructive overwrites; detect stale revisions/conflicting edits where supported, and provide a safe recovery path.
- Verify current Google OAuth publication/testing requirements, API terms, quota/billing rules, and the actual Google Cloud project configuration before production use.
- No recurring production costs or expiring-trial dependencies are acceptable.

## Import handling
- Prefer local parsing of user-selected files unless an approved design requires transmission.
- Explain and minimize any data transferred to Drive.
- Validate file structure, dates, amounts, and row types; treat CSV contents as untrusted input.
- Never execute imported values as code or HTML; render descriptions as text.
- Retain original imports only in approved private storage for **540 days (18 months)** from successful retention. Record the retention timestamp and calculate deletion eligibility 540 days later; expiry alone is not confirmation of deletion. Indefinite retention is not the default. Keep file-retention state distinct from import-processing status, record confirmed deletion, and make deletion failures visible and retryable. After confirmed deletion, remove the live file locator while preserving only permitted row-level provenance and import metadata.
- The 540-day duration is approved; private-storage implementation and the detailed controls still require approval before production use. Define how backup copies expire or are deleted consistently with the policy; backup/restore must not silently reintroduce originals that the policy says were deleted.
- Do not log full rows, account identifiers, or sensitive amounts by default.
- Show import errors without leaking sensitive details to public logs.
- Preserve provenance and use conservative duplicate matching; ambiguous matches go to review instead of silent deletion.

## Synchronization, backup, and recovery
- Access across iPhone and iPad is sequential. Verify release on the first device before opening the saved copy on the next. Simultaneous use is unsupported; best-effort session markers are not a server-enforced lock.
- Clearly distinguish saved, pending, failed, stale, and synchronized states.
- Test interrupted writes, duplicate submissions, detected competing sessions, stale revisions, unavailable network, revoked access and provider errors. Refuse offline/uncertain writes. An unverified release or ambiguous commit cannot be reported as success.
- Provide a portable export independent of the app.
- Document backup location, cadence, retention, and restore steps; test restoration before release.
- Never claim a backup or recovery guarantee that has not been tested.
- Decide how accidental deletion and corrupt/incomplete writes are detected and recovered.

## Data minimization and browser privacy
- Keep parsing and calculations local unless the approved design needs a network transfer.
- Treat browser cache/local storage as device-local and potentially readable by someone with device/browser access; do not mistake it for cross-device synchronization.
- Avoid analytics/telemetry that could disclose financial activity. No sensitive data in URLs, console output, crash reports, or notifications.
- Preserve the settled 540-day original-file policy separately from canonical-history retention. Verify deletion rather than inferring it from expiry or an access-ambiguous 404. Review the [deletion-receipt limitation](SYNTHETIC_STORAGE_ACCEPTANCE.md) and restore behavior.
- Inspect localStorage, sessionStorage, IndexedDB, browser/network caches and restored page state after release, sign-out, reload and abrupt closure. Document what device loss or account compromise can expose; clearing application references is not a secure memory/device wipe.
- Define routine backup cadence, tolerable loss and rotation after production OAuth verification. Existing pre-migration backup and retention requirements remain in force.

## Required release gates

1. No real financial data or secrets in tracked files, diffs, public assets, fixtures, logs or workflow artifacts.
2. Actual OAuth configuration, scopes, designated-account/database binding, restrictions, expiry, revocation and reauthorization verified.
3. Production working-state/token clearing, browser retained-state limits, network behavior and deployed-artifact privacy inspected and tested.
4. Live synthetic save/reopen and orderly sequential handoff verified on the supported devices. Competing-session detection remains best-effort; no offline writes.
5. Interrupted/ambiguous-write recovery, idempotent retry, provider/quota failure and corruption refusal demonstrated.
6. Synthetic retention tests verify expiry, confirmed deletion, retryable failure and backup/restore consistency; the owner reviews the deletion-receipt limitation.
7. Portable export and independent restore pass for the production-capable record inventory; backup policy is defined after OAuth verification.
8. Actual provider terms, quotas, usage and billing support $0 recurring cost.
9. Financial calculations, provenance and coverage reconcile to synthetic expectations. Missing/stale data is explicit.
10. The owner reviews evidence and residual risks and explicitly authorizes production activation. Merge and deployment approval are separate.

A separate real-financial-data smoke test is not required under the later PR27 decision. Synthetic tests provide test evidence; they do not waive actual configuration, live synthetic, privacy, cost or owner-authorization requirements. Until the gates pass, real-data use remains unauthorized.

## Secret exposure response
1. Stop changes that may spread the exposure and notify the owner.
2. Revoke/rotate exposed credentials promptly, where applicable.
3. Assess Git history, forks, caches, artifacts, and logs; a deletion commit alone is insufficient.
4. Document remediation without repeating the exposed data.
