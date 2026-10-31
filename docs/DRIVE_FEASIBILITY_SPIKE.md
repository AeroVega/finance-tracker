# Google Drive Storage Feasibility Spike

**Status:** Phase 1 harness implemented; live Drive validation pending  
**Branch:** `feat/drive-feasibility-spike`  
**Scope:** Synthetic-only experimentation. This work does not authorize production persistence or access to real financial data.

## Purpose

PR #19 established the target database identity, immutable-object, commit, journal, backup, and recovery design. This spike determines whether Google Drive can satisfy the most important assumptions under the existing browser OAuth flow and `drive.file` scope.

The first phase intentionally tests the earliest go/no-go gates before implementing a complete storage engine:

1. Complete folder-child enumeration.
2. Pre-generated-ID creation and retry after an ambiguous/lost response.
3. Exact synthetic-object read-back and SHA-256 verification.
4. Whether Drive exposes a usable ETag to the browser and enforces an `If-Match` conditional update across two sessions.

The experiment must use a dedicated test folder containing no personal financial data. It must never discover, read, create, update, or delete the canonical database manifest.

## Current implementation

### Browser harness

Open `prototype/drive-feasibility-spike.html` from a branch deployment. The page uses the existing Google browser token flow and Picker pattern and requests only:

`https://www.googleapis.com/auth/drive.file`

The access token remains in page memory. The harness does not persist the selected folder ID or token.

Available checks:

- **Folder enumeration:** lists every child page under the selected folder, follows `nextPageToken`, rejects repeated tokens, and fails closed if Drive returns `incompleteSearch: true`.
- **Immutable-object retry:** requests a pre-generated Drive file ID, creates a uniquely named synthetic text object, deliberately discards the successful create response, retries the same ID, expects HTTP 409, then reads the file by ID and verifies exact content and SHA-256.
- **Conditional-write probe:** creates a disposable synthetic file whose description is the test value. Both sessions read the same file's metadata and capture the HTTP ETag response header (if browser CORS exposes it). Each session then sends a PATCH with `If-Match` and a different synthetic writer marker.
- **Cleanup:** deletes only temporary files created by the current browser session, after an explicit confirmation.

The object retry test is a controlled simulation of a lost response: the first successful response is deliberately discarded by the client, and the same request is retried with the same pre-generated ID. It validates the duplicate-prevention behavior, not every possible network failure mode.

### Automated tests

`tests/drive-feasibility-spike.test.mjs` covers pagination, incomplete listings, repeated page tokens, pre-generated-ID retry/409 verification, filename safety, ETag capture, and conditional-write request behavior using mocked HTTP responses.

These tests validate application logic only. They do not establish live Google Drive behavior.

## Live test procedure

### Preparation

1. Use a dedicated synthetic test folder. Do not select the folder containing any real Finance Tracker data.
2. Deploy the branch through **Actions → Deploy static site to GitHub Pages → Run workflow**, selecting `feat/drive-feasibility-spike`.
3. Open `https://aerovega.github.io/finance-tracker/prototype/drive-feasibility-spike.html` and confirm the displayed source SHA matches the branch commit.
4. Use the existing OAuth client ID, restricted Picker API key, and project number. Do not paste them into GitHub, chat, issues, or repository files.
5. Connect and select the dedicated test folder.

GitHub Pages is a single shared deployment. Deploying this branch temporarily replaces the currently published page for everyone who visits the project URL. Re-deploy `main` when the experiment is complete.

### Folder enumeration

1. Run **Enumerate folder children**.
2. Record the returned child count and whether the result is complete.
3. If the folder is expected to be empty, it may be treated as empty only when the harness completes every page and returns zero children.
4. Repeat after a page reload and fresh OAuth authorization.

A successful result establishes visibility only for the selected folder and the tested account/scope. It does not prove global Drive discovery.

### Pre-generated ID and retry

1. Run **Run object and lost-response test**.
2. Confirm the result reports a retry response of HTTP 409 and exact SHA-256 read-back verification.
3. Confirm the uniquely named synthetic file appears in the selected test folder.
4. Use the cleanup control when finished.

