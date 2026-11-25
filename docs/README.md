# Documentation map

Start with [Agent quick start](AGENT_QUICK_START.md), then read [current project state](CURRENT_STATE.md). This index is a map, not a reading checklist: open only the contracts relevant to the code or decision being worked on.

## Authority and reading order

1. [Current state](CURRENT_STATE.md) — concise active branch/main status and permission boundary.
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
- [Posting-status corrections](POSTING_STATUS_CORRECTIONS.md) — auditable posting-state correction events.

## Storage, persistence, and recovery

- [Full-snapshot storage](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md) — selected application format, authority, verification, recovery and bounds.
- [Drive simulator](DRIVE_SIMULATOR.md) — repeatable synthetic provider/authentication scenarios, performance measurements and explicit emulation limits.
- [Storage terminology](STORAGE_TERMINOLOGY.md) — active format versus historical version namespaces.
- [Account/session privacy](PRIVACY_SESSION.md) — designated-account checks, transactional folder selection, privacy close, and browser retention limitations.
- [Session coordination](SESSION_COORDINATION.md), [Drive response bounds](DRIVE_RESPONSE_BOUNDS.md), [Google Drive configuration](GOOGLE_DRIVE_CONFIGURATION.md), and [security](SECURITY.md) — retained shared safety/provider boundaries.
- Portable backup/restore and supported file ingestion remain requirements, not available features of the selected route.

### Historical storage design references

The following preserve rationale and earlier invariants; they do not describe a second supported application format: [partitioned canonical storage](PARTITIONED_CANONICAL_STORAGE.md), [database identity/lifecycle](DATABASE_IDENTITY_AND_LIFECYCLE.md), [application storage lifecycle](APPLICATION_STORAGE_LIFECYCLE.md), [ledger session](LEDGER_SESSION.md), [transaction staging/recovery](TRANSACTION_STAGING_AND_RECOVERY.md), [root protocol](ROOT_TRANSACTION_PROTOCOL.md), [immutable page tree](IMMUTABLE_PAGE_TREE.md), [segmented locator catalog](SEGMENTED_LOCATOR_CATALOG.md), [canonical month index](CANONICAL_MONTH_INDEX.md), [backup/restore](DRIVE_BACKUP_AND_RESTORE.md), [framed archives](FRAMED_BACKUP_STREAM.md), [source retention](ORIGINAL_SOURCE_RETENTION.md), and [earlier private-storage architecture](PRIVATE_STORAGE_ARCHITECTURE.md).

## Interface, diagnostics, and quality

- [Interface design](DESIGN.md) — current navigation, workspace status, tokens and components.
- [Mobile UI design](MOBILE_UI_DESIGN.md), [mobile workspace pages](MOBILE_WORKSPACE_PAGES.md), and [Apple web app](APPLE_WEB_APP.md) — earlier interface rationale and device-specific behavior.
- [Application diagnostics](APP_DIAGNOSTICS.md) and [error codes](ERROR_CODES.md) — privacy-safe error reporting and registered codes.
- [Testing](TESTING.md) and [owner acceptance](OWNER_ACCEPTANCE.md) — automated checks and manual acceptance boundaries.
- [Save request measurements](ACTIVE_SAVE_REQUESTS.md) and [application testing feedback](APP_TESTING_FEEDBACK.md) — historical optimization rationale and user-facing follow-up.

## Research, experiments, and evidence

Provider feasibility, Drive experiments, CPU measurements, synthetic probes, and PR-specific reviews are evidence—not active instructions by default. Use their dates, source revisions, and limitations when relevant. Superseded reports and explorations are collected in [archive](archive/README.md).

## Maintenance rules

- Update CURRENT_STATE.md when the current `main` baseline or authorization changes.
- Update NEXT_STEPS.md only when project priorities or acceptance gates change.
- Update the focused contract when implementation behavior changes; do not put detailed invariants in this index.
- Keep PROJECT_STATUS.md as a dated evidence log. Do not copy its entire history into README or agent entry points.
- Preserve meaningful historical rationale, but archive superseded reports rather than leaving competing instructions in the active reading path.
- Use **Verified**, **User-confirmed**, **Hypothesis**, and **Open** accurately. A merged PR, green CI, owner acceptance, and successful deployment are distinct facts.
