# Documentation guide

Start with [project status](PROJECT_STATUS.md) for what exists and what has actually been checked. Then use [next steps](NEXT_STEPS.md) for the work needed to finish Alpha.

Production financial-data persistence remains **NO-GO**. Merged code, green tests and a public Pages deployment are separate facts; none grants permission to use real financial data.

## Current planning and acceptance

| Document | Purpose |
| --- | --- |
| [Project status](PROJECT_STATUS.md) | Dated main/PR/CI snapshot, capability gaps and evidence limits. |
| [Next steps](NEXT_STEPS.md) | Four-step Alpha sequence, dependencies and measurable completion checks. |
| [Roadmap](ROADMAP.md) | Alpha, Beta and conditional January 1, 2027 v1.0.0 scope. |
| [Product definition](PRODUCT_DEFINITION.md) | Owner-confirmed product requirements, including monthly history. |
| [Open decisions](PRODUCT_OPEN_DECISIONS.md) | Stable question IDs, remaining owner choices and deferred work. |
| [Owner acceptance](OWNER_ACCEPTANCE.md) | Current manual checks, supported storage formats and known checklist drift. |
| [Security](SECURITY.md) and [production persistence plan](PR27_PRODUCTION_PERSISTENCE_PROPOSAL.md) | Required controls and the separate production authorization gate. |

## Implementation contracts

- [Canonical main workspace](CANONICAL_MAIN_WORKSPACE.md): saved-year browsing, corrections, fresh-preview saves, transfer links and failure behavior.
- [Canonical ledger](CANONICAL_LEDGER_CONTRACT.md), [data model](DATA_MODEL.md), [provider formats](PROVIDER-IMPORT-SPECS.md) and [PR28 import](PR28_CANONICAL_IMPORT.md): financial meaning, import provenance and reconciliation.
- [Database identity and lifecycle](DATABASE_IDENTITY_AND_LIFECYCLE.md), [application lifecycle](APPLICATION_STORAGE_LIFECYCLE.md), [transaction recovery](TRANSACTION_STAGING_AND_RECOVERY.md) and [session coordination](SESSION_COORDINATION.md): storage authority and safe writes.
- [Fragmented canonical storage](FRAGMENTED_CANONICAL_STORAGE.md): current synthetic format policy. New stores use v3; per-record v1 remains readable; standalone grouped v2 is rejected. These layout versions are separate from storage-manifest/catalog version numbers.
- [Backup and restore](DRIVE_BACKUP_AND_RESTORE.md), [original-source retention](ORIGINAL_SOURCE_RETENTION.md) and [Google configuration](GOOGLE_DRIVE_CONFIGURATION.md): operational requirements and remaining production checks.
- [Architecture decisions](ARCHITECTURE_DECISIONS.md) and [project charter](PROJECT_CHARTER.md): constraints and accepted direction.

## Evidence and history

[Synthetic storage acceptance](SYNTHETIC_STORAGE_ACCEPTANCE.md), [PR28 evidence](PR28_CANONICAL_IMPORT.md), [PR29 visual work](PR29_VISUAL_OVERHAUL.md), [PR30 performance integration](PR30_PERFORMANCE_INTEGRATION.md), and the linked CPU/storage reports describe bounded checks on specific revisions. Their measurements do not establish present-day device acceptance or production readiness. [Prototype cleanup](PROTOTYPE_CLEANUP.md) records retired tools and preserved diagnostics.

The [archived November 8 handoff](archive/NEXT_STEPS_2026-11-08.md) retains earlier decisions and interim status. The [modern UI exploration](archive/MODERN_UI_EXPLORATION.md) is historical. Do not treat historical instructions as the current queue.

## Keep these documents current

For each completed change, update project status with the reviewed commit, PR state, checks actually run and remaining limits. Update next steps when a dependency or completion condition changes. Put changed product decisions in the product definition/open-decision register and changed technical decisions in the appropriate contract. Keep test, owner observation, merge, deployment and production authorization separate. Do not copy a growing PR diary into every guide.

Use **Verified** for inspectable source or test evidence, **User-confirmed** for an attributed owner observation or decision, **Hypothesis** for an unproven explanation, and **Open** for unresolved work. Preserve the original date and source when carrying evidence forward.
