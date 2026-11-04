# Per-Copy Drive Locator Catalog — Design and Reconciliation

**Status:** Synthetic v2 implementation and fault tests prepared for review; owner protocol acceptance and live validation remain open
**Scope:** PR #25 transaction-engine reconciliation and synthetic backup/restore acceptance
**Production authorization:** None. All implementation and validation remain synthetic-only.

## Current implementation — 2026-11-03

[Drive Transaction Engine Testing](DRIVE_TRANSACTION_ENGINE_TESTING.md) specifies the current 14-write ordering and recovery validation. `catalog-transaction-engine.mjs` implements this path; the dashboard opts into it. The sections below preserve the original proposal and principles; historical statements about the old engine apply to legacy v1 paths only. Implementation does not claim owner acceptance.

## Original problem

The accepted database architecture requires commit records to describe logical database state independently of a particular Google Drive folder. The current transaction engine still embeds Drive file IDs in commit snapshot references:

`logicalPath -> { fileId, sha256 }`

That couples logical history to one physical copy. Copying the commit record to another folder either leaves stale source-folder IDs or forces immutable commit records to be rewritten.

## Owner-approved principles

The following principles are already recorded in PR #25's acceptance history:

- Commit history describes logical state using logical paths and exact content hashes, not physical Drive IDs (ADR §81).
- Every physical copy has its own lookup mapping from logical immutable objects to physical Drive locators.
- The mapping must cover all immutable objects needed for normal operation and recovery: data objects, commit records, journal events, migration records, and other protocol objects. The locator catalog itself is excluded from self-lookup; its identity and integrity are anchored by the manifest.
- Every retained historical snapshot and its protocol history must remain resolvable.
- Catalog updates are copy-on-write and the manifest remains the publication boundary.
- Backup/restore creates a new copy-specific catalog while preserving logical database identity and commit lineage.
- No production financial-data persistence is authorized.

## Proposed catalog format

A catalog is bound to both `databaseId` and `copyId`. It is immutable, versioned, and linked to its previous generation by the previous catalog's exact SHA-256 hash.

The proposed shape is:

```json
{
  "format": "finance-tracker-locator-catalog",
  "version": 1,
  "databaseId": "<logical-database-uuid>",
  "copyId": "<physical-copy-uuid>",
  "generation": 0,
  "parentCatalogHash": null,
  "entries": {
    "data-object:<sha256>": {
      "kind": "data-object",
      "identity": "<sha256>",
      "sha256": "<sha256>",
      "fileId": "<drive-file-id>"
    },
    "commit-record:<commit-id>": {
      "kind": "commit-record",
      "identity": "<commit-id>",
      "sha256": "<record-sha256>",
      "fileId": "<drive-file-id>"
    },
    "journal-event:<event-id>": {
      "kind": "journal-event",
      "identity": "<event-id>",
      "transactionId": "<transaction-id>",
      "sequence": 0,
      "sha256": "<event-sha256>",
      "fileId": "<drive-file-id>"
    }
  }
}
```

The typed key prevents different immutable-object classes from colliding. Data objects are content-addressed and can be reused when the exact hash already exists. Commit records, journal events, migration records, and other immutable protocol objects use their stable protocol identity plus an exact content hash. A physical file ID may appear only once in a catalog. Existing identities cannot be rebound to a different file ID or hash.

The catalog is operational metadata. It contains no transaction descriptions, merchant names, account identifiers, balances, credentials, or source-file contents.

## Logical commit and manifest shape

A commit's complete snapshot is:

`logicalPath -> sha256`

It contains no Drive IDs. The current manifest remains copy-specific and points directly to the current catalog by file ID and exact catalog hash. The current commit is identified by commit ID and record hash and is resolved through the catalog; the manifest need not carry a commit-record Drive ID.

The catalog generation is independent of the financial revision. If a transaction reuses existing content and adds no new immutable objects, it may reuse the current catalog pointer.

## Copy-on-write and publication protocol

An existing catalog is never edited in place. A proposed normal transaction sequence is:

1. Read and verify the manifest-selected catalog and exact base manifest.
2. Stage new data objects, journal events, and the immutable hash-only commit record using pre-generated IDs.
3. Verify each object by exact raw-byte hash and expected Drive metadata.
4. Build a new catalog preserving every prior retained mapping and adding all newly required immutable-object locators.
5. Verify catalog identity, parent hash, uniqueness, and exact content hash.
6. Revalidate the active session and exact base manifest.
7. Publish the new commit and catalog pointers in the manifest last; read back and verify the manifest.
8. Complete any post-publication terminal journal events and ensure those events are also indexed in a subsequent catalog generation and manifest catalog-pointer update, without inventing a new financial revision.
9. Verify the complete committed snapshot and retained history through the published catalog.

