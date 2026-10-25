# Private Storage Architecture — Google Drive

**Status:** Selected direction; production validation required  
**Decision date:** 2026-10-17  
**Scope:** Architecture and verification plan only. This document does not authorize production implementation or storage of real financial data.

## Decision

Use the project owner's own Google Drive as the intended canonical private store for the Finance Tracker's ledger and related metadata. Continue down this path unless a concrete, material blocker is found that cannot reasonably be worked around. Do not reopen the decision based only on hypothetical scale concerns.

The goal is an app hosted as public static content on GitHub Pages that can authenticate the owner through Google's authorized OAuth flow, read and write the owner's private files, and synchronize records across iPhone and iPad—without a separate paid database service or recurring operating cost.

This is an architectural direction, not a claim that every OAuth, scope, billing, synchronization, or recovery detail has already been validated.

## Status labels

- **User-confirmed (2026-10-21):** Use the owner's existing Google Drive folder as the private home for the canonical ledger. Parse selected CSVs locally; store the normalized ledger and import provenance in Drive; do not retain original CSV files there. Short-lived access tokens and interactive reauthorization are acceptable.
- **User-confirmed (baseline):** The public repository must not contain personal financial data; recurring production cost must remain $0; CSV import remains a permanent fallback; cross-device access is required.
- **Selected direction:** Keep the dashboard as public static content and call Drive from the browser after explicit user authorization. The Drive folder will hold the ledger rather than a collection of archived source CSVs.
- **Proposed least-privilege prototype:** Evaluate the `drive.file` scope with Google Picker folder selection. Keep the supplied folder ID out of public source. Confirm that folder selection permits the required operations before enabling ledger writes.
- **Verified from repository constraints:** GitHub Pages content and this public repository must be treated as public; browser-local storage alone does not synchronize devices.
- **Hypothesis pending verification:** Google Drive API plus browser OAuth can meet the required production workflow with no recurring cost and acceptable recovery guarantees.
- **Open:** exact OAuth and Picker configuration, authorized site origin, selected-folder access under `drive.file`, conflict handling, backup/restore, and current production billing/terms.

## Intended data flow

1. The user selects a supported CSV on their device.
2. The browser parses and validates the file locally by default.
3. The app displays an import summary and asks the user to resolve ambiguous cases where necessary.
4. After authorized sign-in, the app reads the latest canonical data and revision metadata from Drive.
5. The app reconciles the import using the documented idempotent import contract.
6. It writes changes only after checking for stale data/conflicts; it must not silently replace a newer version.
7. It reports success, pending work, failure, or unresolved conflict honestly.
8. A later session on the other device reads the synchronized canonical data from Drive.

No raw CSV or ledger data should be sent to unrelated services. Avoid analytics/telemetry that could expose financial activity.

## Authorization and access scope

- Use Google's supported browser OAuth flow; never request or store the user's Google password.
- Evaluate the narrowest practical Drive permission, including `drive.file`, and whether a dedicated app-created or user-selected folder is required. Verify which files are actually visible/manageable under the chosen scope.
- Do not assume broad Drive access is necessary. Document why any requested scope is required.
- Never embed client secrets in static frontend code. Do not commit tokens or real OAuth configuration secrets.
- Prefer short-lived access tokens held in memory where practical. Handle expiry and reauthentication; do not assume a browser-only client can safely retain long-lived refresh tokens.
- Make sign-out and access revocation understandable, and fail closed when authorization is absent.
- Test on iPhone and iPad using synthetic records before connecting real financial data.

## Data layout — working proposal

The synthetic Drive probe is isolated from the canonical ledger. The production persistence proposal, pending architecture review, is:
- Keep a versioned JSON ledger in the user's selected Drive folder. Include normalized activities, source provenance, import-run summaries, and schema version.
- Retain the original CSV only in the browser's selected-file flow; do not upload or archive CSVs in Drive.
- Keep any recovery snapshots as ledger snapshots, not source-file archives. Final snapshot cadence and retention remain open.
- Do not include the user's folder ID or OAuth configuration in the public repository.

This keeps the parser and financial calculations independent of the storage provider while making the ledger portable.

