# PR25 implementation and acceptance handoff

**Reviewed:** 2026-11-04
**Code head:** `79292202e6b7c3c8499f4860d5cdad2335a32ecb`
**Status:** Synthetic implementation reviewed; owner-reported live acceptance rehearsals completed. Production persistence remains **NO-GO**.

## Acceptance outcome

The owner reports completing the following against the deployed PR25 acceptance page, using synthetic data:

| Scenario | Owner-reported result |
| --- | --- |
| Separate Drive backup, reopen and verification | Pass — 11 immutable objects; logical commit history preserved |
| Failed backup | Pass — durable quarantine marker; no usable destination manifest; fresh destination required |
| Portable archive export and independent loaded-archive verification | Pass |
| Restore to a fresh Drive folder | Pass — new physical copy identity; exact logical history verified |
| Invented-original retention | Pass — uploaded, hash-verified and linked to a completed synthetic import |
| Retention boundary and deletion | Pass — ineligible one millisecond before day 540; expired originals deleted and absence verified; import status/timing preserved |
| Unapproved Google account | Pass — Google denied access while app was in Testing mode |
| Approved account reconnection | Pass — original session/history remained intact |
| Real iPad browser interruption | Pass at boundary 5 — tab fully closed, reopened, reconnected, stale session explicitly recovered, retained history verified |
| Actual Google authorization revocation | Pass — Google access removed; retained-history verification failed and writes paused |
| Reauthorization and recovery after revocation | Pass — permission restored; stale session recovered; retained bytes and commit ancestry verified |

These are owner-reported results based on the screenshots and description supplied during acceptance. They are not independent telemetry or CI assertions. The browser interruption rehearsal proves boundary 5 only; it does not claim that every one of the 14 boundaries was manually exercised on iOS. All 14 transaction-write boundaries and interrupted recovery-repair paths are covered by automated fault tests.

The unapproved-account 403 was expected because the OAuth application is in Testing mode and that account was not an approved tester; it is a successful negative test, not an application defect.

## Outstanding-item assessment

| Area | Assessment |
| --- | --- |
| Catalog-backed commits, copy-specific locators, recovery | Implemented and automated tests pass |
| Backup, quarantine, portable export and restore | Implemented; owner-reported live synthetic rehearsals pass |
| Original-source retention | Implemented for synthetic acceptance; owner-reported expiry/deletion rehearsal passes |
| Transaction interruption | All 14 durable writes and recovery repairs fault-tested; real iPad termination/recovery pass at boundary 5 |
| OAuth failure and reconnect | Actual Google Drive authorization revocation and reauthorization rehearsed successfully |
| Cloud OAuth configuration, quotas, usage and billing | Actual project settings remain uninspected by this review |
| Security/privacy on deployed artifact | Owner's final artifact/storage/network inspection remains outstanding |
| Production financial-data persistence | Not implemented or authorized; separate milestone and PR required |

## Concrete synthetic protocol for owner review

The per-copy catalog retains the typed version-1 format in `DRIVE_LOCATOR_CATALOG_DESIGN.md`. New manifests use `manifestVersion: "2.0.0"`; new commits use `version: 2`, contain `logicalPath -> lowercase SHA-256`, and omit physical `copyId`. The manifest binds the physical folder/copy and carries `locatorCatalog: {fileId, sha256}` and `catalogFinalizationPending: transactionId | null`. Schema version 1 is the only application schema supported by this synthetic implementation.

`CatalogTransactionEngine` is used by the synthetic dashboard and PR25 page. The old `DriveTransactionEngine`, v1 portable helper and older prototype pages remain legacy test/reference paths. They are not silently upgraded or presented as ADR-compliant.

For one new object, the durable transaction writes are:

| Boundary | Durable write |
| --- | --- |
| 1 | Transaction-started event, including the exact base-manifest hash |
| 2 | Object-stage plan with its preallocated ID and hash |
| 3 | Immutable data object |
| 4 | Object-staged event |
| 5 | Commit-stage plan |
| 6 | Immutable logical commit |
| 7 | Commit-staged event |
| 8 | New immutable catalog covering staged objects, commit and journal prefix |
| 9 | Publication-intent event containing the exact intended manifest |
| 10 | Financial manifest publication with the pending-finalization marker |
| 11 | Manifest-published event |
| 12 | Transaction-committed event |
| 13 | Catalog generation adding publication intent and terminal events |
| 14 | Catalog-only manifest publication clearing the pending marker; financial revision is unchanged |

Every immutable write is read back by exact generated ID, folder, kind, transaction binding and raw-byte hash. Catalog updates preserve prior mappings. Manifest publication rechecks the exact base, revalidates the session and verifies exact read-back. Complete folder enumeration discovers journals not yet in a published catalog; names alone never establish identity. Malformed/duplicate/conflicting evidence stops recovery before mutation.

