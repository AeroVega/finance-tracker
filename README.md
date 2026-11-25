# Finance Tracker

[Open the deployed application](https://aerovega.github.io/finance-tracker/)

A second-generation personal finance tracker built around trustworthy financial data, transparent calculations, and privacy-first handling.

**Product target:** minimum coherent v1.0.0 on January 1, 2027, subject to correctness, privacy, recovery, and owner-acceptance gates. See [the product definition](docs/PRODUCT_DEFINITION.md).

> **Public repository:** never commit real financial records, account exports, statements, credentials, tokens, or production secrets.

## Current state

The owner declared the project **GO for real financial data** when [PR 61](https://github.com/AeroVega/finance-tracker/pull/61) merged. The release profile now lists the `production` data class, so Private database mode is available in the served build. Synthetic remains the default. Verify the deployed build and profile before entering real records. [Current state](docs/CURRENT_STATE.md) holds the details, evidence and permission boundary.

**Storage:** full-snapshot v1. Each save writes one complete immutable ledger snapshot with verified publication and recovery. Older formats are unsupported and are not converted or deleted. Supported CSV import (Wells Fargo, SoFi, Fidelity) and encrypted portable backup and restore are implemented. Financial position and reconciled coverage were implemented in PR36. The whole ledger loads and validates on open; no bounded-memory claim is made.

CI, deployment identity, owner acceptance and production approval are separate facts. Development, CI and public artifacts use invented data only. Never put real financial records in this repository. See [project history](docs/PROJECT_STATUS.md) for the milestone timeline.

## Start here

- [Agent quick start](docs/AGENT_QUICK_START.md) — minimal reading order and source-of-truth rules.
- [Current project state](docs/CURRENT_STATE.md) — current main baseline, evidence, open gates, and permissions.
- [Documentation map](docs/README.md) — find only the relevant contract.
- [Next steps](docs/NEXT_STEPS.md) — current priorities and acceptance gates.
- [Project history](docs/PROJECT_STATUS.md) — dated milestone timeline, not a second current-state summary.
- [Contributor and agent instructions](AGENTS.md) — mandatory privacy, Git, and engineering rules.

## Core technical references

- [Canonical workspace](docs/CANONICAL_MAIN_WORKSPACE.md) and [canonical ledger contract](docs/CANONICAL_LEDGER_CONTRACT.md).
- [Financial position](docs/FINANCIAL_POSITION.md) and [data model](docs/DATA_MODEL.md).
- [Provider import specifications](docs/PROVIDER_IMPORT_SPECS.md) and [import contract](docs/CANONICAL_IMPORT.md).
- [Full-snapshot storage contract](docs/FULL_SNAPSHOT_STORAGE.md) and [storage terminology](docs/STORAGE_TERMINOLOGY.md).
- [Session coordination](docs/SESSION_COORDINATION.md), [Drive response bounds](docs/DRIVE_RESPONSE_BOUNDS.md), and [simulator coverage](docs/DRIVE_SIMULATOR.md).
- [Security](docs/SECURITY.md) and [application diagnostics](docs/APP_DIAGNOSTICS.md).

## Engineering workflow

Use a focused branch and pull request. Never push directly to `main`, force-push, or merge without explicit authorization. Keep real financial data out of GitHub and CI. Run the repository's documented tests and checks for the changed paths; distinguish implemented, verified, owner-accepted, and deployed behavior.

See [AGENTS.md](AGENTS.md) before making changes.
