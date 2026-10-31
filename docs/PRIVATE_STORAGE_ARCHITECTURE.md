# Private Storage Architecture — Google Drive

**Status:** Selected direction; production validation required  
**Decision date:** 2026-10-17; architecture baseline and original-import retention reaffirmed 2026-10-31  
**Scope:** Architecture and verification plan only. This document does not authorize production implementation or storage of real financial data.

## Decision

Use the project owner's own Google Drive as the intended canonical private store for the Finance Tracker's ledger and related metadata. Continue down this path unless a concrete, material blocker is found that cannot reasonably be worked around. Do not reopen the decision based only on hypothetical scale concerns.

The goal is an app hosted as public static content on GitHub Pages that can authenticate the owner through Google's authorized OAuth flow, read and write the owner's private files, and synchronize records across iPhone and iPad—without a separate paid database service or recurring operating cost.

This is an architectural direction, not a claim that every OAuth, scope, billing, synchronization, or recovery detail has already been validated.

## Status labels

- **User-confirmed (2026-10-31; supersedes the earlier 2026-10-21 preference):** Use the owner's existing Google Drive folder as the private home for the canonical ledger and retained source imports. Parse selected CSVs locally; retain each original CSV in private Drive storage for **540 days (18 months)** from successful retention, then delete it and verify deletion. Store normalized ledger data and import provenance in Drive. Short-lived access tokens and interactive reauthorization are acceptable.
- **User-confirmed (baseline):** The public repository must not contain personal financial data; recurring production cost must remain $0; CSV import remains a permanent fallback; cross-device access is required.
- **Selected direction:** Keep the dashboard as public static content and call Drive from the browser after explicit user authorization. Drive holds the canonical ledger, import provenance, and separately governed original CSV files subject to the approved 540-day retention lifecycle; it is not an indefinite source-file archive.
- **Verified prototype result (user-confirmed 2026-10-24):** The deployed synthetic probe succeeded with the `drive.file` scope and Google Picker folder selection. It created invented JSON in the selected private folder, read back an exact match, and deleted the temporary file after user confirmation. The owner repeated the test successfully after rotating the restricted API key. This validates only the probe's create/read-back/confirmed-delete path; it does not authorize production ledger writes.
- **Verified from repository constraints:** GitHub Pages content and this public repository must be treated as public; browser-local storage alone does not synchronize devices.
- **Hypothesis pending verification:** Google Drive API plus browser OAuth can meet the required production workflow with no recurring cost and acceptable recovery guarantees.
- **Verified for the prototype (user-confirmed 2026-10-24):** the configured OAuth/Picker flow and selected-folder create/read-back/delete operations worked from the deployed GitHub Pages origin.
- **Open for validation:** token expiry, reauthorization and revocation behavior; cross-device synchronization; whether Google Drive can enforce the documented stale-writer exclusion; implementation and testing of interrupted-write recovery, corruption handling, and verified backup/restore; production publishing/verification requirements; and current production billing/terms.

## Intended data flow (target; not yet implemented)

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

## Data layout — architecture baseline

The detailed database identity and persistence model is recorded in [Database Identity and Lifecycle](DATABASE_IDENTITY_AND_LIFECYCLE.md), merged in PR #19. The ADR defines the target behavior; it does not establish that the Drive API can satisfy every requirement.

The target model is no longer a single mutable JSON ledger file:
- One canonical finance-tracker-manifest.json identifies the logical database and physical copy, declares manifestVersion and schemaVersion, and points to the current committed snapshot.
- Each commit record contains a complete logical path-to-content-hash map for one immutable database state.
- Stored data objects are immutable and content-addressed by SHA-256. Unchanged objects are reused; stable logical partitioning avoids rewriting the entire growing ledger for every import.
- Commit history, transaction journal, and migration history are separate append-only records.
- Drive file IDs are physical locators, not logical database identity. A backup copy has its own Drive IDs while preserving logical commit identity.
- Original CSV files are retained as separately governed private Drive objects, not as immutable database snapshot objects. Their approved retention period is 540 days (18 months) from successful retention. This lifecycle remains separate from database snapshot/object retention; backups must preserve the original retention timestamp and must never restore an already-expired original file.

