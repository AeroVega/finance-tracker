# Security, Privacy, OAuth, Cost and Recovery Review

**Review date:** 2026-11-22
**Reviewed main revision:** `16a5ff6134a414d4cc5ede1e2ed4c3af551740f4`
**Review branch:** `review/security-privacy-oauth-cost-recovery-2026-11-22`
**Reviewed app path:** `index.html` → `js/canonical-workspace.mjs` → `DashboardSyntheticStorage` / `CanonicalWorkspaceSession` → full-snapshot v1
**Decision:** **NO-GO for real financial data.** Synthetic-only code review and documentation updates do not constitute production activation approval.

This is an evidence record and release-gate checklist, not a certification, penetration test, legal opinion, live Google configuration audit, or authorization to use a real account, folder or figures.

## 1. Scope and threat model

The proposed initial financial summary must show three separate measures:
1. Monthly income.
2. Categorized expenses/spending.
3. Net-worth increase over the selected comparison period.

Net-worth increase is a separately derived change in assets less liabilities; it must not be presented as income or as the arithmetic remainder of income less spending. Internal transfers must not become income or expenses. Each displayed value must be traceable to validated ledger records and must disclose incomplete or stale coverage. Missing values are unavailable, not zero.

The current repository implements a broader canonical financial ledger and a synthetic-only workspace. This review does not claim the three-measure production experience has been activated or accepted with real data. The product specification already distinguishes income, spending, transfers, investment activity, net worth and change in net worth.

Threats in scope:
- Public GitHub Pages hosting and a public source repository accidentally publishing financial values or credentials.
- Sensitive state exposed through browser memory, local/session storage, caches, history, page restoration, DOM, downloads, backups, developer tools or extensions.
- Google account mix-ups, account switching, unexpected Picker selection, wrong database folder, misleading synthetic folder names, and limited Drive visibility.
- OAuth access-token expiry, revocation, account mismatch, popup denial, reauthorization, and stale authorization during in-flight work.
- Existing data accidentally overwritten, duplicate writes, uncertain provider responses, interrupted publication, delayed remote mutation, corrupted/incomplete history and failed restore.
- Browser/device suspension, two tabs/devices, stale session markers and concurrent writers.
- Quota/rate/egress limits, storage growth and costs associated with full snapshots, verification reads, backups, restore and recovery.

Assets to protect include the logical ledger and its complete history, monthly summaries, source/import provenance, account/folder bindings, OAuth access tokens, backup passwords and local drafts. The main trust boundaries are GitHub Pages/public Git history, the user's browser, Google OAuth/Picker, Drive API, and user-managed downloaded backups.

## 2. Source and privacy findings

### Public hosting and repository

The inspected `index.html` loads the current canonical workspace and visibly identifies the workspace as synthetic-only; the navigation and footer say production financial storage is disabled. The checked-in `js/google-config.js` has empty OAuth client ID and API key values; the deployment workflow supplies public browser configuration at deploy time. A browser OAuth client ID and restricted browser API key are not secrets in the same sense as a client secret, but they are public and must be correctly origin/API restricted.

GitHub Pages, workflow artifacts, Git history, pull requests, issues and static assets are public surfaces. No real financial values, account credentials, private folder IDs or tokens were added in this review branch. No private workbook, real bank export, live Drive account or real folder was accessed.

**Not verified:** the currently served Pages build, deployed source-stamp, generated configuration artifact, repository/environment secret values, artifact contents, deployment permissions, caches/CDN behavior or the actual Cloud Console project. A successful workflow alone does not prove the served site is the reviewed code or that its public configuration is correct.

### Financial values and tokens

The current app path holds the logical ledger, saved baseline, drafts, backup preview and selected account/folder state in JavaScript application/session objects. The inspected source intentionally stores a browser-local SHA-256 account fingerprint under `finance-tracker.designated-account.v1`; it does not store the account email, access token, ledger or refresh token there. No IndexedDB or sessionStorage persistence of the ledger or token was identified in the inspected current path. The app has no offline write queue; write paths are blocked offline.

The OAuth access token is held in page memory, supplied to the Drive adapter through a callback and sent in the HTTP Authorization header. It is not intentionally embedded in a URL or committed asset. No raw-token, raw-provider-body or financial-record logging path was identified in the inspected adapter/diagnostic modules.

The diagnostic pipeline normalizes failures to registered error codes and fixed messages. It uses allowlisted source/operation context, bounded request metrics, environment metadata and limited breadcrumbs; it does not intentionally include raw provider bodies, Authorization headers, tokens, account identity, folder IDs or ledger records. These properties were reviewed in source; there was no live browser/network capture or deployed log/artifact inspection.

