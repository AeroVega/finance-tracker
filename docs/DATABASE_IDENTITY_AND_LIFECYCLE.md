# Database Identity and Lifecycle — Architecture Decision Record

**Status:** Draft PR; design decisions accepted in discussion, implementation not authorized  
**Decision scope:** Stable database identity, physical copies, primary designation, backups, lifecycle, commit lineage, and corruption handling  
**Storage direction:** Google Drive, subject to the existing production-readiness gates  
**Target:** MVP1  
**Related baseline:** `docs/PRIVATE_STORAGE_ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DATA_MODEL.md`, and `docs/ARCHITECTURE_DECISIONS.md`

> This record documents the 29 decisions made during the database identity design review. It is a design baseline, not permission to implement production persistence or enable real financial-data storage. Schema details and operational protocols identified as open below still require design and review.

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
- `lastModifiedAt`: time associated with the latest committed database state.

Additional metadata may be included only when its semantics are reliable and useful. Do not turn the manifest into a dumping ground. Do not include account email, OAuth tokens, API keys, account numbers, balances, transactions, or other financial records.

### 13. Strict core fields with an extensions section

The manifest has strictly validated core fields and an optional `extensions` section for future capabilities. Unknown optional extension data may be ignored when compatibility rules permit. Credentials, personal account details, and financial records are prohibited from the manifest.

### 13A. Use semantic major/minor manifest compatibility

Manifest compatibility uses major/minor semantics:
- A major version change indicates a breaking change; an app that does not support that major version refuses access.
- A minor version change is backward-compatible. An older app may continue only when all fields and semantics it relies on remain compatible.
- Adding a newly required field or changing existing semantics requires a major version change.
- Unknown optional fields may be ignored when the declared compatibility rules permit it.

Manifest version is independent of ledger schema version and app software version.

### 14. Separate required identity fields from optional operational metadata

Required core fields:
- `format`
- `manifestVersion`
- `databaseId`
- `copyId`
- `role`
- `revision`
- `commitId`
- `storageBinding`

Optional operational metadata:
- `databaseCreatedAt`
- `copyCreatedAt`
- `lastModifiedAt`
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

## Proposed manifest shape — illustrative, not yet approved

The following is a conceptual shape only. Exact filename, JSON schema, field types, enum values, UUID generation, timestamp semantics, and root-level unknown-field policy remain open. This example is not an implementation contract.

```json
{
  "format": "com.aerovega.finance-tracker.database",
  "manifestVersion": "1.0",
  "databaseId": "<logical-database-id>",
  "copyId": "<physical-copy-id>",
  "role": "primary",
  "revision": 0,
  "commitId": "<initial-commit-id>",
  "storageBinding": {
    "provider": "google-drive",
    "folderId": "<actual-drive-folder-id>"
  },
  "databaseCreatedAt": "<timestamp>",
  "copyCreatedAt": "<timestamp>",
  "lastModifiedAt": "<timestamp>",
  "extensions": {}
}
```

The example omits commit-history storage deliberately. Whether lineage is stored in the manifest or in a separate, versioned metadata file is an open design detail. Do not let a growing history make the identity manifest unwieldy.

## Important limitations and safety boundaries

1. **No global primary coordinator:** Separate per-folder manifests cannot guarantee that only one isolated copy claims primary. Detection is limited to copies the app can discover and access. Emergency promotion can leave an old primary elsewhere.
2. **No atomic multi-file transaction:** Promotion and other lifecycle transitions that update more than one file require a recoverable state machine or operation record. Writes remain blocked during incomplete transitions.
3. **Manifest is not cryptographic:** A user or process with permission to modify the folder can alter the manifest. It is an identity/consistency check, not a tamper-proof signature.
4. **Identity is not authorization:** Validate the active Google authorization and file access separately from manifest identity.
5. **Identity is not financial correctness:** Hashes and structural checks validate copy consistency, not the financial correctness of the source ledger.
6. **Restricted discovery is incomplete by design:** The app must not imply that Settings displays every possible copy in Drive.
7. **No production approval:** This ADR does not authorize real ledger reads/writes, production data migration, or relaxing any existing storage-readiness gate.

## Open implementation details

The following details are intentionally not settled by the 29 decisions and must be designed before implementation:

- Exact manifest filename and canonical JSON schema.
- Exact `format` identifier, manifest version encoding, and compatibility validation.
- UUID/unique-ID generation and collision handling.
- Whether `role` and lifecycle/health status are separate fields; proposed roles are primary/backup, with retired/quarantined/incomplete represented as lifecycle or health states rather than overloaded roles.
- Exact `storageBinding` schema and folder-ID verification behavior.
- Exact semantics for `lastModifiedAt` versus a separate manifest-update timestamp.
- Where commit metadata is stored, how it is validated, and how it is made durable before a commit is considered successful.
- How snapshot consistency is established with Drive's file APIs.
- A durable promotion/move operation record and interrupted-transition recovery protocol.
- How restore creates a new committed state while preserving the source lineage, including how the parent relationship is represented.
- Exact rules for classifying older snapshot versus divergent when history is partial.
- Explicit initialization behavior for an empty folder, a folder with unrelated files, a missing manifest, malformed manifest, unsupported version, or mismatched binding.
- Explicit retirement/reactivation and deletion confirmations, including the distinction between an approved deletion and confirmed deletion.

These are follow-on design questions, not permission to make assumptions during implementation.

## Validation required before production storage

Before any real financial data is stored, the existing release gates still apply. In addition, synthetic tests must cover at least:

- Valid manifest; missing, malformed, unsupported, or mismatched manifest.
- Duplicate folder names and multiple primary claims among accessible copies.
- Primary unavailable, expired/revoked authorization, wrong account, network/API errors.
- Copied-folder registration and folder move behavior.
- Normal and emergency promotion, including interrupted promotion and later reappearance of the old primary.
- Snapshot consistency, source changes during backup, hash mismatch, missing files, structural corruption, and quarantine.
- Current, older snapshot, divergent, and unknown lineage classification.
- Missing/malformed commit-history records and read-only/quarantine behavior.
- Retired-copy exclusion and explicit reactivation.
- Restore from a healthy backup and refusal to restore from quarantined/incomplete copies.

All fixtures and identifiers must be deliberately synthetic. No real financial records, folder IDs, account identifiers, tokens, or secrets may enter the public repository.

## Approval boundary

This document records the owner's accepted design decisions. It does **not** approve production implementation. After the remaining design questions are resolved, the architecture and recovery protocol must be reviewed as a whole. Only then should a focused identity-only prototype be proposed, with synthetic tests and no ledger reads/writes.
