# Drive Transaction Engine — Synthetic Test Guide

**Scope:** Synthetic Drive transaction, recovery, and lifecycle verification. All fixtures and Drive objects are invented. This guide does not authorize production ledger storage.

## Fast local regression suite

From the repository root, run:

```sh
node --test tests/transaction-protocol.test.mjs tests/drive-transaction-engine.test.mjs
```

The new engine tests use an in-memory synthetic Drive implementation. They inject a lost response immediately after each of the 11 durable mutation boundaries:

1. Transaction-start journal event.
2. Object-stage intent event.
3. Immutable object creation.
4. Object-staged journal event.
5. Commit-stage intent event.
6. Immutable commit-record creation.
7. Commit-staged journal event.
8. Manifest-publication intent event.
9. Manifest publication.
10. Manifest-published journal event.
11. Terminal transaction-committed journal event.

The suite verifies all 11 injected interruption points, preserves durable evidence, rejects stale serialized writers, and refuses offline writes. If the manifest is still at the verified base and publication has not been planned, recovery can safely append an abort when a planned object or commit record remains unavailable after the bounded 404 window. Visible staged objects are still hash-verified; unavailable IDs are retained in the abort journal event, and no files are deleted. A late-arriving file is an unreferenced orphan, not an authoritative ledger object. Once a commit record has been journaled as staged or publication has been planned, missing or unverifiable data remains unresolved and blocks further writes. Recovery also resumes a fully verified immutable commit when publication can safely continue and repairs missing publication/terminal journal events after manifest read-back proves the commit. The live adapter retries only HTTP 404 metadata-visibility responses up to eight attempts, with exponential delays capped at five seconds (about 22.5 seconds total by default). Authorization failures, permission errors, malformed metadata, and location mismatches are not retried. A final timeout records the file ID, attempt count, elapsed time, and last HTTP status so the owner can identify the missing object without discarding transaction evidence.

## Live Google Drive smoke test

The existing Drive feasibility page now includes **Run synthetic Drive transaction test**.

1. Create or choose a dedicated, empty Google Drive folder used only for Finance Tracker synthetic testing. Include the word `synthetic` in its folder name (the page enforces this check). Do not select the folder containing personal financial data.
2. Deploy branch `feat/durable-drive-transaction-engine` using the repository's documented **Actions → Deploy static site to GitHub Pages → Run workflow** procedure. This is the shared public Pages deployment; it is not an isolated staging site.
3. Open the Drive feasibility page, connect Google, and select the dedicated synthetic folder with Picker.
4. Run **Enumerate folder children** first. It must report a complete listing.
5. Run **Run synthetic Drive transaction test**. It creates a disposable synthetic manifest, one invented object, immutable commit metadata, and append-only journal events; it publishes the manifest last, then reopens and verifies the transaction from Drive.
6. Inspect the selected folder if desired. Test-created files use the `ft-synthetic-manifest-`, `ft-object-`, `ft-commit-`, and `ft-journal-` prefixes.
7. Use **Review and delete this session's test files** to remove files tracked by that browser session. If the page is reloaded or closed before cleanup, inspect the dedicated test folder and remove only the clearly identified `ft-` synthetic files manually.

A successful live smoke test verifies the ordinary Drive create/read-back/publish path. It does **not** simulate browser termination at every real Drive boundary, validate session-marker ownership, establish a server-side mutex, or approve production persistence.

## Evidence classification