### Orderly release and limits

The normal UI release flow requires verified lifecycle release, then clears the workspace's ledger/session references, staged history, view models, rendered record panels, form values and token references. Unresolved saves/recovery states block a normal successful close; failed release does not claim success. The local account fingerprint and allowlisted diagnostic history are intentionally retained.

This is application-reference clearing, not secure erasure. JavaScript cannot promise zeroization of strings or process memory. Downloads, browser history, Google login cookies, OS snapshots, browser restoration, extensions, developer tools, crash dumps, abrupt shutdown, lost devices and external copies remain outside the guarantee. A downloaded unencrypted backup is readable; optional password encryption does not allow password recovery. Physical iPhone/iPad Safari retention behavior has not been verified.

**Finding:** source-level privacy boundaries are materially better than persisting financial data in browser storage, but release, cache and physical-device acceptance is incomplete. Do not enter real data until deployed artifact and device checks pass.

## 3. OAuth, account and folder authorization

### Scope

The current source requests only `https://www.googleapis.com/auth/drive.file` via Google Identity Services. Google classifies it as non-sensitive and recommends it for most use cases. It permits the app to create files and access files the user opens with the app or shares through Picker; it is not broad read access to the user's entire Drive. Google Drive `about.get` documents `drive.file` as a supported scope, so the app's `fields=user(permissionId,emailAddress,me)` identity check is consistent with the documented scope.

The app should not expand to the restricted full-Drive scope simply to make folder enumeration easier. The trade-off is material: the app cannot infer that every item in the selected folder is visible to it.

### Designated account

The inspected code obtains `permissionId`, `emailAddress` and `me` from `about.get`; it requires a self identity with nonempty fields. It asks the user to confirm the returned email and stores a SHA-256 fingerprint of the permission ID in localStorage. On recovery reauthorization it requires the same in-memory permission ID before replacing the token. Tests cover first designation, mismatch, missing identity, missing expiry, unavailable storage, and preserving the old binding through Picker cancellation/preflight/release failures.

This closes part of the prior account-binding gap in source: the token is bound to a designated Google identity for the life of this browser storage session. It does **not** create a cross-device identity authority. Each browser/device must independently designate the same account; clearing site data removes the pin. The fingerprint is not encryption or an authorization boundary.

### Selected database folder

The app carries the selected folder ID/name in the same in-memory storage object as the designated account permission ID; the lifecycle and adapter are constructed for that selected folder and use the current token callback. Picker selection is treated as a candidate until metadata, user confirmation, storage format preflight and (for folder changes) verified release of the prior session succeed. The application refuses the hard-coded production folder name, requires a name containing “synthetic”, and requires explicit user confirmation.

Those checks are guardrails, not an authorization proof. The inspected code does not establish that the selected folder's owner or effective permissions match the intended account. More importantly, the `drive.file` scope only exposes app-visible files. A successful child listing can therefore not prove that the entire folder is empty or free of files not visible to the app. The UI asks the user to check emptiness in Drive and confirm, but this remains a human assertion.

**Finding:** account-to-token binding is partially implemented and has synthetic test coverage; account-to-folder ownership/effective permission binding and complete folder visibility are not proven. Keep this as a production gate. Do not use a real database folder.

### Token lifecycle

The token is held in memory with an expiry timestamp. The token callback clears the reference and blocks operations at/near expiry; requests are not silently renewed. Explicit recovery reauthorization obtains a new token and checks the same account identity before replacing it. Source/tests cover authorization denial, closed/blocked popup, expiry-shaped failures, authorization failures and no silent reauthorization. Live revocation and reauthorization against the currently configured project were not independently tested at this revision. Clearing the local token does not revoke Google's grant or sign the user out of Google.

### Current Google OAuth app-mode decision

Google's current guidance (checked 2026-11-22) describes Personal mode for an app intended for one personal account. It does not require OAuth app verification and is not subject to the 100-user cap or seven-day testing expiry. It is a one-time setup choice; an existing External/Internal project cannot be converted to Personal. Google documents that an account other than the app creator can receive `client_user_mismatch`. External Testing remains limited to listed test users and has seven-day authorization expiry; external published/unverified configurations have separate warnings and caps.

