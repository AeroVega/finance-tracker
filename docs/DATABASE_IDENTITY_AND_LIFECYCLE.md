# Database Identity and Lifecycle — Architecture Decision Record

**Status:** Accepted architecture baseline (PR #19); synthetic transaction-engine implementation is underway in PR #23. Production financial-data persistence remains unauthorized.  
**Decision scope:** Database identity, manifest/schema versioning, physical copies, immutable storage, commit lineage, transaction journaling, initialization, migrations, backups, lifecycle, and recovery  
**Storage direction:** Google Drive, subject to the existing production-readiness gates  
**Target:** MVP1  
**Related baseline:** `docs/PRIVATE_STORAGE_ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DATA_MODEL.md`, and `docs/ARCHITECTURE_DECISIONS.md`

> This record consolidates 108 accepted architecture decisions from the database identity, lifecycle, storage, transaction, recovery, and migration reviews. PR #23 implements and validates the transaction protocol using synthetic data only. It does not authorize production persistence or real financial-data storage. The accepted single-active-device operating constraint and best-effort session detection supersede the earlier expectation of server-enforced concurrency protection.

## Context and constraints

The current Drive prototype can discover a candidate folder, but folder name and a prior Picker comparison reference do not prove that the folder contains the intended Finance Tracker database. A small, visible, app-owned JSON manifest inside the existing `finance-tracker-database` folder will provide a stable identity and validation boundary.

The design must remain compatible with the project constraints:

- MVP1 remains based on permanent user-selected CSV imports.
- Google Drive remains the selected private-storage direction, but production ledger reads/writes are not approved by this ADR.
- The public repository contains code, documentation, and deliberately synthetic fixtures only.
- No recurring operating costs, expiring trials, stored bank passwords, unauthorized scraping, or production secrets.
- Drive is file storage, not a transactional database. Do not promise atomic multi-file transactions or global discovery of all copies.
- Fail closed when identity, authorization, consistency, or recovery state is uncertain.
- Preserve the current modular static frontend direction unless separately approved.

## Terminology

- **Logical database:** The enduring dataset identified by one `databaseId`.
- **Physical copy:** One Drive folder containing a representation of that logical database, identified by a unique `copyId`.
- **Primary:** The one copy designated for normal reads and writes.
- **Backup:** A non-primary copy intended for inspection and explicit recovery.
- **Manifest:** The small JSON file in a database folder that identifies the logical database and the physical copy and records essential state.
- **Commit:** A uniquely identified, successfully committed database state.
- **Lineage:** The lightweight parent-commit relationships used to compare copy histories.

A manifest is an application-level consistency and identity check. It is not a cryptographic proof, a substitute for Google authorization, or proof that financial records are correct.

## Accepted decisions

### 1. Copies share logical database identity

All physical copies of one logical database share the same `databaseId`. A copy is not a new logical database merely because it resides in another folder or device. Changes made to one copy do not automatically update another; an out-of-date or partially restored copy remains a separate physical representation of the same logical database.

### 2. Stale copies are recognized, not silently activated

A stale copy may be inspected read-only and offered through an explicit restore workflow. It must never silently become the active database. The app must distinguish database identity from copy state.

### 3. Preserve import-level coverage; derive account-level coverage

Import-level coverage records remain source evidence. Account-level coverage is derived from those import records. Coverage bookkeeping is updated automatically as successful imports are accepted; failed or rejected imports do not change coverage.

### 4. Preserve source-reported and observed coverage separately

Where available, record both the period a source claims to cover and the transaction-date range actually observed. Preserve whether a range is source-reported or inferred. A claimed export period is not proof that every expected transaction is present. Reconciliation and completeness assessment remain separate.

### 5. Merge overlapping or adjacent coverage periods without erasing source evidence

Account-level coverage may automatically merge overlapping or adjacent intervals. Preserve every original import-level coverage record. Gaps remain visible; never imply continuous coverage across a gap. Coverage merging is independent of transaction duplicate reconciliation.

### 6. Reconcile overlapping transactions conservatively

Use the accepted PR #11 reconciliation contract: automatically match only high-confidence duplicates; send ambiguous candidates for review; preserve pending and posted observations when evidence supports linking them; never silently discard conflicting financial information; and use append-only correction/reversal events. Coverage merging must not be used as a shortcut for transaction deduplication.

### 7. Explicitly designate one primary copy

One physical copy is designated primary; other copies are backups. Only the primary is eligible for ordinary writes. Backups may be inspected read-only and used only through explicit restore/promotion workflows.

If multiple accessible copies claim to be primary, stop normal writes and require explicit resolution. Never choose based on timestamps or whichever copy happens to be discovered first.

### 8. Store primary designation and copy identity in each manifest

Each physical copy has a unique `copyId`; its manifest records its role. A copy is treated as a backup unless its manifest explicitly designates it primary. App-created backups receive a new `copyId` and backup role.

A manually copied folder may initially duplicate both `copyId` and role. Treat that as an identity conflict requiring explicit resolution, not as a valid independent copy.

**Known limitation:** Per-folder manifests cannot globally enforce a single primary across isolated or undiscoverable Drive folders. Restricted `drive.file` access may prevent the app from seeing every copy. The app can detect conflicts among copies it encounters, but cannot promise a global inventory or globally atomic single-primary enforcement. This residual risk must be visible in documentation and the UI.

### 9. Promotion is guided, with an explicit emergency path

Normal promotion must:
1. Confirm the selected backup.
2. Verify the current primary when it is accessible.
3. Demote the former primary to backup.
4. Promote the selected copy.
5. Read back and verify both manifests.
6. Enable writes only after the resulting state is verified.

If the former primary is unavailable, an explicit emergency promotion may proceed only after warning that the old primary may still exist. Record that the promotion was emergency. If the old primary later reappears, detect the conflict and require user intervention.

Drive does not provide an atomic transaction across two manifest files. The implementation must use a recoverable transition protocol and refuse writes while a promotion is incomplete or ambiguous.

### 10. Identify committed states with revision and commit ID

Each committed state has a monotonically increasing revision within its copy history and a unique `commitId`. Two copies may have the same revision but different commit IDs, which signals different states. A full parent graph/version-control implementation is not required; minimal lineage is addressed in Decision 26.

### 11. Stop database operations when the primary is unavailable

If the primary cannot be verified because of network, authorization, or availability problems, stop database operations. Do not fall back automatically to a backup, perform offline writes, or silently switch copies. Offer retry or reauthorization. No write is allowed without verifying the primary.

### 12. Include database-level and copy-level metadata

The manifest design should distinguish shared database metadata from per-copy metadata. Proposed optional timestamps include:
- `databaseCreatedAt`: creation time of the logical database, shared by its copies.
- `copyCreatedAt`: creation time of this physical copy.
- `lastCommittedAt`: time associated with the latest committed database state.

Additional metadata may be included only when its semantics are reliable and useful. Do not turn the manifest into a dumping ground. Do not include account email, OAuth tokens, API keys, account numbers, balances, transactions, or other financial records.

### 13. Strict core fields with an extensions section

The manifest has strictly validated core fields and an optional `extensions` section for future capabilities. Unknown optional extension data may be ignored when compatibility rules permit. Credentials, personal account details, and financial records are prohibited from the manifest.

### 13A. Use semantic major/minor manifest compatibility

Manifest compatibility uses semantic major/minor/patch nomenclature:
- A major version change indicates a breaking change; an app that does not support that major version refuses access.
- A minor version change is a backward-compatible addition. An older app may continue only when all fields and semantics it relies on remain compatible.
- A patch version change is a clarification or correction that does not change compatibility or persisted meaning.
- Adding a newly required field or changing existing semantics requires a major version change.
- Unknown optional extension fields may be ignored when the declared compatibility rules permit it.

Manifest version is independent of ledger schema version and app software version.

### 14. Separate required identity fields from optional operational metadata

Required core fields:
- `format`
- `manifestVersion`
- `schemaVersion`
- `databaseId`
- `copyId`
- `role`
- `lifecycleStatus`
- `revision`
- `commitId`
- `parentCommitId` (nullable only for the initial commit)
- `storageBinding`

Optional operational metadata:
- `databaseCreatedAt`
- `copyCreatedAt`
- `lastCommittedAt`
- `extensions`

New manifests should populate applicable timestamps. An older supported manifest that lacks an optional timestamp remains valid; missing historical information must not be invented.

### 15. Explicitly register copied folders

The `storageBinding` binds a physical copy to its actual Google Drive folder ID. Moving a folder while preserving its Drive ID should preserve the binding, subject to verification. Copying a folder produces a new folder ID and therefore a binding mismatch.

A copied folder must not be adopted automatically. Explicit registration must inspect and validate the copy, then assign a new `copyId`, set its role to backup, and update its storage binding. Registration is distinct from restore or reinitialization.

The broader copy manager should eventually support create, backup, restore, move, register, inspect, and retire operations without conflating their semantics.

### 16. Create verified snapshots for MVP1

MVP1 backup creation is a verified snapshot:
1. Identify the primary's committed revision and `commitId`.
2. Establish a consistent snapshot so the source cannot change during backup.
3. Copy the expected files.
4. Assign a new `copyId` and backup role.
5. Preserve the `databaseId`, revision, and `commitId`.
6. Verify the copied files and manifest against the source snapshot.
7. Report success only after verification completes.

If the source changes during copying, the operation must represent one consistent committed state or fail/retry. Never report a partial copy as a successful backup. Versioned backup schedules and automated retention policies are deferred to MVP2.

### 17. Verify backups at file and structural levels

MVP1 backup verification includes:
- **File-level:** every expected file exists and matches the source snapshot's hash.
- **Structural:** reopen the copy and validate schemas, references, and internal consistency.

Full financial reconciliation—such as recomputing balances or auditing all transaction history—is deferred to MVP2. Hash equality proves that the copy matches the source snapshot, not that the source itself is financially correct.

### 18. Quarantine incomplete backups

An incomplete or failed backup is quarantined. Retain diagnostics, prohibit primary use, restoration, and ordinary backup classification. Do not silently resume, repair, promote, or ingest it as a valid backup. Retry from a fresh snapshot; leave the original primary untouched.

### 19. Retain quarantined copies indefinitely in MVP1

MVP1 does not automatically delete quarantined copies. Keep them until the owner explicitly removes them. An automatic 30-day deletion policy is a possible MVP2 consideration, with appropriate diagnostic-record handling. Quarantine retention is separate from the approved 540-day original-import-file retention policy.

### 20. Move a database through a verified move

A move preserves `databaseId`, `copyId`, revision, `commitId`, role, and creation timestamps. Verify the destination, identity, and contents. Do not assume the Drive folder ID or binding behavior; verify it. If Drive cannot safely complete the move, report failure rather than silently substituting a copy-and-retire operation.

### 21. Recover interrupted moves through inspection

After an interrupted move, inspect the original and destination, compare folder IDs and manifest contents, and verify identity. Determine whether the move completed, failed, or is ambiguous. Recover only when evidence is clear; otherwise stop and ask the owner. Never automatically overwrite, delete, or select the newest-looking folder.

### 22. Retire copies explicitly without deleting them

Retirement is an explicit lifecycle state. A retired copy remains on Drive but is excluded from normal primary/backup selection and unavailable for ordinary imports or writes. Reactivation or restoration requires explicit authorization. Deletion is a separate explicit operation.

### 23. Reactivation preserves identity and history

Reactivating a retired copy preserves its `databaseId`, `copyId`, revision, `commitId`, and historical timestamps. Reactivation changes lifecycle designation only through explicit authorization; it does not create a new database or copy identity.

### 24. Keep everyday UI focused; put full inventory in Settings

The nominal user experience shows the active primary database. A dedicated Settings area provides the full inventory of recognized and accessible copies, including primary, backups, retired copies, revisions, commit IDs, timestamps, and status.

Database-management operations belong in Settings. The inventory can show only copies the app has successfully discovered and can access; it cannot promise global discovery of every Drive copy.

### 25. Use conservative copy-state labels

MVP1 uses four labels:
- **Current:** same committed state as the primary.
- **Older snapshot:** evidence establishes that the copy came from an earlier primary state.
- **Divergent:** evidence establishes that the copies have different histories.
- **Unknown:** insufficient evidence to establish their relationship.

A lower revision number alone does not prove ancestry. If evidence is incomplete, use Unknown rather than guessing.

### 26. Keep minimal commit lineage

Each committed state records its unique `commitId` and immediate `parentCommitId`. The initial database commit has no parent. Backups preserve the commit history associated with their snapshot. Restores and promotions preserve lineage rather than inventing a new history.

This lightweight parent relationship is intended to make it reasonably possible to distinguish older snapshots from divergent copies without building a full commit graph or version-control system. Independent changes from a shared parent can be recognized as divergent. If history is incomplete or cannot establish the relationship, classify it as Unknown.

### 27. Retain all commit metadata indefinitely in MVP1

Keep the complete lightweight commit metadata history indefinitely for MVP1. It is small relative to ledger data and is necessary to classify older copies safely. History is append-only; do not silently prune lineage. If history is damaged or incomplete, use Unknown and the corruption policy below.

### 28. Treat damaged commit history as an integrity issue

If the manifest is valid and ledger files pass structural checks but commit-history records are missing or malformed:
- Allow read-only inspection and diagnostics.
- Block normal writes, backup creation from the damaged copy, and restoration or promotion using the damaged copy as a source.
- Mark the copy as needing attention.
- Require a deliberate recovery process before normal operations resume.
- Never silently reconstruct missing records or invent parent relationships.

Readable ledger files do not make an unverifiable history safe to manage.

### 29. Quarantine when no healthy history backup exists

If a healthy, verified backup with intact history exists, use the normal verified restore process to recover from that backup; the damaged copy must not be used as the restore source. If no healthy backup exists, quarantine the damaged copy, preserve original files and diagnostics, and prohibit automatic history reconstruction or lineage repair.

Manual recovery or re-establishment of commit history is out of scope for MVP1 and may be considered separately in a future version.


### 30. Separate copy role, lifecycle status, and health

Keep three independent concepts:
- Role: primary or backup.
- Lifecycle status: active, retired, or quarantined.
- Health: healthy, needs-attention, damaged, or unknown.

Health is derived from inspection and is not stored as an authoritative manifest claim. Quarantine is an operational restriction; damaged is an integrity finding. A quarantined copy can never be primary.

### 31. Store current commit identity in the manifest and full history separately

The manifest stores the current committed revision, commit ID, and immediate parent commit ID. The complete append-only commit history lives in a separate database file or record set. Missing, malformed, or inconsistent history makes the copy unhealthy and blocks writes.

### 32. Hash-chain commit history

Each commit record is hashed using SHA-256 over a deterministic canonical representation and includes the preceding record's hash. The initial record anchors the chain. A broken chain is an integrity failure; never rebuild it silently. A hash chain detects many changes but does not prove authorship or prevent a complete rewrite by someone with sufficient access.

### 33. One commit per complete logical database change

An import, correction, migration, restore-related logical change, or other operation creates one commit only after all associated data is persisted and verified. Individual file uploads are not separate logical commits. A partial multi-file operation is never reported as committed.

### 34. Use a staged, recoverable multi-file commit protocol

Stage every changed object, verify its exact content and hash, create the commit record, publish the new state through the manifest, read back and verify the published state, and only then clean temporary material. Drive atomicity is not assumed. Browser closure, network loss, or authorization failure triggers journal-guided recovery or a stop—not a guess.

### 35. Maintain a separate append-only transaction journal

The journal records transaction identity, intended changes, affected files, staging references and expected hashes, progress, and final outcome. Outcomes distinguish committed, aborted, and outcome-unknown. Transaction IDs are unique; retries must be idempotent. The journal is separate from the manifest and commit history.

### 36. Recover interrupted transactions conservatively

- Clearly recoverable: resume or finalize automatically, then verify.
- Clearly uncommitted and safely discardable: record an abort, preserve diagnostics, and clean staged material only after proving it is unreferenced.
- Ambiguous or inconsistent: stop writes and require explicit intervention.

No uncertain transaction is silently replayed or discarded.

### 37. Require expected-base validation under the accepted single-active-device model

Every write captures the starting database ID, copy ID, revision, and commit ID. The app re-reads and validates that exact base before staging and immediately before manifest publication, and revalidates the best-effort active session before every mutation. If the base changes, another session is detected, the session cannot be verified, or the outcome is uncertain, the app refuses publication and preserves evidence. The tested Drive v3 `files.update` path accepted a deliberately stale `If-Match` value, so this mechanism is not an atomic compare-and-swap and must not be described as one. The owner explicitly accepted single-user, single-active-device operation; simultaneous starts and network partitions remain residual risks. Production writes remain blocked until safe serialized operation, fail-closed session handling, and crash recovery are demonstrated within that operating constraint.

### 38. Re-evaluate conflicted imports instead of replaying stale work

A conflicted transaction is rejected, not blindly replayed. Preserve the original import and diagnostics; reload and validate the current database; re-evaluate the import against the latest committed state; surface newly ambiguous reconciliation decisions; and require a new commit attempt with a new transaction ID linked to the original failed attempt.

### 39. Gate write eligibility on integrity

Normal writes require a healthy copy and successful checks of manifest identity/compatibility, committed data structure, commit-history integrity, transaction-journal recovery state, and consistency between the manifest and stored objects. Degraded copies allow read-only inspection and diagnostics only. Quarantined copies are excluded from normal use. Structural integrity is not financial correctness.

### 40. Run integrity checks at defined boundaries

Check integrity when opening a database before declaring it ready; before every write; after every commit through read-back; and during backup and restore. Cache results only when the app can prove the relevant state has not changed. Correctness takes priority over speed.

### 41. Treat external Drive changes as untrusted until explained

Detect unexpected changes using file IDs, content hashes, Drive version metadata, commit identities, and structural checks. Revalidate before writes. Accept a change only when its origin and result can be verified. An unexplained change degrades the copy; never overwrite it merely to restore apparent consistency. Drive revision history may aid investigation but does not replace the app's own history.

### 42. Missing required files block normal use

A missing required committed object or recovery record makes the copy degraded and read-only. A missing staging object may be handled only when the journal proves the recovery path unambiguous. Optional files may be absent only when the active schema explicitly permits it. Never auto-create missing required history or data files.

### 43. Keep a persistent inventory of known accessible copies

Maintain a local inventory as a cache of known copies, including database/copy IDs, Drive folder and manifest file IDs, last verified revision/commit ID, inspection time, and last known role/status/health. The inventory is never authoritative; verify actual Drive state before use. It cannot promise discovery of every copy.

### 44. Store the inventory in browser IndexedDB for MVP1

Each browser/device has its own inventory; there is no cross-device inventory synchronization in MVP1. Losing or clearing it does not delete the Drive database. Inventory corruption must not compromise the database.

### 45. Rebuild lost or corrupted inventory safely

Discard and rebuild the local inventory, rediscover accessible folders, validate each database independently, and request explicit registration when identity is uncertain. An empty inventory is never a reason to initialize a new database automatically.

### 46. Treat Drive synchronization delay as unresolved until verified

Use bounded exponential backoff for transient read-after-write discrepancies. Do not report commit success until read-back verifies the state. Never overwrite a file that appears missing or stale during propagation. If consistency is not established within the retry window, mark the outcome unresolved and block further writes until inspection.

### 47. Authorization loss stops Drive-dependent operations

Stop new Drive-dependent operations immediately. Preserve available local diagnostics and staging references, but do not interpret authorization failure as deletion or absence. Require reauthorization; after access returns, inspect the database and resolve any interrupted transaction before writes resume.

### 48. Authorization loss during commit produces an uncertain outcome

If Drive becomes unavailable before the journal can record a final result, preserve an outcome-unknown diagnostic locally where possible. After reauthorization, inspect the manifest, journal, commit record, and affected objects. Determine whether the operation committed, can safely resume, or must abort. Never blindly retry.

### 49. Support one active logical database in MVP1

The normal MVP1 experience uses one active personal database. The identity model permits distinct logical databases, but a multi-database switching interface is out of scope. Multiple physical copies of the one logical database remain supported for backup and recovery.

### 50. Require explicit confirmation to initialize a database

Even an empty folder requires explicit user confirmation before initialization. Explain that a new database will be created, then create its manifest, initial structure, and first commit through the standard transaction protocol and verify them by read-back.

### 51. Refuse ambiguous initialization

Only a verified empty folder may be initialized. A folder containing any unexplained files, old database-looking files, a malformed manifest, or an incomplete prior initialization must be inspected or recovered—not overwritten or reinitialized.

### 52. Define an empty folder through complete enumeration

Initialization requires successful enumeration of all accessible children, every page of results, a repeated listing check, and sufficient authorization. Any uncertainty blocks initialization. The completeness of child listing under the selected Drive scope must be demonstrated before production initialization is enabled.

### 53. Use a formal initialization state machine

Track uninitialized-empty, initializing, initialized-verified, initialization-interrupted, initialization-failed, and unrecognized-existing states. An interrupted initialization goes to inspection/recovery; it never restarts from scratch without proving the folder is empty again.

### 54. Initialization uses the standard transaction infrastructure

Initialization has a unique transaction ID, durable journal entry, staged objects, an initial commit with no parent, and verification before success. It does not use a separate persistence model.

### 55. Make initialization idempotent

A retry of the same initialization transaction resumes or reports its established outcome. A completed initialization opens the existing database. Ambiguous evidence requires inspection. Never create a second database ID because a success notification was missed.

### 56. Use explicit, staged schema migrations

An older supported schema may be migrated only through an explicit staged transaction. Preserve the original state until the migrated state is fully verified. Require a verified pre-migration backup before any migration that changes persisted data. An unsupported future schema is read-only and requires a newer app.

### 57. MVP1 migrations are forward-only

MVP1 uses forward migrations only. Recovery from a problematic migration uses the verified pre-migration backup. Reverse migrations are deferred; MVP2 may consider a hybrid approach only where reversibility is demonstrably lossless and independently verified.

### 58. Record migration history append-only

Each migration record includes a unique migration ID, source and target schema versions, application version, start/completion timestamps, outcome and verification result, transaction ID, and pre-migration backup reference. Retain migration history indefinitely in MVP1.

### 59. Use a migration registry and periodically consolidate paths

MVP1 migrations are sequential and individually verified. Maintain a registry of supported schema versions and valid migration paths; execute only the required path. Define a minimum supported source schema. Consolidate older paths into direct migrations to a newer baseline when useful, after representative historical fixtures and independent verification. Historical migration records remain even when old executable migration code is retired.

### 60. Refuse automatic migration from schemas below the supported minimum

Preserve the original untouched and report its version and the minimum supported version. Document a controlled upgrade path where feasible, potentially through an older compatible app release operating on a verified copy. Do not skip or reinterpret old schemas. Unsupported old-schema copies are not automatically eligible for restore or promotion.

### 61. Require one explicit approval for the migration sequence

Before migration, show current and target schema versions, intended changes, availability of a verified backup, known compatibility limitations, and estimated storage needs where known. One explicit approval authorizes the planned sequence; the app then runs individual verified steps. Unexpected conditions stop the sequence.

### 62. Retain verified pre-migration backups indefinitely in MVP1

Keep every verified pre-migration recovery backup until the owner explicitly retires or deletes it. MVP2 may add configurable retention, but must never automatically delete the only known-good pre-migration recovery point. Retirement and physical deletion remain separate operations.

### 63. Validate financial meaning across every migration

Every migration validates its source, captures relevant baseline financial invariants, executes the transformation, recalculates and compares invariants, validates references, monetary precision, transaction records, and affected coverage, then verifies the resulting database before commit. Legitimate expected changes must be documented and tested. Successful JSON parsing is not sufficient.

### 64. Maintain synthetic historical migration fixtures

Create synthetic fixtures for every actively supported schema, including ordinary records, pending/posted observations, monetary edge cases, import coverage gaps, corrections, and recovery cases. Run migration-path tests in CI before merge. Retire fixtures from the active suite when their schema is no longer supported; preserve historical migration records and retirement documentation.

### 65. Retire schemas only after both age and version-distance thresholds are met

A schema becomes eligible for retirement only when it is both more than two years past its original release date and at least eight major versions behind the latest major schema. Eligibility is not automatic retirement. Actual retirement requires a reviewed branch/PR, documentation of affected databases and migration paths, an updated minimum supported version, and deliberate removal of obsolete executable code and active fixtures. Preserve historical records. A retired schema is unsupported, not silently treated as corrupt or safe to restore.

### 66. Use semantic major/minor/patch database schema versions

Major changes are breaking structural or semantic changes requiring migration. Minor changes are backward-compatible additions. Patch changes are clarifications or fixes that do not alter persisted meaning or compatibility. A validator change that rejects previously valid databases is not automatically a patch. Schema-retirement distance counts major versions only.

### 67. Make schemaVersion a required manifest field

schemaVersion is the authoritative declaration of the stored database schema. Migration history and actual structures must corroborate it. Missing, malformed, or inconsistent schema-version evidence blocks writes; the app never guesses or silently repairs the version.

### 68. Start the first production database schema at 1.0.0

The initial production database schema version is 1.0.0. Ordinary imports, transactions, and commits do not change it; only persisted-schema or compatibility-semantic changes do.

### 69. Start the manifest version at 1.0.0

The initial manifest version is 1.0.0. It evolves independently from schemaVersion and application software version, using semantic major/minor/patch compatibility rules.

### 70. Use one canonical manifest filename

The canonical filename is finance-tracker-manifest.json. Each database folder must resolve to exactly one valid manifest. A missing or duplicate manifest is an inspection state, not permission to initialize or select the newest-looking file. Drive file names are not unique; verify the actual file ID, parent folder, MIME type, and content.

### 71. Generate application IDs with UUID v4

Generate databaseId, copyId, commitId, transactionId, migrationId, and event IDs with a cryptographically secure UUID v4 generator such as crypto.randomUUID(). Never fall back to Math.random(); fail safely if secure generation is unavailable. Google Drive file IDs remain provider-assigned or Drive-pre-generated IDs and are separate.

### 72. Adopt the initial manifest contract

The initial manifest contains:
- format: finance-tracker-database
- manifestVersion: 1.0.0
- schemaVersion: 1.0.0
- databaseId and copyId
- role and lifecycleStatus
- revision, commitId, and parentCommitId
- storageBinding with provider and Drive folder ID
- databaseCreatedAt, copyCreatedAt, and lastCommittedAt
- optional extensions object

Health is derived from inspection and is not stored as an authoritative field. Keep credentials, email addresses, account numbers, balances, transactions, and other financial records out of the manifest.

### 73. Standardize timestamp semantics

Persist timestamps as ISO 8601 UTC strings with an explicit Z suffix. databaseCreatedAt is shared by all copies; copyCreatedAt belongs to one physical copy; lastCommittedAt describes the committed state represented by the manifest. Timestamps are informational, not proof of authority or ordering. Device clocks can be wrong. Administrative role/lifecycle changes do not alter lastCommittedAt.

### 74. Define revision semantics

Revision is a positive safe integer beginning at 1 for the initial commit. Each successful logical database commit increments it by one. Backups inherit revision and commit identity; failed/aborted transactions do not increment it. Revision is meaningful only with commitId and lineage. Timestamps never determine revision order.

### 75. Define storage binding by provider and folder ID

storageBinding contains provider=google-drive and the actual Drive folder ID. A rename does not change the binding; a move preserving the ID may preserve it after verification. A copied folder has a different ID and must be explicitly registered. A mismatch blocks normal use.

### 76. Canonicalize structured records with RFC 8785 JCS

Use the JSON Canonicalization Scheme (RFC 8785) before hashing commit and journal records. Use a conforming, tested implementation. Reject non-finite numbers and unsupported values. Monetary values retain the canonical contract's integer-minor-unit representation or exact decimal-string fallback. Canonicalization failure stops the commit.

### 77. Define immutable commit-history records

Each commit record includes commitId, revision, parentCommitId, transactionId, operationType, schemaVersion, committedAt, a complete logical file map, previousRecordHash, and recordHash. The initial record has no parent and no preceding history hash. Commit records are never edited in place; corrections are new commits.

### 78. Represent transaction journals as append-only events

Each journal event has transactionId, unique eventId, sequence number, event type, UTC timestamp, relevant logical file references and expected hashes, and a hash linking it to the prior event for that transaction. Derive current transaction state by replaying events. Never rewrite an earlier failure or uncertain outcome.

### 79. Retain transaction and commit metadata indefinitely in MVP1

Keep complete commit metadata, transaction events, and migration history indefinitely in MVP1. Temporary staging objects are separate and may be cleaned only after their transaction outcome is verified and they are proven unreferenced.

### 80. Keep financial details out of operational metadata

Manifest, commit, journal, migration, and diagnostic records contain only identity, integrity, and recovery metadata. Do not duplicate merchant names, transaction descriptions, account numbers, balances, amounts, credentials, or original bank-export contents. Use opaque logical paths and content hashes.

### 81. Use logical paths and content hashes in portable commit records

Commit records identify logical relative paths and SHA-256 hashes, not Google Drive file IDs. Drive file IDs are copy-specific storage locators. This lets a backup retain the same logical commit history while its physical file IDs differ.

### 82. Use deterministic logical paths and reject ambiguous mappings

The active schema defines the complete set of required logical paths. Each required path must resolve to exactly one verified object. Duplicate or unexplained logical files, missing required files, and unsupported optional files are integrity failures. Never select an arbitrary file based only on its name.

### 83. Distinguish raw-object hashes from record hashes

For stored objects, SHA-256 covers the exact raw bytes; do not decode, normalize line endings, or reserialize before hashing. For commit/journal records, SHA-256 covers the JCS-canonicalized record excluding its own hash field. Represent hashes as lowercase hexadecimal with a sha256: prefix.

### 84. Validate manifests strictly by version

Validate exact format, semantic manifest/schema versions, UUID v4 identifiers, allowed role/lifecycle values, positive safe-integer revision, commit and parent IDs, storage binding, and any present timestamps. No silent type coercion. Unknown top-level fields are rejected under manifest 1.0.0; compatible optional extensions belong under extensions. A future mandatory field or changed meaning requires a major manifest version.

### 85. Treat the manifest as current state, not historical event storage

The manifest identifies the physical copy and points to the current committed revision/commit. It may change for commits and authorized administrative transitions. Those changes are journaled. Administrative role/lifecycle changes do not increment the financial database revision or invent a commit.

### 86. Use a recoverable promotion ordering

Normal promotion verifies both copies, records the transition, demotes and verifies the former primary, promotes and verifies the selected backup, then enables writes. A temporary state with no primary is acceptable; an unverified dual-primary state is not. Emergency promotion requires explicit warning and records that the old primary may still exist. Interrupted transitions block writes until resolved.

### 87. Restore into a new physical copy

A restore creates a new destination folder and new copyId rather than overwriting the existing primary. Copy and verify the selected backup's committed objects and metadata, update the new storage binding, then promote through the normal or emergency protocol. Failed destinations are quarantined; the source backup remains untouched.

### 88. Preserve logical lineage during restore

A restored copy inherits the selected snapshot's databaseId, schemaVersion, revision, commitId, parentCommitId, and commit-history chain. The restore action is recorded in the transaction journal with source and destination copy identities. It does not invent a financial commit or pretend the restored snapshot is newer.

### 89. Register manually copied folders explicitly

A manually copied folder must pass manifest, database identity, object/hash, schema, and commit-history verification. Then assign a new copyId, set role=backup and lifecycleStatus=active, update storageBinding, and verify the manifest. Never promote automatically. Stop if source identity or integrity cannot be established.

### 90. Keep migration history separate from commit and transaction histories

Migration records preserve migration-specific provenance and verification. Commit history records logical database states. Transaction journal records operation progress and recovery. These are separate concerns and must not be collapsed into one overloaded record.

### 91. Do not confuse integrity with authenticity

Google authorization controls access. Manifest validation, content hashes, and hash chains detect inconsistencies and many unexpected changes; they do not prove authorship or prevent a privileged actor from rewriting all records. Do not embed signing secrets in the public frontend or describe a valid hash chain as proof of authenticity.

### 92. Adopt immutable, content-addressed storage as the target model

Committed data objects are immutable and identified by SHA-256 content. A commit describes a complete logical database state. New objects and commit metadata are staged and verified before the manifest publishes the new current commit pointer. Existing committed objects are never overwritten. Exact physical layout and feasibility remain subject to the Drive API gates below.

### 93. Make every commit a complete immutable snapshot descriptor

Each commit record contains the complete logical path-to-content-hash map for the database state it represents, not merely a list of changed files. Unchanged objects are reused by hash. This allows a reader to reconstruct one exact committed state without applying a fragile sequence of partial file mutations.

### 94. Store immutable objects by content hash

Store exact object bytes as immutable Drive files named from their SHA-256 digest. Verify raw bytes against the digest on read and before commit publication. A logical commit references hashes; physical Drive file IDs remain copy-specific. Because Drive names are not unique, duplicate or ambiguous object matches are integrity failures unless a reviewed storage index can resolve them deterministically.

### 95. Make staged file creation retry-safe

For each staged Drive file, obtain a Drive-generated file ID before creation and persist that ID in the transaction journal. Retries use the same ID; if Drive reports that the ID already exists, fetch the existing file and verify its parent, metadata, and exact content hash rather than creating another file. Google documents that a pre-generated ID reused after successful creation returns 409 Conflict instead of creating a duplicate. This behavior must still be tested under the app's actual OAuth scope and folder arrangement.

### 96. Publish a commit only by advancing the manifest pointer last

The publication boundary is the manifest's current revision/commit pointer. First stage and verify every referenced object and the immutable commit record; then revalidate the expected base state; update the manifest pointer; read it back; and verify the pointer resolves to the intended complete snapshot. A commit is successful only after that read-back. Drive does not provide a multi-file transaction, so no other file is modified in place as part of publication.

### 97. Require a durable journal before beginning a Drive transaction

Persist the transaction-start event and its intended base revision/commit before staging or changing committed state. If authorization or network access prevents durable journaling, do not begin the Drive mutation. Local browser diagnostics are best-effort only and never replace the canonical journal. After an uncertain journal write, read back by the pre-generated file ID before proceeding.

### 98. Recover publication interruptions by inspecting the authoritative pointer

After interruption, read and validate the manifest, transaction events, commit record, and all referenced objects:
- If the manifest points to the intended commit and the complete snapshot verifies, record the transaction as committed.
- If the manifest still points to the original base and the staged commit is complete, revalidate the same best-effort active session and exact base tuple, then resume under the accepted single-active-device operating model. If ownership or base state is uncertain, fail closed and require intervention. This is not server-enforced fencing; simultaneous starts and network partitions remain residual risks.
- If the manifest or referenced state is inconsistent, mark outcome-unknown, degrade the copy, and block writes.

Never infer success from an upload response alone.

### 99. Do not automatically garbage-collect committed objects in MVP1

Retain every object referenced by any retained commit history. Because commit metadata is retained indefinitely, historical objects required to reconstruct those states are also retained. Cleanup is permitted only for staged objects from a transaction conclusively marked aborted and proven unreferenced by a complete commit-history scan. Automatic general garbage collection is disabled in MVP1.

### 100. Do not rely on Drive's native revision history as the backup system

Drive's native revision retention is not equivalent to the app's required indefinite history: unpinned binary revisions may be purged, and only up to 200 revisions per file can be marked Keep Forever. The app's own immutable objects, commit history, and verified backups are authoritative. Native revisions may assist investigation only. See Google's [Manage file revisions](https://developers.google.com/workspace/drive/api/guides/manage-revisions).

### 101. Back up a verified committed snapshot, not a live mutable folder

A backup captures one manifest-verified commit and copies every object referenced by its complete snapshot map, along with required commit, transaction, migration, and manifest metadata. It assigns a new copyId and storage binding, preserves logical database identity and lineage, and verifies every copied object's raw hash and structural relationships before reporting success. Source changes during backup cause retry or failure, never a mixed snapshot.

### 102. Use best-effort session coordination under an explicit single-active-device constraint

The owner accepted Google Drive despite the absence of a demonstrated server-enforced compare-and-swap or mutex. The tested Drive v3 `files.update` path accepted a deliberately stale `If-Match` value; do not use that header as a lock or spend further effort trying to treat the tested path as atomic. Finance Tracker is single-user and single-active-device: simultaneous use on two devices is unsupported, and the owner will end the active session before switching devices and will not edit database files outside the app. The app must serialize its own writes, revalidate the same active session and exact base tuple before publication, refuse writes when another active session is detected, prohibit offline writes, and fail closed whenever ownership or outcome is uncertain. Session markers are best-effort detection, not server-enforced exclusion; simultaneous starts and network partitions remain residual risks. Production writes remain blocked until the app demonstrates these safeguards and crash recovery within this accepted operating constraint, followed by explicit owner acceptance. See Google's [File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) and [files.update](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update) references.

### 103. Initialize by publishing the initial manifest last

Initialization uses the same journal and immutable-object protocol. Verify the folder is completely empty; record the initialization transaction; stage the initial required objects and commit record; verify them; then create the canonical manifest as the final publication step and read it back. If interrupted, inspect the known transaction and staged IDs. Never overwrite an existing manifest or start a second initialization merely because the first response was lost.

### 104. Journal all administrative copy transitions

Promotion, emergency promotion, move, registration, retirement, reactivation, quarantine, and restoration use durable transaction events and explicit state transitions. They do not create financial commits unless they actually change committed database contents. Incomplete transitions block ordinary writes and are recovered by inspecting both the journal and affected manifests.

### 105. Partition logical data into stable bounded objects

Do not store the entire growing ledger as one monolithic object that must be rewritten on every import. Use stable logical partitions so unchanged data reuses existing content-addressed objects and small changes do not rewrite unrelated history. Exact partition boundaries and indexing strategy are implementation details to benchmark against synthetic workloads before schema 1.0.0 is frozen.

### 106. Treat storage capacity and quota exhaustion as correctness failures

Do not assume Drive storage or API quota is unlimited. Estimate required staging space where feasible and surface capacity constraints before starting an operation. If storage or quota prevents completion, leave the previous committed state intact, record the failed/unknown transaction, and block further writes until resolved. Never automatically delete committed history or verified recovery points to make room. Preserve the $0 recurring-cost constraint.

### 107. Keep local browser storage non-authoritative

IndexedDB stores only the known-copy inventory and narrowly scoped recovery diagnostics needed for user experience. It is not a second writable ledger, a silent offline queue, or a fallback primary. Clearing browser data must not alter Drive data. MVP1 does not perform offline financial writes.

### 108. Complete synthetic Drive feasibility and transaction validation before production persistence

PR #20's synthetic feasibility spike established complete folder enumeration, pre-generated-ID retry behavior, and exact object hashing, and demonstrated that the tested stale-`If-Match` mechanism is not enforced. The owner then accepted single-user, single-active-device operation instead of requiring a server-enforced lock. PR #21 validates best-effort session coordination; PR #22 establishes the pure transaction protocol; PR #23 implements the durable Drive adapter and synthetic fault-injection/recovery tests; PR #24 integrates the engine with automatic application lifecycle behavior; PR #25 completes end-to-end acceptance and production-readiness review. These workstreams use invented records and a dedicated synthetic folder only. They do not authorize real ledger reads/writes or production financial-data storage.

## Initial manifest example — approved design contract

This illustrates the accepted initial fields and values. IDs and timestamps are placeholders, not real values.

```json
{
  "format": "finance-tracker-database",
  "manifestVersion": "1.0.0",
  "schemaVersion": "1.0.0",
  "databaseId": "<uuid-v4>",
  "copyId": "<uuid-v4>",
  "role": "primary",
  "lifecycleStatus": "active",
  "revision": 1,
  "commitId": "<uuid-v4>",
  "parentCommitId": null,
  "storageBinding": {
    "provider": "google-drive",
    "folderId": "<drive-folder-id>"
  },
  "databaseCreatedAt": "<utc-timestamp>",
  "copyCreatedAt": "<utc-timestamp>",
  "lastCommittedAt": "<utc-timestamp>",
  "extensions": {}
}
```

Health is derived by inspection and is not a manifest field. The manifest is a current-state pointer and identity record, not the commit history or transaction journal.

## Important limitations and safety boundaries

1. **No global primary coordinator:** Per-folder manifests cannot guarantee a single primary across isolated or undiscoverable copies. Detection is limited to copies the app can access.
2. **No assumed atomic Drive writes:** Drive is file storage, not a transactional database. The manifest pointer is the logical publication boundary. The accepted operating model is single-active-device with best-effort app-level session detection and exact-base revalidation; it does not provide a server-enforced lock.
3. **Concurrency limitation is explicit:** A monotonic Drive file version can detect changes but is not itself a lock or conditional write. Simultaneous device use is unsupported; simultaneous starts and network partitions can still defeat best-effort detection. The app must fail closed, and production use requires explicit owner acceptance of this residual risk after the safeguards are validated.
4. **No Drive-revision backup assumption:** Native revision retention is not our indefinite commit/object history.
5. **Manifest is not cryptographic:** A privileged actor can rewrite records and hashes. Integrity checks are not signatures.
6. **Identity is not authorization:** Validate Google authorization and file access separately from manifest identity.
7. **Identity is not financial correctness:** Hashes and structural checks validate consistency, not the correctness of the original financial information.
8. **Restricted discovery is incomplete by design:** Settings cannot promise to show every possible copy in Drive.
9. **Storage growth is deliberate:** MVP1 retains committed history and referenced objects indefinitely. No automatic deletion of committed history is permitted; capacity must be monitored.
10. **No production approval:** This ADR does not authorize real ledger reads/writes, production migration, or relaxation of existing storage-readiness gates.

## Remaining feasibility and implementation gates

These are not unresolved product decisions; they are engineering facts that must be demonstrated before implementation can be considered safe:

- **Drive session coordination:** demonstrate serialized in-app writes, same-session revalidation, refusal when another active session is detected, offline-write prohibition, exact-base rechecks, and crash recovery. Do not claim server-enforced exclusion; simultaneous multi-device use remains unsupported and residual race risks require explicit owner acceptance.
- **Folder visibility:** prove complete child enumeration, pagination, and empty-folder checks under drive.file after Picker selection and after reauthorization.
- **Immutable-object layout:** validate content-addressed naming, duplicate detection, exact raw-byte hashing, generated-ID retries, and object lookup across copies.
- **Snapshot and restore:** prove one committed snapshot can be copied and verified without mixing revisions.
- **Recovery:** exercise interruption at every transaction phase, including a lost response after manifest publication and authorization loss mid-operation.
- **Migration:** validate deterministic migration paths, financial invariants, backup retention, and old-schema compatibility.
- **Storage capacity:** quantify realistic growth with stable partitions and confirm quota/cost behavior without enabling recurring billing.
- **Security and privacy:** review token lifetime/revocation, browser diagnostics, logs, export, deletion, device loss, and account compromise.
- **Production terms and cost:** recheck current Google API terms, quotas, OAuth publishing requirements, and $0 sustainability before real data is used.

## Validation required before any production storage

The synthetic feasibility spike must cover:
- Valid, missing, malformed, duplicate, unsupported, and mismatched manifests.
- UUID, semantic-version, timestamp, canonicalization, and hash-validation failures.
- Complete and incomplete folder listings, duplicate filenames, wrong parent, wrong MIME type, and authorization changes.
- Same-transaction retries using pre-generated Drive IDs, including a lost create response.
- Two-device simultaneous commits from the same base revision, stale writer after a successful commit, lost publication response, and delayed read-after-write visibility.
- Interruption before and after every stage, commit-record creation, manifest publication, and final journal event.
- Missing/duplicate objects, hash mismatch, external edits, missing commit history, and unknown outcomes.
- Initialization retries, partial initialization, and refusal to overwrite unexplained content.
- Backup source changes, object copy mismatch, restore into a new copy, and promotion interruption.
- Migration failures, financial invariant preservation, and pre-migration backup restoration.
- Retired/quarantined copy exclusion, reactivation, and explicit deletion behavior.
- iPhone/iPad browser behavior, authorization renewal, and storage/quota exhaustion.

All fixtures, IDs, folders, and financial records must be synthetic. No real financial data, folder IDs, account identifiers, tokens, or secrets may enter the public repository.

## Approval boundary

This ADR is ready to merge. Merging it records the agreed design and constraints; it does **not** authorize production persistence. The next implementation proposal is a focused synthetic-only Google Drive feasibility spike. A separate owner review is required after its evidence is available and before any identity prototype or production ledger storage is authorized.