Record any 403, unsupported scope, 409 mismatch, missing file, or hash mismatch as a failed or inconclusive test. Do not infer success from the first create response alone.

### Two-session conditional-write test

1. In Session A, select the same test folder and click **Create race-test file**.
2. Copy the resulting synthetic file ID to Session B. Session B must connect to the same Google account and select the same test folder.
3. Paste the file ID into Session B.
4. In both sessions, click **Read baseline ETag and version**.
5. Compare the displayed baseline version and ETag. They must match exactly. If either session cannot see an ETag, stop: the browser cannot perform this conditional-write test under the current response/CORS behavior.
6. Once both sessions are ready with the same ETag, click **Attempt conditional write** in both sessions as nearly simultaneously as possible.
7. Record both HTTP outcomes. Then click **Read final race-test state** in each session.
8. Repeat several times with a newly created race-test file for each trial. Do not reuse a stale ETag from an earlier trial.

Interpretation:

| Session outcomes | Interpretation |
|---|---|
| Exactly one 2xx and one HTTP 412 | Candidate evidence that the server enforces the supplied ETag precondition. Repeat under controlled races and verify final state. |
| Both updates return 2xx | Failure: Drive did not exclude the stale writer for this test. |
| ETag unavailable, header rejected by CORS, or conditional update unsupported | Failure to establish a usable browser-based compare-and-swap mechanism. |
| Network error, timeout, or unknown outcome | Inconclusive. Re-read the synthetic test file and repeat with a new file; do not call it a pass. |
| One 2xx and one other error | Inconclusive until the error is understood and the test is repeated. |

A passing trial is not yet production approval. The mechanism must be repeatable and must protect the actual manifest publication operation under the exact same authorization scope and browser-origin conditions.

### Cleanup

Session A owns the race-test file it created. Use its cleanup control after both sessions have finished. Session B should not assume ownership of or delete files it did not create. If cleanup fails, manually remove only the files whose names begin with `finance-tracker-spike-` from the dedicated test folder.

## Evidence log

| Check | Status | Evidence |
|---|---|---|
| Existing Picker-based folder selection | **User-confirmed** | Prior experiment B; PR #17 and its live validation record |
| Existing synthetic create/read-back/delete | **User-confirmed** | Prior experiment A; 2026-10-24 |
| Complete child enumeration in this harness | **Open** | Live run required |
| Pre-generated ID retry in this harness | **Open** | Live run required |
| Raw SHA-256 read-back in Drive | **Open** | Live run required |
| ETag visibility in browser | **Open** | Live run required |
| Server-enforced `If-Match` stale-writer exclusion | **Open / critical blocker** | Two-session live race required |
| Staged commit interruption recovery | **Not yet implemented** | Later phase, gated on concurrency |
| Snapshot backup/restore | **Not yet implemented** | Later phase, gated on concurrency |
| Production terms, quota, and $0 cost | **Open** | Recheck current official Google requirements before release |

## Explicit exclusions

- No canonical manifest or ledger files are accessed.
- No real CSV, transaction, balance, account identifier, or other personal financial data is used.
- No production storage engine or automatic initialization is implemented.
- No offline writes, queue, or local authoritative database is introduced.
- No claim of production readiness follows from passing the harness.

## Retention policy

Original CSV imports are retained in approved private Drive storage for **540 days (18 months)** from successful retention, then deleted with deletion verified. This policy supersedes the earlier preference not to retain original CSVs. The feasibility harness does not upload or exercise original CSV retention. Backup copies must preserve the original retention timestamp and must not reset the 540-day period or resurrect expired originals.

## Primary Google references

- [Drive files resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) — `version` is output-only and monotonically increasing.
- [Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list) — folder-child listing, page tokens, and incomplete-search indicator.
- [Drive files.update](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update) — update method and patch semantics; the reference does not document a Drive-specific compare-and-swap precondition.
- [Create and manage files](https://developers.google.com/workspace/drive/api/guides/create-file) — pre-generated IDs and duplicate-creation behavior.

Checked 2026-10-31. Recheck current API behavior, terms, quotas, and OAuth requirements before production release.
