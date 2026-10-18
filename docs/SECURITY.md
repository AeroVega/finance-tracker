# Security and Privacy Requirements

**Status:** Required baseline; Google Drive is the selected storage direction, subject to validation  
**Last updated:** 2026-10-17

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
- Keep access tokens short-lived in memory where practical; do not commit or log tokens. Do not assume a browser app can safely protect a long-lived refresh token.
- Handle token expiry, sign-out, revocation, and reauthorization explicitly.
- Apply least privilege and validate ownership/authorization for every file operation. Do not rely on obscurity of file IDs.
- Treat Drive as file storage, not a transactional database. Avoid destructive overwrites; detect stale revisions/conflicting edits where supported, and provide a safe recovery path.
- Verify current Google OAuth publication/testing requirements, API terms, quota/billing rules, and the actual Google Cloud project configuration before production use.
- No recurring production costs or expiring-trial dependencies are acceptable.

## Import handling
- Prefer local parsing of user-selected files unless an approved design requires transmission.
- Explain and minimize any data transferred to Drive.
- Validate file structure, dates, amounts, and row types; treat CSV contents as untrusted input.
- Never execute imported values as code or HTML; render descriptions as text.
- Avoid retaining raw imports longer than necessary; retention policy remains to be defined.
- Do not log full rows, account identifiers, or sensitive amounts by default.
- Show import errors without leaking sensitive details to public logs.
- Preserve provenance and use conservative duplicate matching; ambiguous matches go to review instead of silent deletion.

## Synchronization, backup, and recovery
- The canonical record must be accessible from the owner's iPhone and iPad after successful synchronization.
- Clearly distinguish saved, pending, failed, stale, and synchronized states.
- Test interrupted uploads/writes, duplicate submissions, concurrent edits, stale revisions, unavailable network, revoked access, and provider errors.
- Provide a portable export independent of the app.
- Document backup location, cadence, retention, and restore steps; test restoration before release.
- Never claim a backup or recovery guarantee that has not been tested.
- Decide how accidental deletion and corrupt/incomplete writes are detected and recovered.

## Data minimization and browser privacy
- Keep parsing and calculations local unless the approved design needs a network transfer.
- Treat browser cache/local storage as device-local and potentially readable by someone with device/browser access; do not mistake it for cross-device synchronization.
- Avoid analytics/telemetry that could disclose financial activity. No sensitive data in URLs, console output, crash reports, or notifications.
- Define raw CSV retention, local cache lifetime, export/deletion behavior, and response to device loss before release.

## Required release gates
1. No real financial data or secrets in tracked files, diffs, assets, fixtures, logs, or workflow artifacts.
2. OAuth scopes, production configuration, token handling, revocation, and reauthorization verified.
3. Storage authorization and cross-device synchronization tested on synthetic data.
4. Conflict handling and interrupted-write recovery demonstrated.
5. Export and backup restoration tested.
6. Current provider terms and total production cost verified as compatible with $0 recurring cost.
7. Stale/incomplete data is clearly indicated and financial calculations reconcile to test expectations.

## Secret exposure response
1. Stop changes that may spread the exposure and notify the owner.
2. Revoke/rotate exposed credentials promptly, where applicable.
3. Assess Git history, forks, caches, artifacts, and logs; a deletion commit alone is insufficient.
4. Document remediation without repeating the exposed data.
