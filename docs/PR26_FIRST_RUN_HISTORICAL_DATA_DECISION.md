# PR #26 — First-Run Historical Data Availability Decision

**Status:** Owner-approved product behavior  
**Decision date:** 2026-11-05  
**Scope:** Record the first-run availability decision and its relationship to the existing private-storage architecture.

## Decision

On first use, the application should present the user's migrated historical financial summaries as soon as the app can access the user's authorized financial data in Google Drive. The user must not be required to import current Wells Fargo, SoFi, or Fidelity data before the application becomes useful.

The initial experience should therefore:

- Make the migrated historical summaries available immediately after the required Google Drive access is established.
- Clearly indicate that current institution data can be imported to bring the financial picture up to date.
- Avoid presenting an empty dashboard merely because current institution imports have not yet been completed.

## Google Drive and data authority

The historical summaries and canonical financial data reside in the user's private Google Drive storage, not in the public GitHub Pages application bundle.

The application must have authorized access to the designated Google Drive location before it can retrieve the historical data. **First-run setup must explicitly establish which Google Drive directory is the user's primary Finance Tracker database location.** The user must be able to select or confirm that directory; the app must then discover and validate the database identity, folder binding, manifest, and primary role under the accepted database lifecycle contract before using it. A folder name or a remembered path alone is not proof that it is the correct database. If the selected directory is empty, unrecognized, or cannot be verified as the primary, the app must follow the existing explicit initialization, inspection, or recovery process—it must not silently create, overwrite, or switch databases. The exact connection, folder-discovery/selection, and reconnect experience remains an engineering design matter governed by the existing Google Drive and OAuth architecture; this decision does not prescribe a new storage mechanism.

Google Drive remains the authoritative storage location under the accepted architecture. Locally available data may be used for responsive reading and analysis where supported, but browser-local copies are not a substitute for authoritative Drive storage and do not change the existing restrictions on offline writes.

If Drive access is unavailable, the application should explain the access/recovery state rather than silently treating the user's financial history as empty or zero.

## Scope boundaries

- This decision does not authorize storing private financial records in GitHub Pages or the public repository.
- It does not change the existing storage, security, OAuth, synchronization, or offline-write contracts.
- It does not require current CSV imports before historical summaries can be viewed.
- Manual file import remains supported as a permanent data-ingestion path.
- Selecting or confirming the primary Google Drive database directory is a required first-run setup responsibility, not an optional convenience.
- Exact first-run screens, ordering, folder-access recovery, and presentation details remain implementation/design work unless they require a consequential product decision.

## Relationship to later work

PR #26 records the product decision that migrated historical summaries should be available on first use after authorized Google Drive access, without waiting for current institution imports.

The broader first-run experience and application implementation should be developed in the appropriate engineering work, respecting the existing storage architecture and release gates.
