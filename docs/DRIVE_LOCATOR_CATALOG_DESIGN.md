# Per-Copy Drive Locator Catalog — Design and Reconciliation

**Status:** Synthetic v2 implementation and fault tests prepared for review; owner protocol acceptance and live validation remain open
**Scope:** PR #25 transaction-engine reconciliation and synthetic backup/restore acceptance
**Production authorization:** None. All implementation and validation remain synthetic-only.

## Current implementation — 2026-11-03

[PR25 implementation handoff](PR25_IMPLEMENTATION_HANDOFF.md) specifies the exact manifest/commit versions, 14-write ordering, recovery decisions, migration provenance, and ownership gates. `catalog-transaction-engine.mjs` implements this path; the dashboard opts into it. The sections below preserve the original proposal and principles; historical statements about the old engine apply to legacy v1 paths only. Implementation does not claim owner acceptance.

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

This ordering preserves the accepted manifest-last publication boundary for the financial commit while ensuring the final catalog covers all immutable protocol objects. The exact ordering is now specified in the handoff and tested at every durable transaction boundary and representative recovery-repair boundary before its synthetic dashboard integration. Owner review and live acceptance remain open.

## Historical retention and recovery

The catalog must preserve every physical locator needed by all retained commit records, journal events, migration records, and data objects. MVP1 does not garbage-collect committed objects or remove historical mappings. Any future compaction or retention operation must prove that an object is no longer referenced by retained history and must preserve required checkpoints and backups.

Fail closed if the catalog is missing, malformed, has the wrong database/copy identity, fails its hash, has duplicate/conflicting mappings, or cannot resolve an object required by the selected history. Do not search Drive by filename and guess a replacement locator. A failed catalog publication leaves the old manifest and old catalog authoritative; new unreferenced files remain evidence and are not automatically deleted.

## Backup and restore

A backup preserves logical commit IDs, revisions, parent relationships, and hash-only snapshots. It copies every retained object required by the selected history into the destination folder and creates a new catalog bound to the destination's new `copyId`. The destination catalog maps the same logical immutable objects to destination-specific Drive IDs. The source copy and source catalog remain untouched.

Restore creates a new physical copy, verifies every required object and historical reference, builds its own catalog, and publishes the destination manifest last. It preserves the selected logical commit lineage; it does not invent a financial commit.

## Legacy-format transition

The current synthetic transaction engine and PR #24 synthetic dashboard data use the legacy embedded-locator representation. Do not silently reinterpret those records as hash-only records and do not mutate immutable records in place.

Before using the new engine against an existing synthetic folder, implement an explicit, verified conversion path that:

- Reads the selected copy's manifest and complete commit/journal history.
- Verifies every legacy object by its recorded exact raw-byte hash and physical folder binding.
- Builds a destination catalog for the selected copy or, preferably, a separate destination physical copy.
- Produces a hash-only logical history representation with explicit migration provenance.
- Verifies that every retained historical snapshot resolves through the new catalog.
- Publishes the new-format manifest only after the destination state is complete and verified.
- Leaves the legacy source intact and read-only until the converted copy passes acceptance.

For PR #25 acceptance, use a fresh, clearly identified synthetic destination folder for the first full rehearsal. Never reset, overwrite, or delete the existing synthetic test folder merely to simplify migration. Any later cutover of an existing folder requires a verified backup and an explicit owner-reviewed procedure.

## Implemented synthetic path

The pure `drive-locator-catalog.mjs` foundation is now composed with `catalog-storage.mjs`, `catalog-transaction-engine.mjs`, `catalog-backup.mjs`, `catalog-legacy-conversion.mjs`, lifecycle reads and dashboard bootstrap. The PR25 acceptance page uses the actual Google Drive and session adapters. Original source bytes and their mutable retention index live separately from immutable financial history. See the handoff for limits and evidence.

## Acceptance criteria

- Commit snapshot values are lowercase SHA-256 strings only; no Drive IDs appear in commit snapshot entries.
- Each manifest points to one verified locator catalog for its physical copy.
- Catalog entries cover every retained immutable protocol-object class except the catalog itself.
- Catalog validation enforces database ID, copy ID, generation, parent hash, typed identity, exact hash, and unique physical file IDs.
- Catalog updates are copy-on-write and preserve all existing mappings.
- Reads resolve logical paths through the selected copy's catalog and verify exact raw bytes.
- Recovery handles every interruption between financial manifest publication and terminal-journal/catalog finalization without guessing.
- Backup/restore creates a distinct destination catalog and preserves logical commit history.
- Legacy conversion is explicit, verified, non-destructive, and rehearsed in a fresh synthetic destination.
- No production financial-data persistence or existing-folder destructive migration is authorized.

## Remaining sequence

Synthetic implementation and deterministic fault/HTTP integration tests are complete for review. Require current-head Node 26 CI, review the concrete protocol and retention limits, then seek owner authorization for the shared branch deployment. Live synthetic Drive, OAuth, retention, iOS termination/reload and Cloud configuration evidence remain open. No automatic legacy cutover, production writes, or history deletion is authorized.
