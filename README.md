# Finance Tracker

[Open the deployed application](https://aerovega.github.io/finance-tracker/)

A second-generation personal finance tracker built around trustworthy financial data, transparent calculations, and privacy-first handling.

**Product target:** minimum coherent v1.0.0 on January 1, 2027, subject to correctness, privacy, recovery, and owner-acceptance gates. See [the product definition](docs/PRODUCT_DEFINITION.md).

> **Public repository:** never commit real financial records, account exports, statements, credentials, tokens, or production secrets.

## Current state

**Selected storage format:** full-snapshot v1. Dashboard and workspace use complete immutable ledger snapshots with verified publication and recovery. The owner accepted a synthetic 11-second open and 25-second persisted save on `86d1f2b`, then requested cleanup and merge of PR46. Cleanup is not yet merged; see [current state](docs/CURRENT_STATE.md) for exact evidence and authorization.

Use a fresh empty synthetic folder for creation. Older storage formats are unsupported and are not converted or deleted. Import and portable backup/restore for this format remain outstanding Alpha requirements. Financial position and reconciled coverage were implemented in PR36. Full ledger/history materialization and validation remain; no bounded whole-database memory claim is made.

CI, deployment identity, owner acceptance and production approval are separate. Historical implementation and measurement evidence remains in [project status](docs/PROJECT_STATUS.md).

**Production financial-data persistence is NO-GO.** Use invented fixtures only. Do not access real financial records, the private workbook, or owner Drive data. Merge, deployment, production configuration, and real-data use require their separate authorization.

## Start here

- [Agent quick start](docs/AGENT_QUICK_START.md) — minimal reading order and source-of-truth rules.
- [Current project state](docs/CURRENT_STATE.md) — current main baseline, evidence, open gates, and permissions.
- [Documentation map](docs/README.md) — find only the relevant contract.
- [Next steps](docs/NEXT_STEPS.md) — current priorities and acceptance gates.
- [Project status evidence log](docs/PROJECT_STATUS.md) — dated implementation history, not a second current-state summary.
- [Contributor and agent instructions](AGENTS.md) — mandatory privacy, Git, and engineering rules.

## Core technical references

- [Canonical workspace](docs/CANONICAL_MAIN_WORKSPACE.md) and [canonical ledger contract](docs/CANONICAL_LEDGER_CONTRACT.md).
- [Financial position](docs/FINANCIAL_POSITION.md) and [data model](docs/DATA_MODEL.md).
- [Provider import specifications](docs/PROVIDER-IMPORT-SPECS.md) and [import contract](docs/PR28_CANONICAL_IMPORT.md).
- [Full-snapshot storage contract](docs/EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md) and [storage terminology](docs/STORAGE_TERMINOLOGY.md).
- [Session coordination](docs/SESSION_COORDINATION.md), [Drive response bounds](docs/DRIVE_RESPONSE_BOUNDS.md), and [simulator coverage](docs/DRIVE_SIMULATOR.md).
- [Security](docs/SECURITY.md) and [application diagnostics](docs/APP_DIAGNOSTICS.md).

## Engineering workflow

Use a focused branch and pull request. Never push directly to `main`, force-push, or merge without explicit authorization. Keep real financial data out of GitHub and CI. Run the repository's documented tests and checks for the changed paths; distinguish implemented, verified, owner-accepted, and deployed behavior.

See [AGENTS.md](AGENTS.md) before making changes.
