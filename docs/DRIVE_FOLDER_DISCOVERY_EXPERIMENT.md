# Google Drive folder discovery experiment

**Status:** User-confirmed live validation passed for folder discovery after a prior Picker grant  
**Branch:** `experiment/drive-folder-discovery`  
**Base:** `main` (intentionally independent of the Google sign-in/configuration experiment)

## Question

Can the browser app rediscover the owner's existing Finance Tracker folder across page reloads and a fresh Google authorization session while using only `https://www.googleapis.com/auth/drive.file`, without requiring Google Picker every time?

This experiment tests discovery only. It does not enable canonical ledger reads/writes or change the selected production-storage direction.

## Hypotheses

- **H1 — API discovery after Picker grant:** after the owner explicitly selects the existing folder in Picker, a Drive API `files.list` query can rediscover that same folder without opening Picker again.
- **H2 — Fresh session:** after a page reload and a new interactive authorization, the same query still finds the folder.
- **H3 — Scope boundary:** the query does not expose unrelated Drive folders/files outside the app's `drive.file` access boundary.
- **H4 — Existing-folder compatibility:** the existing user-created `finance-tracker-database` folder is discoverable under this scope once selected, without needing to replace it with a newly created app-owned folder.

These are hypotheses, not assumptions. The test must report the actual result and HTTP/API error details that are safe to show.

## Implemented prototype

- Page: [`prototype/drive-folder-discovery.html`](../prototype/drive-folder-discovery.html)
- Query helper: [`js/drive-folder-discovery.mjs`](../js/drive-folder-discovery.mjs)
- Automated tests: [`tests/drive-folder-discovery.test.mjs`](../tests/drive-folder-discovery.test.mjs)
- The page uses the same browser OAuth pattern and `drive.file` scope, and uses Picker only to establish the reference folder for comparison.
- The selected folder ID and name are retained in this tab's `sessionStorage` solely to compare the identity after a reload. OAuth access tokens remain in page memory only. Closing the tab clears the session reference.
- The page also provides **Forget saved comparison**. This removes the saved folder ID and allows a separate discovery run using only the entered folder name and the fresh access token; a unique result is reported without comparing against a Picker reference.
- The discovery helper queries exact folder name, folder MIME type, and `trashed = false`; it follows pagination and reports zero/one/multiple matches without choosing an ambiguous result. The UI reports only outcome/count, never the folder ID.
- The branch's Pages workflow injects the public OAuth client ID and restricted Picker API key from repository Actions variables into the deployed artifact. The workflow logs only whether values are present, not their values.

The implementation is a test harness, not production storage code. The query's real visibility under `drive.file` is the experiment being tested; a zero-result outcome is not automatically treated as a code defect.

## Live validation record — 2026-10-29

**Result: User-confirmed PASS.** On the deployed Experiment B page, the owner:
- authorized Google for the page session using the existing `drive.file` scope;
- had previously selected `finance-tracker-database` through Picker and confirmed the same folder could be rediscovered after reload and reauthorization;
- then pressed **Forget saved comparison**, clearing the folder ID/name reference from this page's `sessionStorage`;
- ran discovery by exact folder name without reopening Picker; the page reported one exact-name folder found and no file was changed.

The deployed page showed source SHA `d29a4eb19bbd3a56aa00376692d2ea2ae6b68ec7`. The screenshot confirms the success status and that the saved comparison reference was cleared. Device: iPad. Browser/version was not captured. No folder ID, token, API key, ledger data, or file listing was recorded.

### What the result establishes

- The Drive `files.list` exact-name query returned exactly one accessible folder for this account and configuration after a prior Picker selection/grant.
- The app can rediscover the folder without keeping its ID in its own session storage and without opening Picker during that discovery run.
- Together with the earlier reload/re-authorization identity-match test, the result supports using Picker as a one-time onboarding/permission-grant step and name-based discovery for subsequent recovery, subject to the limitations below.

### Negative implications and disposition