## Consistency and failure handling

Drive is file storage, not a transactional database. Before real writes are enabled, specify and test:
- how the app detects stale revisions or concurrent updates;
- how a write is staged and committed without leaving a partially updated dataset;
- how the app distinguishes an upload accepted by Drive from a complete, verified update;
- how duplicate requests and retries remain idempotent;
- how conflicting edits are surfaced without silently discarding either version;
- how corrupt, missing, deleted, or unexpectedly modified files are detected;
- how the app behaves offline, after a timeout, after token expiry, and after access revocation.

Use revision/version metadata where the API supports it. Preserve a prior known-good version or a recoverable snapshot before replacing canonical state. Exact mechanics are open until tested; do not promise database-grade transactions or automatic conflict resolution without evidence.

## Backup, export, and portability

- Provide an export format the owner can retain independently of the app.
- Define a backup cadence, destination, and retention policy; a second file in the same Drive account may not protect against account loss or account-wide deletion.
- Document how to restore and how to recognize a valid backup.
- Test restore on synthetic data and verify transaction counts and totals.
- Keep the data model source-independent so that changing storage providers does not require rewriting CSV parsers or financial calculations.
- The owner should be able to retrieve data without depending on the deployed web app remaining available.

## Cost and provider terms

The $0 recurring-cost constraint is a release gate. Published quota headroom may make ordinary one-person API usage unlikely to hit limits, but quota limits and billing terms are separate questions. Before production:
- verify current Drive API terms, quota policies, and any billing-related changes from official Google documentation;
- confirm the project's Cloud configuration cannot accidentally enable paid services or billing-dependent behavior;
- test expected usage at personal scale;
- record the source URL and verification date.

Do not implement elaborate quota optimization before there is measured evidence it is needed. Handle ordinary quota/network errors safely and visibly.

## Validation checklist before production

- [ ] Confirm OAuth app configuration, consent-screen status, allowed origins, and production publishing requirements.
- [ ] Confirm the selected scope is least-privilege and supports the intended folder/file operations.
- [ ] Confirm access-token lifetime, reauthorization, sign-out, and revocation behavior.
- [ ] Confirm no client secret or privileged credential ships in the frontend.
- [ ] Run the separate synthetic Drive probe in the user-selected folder: create a temporary invented JSON file, read back and compare it, then ask before deleting only that test file. Do not read or modify the ledger during this probe.
- [ ] Demonstrate create/read/update/export on synthetic data from iPhone and iPad.
- [ ] Test two-device stale writes, simultaneous edits, retries, interrupted uploads, deletion, and corruption recovery.
- [ ] Define and test backup/restore outside the normal read/write path.
- [ ] Verify current terms and confirm no recurring production cost or expiring-trial dependency.
- [ ] Review data leakage through browser storage, logs, URLs, telemetry, and GitHub assets.
- [ ] Keep real financial records out of the public repo and all public CI artifacts.

## Development sequence and target

- **October 2026:** document the storage/security direction, finish the import contract and source-schema discovery, and review architecture PRs.
- **November 2026:** build the first working vertical slice with synthetic/sanitized inputs: upload, parse, validate, calculate, display, and prove duplicate safety.
- **December 2026:** integrate the approved private persistence path, test iPhone/iPad synchronization, conflict handling, export, backup/restore, and release safeguards.
- **Target: 2027-01-01:** release MVP1 only if privacy, correctness, recovery, and $0 recurring-cost gates pass. If they do not, reduce scope or move the date rather than weakening safeguards.

The timeline is a planning baseline, not a guarantee. The open storage-validation items must not block independent parser, calculation, and dashboard work using synthetic test data.

## Primary-source references to verify during implementation

- Google Drive API overview: https://developers.google.com/workspace/drive/api/guides/about-sdk
- Google Drive API scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Google Drive API usage limits: https://developers.google.com/workspace/drive/api/guides/limits
- Google Identity Services: https://developers.google.com/identity/oauth2/web/guides/overview
- OAuth 2.0 for browser-based applications: https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow

These are starting points, not a substitute for checking the current wording, production requirements, and applicable terms at implementation time.
