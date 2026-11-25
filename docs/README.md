# Documentation map

Start with the [agent quick start](AGENT_QUICK_START.md), then [current state](CURRENT_STATE.md). This index is a map, not a reading list: open only the contracts your work touches.

## Authority

When documents disagree, resolve it at the source instead of adding another summary.

| Question | Authority |
| --- | --- |
| Current status and permissions | [Current state](CURRENT_STATE.md), then [AGENTS.md](../AGENTS.md) |
| Active priorities and acceptance gates | [Next steps](NEXT_STEPS.md) |
| Module and format invariants | The focused contract below |
| What happened earlier | [Project history](PROJECT_STATUS.md) and the [archive](archive/README.md) |

## Project direction

| Document | Owns |
| --- | --- |
| [Project charter](PROJECT_CHARTER.md) | Mission, constraints, governing principles |
| [Product definition](PRODUCT_DEFINITION.md) | Product vision and the owner-confirmed v1.0.0 scope |
| [Roadmap](ROADMAP.md) | Alpha → Beta → 1.0.0 → 2.0.0 |
| [Open product decisions](PRODUCT_OPEN_DECISIONS.md) | Unresolved owner and product choices |
| [Architecture decisions](ARCHITECTURE_DECISIONS.md) | Technical decision record and rationale |
| [Data sources](DATA_SOURCES.md) | Research on financial data sources and import strategy |

## Financial behavior

| Document | Owns |
| --- | --- |
| [Canonical ledger contract](CANONICAL_LEDGER_CONTRACT.md) | Financial meaning, identity, provenance |
| [Data model](DATA_MODEL.md) | Record shapes |
| [Financial position](FINANCIAL_POSITION.md) | Dated balances, holdings, liabilities, reconciliation |
| [Historical monthly summary](HISTORICAL_MONTHLY_SUMMARY.md) | Normalized monthly history from the legacy workbook |
| [Canonical import](CANONICAL_IMPORT.md) | Import pipeline, reconciliation, coverage |
| [Provider import specs](PROVIDER_IMPORT_SPECS.md) | Wells Fargo, SoFi and Fidelity formats |
| [Provider CSV import workflow](PROVIDER_CSV_IMPORT_WORKFLOW.md), [preview](PROVIDER_CSV_PREVIEW.md), [coverage selector](IMPORT_COVERAGE_SELECTOR.md) | The supported application import path |
| [Category rule scoping](CATEGORY_RULE_SCOPING.md) | Deterministic categorization |
| [Posting-status corrections](POSTING_STATUS_CORRECTIONS.md) | Auditable posting-state events |
| [Canonical month index](CANONICAL_MONTH_INDEX.md) | Account/month lookup and monthly summaries |
| [CPU performance](CPU_PERFORMANCE.md) | In-memory optimizations, invariants, benchmarks |

## Storage, sessions and security

| Document | Owns |
| --- | --- |
| [Full-snapshot storage](FULL_SNAPSHOT_STORAGE.md) | The one supported format: authority, verification, recovery, bounds |
| [Backup and recovery](FULL_SNAPSHOT_BACKUP_RECOVERY.md) | Encrypted portable backup and restore |
| [Persistence data class](PERSISTENCE_DATA_CLASS.md) | Synthetic versus production release gate |
| [Storage terminology](STORAGE_TERMINOLOGY.md) | Active format versus retired version names |
| [Privacy and session](PRIVACY_SESSION.md), [session coordination](SESSION_COORDINATION.md) | Designated-account checks, ownership, release |
| [Drive response bounds](DRIVE_RESPONSE_BOUNDS.md), [Google Drive configuration](GOOGLE_DRIVE_CONFIGURATION.md), [Google Cloud setup](GOOGLE_CLOUD_SETUP.md) | Provider boundaries and setup |
| [Security](SECURITY.md), [security and cost review](SECURITY_AND_COST_REVIEW.md) | Security posture and the dated pre-approval review |
| [Drive simulator](DRIVE_SIMULATOR.md), [Drive transaction engine testing](DRIVE_TRANSACTION_ENGINE_TESTING.md) | Synthetic provider scenarios and their limits |

## Interface

| Document | Owns |
| --- | --- |
| [Design](DESIGN.md) | Current navigation, tokens, components and the Activity surface |
| [Product summary](PRODUCT.md) | Short product record for design tooling; links to the authorities above |
| [Canonical main workspace](CANONICAL_MAIN_WORKSPACE.md) | Ledger workflow, corrections and workspace checks |
| [Mobile UI design](MOBILE_UI_DESIGN.md), [mobile workspace pages](MOBILE_WORKSPACE_PAGES.md), [Apple web app](APPLE_WEB_APP.md) | Mounted-page architecture and device behavior. Visual decisions are superseded by Design. |
| [Visualization and investigation design](VISUALIZATION_AND_INVESTIGATION_DESIGN.md) | Owner-confirmed direction for future charts, not an implementation contract |
| [Success metrics](SUCCESS_METRICS.md) | Tab-local summary of the last successful storage action |

## Quality and operations

| Document | Owns |
| --- | --- |
| [Testing](TESTING.md) | Automated checks and commands |
| [Guarded code](GUARDED_CODE.md) | Required checks and owner-merge rule for safeguard-affecting changes |
| [Owner acceptance (archived)](archive/OWNER_ACCEPTANCE_2026-11-24.md) | Historical pre-GO checklist, superseded 2026-11-24 |
| [Synthetic data](SYNTHETIC_DATA.md) | The invented-year recipe |
| [Application diagnostics](APP_DIAGNOSTICS.md), [error codes](ERROR_CODES.md) | Privacy-safe reports and registered codes (the code list is generated) |
| [Guarded code](GUARDED_CODE.md) | Which paths need extra verification |

## Archive

[Archive](archive/README.md) holds retired storage designs, performance experiments, and PR and probe reports. Treat them as evidence with dates and source revisions, never as instructions.

## Maintenance rules

- Update CURRENT_STATE.md when the `main` baseline or authorization changes. Update NEXT_STEPS.md only when priorities or gates change.
- Update the focused contract when behavior changes. Keep detailed invariants out of this index.
- Link to status instead of copying it. Put each measurement next to its dated evidence.
- Move a superseded report to the archive when it still has historical value. Otherwise delete it.
- Use **Verified**, **User-confirmed**, **Hypothesis** and **Open** exactly. A merge, green CI, owner acceptance and a deployment are distinct facts.