**Original protocol issue, now implemented and fault-tested for review:** the current transaction protocol writes terminal journal events after manifest publication. A catalog published at step 7 cannot contain a terminal event that does not yet exist. The engine must therefore implement and fault-test the post-publication catalog finalization at step 8, including crashes between the financial pointer publication, terminal event writes, and follow-on catalog pointer publication. During that interval the previous published catalog remains authoritative for the committed data; recovery may use complete folder enumeration to locate unindexed in-flight journal evidence, but must verify every event and must not guess by filename. Writes remain blocked until recovery completes catalog finalization.

This ordering preserves the accepted manifest-last publication boundary for the financial commit while ensuring the final catalog covers all immutable protocol objects. The exact ordering is specified in [Drive Transaction Engine Testing](DRIVE_TRANSACTION_ENGINE_TESTING.md) and fault-tested at every durable transaction boundary and representative recovery-repair boundary. Owner-reported live acceptance is recorded in [Synthetic Storage Acceptance](SYNTHETIC_STORAGE_ACCEPTANCE.md).

## Historical retention and recovery

The catalog must preserve every physical locator needed by all retained commit records, journal events, migration records, and data objects. MVP1 does not garbage-collect committed objects or remove historical mappings. Any future compaction or retention operation must prove that an object is no longer referenced by retained history and must preserve required checkpoints and backups.

Fail closed if the catalog is missing, malformed, has the wrong database/copy identity, fails its hash, has duplicate/conflicting mappings, or cannot resolve an object required by the selected history. Do not search Drive by filename and guess a replacement locator. A failed catalog publication leaves the old manifest and old catalog authoritative; new unreferenced files remain evidence and are not automatically deleted.

## Backup and restore

A backup preserves logical commit IDs, revisions, parent relationships, and hash-only snapshots. It copies every retained object required by the selected history into the destination folder and creates a new catalog bound to the destination's new `copyId`. The destination catalog maps the same logical immutable objects to destination-specific Drive IDs. The source copy and source catalog remain untouched.

Restore creates a new physical copy, verifies every required object and historical reference, builds its own catalog, and publishes the destination manifest last. It preserves the selected logical commit lineage; it does not invent a financial commit.

## Folder-format boundary

PR25 starts with fresh version-2 synthetic folders. Existing PR24-format folders are unsupported and are not converted, upgraded, or opened by the PR25 dashboard. Use a new empty synthetic folder for acceptance. This is distinct from future application-schema migrations: those remain governed by the general database lifecycle decisions and are not implemented by this PR25 directory-format work.

## Implemented synthetic path

The pure `drive-locator-catalog.mjs` foundation is now composed with `catalog-storage.mjs`, `catalog-transaction-engine.mjs`, `catalog-backup.mjs`, lifecycle reads and dashboard bootstrap. The PR25 acceptance page uses the actual Google Drive and session adapters. Original source bytes and their mutable retention index live separately from immutable financial history. See [Drive Backup and Restore](DRIVE_BACKUP_AND_RESTORE.md), [Original Source File Retention](ORIGINAL_SOURCE_RETENTION.md), and [Synthetic Storage Acceptance](SYNTHETIC_STORAGE_ACCEPTANCE.md) for operational behavior, limits, and evidence.

## Acceptance criteria

- Commit snapshot values are lowercase SHA-256 strings only; no Drive IDs appear in commit snapshot entries.
- Each manifest points to one verified locator catalog for its physical copy.
- Catalog entries cover every retained immutable protocol-object class except the catalog itself.
- Catalog validation enforces database ID, copy ID, generation, parent hash, typed identity, exact hash, and unique physical file IDs.
- Catalog updates are copy-on-write and preserve all existing mappings.
- Reads resolve logical paths through the selected copy's catalog and verify exact raw bytes.
- Recovery handles every interruption between financial manifest publication and terminal-journal/catalog finalization without guessing.
- Backup/restore creates a distinct destination catalog and preserves logical commit history.
- PR25 initializes only fresh version-2 synthetic folders; PR24-format folders are rejected without modification.
- No production financial-data persistence or existing-folder destructive migration is authorized.

## Remaining sequence

Synthetic implementation and deterministic fault/HTTP integration tests are complete for review. Require current-head Node 26 CI, review the concrete protocol and retention limits, then seek owner authorization for the shared branch deployment. Live synthetic Drive, OAuth, retention, iOS termination/reload and Cloud configuration evidence remain open. No legacy-folder conversion, production writes, or history deletion is implemented or authorized.