- **Verified by automated tests:** deterministic in-memory state transitions and fault injection at all 11 mutation boundaries, once the CI run passes.
- **Verified by live test (owner-confirmed 2026-11-01):** complete folder enumeration; immutable-object same-ID retry after a deliberately discarded successful response, HTTP 409, and exact SHA-256 read-back; durable transaction commit, reopen, and recovery verification; cleanup of all synthetic files tracked by that browser session (deleted or already absent).
- **Open:** live Drive interruption/reload rehearsals at each boundary, delayed visibility under real conditions, authorization loss/reconnect, automatic session lifecycle integration (PR #24), backup/restore, security review, 540-day source retention, current terms/quotas, and sustainable $0 recurring cost.

Never place real financial data, account identifiers, tokens, or real Drive folder/file IDs in this repository, CI logs, or public issue/PR comments.

## PR #24 recovery scope and diagnostic follow-up

**Verified (local synthetic tests):** a selected folder can contain journals from separate synthetic harness manifests. Recovery preflights all journal hash chains and start identities before any recovery mutation, then processes only the selected manifest's exact database/copy pair. Verified foreign histories remain untouched. Missing identities, corrupt chains, or conflicting reuse of one copy identity still block recovery; they are not silently ignored. Tests cover foreign histories at all supported interruption boundaries and a current pending transaction alongside foreign evidence. Never delete journals to bypass this check.

**Open — live metadata 404:** a read returning 404 does not establish whether a create succeeded, whether the requested ID is accessible, or whether a recovery plan refers to a file never created. The current create path reports its HTTP outcome and returned ID alongside the requested ID. A generic visibility-timeout message can instead come from recovery or an older browser build. Do not increase retries as a substitute for tracing the outcome.

Safe reproduction after the patch is deployed:

1. Confirm the footer's source commit is the intended build. Use invented fixtures in the dedicated synthetic folder only; do not delete existing evidence or use real CSV data.
2. Expand the storage diagnostics before reproducing. Record which action fails: Connect/recovery, sample save, clear, or release. Do not start another action while the result is pending.
3. If the error recurs, retain the diagnostic event sequence and error text, including CREATE HTTP status if present. Privately compare requested and returned file IDs; omit IDs from public issues. Never share authorization headers, tokens, full network exports, folder names, or financial contents.
4. An unresolved transaction must stay recovery-required and must not become a green handoff success. Reconnect/recover through the existing flow; confirm stale takeover only when appropriate. If recovery still fails, preserve evidence and stop retrying writes.
5. Reopen and verify the expected invented rows after a successful save/release/reconnect. A passing unit suite or a green deployment is not proof of this live result.

Provider references: [Drive generated IDs](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds), [multipart uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [Drive 404 errors](https://developers.google.com/workspace/drive/api/guides/handle-errors#notFound). These were checked for this review; the selected ordinary Drive folder uses `space=drive`, not `appDataFolder`.


## Version-2 catalog transaction protocol

The current synthetic dashboard uses `CatalogTransactionEngine` with version-2 hash-only logical commits and a per-copy locator catalog. The 14 durable writes for one new object are:

| Boundary | Durable write |
| --- | --- |
| 1 | Transaction-started event, including exact base-manifest hash |
| 2 | Object-stage plan with preallocated ID and hash |
| 3 | Immutable data object |
| 4 | Object-staged event |
| 5 | Commit-stage plan |
| 6 | Immutable logical commit |
| 7 | Commit-staged event |
| 8 | Immutable catalog covering staged objects, commit, and journal prefix |
| 9 | Publication-intent event containing exact intended manifest |
| 10 | Financial manifest publication with pending-finalization marker |
| 11 | Manifest-published event |
| 12 | Transaction-committed event |
| 13 | Catalog generation adding publication-intent and terminal events |
| 14 | Catalog-only manifest publication clearing pending marker; financial revision is unchanged |

Every immutable write is read back by exact generated ID, folder, kind, transaction binding, and raw-byte hash. Catalog updates preserve prior mappings. Manifest publication rechecks the exact base, revalidates the session, and verifies exact read-back. Complete folder enumeration discovers journals not yet in a published catalog; names alone never establish identity. Malformed, duplicate, or conflicting evidence stops recovery before mutation.

Recovery resumes a complete verified staged commit at its exact base, or verifies an already-published intended commit and finishes terminal catalog finalization. An incomplete pre-commit stage can be aborted only at its exact base; visible staged objects are verified, unavailable planned IDs remain evidence, and nothing is deleted. A missing previously verified commit/object or unrelated manifest blocks writes. Recovery repairs are restartable, and tests interrupt both the original transaction and repair. A pending marker blocks application reads and new writes until recovery succeeds.

See [Per-Copy Drive Locator Catalog Design](DRIVE_LOCATOR_CATALOG_DESIGN.md) for the logical/physical identity model and [Synthetic Storage Acceptance](SYNTHETIC_STORAGE_ACCEPTANCE.md) for current acceptance evidence.

## PR24 lifecycle regression and diagnostic requirements

The dashboard integration tests must continue to exercise interactions between admission guards, write drain, heartbeat renewal, recovery, and status reporting—not only isolated callbacks. The following are established regression requirements:

- A release request closes admission to new writes but does not invalidate already-admitted operations before they drain.
- Release rechecks unresolved recovery after the drain; failure retains ownership/renewal and recovery-required state.
- Session-marker operations serialize separately from long transactions, preventing heartbeat starvation.
- Startup heartbeat begins before potentially long initialization/recovery.
- Independent asynchronous UI success writers must not overwrite newer ownership or recovery failures.
- Foreign verified journal histories remain untouched; recovery is limited to the selected database/copy identity after preflight.
- A missing lifecycle or unverified release is never a successful release.
- Clear must not roll back or discard CSV imports that arrive during remote operations. Only the captured synthetic selection is removed after a verified remote result; failed remote operations preserve local rows and provenance.
- Explicit Save writes only synthetic rows. Clear writes an empty synthetic snapshot through the same verified transaction boundary. Both are refused when ownership/recovery is uncertain.

Historical Drive metadata 404 and earlier unexpected-release symptoms were not assigned definitive root causes. If they recur, record the source build and exact failing action (connect/recovery, sample save, Clear, or release), preserve the sanitized diagnostic sequence and HTTP status, and privately compare requested/returned IDs. Never publish tokens, authorization headers, full network captures, folder names, file IDs, or financial contents. Do not increase retries without tracing the actual outcome. A successful later test does not prove the historical root cause was fixed.