This is an architecture target, not an implemented or production-validated storage format. Exact partitioning, index layout, and Drive file mapping remain subject to the synthetic feasibility spike.

## Consistency and failure handling

Drive is file storage, not a transactional database. The target staged protocol is documented in the identity/lifecycle ADR. Before real writes are enabled, prove:
- server-enforced stale-write exclusion or a safe writer/fencing protocol; a read-version-then-update sequence is insufficient;
- immutable object creation, exact raw-byte hash verification, and retry-safe behavior after lost responses;
- complete folder enumeration under drive.file for initialization and object discovery;
- publication of the manifest's current commit pointer only after all snapshot objects and commit metadata are verified;
- idempotent transaction journaling and deterministic recovery after interruption at every stage;
- snapshot consistency, backup/restore, and cross-copy portability;
- handling of external modifications, missing objects, delayed visibility, network failure, token expiry, and access revocation.

Google documents a monotonically increasing output-only file version that can help detect changes, but it must not be treated as a lock or atomic compare-and-swap. Google also documents pre-generated Drive file IDs for retry-safe creation: a repeated create using an already-used pre-generated ID returns 409 rather than creating a duplicate. Both behaviors must be tested in the deployed browser flow and actual scope.

The app must not claim a commit succeeded until the manifest and complete referenced snapshot read back and verify. If concurrency protection cannot be proven, keep production ledger writes disabled.

## Backup, export, and portability

- Provide an export format the owner can retain independently of the app.
- MVP1 defines verified snapshot backups, but backup cadence and an independent destination remain open. A second file in the same Drive account may not protect against account loss or account-wide deletion; automated backup scheduling/retention is deferred to MVP2.
- Document how to restore and how to recognize a valid backup. Any backup copy of an original CSV must preserve its original retention timestamp and expiry; restoring a backup must not restart the 540-day clock or resurrect an expired original.
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
- [x] Prototype check: confirm `drive.file` plus Picker permits create/read-back and user-confirmed deletion in the selected folder (user-confirmed live test, 2026-10-24). This does not yet validate production ledger operations.
- [ ] Confirm access-token lifetime, reauthorization, sign-out, and revocation behavior.
- [ ] Confirm no client secret or privileged credential ships in the frontend.
- [x] Run the separate synthetic Drive probe in the user-selected folder: temporary invented JSON was created, observed in the folder, read back with exact match, and deleted after explicit confirmation. The owner repeated the test successfully after rotating the API key (user-confirmed 2026-10-24). No ledger or CSV was accessed.
- [ ] Demonstrate create/read/update/export on synthetic data from iPhone and iPad.\n- [ ] Verify the 540-day original-CSV lifecycle, including confirmed deletion, retryable deletion failures, and backup/restore behavior that cannot extend retention.
- [ ] Test two-device stale writes, simultaneous edits, retries, interrupted uploads, deletion, and corruption recovery.
- [ ] Test verified snapshot backup/restore outside the normal read/write path, and decide whether an independent backup destination is required.
- [ ] Verify current terms and confirm no recurring production cost or expiring-trial dependency.
- [ ] Review data leakage through browser storage, logs, URLs, telemetry, and GitHub assets.
- [ ] Keep real financial records out of the public repo and all public CI artifacts.

## Google Drive API references relevant to this design

- [Drive files resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) — the file version is output-only and monotonically increasing; file names are not guaranteed unique.
- [Drive files.update](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update) — documents PATCH update semantics; this review has not established a conditional compare-and-swap guarantee for the intended publication path.
- [Create and manage files](https://developers.google.com/workspace/drive/api/guides/create-file) — pre-generated file IDs can be reused for create/copy retries; after successful creation, retrying with the same ID returns 409 Conflict.
- [Manage file revisions](https://developers.google.com/workspace/drive/api/guides/manage-revisions) — unpinned binary revisions may be purged; only up to 200 revisions per file can be kept forever.

These references were checked on 2026-10-31. Recheck current API behavior, terms, quotas, and OAuth requirements during the feasibility spike and before production release.

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
