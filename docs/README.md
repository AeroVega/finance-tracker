# Documentation map

Start with [Agent quick start](AGENT_QUICK_START.md), then read [current project state](CURRENT_STATE.md). This index is a map, not a reading checklist: open only the contracts relevant to the code or decision being worked on.

## Authority and reading order

1. [Current state](CURRENT_STATE.md) — concise, current `main` snapshot and permission boundary.
2. [Contributor/agent instructions](../AGENTS.md) — mandatory privacy, Git, and engineering rules.
3. [Next steps](NEXT_STEPS.md) — active project priorities and acceptance gates.
4. One or more focused contracts below.
5. [Project status evidence log](PROJECT_STATUS.md) — detailed dated implementation and verification history. Historical sections describe only their named revisions.

## Project direction

| Document | Owns |
| --- | --- |
| [Project charter](PROJECT_CHARTER.md) | Mission, constraints, and governing project principles |
| [Product definition](PRODUCT_DEFINITION.md) | Product vision and owner-confirmed v1.0.0 scope |
| [Roadmap](ROADMAP.md) | Alpha → Beta → 1.0.0 → 2.0.0 progression |
| [Open product decisions](PRODUCT_OPEN_DECISIONS.md) | Unresolved owner/product choices |
| [Architecture decisions](ARCHITECTURE_DECISIONS.md) | Technical decision record and rationale |

## Application and financial behavior

- [Canonical main workspace](CANONICAL_MAIN_WORKSPACE.md) — user-facing ledger workflow and corrections.
- [Canonical ledger contract](CANONICAL_LEDGER_CONTRACT.md) and [data model](DATA_MODEL.md) — financial meaning, identity, and provenance.
- [Financial position](FINANCIAL_POSITION.md) — dated balances, holdings, liabilities, and reconciliation.
- [Provider import specifications](PROVIDER-IMPORT-SPECS.md) and [PR28 canonical import](PR28_CANONICAL_IMPORT.md) — supported source formats, parsing, coverage, and reconciliation.
- [Category rule scoping](CATEGORY_RULE_SCOPING.md) — deterministic categorization behavior.

## Storage, persistence, and recovery

- [Partitioned canonical storage](PARTITIONED_CANONICAL_STORAGE.md) — active canonical v5 format and compatibility/refusal contract.
- [Storage terminology](STORAGE_TERMINOLOGY.md) — distinct version namespaces and verification vocabulary.
- [Database identity and lifecycle](DATABASE_IDENTITY_AND_LIFECYCLE.md) and [application storage lifecycle](APPLICATION_STORAGE_LIFECYCLE.md) — database authority, session and application lifecycle.
- [Session coordination](SESSION_COORDINATION.md), [ledger session](LEDGER_SESSION.md), and [transaction staging/recovery](TRANSACTION_STAGING_AND_RECOVERY.md) — single-active-session and safe-write behavior.
- [Root transaction protocol](ROOT_TRANSACTION_PROTOCOL.md), [immutable page tree](IMMUTABLE_PAGE_TREE.md), [segmented locator catalog](SEGMENTED_LOCATOR_CATALOG.md), [canonical month index](CANONICAL_MONTH_INDEX.md), and [Drive response bounds](DRIVE_RESPONSE_BOUNDS.md) — physical publication and bounded subsystem contracts.
- [Backup and restore](DRIVE_BACKUP_AND_RESTORE.md), [framed backup stream](FRAMED_BACKUP_STREAM.md), and [original-source retention](ORIGINAL_SOURCE_RETENTION.md) — portability, verification, and retention.
- [Private storage architecture](PRIVATE_STORAGE_ARCHITECTURE.md), [Google Drive configuration](GOOGLE_DRIVE_CONFIGURATION.md), and [security](SECURITY.md) — privacy and provider boundaries.

## Interface, diagnostics, and quality

- [Mobile UI design](MOBILE_UI_DESIGN.md), [mobile workspace pages](MOBILE_WORKSPACE_PAGES.md), and [Apple web app](APPLE_WEB_APP.md) — interface design and device-specific behavior.
- [Application diagnostics](APP_DIAGNOSTICS.md) and [error codes](ERROR_CODES.md) — privacy-safe error reporting and registered codes.
- [Testing](TESTING.md) and [owner acceptance](OWNER_ACCEPTANCE.md) — automated checks and manual acceptance boundaries.

## Research, experiments, and evidence

Provider feasibility, Drive experiments, CPU measurements, synthetic probes, and PR-specific reviews are evidence—not active instructions by default. Use their dates, source revisions, and limitations when relevant. Superseded reports and explorations are collected in [archive](archive/README.md).

## Maintenance rules

- Update CURRENT_STATE.md when the current `main` baseline or authorization changes.
- Update NEXT_STEPS.md only when project priorities or acceptance gates change.
- Update the focused contract when implementation behavior changes; do not put detailed invariants in this index.
- Keep PROJECT_STATUS.md as a dated evidence log. Do not copy its entire history into README or agent entry points.
- Preserve meaningful historical rationale, but archive superseded reports rather than leaving competing instructions in the active reading path.
- Use **Verified**, **User-confirmed**, **Hypothesis**, and **Open** accurately. A merged PR, green CI, owner acceptance, and successful deployment are distinct facts.
