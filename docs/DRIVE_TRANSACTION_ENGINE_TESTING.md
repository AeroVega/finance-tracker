# Drive Transaction Engine — Synthetic Test Guide

**Scope:** PR #23 transaction-engine verification only. All fixtures and Drive objects are invented. This guide does not authorize production ledger storage.

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

The suite verifies all 11 injected interruption points, preserves durable evidence, rejects stale serialized writers, refuses offline writes, aborts only after all known staged objects are independently visible and hash-verified, resumes a fully verified immutable commit when publication can safely continue, and repairs missing publication/terminal journal events after manifest read-back proves the commit. If a pre-generated ID is not visible within the retry window, recovery leaves the outcome unresolved and blocks further writes.

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
