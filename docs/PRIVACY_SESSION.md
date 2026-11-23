# Account and session privacy

**Status:** Synthetic-only implementation. No production activation, account switching, background sign-in or automatic folder creation.

## Designated account

Every new OAuth token is checked with Drive `about.get` using `fields=user(permissionId,emailAddress,me)`. The source binds the active storage lifecycle to the returned `permissionId`, asks the user to confirm the email, and stores only a SHA-256 fingerprint of the permission ID in localStorage. The fingerprint is not a credential, encryption, protection from same-origin script compromise or a cross-device identity policy. Each device/browser must be designated independently.

The current refresh path checks the new token against the active in-memory `permissionId` and retains the same lifecycle/folder. Missing identity, missing expiry, mismatched account or unavailable designation storage fails closed. There is no account-switch/reset UI; clearing site data requires designation again.

## Folder selection and database binding

Picker selection is a candidate until the token identity is verified, folder metadata is checked, the folder is explicitly confirmed and its visible storage contents pass format/preflight checks. Cancellation/admission failures do not initialize the candidate folder. Changing folders requires verified release of the prior lifecycle. A failed new start remains selected but non-ready rather than pretending the old session was restored.

The selected folder ID, name and account permission ID are held in the same in-memory storage object and passed to the lifecycle/adapter. Adapter operations are constructed for that folder and obtain the current token via a callback. The current source does **not** prove that the selected folder is owned by the designated account, and `drive.file` listing only covers app-visible children. The user must confirm the intended database/folder explicitly; folder ownership/effective permissions and completeness must be verified in live synthetic acceptance.

The production folder name is explicitly refused; synthetic folder names are required. This is a safety affordance, not an authorization boundary. Do not use any production folder or real financial data under the present gate.

## Authorization on operations

The full-snapshot storage adapter injects the current access-token callback into each provider request. The token callback fails closed when missing or within five seconds of expiry. It does not persist a refresh token or silently renew. Provider 401/403/authentication failures invalidate readiness and preserve drafts/recovery evidence; new authorization is interactive. Recovery refresh rechecks the same account before replacing the token and does not invoke Picker or switch folders.

A verified orderly release drains admitted work, verifies the Drive session marker is released and clears application references to access token, expiry and lifecycle. The page clears the rendered snapshot through its status callback. An unresolved transaction or unverified release does not claim a successful close. This is application-reference clearing, not secure erasure of JavaScript strings, process memory, browser caches or OS snapshots. It does not revoke Google's grant or sign the user out of Google.

## Browser storage and diagnostics

The account fingerprint is the only intended app-owned localStorage value for this flow. No ledger, financial cache, refresh token or offline queue is persisted in localStorage, sessionStorage or IndexedDB by the inspected source. This source review did not prove that no unrelated browser/network cache, restored page state, extension, developer tool or downloaded backup can retain information; deployed browser inspection is still required.

The diagnostic pipeline converts provider failures to registered codes, fixed messages, allowlisted source/operation context and bounded request metrics. It deliberately omits raw provider response bodies, tokens, headers, account identity, folder IDs and ledger contents. A separate live artifact/log inspection is still required before production.

## Acceptance still needed

Use invented records and a separately authorized synthetic folder to:
- Verify the intended account and reject a different account on connect and recovery refresh.
- Verify that the selected folder/account binding is the expected database and effective Drive access.
- Test cancellation, failed folder admission/release, token expiry/revocation and interactive reauthorization.
- Inspect application/browser storage, rendered UI and diagnostics after release/reload/abrupt close.
- Verify successful release on physical iPhone and iPad Safari.

No real financial data is authorized.
