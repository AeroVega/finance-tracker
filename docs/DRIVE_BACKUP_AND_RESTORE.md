# Google Drive Backup, Portable Archive, and Restore

**Current implementation status:** Synthetic version-2 implementation is present and owner-reported live acceptance passed on 2026-11-04.
**Production status:** This document does not authorize production financial-data backup or persistence.

## Purpose and invariants

Backup and restore preserve logical financial history while creating an independent physical Drive copy. A physical Drive file ID is never treated as portable logical identity.

- Logical commit records contain logical paths and exact content hashes, not physical Drive IDs.
- Each physical copy has its own immutable, versioned locator catalog bound to its database and copy identities.
- The catalog covers retained immutable data objects, commit records, journal events, migration records, and other protocol objects needed for operation and recovery. The catalog itself is anchored by the manifest.
- Catalog generations are copy-on-write and linked by exact parent hashes.
- Backup/restore preserves logical database identity, commit IDs, revisions, parent relationships, and exact logical history while assigning a new physical copy identity and destination-specific locators.
- No committed history is silently discarded or rewritten.

See [Per-Copy Drive Locator Catalog Design](DRIVE_LOCATOR_CATALOG_DESIGN.md) for the catalog model and logical/physical identity boundary.

## Backup behavior

A backup holds verified source and destination session gates during the copy, with independent heartbeats. The destination must be a fresh folder containing only its verified session marker.

The preparation marker begins quarantined and becomes ready only after object and structure verification. The destination database manifest is created last. Reopening a backup verifies the preparation marker and the complete catalog/history.

A backup includes every catalog-referenced retained immutable object required by the selected history, not only the head snapshot. Logical commit bytes and hashes remain unchanged. Archive mappings contain no physical Drive IDs. Historical journal bytes may still contain original protocol locators; exported archives must therefore be treated as private recovery artifacts.

Failure attempts a durable quarantine update and reports whether that update succeeded. If authorization is unavailable, quarantine confirmation may be impossible. Preserve that destination for inspection and retry using a fresh folder rather than assuming it is safe.

## Portable archive and restore

The archive digest detects alteration; it is not authentication or encryption. Exported archives and local copies of original source files are private artifacts and must be protected by the owner.

Restore creates a new physical copy and a new copy-specific locator catalog. It verifies all required objects and historical references before publishing the destination manifest last. It preserves the selected logical commit lineage and does not invent a financial commit.

Expired or confirmed-deleted original source bytes are omitted from backups/archives. Original retention timestamps are preserved; restore does not restart their clocks. Only originals still unexpired at restore time are eligible for restoration. Import provenance and processing status remain even when original bytes are omitted.

## Folder-format boundary

The current synthetic implementation initializes and reopens fresh version-2 folders only. Existing PR24-format synthetic folders are unsupported; there is no conversion, migration, or in-place upgrade path. Use a new empty synthetic folder for acceptance. This directory-format limitation is distinct from future application-schema migrations, which remain governed by the database lifecycle architecture.

## Acceptance evidence (owner-reported, 2026-11-04)

Using synthetic data, the owner reported:
- Separate Drive backup created, reopened, and verified; 11 immutable objects and logical commit history were preserved.
- Failed backup produced a durable quarantine marker, no usable destination manifest, and required a fresh destination.
- Portable archive export passed independent loaded-archive integrity/history/app-structure verification.
- Restore to a fresh Drive folder passed with a new physical copy identity and exact logical history.

These are owner-reported live results, not independent telemetry or CI assertions. Automated tests cover deterministic backup/restore and interruption behavior; live owner observations are recorded separately from CI evidence.

## Operational constraints

- No production financial-data persistence is authorized by this document.
- Never place real financial data, account identifiers, credentials, tokens, or private Drive locators in this public repository, CI logs, or public issues.
- Do not treat an archive digest as encryption, authentication, or protection against a compromised account/device.
- Local exported archives cannot be remotely erased by this static app; the owner is responsible for their private lifecycle.
- The app's single-active-device constraint and no-offline-writes rule continue to apply.