| Implication / risk | Does it affect this project? | Recommended treatment |
|---|---|---|
| **Not a first-contact/no-Picker proof.** The owner had previously selected this folder in Picker. Clearing the app's session reference does not revoke Google's file-specific authorization grant. | **In scope; important.** A brand-new user may not be able to discover an arbitrary existing folder before explicitly selecting/opening it with the app. | Keep Picker as the explicit first-run folder selection and authorization path. Test a genuinely fresh test account/folder before claiming first-run discovery works without Picker. |
| **Folder names are not unique identifiers.** A second folder with the same name can produce multiple matches; a rename can produce zero matches. | **In scope.** The database must not silently attach to the wrong folder. | Keep zero/multiple outcomes as stop-and-review states. For a unique match, consider a small app-owned marker/manifest and verify it before opening ledger data. Never silently pick the first result. |
| **Discovery is permission-bounded.** A zero-result response means no matching folder was returned within the current token's accessible results; it does not prove the folder is absent. | **In scope.** Recovery must not trigger creation of a second database merely because discovery returned zero. | Show “not found in accessible results”; offer explicit Picker re-selection. Do not broaden to full-Drive scope as a fallback. |
| **Account and authorization can change.** Tokens expire; access can be revoked; another Google account may not own or have access to the folder. | **In scope for a usable app.** | Reauthorize interactively when needed; make account identity clear enough to prevent accidental cross-account use; handle 401/403 without modifying data. Test expiry/revocation and wrong-account behavior before production storage. |
| **Exact-name discovery may reveal folder metadata to the app.** The query returns metadata for accessible matching folders, but this prototype displays only the outcome and does not list IDs. | **Manageable and in scope.** | Request minimum fields, keep tokens in memory only, avoid logging IDs/listings, and restrict results to folder MIME type, exact name, and not-trashed. |
| **API outages, quotas, or browser/network failures can prevent discovery.** | **In scope as ordinary failure handling; no special infrastructure required for MVP.** | Fail closed with retry/reconnect guidance. Do not treat transient errors as a missing database or create a replacement automatically. |
| **This test does not validate ledger safety.** No ledger content was read or written; no concurrency, backup, restore, or interrupted-write path was exercised. | **Production blocker, not a reason to reject this discovery result.** | Keep real financial data disabled until synchronization/conflict policy, recovery/backup, integrity validation, and authorization lifecycle are reviewed and tested. |
| **Google OAuth consent-screen testing mode and policy/terms may constrain broader use.** | **Potentially in scope before sharing/deployment beyond the owner.** | Before adding users, verify current Google OAuth publishing/verification requirements and sustainable cost/terms. For this single-user prototype, record as a release gate rather than expanding the experiment. |

### Practical conclusion

The result is useful for this single-user project: after the owner has explicitly selected the existing folder once, the app can find it again by name without persisting its ID in the app's session storage. It does **not** remove the need for Picker during initial onboarding, establish globally unique folder identity, or authorize production ledger storage. Those are separate requirements with explicit mitigations above.

## Local automated test

Run:

    node --test tests/drive-folder-discovery.test.mjs

The tests cover one, zero, and multiple exact matches, pagination, malformed response shape, HTTP errors, and required inputs. They mock Drive responses and do not replace live validation.

## Protocol

1. Deploy this experiment branch to the shared GitHub Pages URL and verify the footer's full source SHA. The shared URL temporarily serves the selected branch.
2. Authorize the intended Google test account using the existing browser OAuth flow and narrow `drive.file` scope.
3. Use Google Picker once to explicitly select the existing private folder. Do not put its ID in source, logs, screenshots, or repository documentation.
4. Query Drive's files list using an exact folder name, folder MIME type, and `trashed = false`; request only the minimum metadata needed to identify a match.
5. Report zero, one, or multiple matches separately. Never silently choose among ambiguous results.
6. Reload the page. Authorize again interactively, without using Picker, and repeat the same discovery query.
7. Record whether the exact intended folder is found, how many matches are returned, and any HTTP/API error class. Do not log access tokens, API keys, folder IDs, or private file listings.
8. For the standalone test, use **Forget saved comparison** to clear the Picker reference, then run discovery again. Record whether one exact-name folder is returned without relying on the saved ID.
9. If a unique match is found, optionally perform a read-only metadata verification against that folder ID. Do not create, modify, or delete any file in this experiment unless a separately documented synthetic-only test is explicitly approved.

## Acceptance criteria

- The query and result handling have automated tests for zero, one, multiple, malformed, and API-error responses.
- The live result is recorded as **User-confirmed** and includes the deployed source SHA, device/browser, whether Picker was used in that session, match count, and result.
- The page does not persist OAuth tokens or expose folder IDs in public logs/source.
- No broader Drive scope is requested.
- A failed query is treated as a valid experimental result; do not work around it by silently requesting full-Drive access.

## Interpretation

- If the folder is found after Picker and after fresh authorization, this supports the narrow hypothesis for this account/configuration, but does not prove all users' existing folders will be discoverable.
- If it is found only after Picker in the same session, discovery may depend on transient state or access grants; document the exact behavior.
- If it is not found, do not assume the folder is absent. The API may be limiting results to files the app created or files explicitly opened/selected through Picker.
- If the existing folder cannot be reliably discovered, separately evaluate an app-created dedicated folder and stable app-owned marker file. Do not change the user's existing folder layout without explicit approval.

## Guardrails

- Synthetic/metadata-only testing; no ledger contents or CSVs.
- Never commit the folder ID, access token, API key, account identifier, or financial information.
- Do not change `main`, merge without explicit authorization, or treat this experiment as approval for production storage.
- The Pages URL is shared: deploying this branch temporarily replaces the currently published content. Restore `main` after the experiment by manually deploying `main`.
