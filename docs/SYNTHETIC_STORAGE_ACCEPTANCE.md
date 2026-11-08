# Synthetic Storage Acceptance Record

**Acceptance date:** 2026-11-04
**Implementation:** Synthetic version-2 Drive storage readiness
**Production financial-data persistence:** **NO-GO — not implemented or authorized by this acceptance**

This record preserves owner-reported live acceptance evidence and distinguishes it from automated CI evidence. The results do not authorize production ledger storage.

## Owner-reported live acceptance

The owner reported completing the following using invented/synthetic data against the deployed acceptance page:

| Scenario | Result |
| --- | --- |
| Separate Drive backup, reopen, and verification | Pass — 11 immutable objects; logical commit history preserved |
| Failed backup | Pass — durable quarantine marker; no usable destination manifest; fresh destination required |
| Portable archive export | Pass — independent loaded-archive integrity, history, and app-structure verification |
| Restore to a fresh Drive folder | Pass — new physical copy identity; exact logical history verified |
| Invented-original retention | Pass — uploaded, hash-verified, and linked to a completed synthetic import |
| Retention boundary and deletion | Pass — ineligible one millisecond before day 540; expired originals deleted and absence verified; import status/timing preserved |
| Unapproved Google account | Pass — Google denied access while the OAuth app was in Testing mode |
| Approved account reconnection | Pass — original session/history remained intact |
| iPad browser interruption | Pass at transaction boundary 5 — tab fully closed, reopened, reconnected, stale session explicitly recovered, retained history verified |
| Actual Google authorization revocation | Pass — Google access removed; retained-history verification failed and writes paused |
| Reauthorization and recovery after revocation | Pass — permission restored; stale session recovered; retained bytes and commit ancestry verified |

These are owner-reported results based on the user's observations/screenshots. They are not independent telemetry or CI assertions.

The unapproved-account 403 was expected because the OAuth application was in Testing mode and that account was not an approved tester. This was a successful negative test, not an application defect.

The iPad interruption rehearsal proves boundary 5 only. It does not claim that every one of the 14 durable-write boundaries was manually exercised on iOS. The full boundary set and interrupted recovery-repair paths are covered by automated fault tests.

## Automated validation evidence

Reviewed implementation code head: `79292202e6b7c3c8499f4860d5cdad2335a32ecb`, dated 2026-11-04.

- [Node contract tests](https://github.com/AeroVega/finance-tracker/actions/runs/41788168056): Node 26.13.0; **288 passed, 0 failed**.
- [Finance Tracker contract tests](https://github.com/AeroVega/finance-tracker/actions/runs/41788168051): Node 26.13.0; **288 passed, 0 failed**.
- Browser/dashboard module syntax checks passed.
- Automated fault coverage includes all 14 durable transaction-write interruption points and interrupted recovery-repair paths.

These CI results apply to the reviewed code head above. Documentation-only reconciliation occurred afterward. Any subsequent code change requires fresh checks. Owner-reported provider/device tests are separate from CI.

## Scope and limitations

- The implementation initializes and reopens fresh version-2 synthetic folders only. Existing PR24-format folders are unsupported; there is no conversion, migration, or in-place upgrade path. Use a new empty synthetic folder for this acceptance path.
- The app remains single-active-device. Session coordination is best-effort, not a server-enforced lock; simultaneous starts or network partitions can still defeat it.
- Maintenance runs on connection and hourly while a verified page is open. It cannot execute while all devices are closed.
- Local exported originals and archives cannot be remotely erased by this static app; the owner must manage private copies.
- A process loss after provider deletion but before durable metadata update can lose the in-memory deletion receipt. The app conservatively preserves the old locator rather than inferring deletion from an access-ambiguous 404. See [Original Source File Retention](ORIGINAL_SOURCE_RETENTION.md).
- The actual Cloud project configuration, assigned quotas, usage, and billing were not inspected by this review.
- The deployed artifact's final privacy/security inspection of browser storage and network behavior remained an owner action at the time of this acceptance record.

## Owner review and authorization boundary

The synthetic acceptance rehearsals are complete as reported. They do not establish that the actual Cloud project meets the $0 recurring-cost requirement or that every deployed-artifact privacy/security check is complete.

Production financial-data persistence remains disabled. It requires a separate design/approval milestone and a separate implementation PR. Merging synthetic storage readiness does not authorize production persistence.

## Related technical documentation

- [Application Storage Lifecycle](APPLICATION_STORAGE_LIFECYCLE.md)
- [Drive Transaction Engine Testing](DRIVE_TRANSACTION_ENGINE_TESTING.md)
- [Drive Backup and Restore](DRIVE_BACKUP_AND_RESTORE.md)
- [Original Source File Retention](ORIGINAL_SOURCE_RETENTION.md)
- [Per-Copy Drive Locator Catalog Design](DRIVE_LOCATOR_CATALOG_DESIGN.md)
- [Google Drive Configuration and Cost Review](GOOGLE_DRIVE_CONFIGURATION.md)