**Owner configuration gate:** inspect the actual Cloud Console project and record app mode, publishing state, creator account, audience/test-user list, enabled APIs, exact scopes, authorized JavaScript origins, Picker key restrictions and current consent screen. Do not attempt to change project mode during this review. Personal mode is only a candidate if it accurately matches the intended single-account use and the existing project is eligible; it cannot be retrofitted into an existing External/Internal project.

## 4. Cost and sustainability

Google's Drive API quota guide, checked 2026-11-22, currently lists 1,000,000 quota units/minute/project, 325,000 quota units/minute/user/project, 1 TB/day project egress before the daily threshold, and a daily billing threshold of 400,000,000 quota units. It lists 5 units for `about.get` and ordinary file GET metadata operations, 100 units for list methods and 50 units for edit methods. Google describes standard use under the threshold as no additional charge and says over-threshold charging/quota-increase billing is planned for later in 2026, with advance notice. Projects with prior Drive API activity in the documented November 2025–April 2026 transition period may retain previously assigned limits; projects created on/after May 1, 2026 use the new quota model. The actual Cloud Console project determines its limits and billing state.

For a single personal user, a $0 recurring-cost design is plausible if usage stays within the no-additional-charge threshold and Google does not require a paid plan or billable behavior. It is not guaranteed by a simulator or by published standard pricing. The project must not enable billing-dependent usage, buy quota increases, rely on trials, or silently switch to a paid provider.

Full-snapshot v1 stores an entire logical ledger snapshot on each changed save and retains prior snapshots. Current hard bounds are 8 MiB per snapshot, 16 KiB for the manifest/envelope and 10,000 commits. There is no aggregate history-byte cap or garbage collection in this route. The implementation note gives an example where ten dense snapshots exceed 60 MB. Every full cold open and recovery audits retained ancestry; verify reads, metadata closure, backup, restore, retries and recovery add requests and egress. Growth is linear in retained full snapshots, and process memory can exceed response-size caps because buffers, strings, parsed objects and histories overlap.

When a quota/rate/egress limit or authentication failure occurs, operations must fail closed, writes remain disabled and drafts/recovery evidence must be retained. Only bounded read retries may be considered where safe. A dispatched but unknown authority mutation must not be retried automatically. No live usage meter, quota alert or bill estimate was verified, so actual consumption must be checked in Cloud Console before activation and periodically thereafter.

**Finding:** the architecture can target $0 recurring cost, but the real project configuration, actual assigned limits, billing state, observed usage and long-term storage growth remain unverified. Full-snapshot growth is a material sustainability risk even if API calls stay free.

## 5. Save, reopen, backup, restore and recovery

### Save/reopen integrity

The selected full-snapshot route validates the ledger and size before writes, checks the current baseline and the candidate financial transition, writes an immutable full snapshot and commit envelope, publishes the pending authority state then the clean authority state, and verifies actual provider reads after publication. Open and recovery audit the selected full ancestry, hashes, metadata and append-only transition rules. Corrupt or unsupported history and wrong-format folders fail closed; the new path does not migrate, overwrite or delete unsupported old copies.

The owner-confirmed synthetic open/save path on an earlier accepted revision and previously recorded local Node/remote CI runs are historical evidence only. They are not a fresh run on reviewed main SHA `16a5ff6`, not all-provider acceptance and not physical-device acceptance.

### Interrupted and uncertain writes

The save protocol records whether an authority mutation was dispatched. If a write may have reached Drive but its outcome cannot be established, the application retains the draft and recovery evidence, blocks ordinary save/retry/release, and requires explicit recovery. Recovery never blindly resubmits a candidate; it independently reads and validates what is on Drive. If the authority was not dispatched and the base is unchanged, it can classify the change as not saved and offer explicit retry. If the outcome remains uncertain or a different valid copy is found, retry stays blocked.

Drive update semantics do not provide the atomic compare-and-swap/fencing guarantee needed to rule out all competing writers. The single-active-session marker is best-effort and can race during network partitions, browser suspension or multiple devices. This is an explicit residual risk, not an application bug that can be fully repaired by a client-side read/check/write/readback sequence. Do not describe the app as multi-device conflict-proof.

When the application closes/reloads, in-memory attempt evidence is lost. A later full open may verify the current saved database but cannot prove whether the user's last uncommitted draft reached Drive. The UI should preserve that distinction and never claim the lost draft was saved or not saved solely from the current head.

### Backup and restore

