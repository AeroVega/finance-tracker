# Storage and transaction terminology

This glossary defines project-wide terms. Focused contracts remain authoritative for exact schemas and behavior.

## Financial-record formats

| Term | Meaning | Current application status |
| --- | --- | --- |
| Canonical ledger | Validated financial source graph: accounts, imports, observations, activities and append-only events, with optional position history. | Active domain model. |
| Per-record v1 | Earlier canonical persistence layout with separately stored records. | Direct old-copy access is refused. Read-only decoding remains only for retained provenance inside existing v5 copies. |
| Grouped v2 (canonical) | Deprecated experimental canonical layout that grouped records. | Rejected; do not create, migrate to or revive it. |
| Fragmented v3 (canonical) | Earlier canonical layout using fragmented record storage. | Direct old-copy access is refused. Read-only decoding remains only for retained provenance inside existing v5 copies. |
| Canonical v4 | Partitioned records and derived monthly data in immutable content-addressed trees. Compact v4 uses `valueCodec: "compact-json-v1"` with source/derived version 2; original untagged v4 retains version-1 semantics. Full validation requires deterministic derived roots. | Historical; refused by the current application. No migration is offered. |
| Canonical v5 | Same compact source/derived version-2 shapes, with full ordered logical derived validation independent of tree topology. Verifier `canonical-partitions-v5`. | Only supported application canonical layout. Whole-ledger/history loading and validation remain. |

## Storage catalog and transaction protocol

| Term | Meaning | Current application status |
| --- | --- | --- |
| Locator catalog | Maps logical object paths and retained revisions to physical Drive object identities and hashes. It is storage metadata, not the financial ledger. | Active storage subsystem. |
| Catalog v1 | Earlier locator-catalog root format. | Historical low-level format; not the v5 application catalog. |
| Catalog v2 | Segmented immutable locator-catalog root with bounded entry segments. | Historical segmented format; not the v5 application catalog. |
| Locator catalog v3 | Paged physical object locators for canonical v5 copies. | Distinct from canonical fragmented v3. |
| Root transaction protocol v3 | Original small-root publication and pending-plan reference protocol. | Historical prototype; unused runtime removed. |
| Physical root protocol v4 | Portable logical commits plus copy-local plans, receipts and physical locators. | Publication and recovery for canonical v5; not canonical layout v4. |
| Journal / commit history | Append-only transaction evidence used to recover and verify saved revisions. | Active protocol; see the transaction/recovery contracts. |

## Derived data and backup

| Term | Meaning | Status |
| --- | --- | --- |
| Monthly index / summary sidecar | Rebuildable account/month report acceleration derived from canonical source content. | Active PR37 sidecar; never authoritative financial evidence and never a balance source. |
| Immutable page tree | Content-addressed bounded-node structure with root-pinned reads and copy-on-write APIs. | V5 saves coalesce canonical tree changes. |
| Framed archive v3 | Transport using `canonical5-physical4` and retained source evidence. This profile has canonical descriptor 5, physical protocol 4 and `catalog: null`. | Older canonical profiles are refused. Verification still materializes ledgers; browser Blob fallback buffers the archive. |
| Portable archive v2 | Existing whole-archive JSON/base64 export and restore format. | Read-only provenance audit for existing migrated-v5 copies; not a standalone application restore or migration path. |

## Verification vocabulary

- **Byte/hash verified:** bytes read match the expected content hash under the selected root. This does not prove unread content is complete or financially valid.
- **Structurally verified:** required objects, shapes, references and commitments pass the relevant structural checks.
- **Semantically verified:** the complete required source and derived data pass the financial/domain validation oracle and exact derived-data comparison.
- **Implemented:** code exists in the named path.
- **Integrated:** normal application workflows invoke that code.
- **Verified:** a named check passed on a named revision.
- **Owner-accepted:** the owner performed the stated acceptance.
- **Deployed:** the deployment completed and the served SHA was checked.
- **Production-authorized:** the owner explicitly approved production financial-data activation after all required gates.

These terms are not interchangeable. A prototype can be implemented and tested without being integrated; a hash can pass without semantic verification; a branch preview is not a production release.

## Version naming rule

Always qualify a version with its subsystem: write **canonical fragmented v3**, **locator catalog v2**, **root transaction protocol v3**, or **framed archive v3**. Never write only “v2” or “v3” when more than one subsystem could be meant.

See [the agent quick start](AGENT_QUICK_START.md) for the current architecture map and [the documentation index](README.md) for focused contracts.
