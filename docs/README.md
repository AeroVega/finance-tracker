# Documentation guide

For a fast agent handoff, read [Agent quick start](AGENT_QUICK_START.md). Then consult [project status](PROJECT_STATUS.md) and [next steps](NEXT_STEPS.md). Read only the focused contract relevant to the task.

Production financial-data persistence remains **NO-GO**. Code, tests, owner acceptance, merge, deployment and production authorization are separate states.

## Current planning

| Document | Purpose |
| --- | --- |
| [Project status](PROJECT_STATUS.md) | Dated implementation, PR/CI/deployment facts and evidence limits. |
| [Next steps](NEXT_STEPS.md) | Alpha dependency order and measurable completion gates. |
| [Storage scaling audit](STORAGE_SCALING_AND_PRODUCTION_READINESS.md) | Capacity findings, measurements and remaining safeguards. |
| [App testing follow-up](APP_TESTING_FEEDBACK.md) | Posting-status editor, save request reduction and remaining acceptance. |
| [Test commands](TESTING.md) | Focused, ordinary and required extended checks. |
| [Incremental storage foundation](SCALABLE_STORAGE_FOUNDATION.md) | Active-path PR37 changes and limits. |
| [Paged storage milestone](PAGED_STORAGE_MILESTONE.md) | Isolated follow-up modules and adoption gates; not active application behavior. |
| [Roadmap](ROADMAP.md), [product definition](PRODUCT_DEFINITION.md) and [open decisions](PRODUCT_OPEN_DECISIONS.md) | Product scope and unresolved owner choices. |
| [Owner acceptance](OWNER_ACCEPTANCE.md) | Current manual checks and known checklist drift. |
| [Security](SECURITY.md) and [production persistence plan](PR27_PRODUCTION_PERSISTENCE_PROPOSAL.md) | Required controls and separate production authorization. |

## Implementation contracts

- [Canonical workspace](CANONICAL_MAIN_WORKSPACE.md), [canonical ledger](CANONICAL_LEDGER_CONTRACT.md) and [data model](DATA_MODEL.md): user-visible workflow and financial meaning.
- [Provider formats](PROVIDER-IMPORT-SPECS.md) and [PR28 import](PR28_CANONICAL_IMPORT.md): import provenance, mapping and reconciliation.
- [Database identity/lifecycle](DATABASE_IDENTITY_AND_LIFECYCLE.md), [application lifecycle](APPLICATION_STORAGE_LIFECYCLE.md), [transaction recovery](TRANSACTION_STAGING_AND_RECOVERY.md) and [session coordination](SESSION_COORDINATION.md): storage authority and safe writes.
- [Fragmented canonical storage](FRAGMENTED_CANONICAL_STORAGE.md): current application layout policy. New stores use fragmented v3; per-record v1 remains readable; standalone grouped v2 is rejected. Canonical layout versions are distinct from locator-catalog versions.
- [Storage terminology](STORAGE_TERMINOLOGY.md): canonical/catalog/protocol/archive version names and verification vocabulary.
- [Segmented locator catalogs](SEGMENTED_LOCATOR_CATALOG.md), [monthly index](CANONICAL_MONTH_INDEX.md) and [Drive response bounds](DRIVE_RESPONSE_BOUNDS.md): PR37 active-path contracts.
- [Immutable page trees](IMMUTABLE_PAGE_TREE.md), [partitioned canonical storage](PARTITIONED_CANONICAL_STORAGE.md), [framed backup](FRAMED_BACKUP_STREAM.md) and [root transaction protocol](ROOT_TRANSACTION_PROTOCOL.md): isolated follow-up contracts, not wired into the application.
- [Backup and restore](DRIVE_BACKUP_AND_RESTORE.md), [original-source retention](ORIGINAL_SOURCE_RETENTION.md) and [Google configuration](GOOGLE_DRIVE_CONFIGURATION.md): operational requirements.

## Evidence and history

PR/acceptance reports and linked benchmark reports describe checks on specific revisions. They are historical evidence, not current acceptance or production readiness. The [historical report archive](archive/README.md) collects superseded PR reports, handoffs and explorations; do not treat archived instructions as the current queue.

## Maintenance rules

Update [project status](PROJECT_STATUS.md) for material implementation/evidence changes and [next steps](NEXT_STEPS.md) when dependencies or acceptance criteria change. Put each technical invariant in one focused contract and link to it; do not duplicate a PR diary across guides.

Use **Verified** for inspectable source/test evidence, **User-confirmed** for attributed owner decisions/observations, **Hypothesis** for unproven explanations and **Open** for unresolved work. Preserve dates and source revisions. When documents conflict, use the newest dated status evidence, the focused technical contract for behavior, and [AGENTS.md](../AGENTS.md) for permissions. Flag and fix stale summaries rather than silently combining them.