The backup codec exports the last verified saved logical ledger and its history/provenance, not physical Drive revision history, ownership state or credentials. Staged changes require save-first or explicit exclusion. It supports plaintext checksum-protected archive or optional AES-256-GCM encryption with PBKDF2-HMAC-SHA-256 (fixed 600,000 iterations); passwords are not persisted/logged and cannot be recovered if forgotten. The unkeyed checksum detects accidental corruption but not malicious replacement/authenticity. The archive is buffered in memory, not streamed; physical-device KDF/memory limits are not measured. Accepted free-text/extension fields are preserved and not scrubbed for arbitrary secrets, so the user must not place credentials in ledger descriptions/extensions.

Restore validates the complete archive before folder selection, requires a new empty destination, uses the existing full-snapshot writer, releases the restore session, then verifies through a fresh application/adapter instance by full open, exact logical equality and recomputed report equality. A partial or uncertain destination is not deleted or blindly reinitialized.

### User procedure (currently synthetic-only)

1. Save and wait for an explicit verified Saved state, or choose the backup option that explicitly excludes the staged draft.
2. Download a verified portable backup. Prefer password encryption for a private backup stored outside a trusted location; keep the password separately.
3. Keep a prior known-good backup until the new copy has been restored and independently verified.
4. Restore only to a new empty dedicated synthetic folder. Validate the file before choosing the folder.
5. Restore once; wait for verified release and fresh-instance full reopen. Compare history and recomputed reports. Do not delete/reinitialize a partial destination.
6. If a save/restore result is Unverifiable, stop writes, keep the tab/folder and use explicit recovery. Do not retry until the app proves retry is safe.
7. Treat downloaded backups as private files; the static app cannot remotely erase them.

The approved 540-day original-source retention requirement must be enforced across actual original files and backups, and restore must not restart retention clocks. The selected full-snapshot backup is logical ledger content; this review did not independently establish deployed cleanup/confirmed deletion for every original-source object. Retention/deletion is another production verification gate.

## 6. Evidence inventory and tests

### Exact reviewed source baseline

Main head fetched from GitHub on 2026-11-22: `16a5ff6134a414d4cc5ede1e2ed4c3af551740f4`.

Key source:
- `index.html`: `742df4431f8010c71f7a628d31d6656f62fb73b9`
- `js/canonical-workspace.mjs`: `4381638798ef5ee92fc1d9819bdec848894695fd`
- `js/dashboard-synthetic-storage.mjs`: `ab1f49601a239abc52fce104f87a78e2f02edbfc`
- `js/full-snapshot-application.mjs`: `7469ebed5626dc1c39abb209d8dac845d12ea292`
- `js/full-snapshot-storage.mjs`: `060b1d27769acb1e72a0ddc61d686c5e14ccafe9`
- `js/full-snapshot-backup.mjs`: `5811cd5082a0092e928c542b5a03a240c87571fc`
- `js/canonical-workspace-session.mjs`: `aa3330f8147c0ba8c554039c31b6541640613e13`
- `js/error-reporting.mjs`: `c20fe601a750816ea2a76b2247512f9bd5d937aa`
- `js/drive-transaction-engine.mjs`: `6d576e030643054dfd94eebbcd78c208e8ed73bb`

Key tests present on reviewed main:
- `tests/privacy-account.test.mjs`: 8 test cases (identity pin, mismatch, expiry/identity failure, picker/selection/release boundaries).
- `tests/full-snapshot-backup.test.mjs`: 12 test cases (logical equality, source/evidence/history and report preservation, corruption/shape/depth, plaintext/encrypted, WebCrypto and interoperability checks).
- `tests/full-snapshot-application.test.mjs`: 13 test cases (seed/open/save/reopen, interruption/recovery, release gating, session expiry/offline cases).
- The simulator documentation describes fault-injected provider scenarios for seed/save/release/reopen, publication lost responses, corruption, 401/403/429/503, expiry-shaped failures and Picker cancellation/errors.

**Important qualification:** I inspected the test sources and the historical verification record; I did not execute a local suite in this review. The backup/recovery contract records a 934/934 extended Node run on its 2026-11-17 candidate, and a local browser harness attempt failed before opening Chromium; WebKit was not installed. That is not a test pass on this exact main SHA. The current Actions result on the exact reviewed head was not run/established in this review.

### Synthetic vs live evidence

Synthetic provider tests use HTTP-shaped fake responses and invented data. They do not use a Google account, real credentials, Drive folders, live API quotas, deployed Pages assets, iPhone Safari or iPad Safari. Simulator timings/request counts are scenario metrics and assumptions, not live cost/latency/usage evidence.

Historical owner-reported live synthetic checks exist for a prior temporary Drive create/readback/delete probe and earlier full snapshot open/save. They do not prove the present exact app build, intended account/folder authorization, revocation, all-provider import, current backup/restore, device privacy, current quota assignment, or production readiness.

