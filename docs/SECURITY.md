# Security and Privacy Requirements

**Status:** Required production controls. See the [owner GO record](CURRENT_STATE.md#owner-decision-go-for-real-financial-data) for the approved deployment baseline and current runtime availability.
**Review record:** [Security, privacy, OAuth, cost and recovery review](SECURITY_PRIVACY_OAUTH_COST_RECOVERY_REVIEW.md), reviewed against main revision `16a5ff6134a414d4cc5ede1e2ed4c3af551740f4` on 2026-11-22.
**Last reconciled:** 2026-11-22

The review record documents scope, threat model, code observations, current Google documentation, cost and recovery constraints, test evidence, residual risks, and the explicit owner-approval gate. It does not authorize production access.

## Objective and data scope

The first production financial view is limited to monthly income, categorized expenses, and a separately represented net-worth increase. These are distinct measures and must not be collapsed into one total. The system must preserve provenance and explain coverage; missing or stale data is not zero.

## Public repository rules

Treat all committed content, branches, issues, pull requests, workflow output, and Git history as potentially public. Never commit:
- Real transaction CSVs, statements, account exports, holdings, balances, income, spending or net-worth figures.
- Account identifiers, passwords, access/refresh tokens, API keys, private keys, cookies, database credentials, or production environment files.
- Logs, screenshots, fixtures, or bug reports containing sensitive data.

Fixtures must be deliberately authored with invented values. Keep owner-provided samples outside this public repository by default.

## GitHub Pages boundary

GitHub Pages serves public static content. Never publish private ledger records as JSON, CSV, JavaScript constants, reports, or downloadable assets. Anything delivered to a browser must be treated as visible and potentially extractable. Obfuscation, minification, hidden links, or an encryption key shipped with the frontend do not provide privacy.

## Google Drive and OAuth

- Use Google's authorized OAuth flow; never collect, transmit, or store a Google password.
- Request the narrowest practical Drive scope and explain its access in user-facing terms. Verify actual file/folder behavior.
- Never embed a client secret in browser code. Public OAuth client IDs are not passwords but still require correct OAuth configuration.
- Keep active financial data and access tokens in memory. No ledger, financial cache, refresh token, or offline write queue may be persisted in browser storage. On verified orderly release clear application references to financial records, drafts, baselines, backup previews, rendered records and access tokens after safe drain/recovery handling.
- Handle token expiry, sign-out, revocation and interactive reauthorization explicitly. Local token clearing is not Google grant revocation or Google account sign-out.
- Bind the session to the designated Google account and selected database. Verify authorization and ownership for every operation. A browser-local account fingerprint is an identity pin, not encryption or a cross-device policy.
- Drive is file storage, not a transactional database. Do not claim atomic compare-and-swap or guaranteed cross-device exclusion. Avoid destructive overwrites; detect conflicts where supported and retain recoverable state on uncertain writes.
- Verify current OAuth publication/testing requirements, API terms, quota/billing rules and actual Cloud project configuration.
- No recurring production costs, expiring-trial dependencies, paid API plan, or implicit billing activation is acceptable.

## Import handling

Parse user-selected CSVs locally unless an approved design requires transfer. Validate structure, dates, amounts and row types; treat input as untrusted. Render descriptions as text, never executable HTML/code. Retain import provenance and use conservative duplicate matching. Ambiguous matches require review.

Parse selected CSVs locally in the browser. The app must never upload or persist original CSV files, including in backups or restores. Preserve normalized records and necessary import provenance only, after explicit save to approved private storage. The owner may keep the original files locally. Verify on the active route that original bytes are absent from app-managed storage, network uploads, and portable backups; never restore original payloads from a legacy archive. Real-data activation still requires separate approval.

## Synchronization, backup and recovery

- Sequential single-active-device use only. Release and verify one device before opening the same database on another. The Drive marker is best-effort, not a server-enforced lock.
- Clearly distinguish saved, pending, failed, stale and synchronized states.
- Test interrupted writes, duplicate submissions, competing sessions, stale revisions, unavailable network, revoked access and provider errors. Refuse offline/uncertain writes.
- A dispatched but ambiguous authority write is **unverifiable** until evidence resolves it; do not automatically resubmit.
- Provide portable export independent of the app and document cadence, retention, tolerable loss and restore steps.
- Never claim a backup/recovery guarantee not demonstrated by tests and live synthetic acceptance.

## Browser privacy and diagnostics

- Keep parsing and calculations local unless transfer is required.
- Browser/device storage and caches are potentially readable by someone with device/browser access. Do not mistake local storage for cross-device synchronization.
- No analytics/telemetry may disclose financial activity. No sensitive data in URLs, console output, crash reports or notifications.
- Inspect localStorage, sessionStorage, IndexedDB, Cache Storage, browser/network caches and restored page state after release, sign-out, reload and abrupt close.
- Clearing application references is not secure memory erasure. Downloads, browser history, Google cookies, OS snapshots, extensions, developer tools, abrupt shutdown and lost-device state remain outside the clearing guarantee.
- Diagnostics must use registered codes, allowlisted context and bounded metrics. Never serialize raw provider bodies, exception messages, full records, account identifiers or token/header values.

## Required release gates

1. No real financial data or secrets in tracked files, diffs, public assets, fixtures, logs or workflow artifacts.
2. Actual OAuth configuration, scopes, designated-account/database binding, restrictions, expiry, revocation and reauthorization verified.
3. Production working-state/token clearing, browser retained-state limits, network behavior and deployed-artifact privacy inspected and tested.
4. Live synthetic save/reopen and orderly sequential handoff verified on supported devices. Competing-session detection remains best-effort; no offline writes.
5. Interrupted/ambiguous-write recovery, idempotent retry, provider/quota failure and corruption refusal demonstrated.
6. Synthetic retention tests verify expiry, confirmed deletion, retryable failure and backup/restore consistency; owner reviews deletion-receipt limitations.
7. Portable export and independent restore pass for the supported logical record inventory; backup policy is defined after OAuth verification.
8. Actual provider terms, quotas, usage and billing support $0 recurring cost.
9. Financial calculations, provenance and coverage reconcile to synthetic expectations. Missing/stale data is explicit.
10. Owner reviews evidence and residual risks and explicitly authorizes production activation. Merge and deployment approval are separate.

Synthetic tests do not waive actual configuration, live synthetic, privacy, cost or owner-authorization requirements. Until every gate passes and the owner separately approves activation, real-data use remains unauthorized.

## Secret exposure response

1. Stop changes that may spread exposure and notify the owner.
2. Revoke/rotate exposed credentials promptly, where applicable.
3. Assess Git history, forks, caches, artifacts and logs; a deletion commit alone is insufficient.
4. Document remediation without repeating exposed data.
