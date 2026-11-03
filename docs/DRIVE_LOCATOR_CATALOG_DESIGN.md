# Per-Copy Drive Locator Catalog — Design Contract

**Status:** Owner-approved architecture direction; synthetic implementation in progress  
**Scope:** PR #25 transaction-engine reconciliation and the subsequent synthetic backup/restore acceptance work  
**Production authorization:** None. All implementation and validation remain synthetic-only.

## Problem

The accepted database architecture requires commit records to describe logical database state independently of a particular Google Drive folder. A commit must be portable between physical copies. The current transaction engine still embeds Drive file IDs in each commit's snapshot map:

`logicalPath -> { fileId, sha256 }`

That couples a logical commit to one physical Drive copy. Copying the commit record to another folder either leaves stale source-folder IDs or forces the commit record to be rewritten, changing its hash and breaking immutable lineage.

## Decision

Separate logical content identity from physical storage location.

### 1. Commit records contain only logical paths and content hashes

The complete snapshot map is:

`logicalPath -> sha256`

Each hash is the SHA-256 digest of the exact raw bytes of one immutable data object. Commit records contain no Google Drive file IDs, folder IDs, or other copy-specific storage locators.

### 2. Each physical copy has its own locator catalog

A locator catalog maps content hashes to the Drive file IDs for that physical copy:

`sha256 -> driveFileId`

The catalog is bound to both `databaseId` and `copyId`. A locator from one physical copy must never be used to read another copy.

The initial format is:

```json
{
  "format": "finance-tracker-locator-catalog",
  "version": 1,
  "databaseId": "<logical-database-uuid>",
  "copyId": "<physical-copy-uuid>",
  "generation": 0,
  "parentCatalogHash": null,
  "locators": {
    "<sha256>": "<drive-file-id>"
  }
}
```

The catalog is operational metadata, not financial data. It contains no account details, transaction descriptions, amounts, credentials, or source-file contents.

### 3. Catalogs are immutable and copy-on-write

A transaction never edits an existing catalog. It:

1. Reads and verifies the catalog referenced by the current manifest.
2. Stages and verifies any new immutable content objects.
3. Creates a new catalog containing every prior mapping plus the newly verified hash-to-ID mappings.
4. Verifies the new catalog's identity, parent hash, and exact content hash.
5. Stages and verifies the new hash-only commit record.
6. Revalidates the exact base manifest and active session.
7. Publishes the new manifest pointer last, including the new catalog file ID and hash.
8. Reads back and verifies the manifest and the complete committed snapshot through the new catalog.

The manifest's catalog pointer is copy-specific and may contain the catalog's Drive file ID and SHA-256 hash. Its current commit pointer is also resolved through the catalog by commit identity and record hash; the manifest does not need a commit-record Drive ID. This does not violate the logical commit-record rule: the manifest belongs to one physical copy and is the authoritative current-state pointer.

A transaction that adds no new content hashes may reuse the current immutable catalog pointer. Catalog generation is independent of the financial revision.

### 4. Historical content remains resolvable

The catalog retains mappings for all immutable objects required by retained history and recovery: data objects, commit records, journal events, migration records, and other immutable protocol objects. The current catalog file is excluded from self-lookup; its identity and integrity are anchored directly by the manifest. Historical objects remain available for backup, restore, audit, and projection provenance.

MVP1 does not garbage-collect committed objects or remove historical locator mappings. A future verified retention/compaction design must prove that no retained commit references an object before any mapping or object can be retired.

### 5. Journal events retain recovery locators

The append-only transaction journal may record pre-generated Drive IDs for planned objects, commit records, and catalog files. These IDs are necessary to resolve ambiguous create responses and recover interrupted work within the same physical copy.

Journal locators are operational, copy-specific recovery evidence. They do not make commit records copy-specific. Journal records remain append-only and are not rewritten during backup.

### 6. Backup and restore rebuild the destination catalog

A backup preserves the logical database ID, commit IDs, revisions, parent relationships, and hash-only logical snapshots. It copies every retained object needed by the selected history into the destination folder and builds a new locator catalog bound to the destination's new copy ID.

The destination catalog maps the same content hashes to destination Drive file IDs. The source catalog and source copy remain untouched. Commit records do not need to be rewritten merely because the physical copy changed.

Restore follows the same rule: create a new physical copy and catalog, verify every required object and historical reference, publish the destination manifest last, and preserve the selected logical commit lineage.

## Legacy-format transition

The current synthetic transaction engine and PR #24 synthetic dashboard data use the legacy embedded-locator representation. Do not silently reinterpret those records as hash-only records and do not mutate immutable records in place.

Before using the new engine against an existing synthetic folder, implement an explicit, verified conversion path that:

- Reads the selected copy's manifest and complete commit/journal history.
- Verifies every legacy object by its recorded exact raw-byte hash and physical folder binding.
- Builds a destination locator catalog for that copy.
- Produces a new hash-only logical history representation with explicit migration provenance.
- Verifies that every retained historical snapshot resolves through the new catalog.
- Publishes the new-format manifest only after the destination state is complete and verified.
- Leaves the legacy source intact and read-only until the converted copy passes acceptance.

For PR #25 acceptance, prefer a fresh, clearly identified synthetic destination folder for the first full rehearsal. Never reset, overwrite, or delete the existing synthetic test folder merely to simplify migration. Any later cutover of an existing folder requires a verified backup and an explicit owner-reviewed procedure.

## Failure behavior

Fail closed if the catalog is missing, malformed, has the wrong database/copy identity, fails its hash, has duplicate or conflicting mappings, or cannot resolve any hash referenced by the selected snapshot/history. Do not search Drive by filename and guess a replacement locator. Do not automatically repair a catalog by choosing among duplicates.

A failed catalog publication leaves the old manifest and old catalog authoritative. The new catalog is an unreferenced immutable staging artifact and remains as evidence; do not delete it during recovery.

## Acceptance criteria

- Commit snapshot values are lowercase SHA-256 strings only; no Drive IDs appear in commit snapshot entries.
- Each manifest points to one verified locator catalog for its physical copy, and the catalog includes every retained immutable protocol-object class except the catalog itself.
- Catalog validation enforces database ID, copy ID, generation, parent hash, and unique hash/file-ID mappings.
- Catalog updates are copy-on-write and preserve all existing mappings.
- Reads resolve logical paths through the selected copy's catalog and verify exact raw bytes.
- Recovery can identify and verify planned object/catalog/commit files after interruption without guessing.
- Backup/restore creates a distinct destination catalog and preserves the logical commit history.
- Tests cover missing, corrupt, wrong-copy, conflicting, duplicate, and unreferenced catalog entries, plus interruptions before and after manifest publication.
- No production financial-data persistence or existing-folder destructive migration is authorized by this work.

## Implementation sequencing

1. Add and test pure locator-catalog validation, hashing, extension, and resolution primitives.
2. Reconcile the transaction engine and journal recovery protocol with hash-only snapshots and manifest catalog pointers.
3. Update lifecycle reads and synthetic dashboard bootstrap to resolve through the catalog.
4. Reconcile portable backup/export/restore to copy all history-referenced hashes and create a destination catalog.
5. Add a synthetic legacy conversion rehearsal using a fresh destination.
6. Only then request a PR #25 branch deployment for owner-run live synthetic acceptance.