Recovery resumes a complete, verified staged commit at its exact base, or verifies the already-published intended commit and finishes the terminal catalog. An incomplete pre-commit stage can be aborted only at its exact base; visible staged objects are verified, unavailable planned IDs remain evidence, and nothing is deleted. A missing previously verified commit/object or an unrelated manifest blocks writes. All recovery repairs are restartable; the tests interrupt both the original transaction and its repair. A pending marker blocks application reads and new writes until recovery succeeds.

## Copy behavior

Version-2 archives contain every catalog-referenced retained immutable object, not just the head snapshot. Logical commit bytes and hashes remain unchanged across backup/restore. Archive mappings have no physical Drive IDs. Historical journal bytes can still contain the original protocol's locators; treat exported archives as private recovery artifacts. The archive digest detects alteration; it is not authentication or encryption.

Both source and destination session gates stay held during copying, with independent heartbeats. A destination must contain only its verified session marker. A preparation marker starts quarantined, changes to ready after object/structure verification, and the database manifest is created last. Reopen checks that preparation marker as well as the full catalog/history. Failure attempts a durable quarantine update and reports whether it succeeded. Unavailable authorization can prevent quarantine confirmation; preserve that destination for inspection and retry in a fresh folder.

**Folder-format boundary:** PR25 creates and reopens only fresh version-2 synthetic folders. Existing PR24-format folders are unsupported: there is no conversion, migration, or in-place upgrade path. Select a new empty synthetic folder for PR25 tests. The PR24 test directories can be retired independently; their Git history remains available as implementation history.

## Retention limits to review

Original source bytes live outside the immutable financial catalog so their expiry can actually remove them. Retention metadata is linked to a completed synthetic import, separate from processing status. An original is deleted only after its exact import ID, source hash, object kind and folder are checked. A successful delete plus same-authorization absence/folder verification is required before clearing its locator. A bare 404, switched token, lost grant, or provider failure never proves deletion.

**Known residual limitation:** a process loss after deletion but before a durable index update can lose the in-memory delete receipt. The next page conservatively preserves the old locator and records a retryable failure; it does not infer deletion from an access-ambiguous 404. Owner inspection/provider evidence is required for that case. This is a remaining deletion-recovery gate, not a claim of fully autonomous production deletion.

The static app runs maintenance on connection and hourly while the page is open with a verified session. It cannot execute while all devices are closed; exactly day 540 marks eligibility, not a guaranteed deletion time. The permanent financial CSV import still stays local. Only the acceptance page can generate/retain an invented original; no production import worker is enabled.

Backups/archives retain original timing, omit already expired/deleted originals, and restore only originals still unexpired at restore time. Local exported files cannot be remotely erased by this static app. The owner must manage their private copies and remove expired original bytes where applicable. Import provenance/status is preserved even when original bytes are omitted.

## Validation evidence

- **Verified current-head CI (2026-11-04):** Node 26.13.0 [Node contract tests](https://github.com/AeroVega/finance-tracker/actions/runs/41788168056) and [Finance Tracker contract tests](https://github.com/AeroVega/finance-tracker/actions/runs/41788168051) both passed: 288 tests, 0 failures in each workflow. Browser/dashboard module syntax checks passed.
- **Owner-reported live synthetic acceptance (2026-11-04):** backup/quarantine/archive/restore, 540-day original retention/deletion, unapproved-account denial, approved-account reconnect, actual Drive authorization revocation and reauthorization, and iPad tab termination/recovery at transaction boundary 5 all passed. See the acceptance table above and `PR25_ACCEPTANCE.md`.
- The actual Cloud project configuration, assigned quotas, usage and billing have not been inspected by this review. The owner has not yet recorded final security/privacy inspection of the deployed artifact and browser storage/network behavior.

## Google source review (2026-11-03)

**Verified:** the [official Drive limits page](https://developers.google.com/workspace/drive/api/guides/limits), updated 2026-10-30, still lists 1,000,000 units/minute/project, 325,000 units/minute/user/project, a 1 TB/day egress limit and a 400,000,000-unit/day billing threshold. It says standard use has no additional cost and planned over-threshold charges will receive at least 90 days' notice. Actual assigned quotas and billing status remain uninspected. This documentation alone does not establish that this project meets the owner's $0 requirement.

The [Drive deletion reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete) describes permanent deletion. The owner reports that expired invented originals were deleted and their absence verified through Drive during the live retention rehearsal.

## Next owner steps

1. Review and explicitly accept PR25's known residual limitations, especially deletion-receipt recovery after process loss and the active-page-only maintenance schedule.
2. Inspect the actual Google Cloud OAuth audience/scopes, API and key restrictions, assigned quotas, usage and billing. Record whether the project can satisfy the $0 recurring-cost constraint; published quota documentation alone is insufficient.
3. Inspect the deployed artifact and browser storage/network behavior for privacy/security boundaries. Keep tokens, folder/file locators, account/project identifiers, raw archives and private screenshots out of GitHub.
4. Complete owner acceptance of PR25 and decide on merge. No further routine synthetic acceptance feature work is proposed.
5. Treat production financial-data persistence as a separate design/approval milestone and a separate implementation PR. Merging PR25 must not enable production persistence.