## 7. Findings, fixes and residual risks

### Findings

1. **Production remains synthetic-only.** The UI and storage selection explicitly block production data; do not change this in this review.
2. **Account-token binding is implemented but only browser-local.** The token-holder permission ID is checked and pinned; it is not a cross-device owner policy.
3. **Account-folder authorization remains open.** Source does not establish folder owner/effective permissions, and `drive.file` enumeration cannot prove global emptiness or inspect inaccessible children.
4. **No CAS or strong concurrent-writer exclusion.** The Drive session marker is best-effort; competing writes remain a residual risk.
5. **Full-snapshot storage growth is unbounded in aggregate.** Each save writes a full snapshot and old snapshots remain; per-object/history-count caps do not provide a total byte/retention cap.
6. **Browser and live provider acceptance is incomplete.** No current-revision physical iPhone/iPad Safari release/cache/download/backup KDF test or current live Google OAuth/Picker/revocation test is claimed.
7. **Project configuration and $0 proof are not available from source.** Console mode, billing, restrictions, quotas and current usage must be checked by the owner.
8. **Uncertain-write evidence is memory-bound.** After page loss the last in-memory attempt cannot be classified; next open verifies saved content only.
9. **Source-original retention/deletion was not proven end-to-end.** The 540-day requirement must apply to actual originals, backups and restore; confirmed deletion and retry need evidence.
10. **Test evidence is not current-head proof.** Historical test runs were not rerun on the exact main SHA reviewed here.

### Changes made on this review branch

- Reconciled `docs/SECURITY.md` with the current source and production NO-GO boundary.
- Updated `docs/GOOGLE_DRIVE_CONFIGURATION.md` to the current Google OAuth Personal/Testing app-mode guidance, `drive.file` scope meaning, current quota model, actual source behavior and project-specific verification gates.
- Updated `docs/PRIVACY_SESSION.md` to distinguish browser-local account pinning from account/folder ownership, and application-reference clearing from secure erasure.
- Updated `docs/FULL_SNAPSHOT_BACKUP_RECOVERY.md` with the present full-snapshot protocol, recovery outcomes, backup constraints and a user-understandable recovery procedure.

No application code was changed because this review did not reproduce a production-safe code fix within the existing synthetic-only authorization. No config, deployment, Google Cloud project, folder or data was activated or modified.

### Residual risks before any activation

- Confirm actual Cloud Console configuration, app mode, authorized origin, API restrictions, enabled APIs and project billing/quota assignment.
- Complete live synthetic tests on the exact deployed candidate: expected account, wrong account, expected folder, folder ownership/effective permission, unselected/inaccessible folder content, cancellation, token expiry, revocation, reauthorization, save, reopen, wrong-folder refusal, interrupted publication and fresh-empty restore.
- Verify no financial data/token in built Pages assets, Git history, CI artifacts/logs, browser storage, URL, console, network diagnostics or caches.
- Verify orderly release and abrupt shutdown/browser restore on physical iPhone and iPad Safari. Measure backup encryption KDF time/peak memory and download completion.
- Verify live quota/usage/cost against the actual project and model storage growth at expected saves/history. Establish an owner-approved capacity/retention policy before history becomes large.
- Verify 540-day source retention, confirmed deletion and restore non-resurrection in the active storage route.
- Decide whether best-effort single-device coordination is acceptable for the intended operational procedure. If not, a server-enforced transactional authority would be required and would need a separately approved cost/architecture decision.
- Decide how users should resolve uncertain last writes after a browser/device loss without falsely asserting draft outcome.

## 8. Owner approval gate — not yet requested

**No approval to activate real financial data is requested or implied by this review.** The release gates above are not yet all demonstrated. The reviewed deployment remains synthetic-only, and no real financial figures, real Drive folder or production Google account should be entered or selected.

Once the outstanding controls are verified, activation must require a separate, explicit owner decision identifying all of:
- The exact deployed Git commit/build stamp and public Pages URL.
- The intended Google account (display/email confirmation and account identity verification in the app, without writing identifiers into this public repo).
- The exact dedicated Drive database folder and how its ownership/effective permissions and contents were confirmed.
- The approved storage format/version and backup/recovery procedure.
- Confirmation that the $0 recurring-cost and privacy boundaries are accepted.

That approval is separate from approving this documentation PR, merging it, deploying code, or running a synthetic test. Until then, keep production financial persistence **NO-GO**.
