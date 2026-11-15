# Finance Tracker

[Open the deployed application](https://aerovega.github.io/finance-tracker/)

A second-generation personal finance tracker built around trustworthy financial data, transparent calculations, and privacy-first handling.

**Product target:** minimum coherent v1.0.0 on January 1, 2027, subject to correctness, privacy, recovery, and owner-acceptance gates. See [the product definition](docs/PRODUCT_DEFINITION.md).

> **Public repository:** never commit real financial records, account exports, statements, credentials, tokens, or production secrets.

## Current state

The authoritative implementation and authorization snapshot is [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md), checked against `main` at `be43951a7b4a09c8e54c1984b1fb41dc39401636` on November 14, 2026.

PR #37 (incremental storage), PR #38 (mobile/tablet workspace), and PR #40 (privacy-safe diagnostics) are merged. Financial position and reconciled coverage were implemented in PR36. The application writes canonical v5 and refuses older canonical copies without migration or overwrite. Full ledger/history materialization and semantic validation remain; v5 does not establish bounded whole-database memory or selective loading.

Node CI passed on the current main SHA. The initial Pages push workflow failed, then a manual deployment and Pages build/deployment completed successfully. The served SHA has not been independently checked. Physical Apple-device and current live Google Drive acceptance remain open.

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
- [Canonical v5 storage contract](docs/PARTITIONED_CANONICAL_STORAGE.md) and [storage terminology](docs/STORAGE_TERMINOLOGY.md).
- [Database identity/lifecycle](docs/DATABASE_IDENTITY_AND_LIFECYCLE.md), [session coordination](docs/SESSION_COORDINATION.md), and [transaction recovery](docs/TRANSACTION_STAGING_AND_RECOVERY.md).
- [Security](docs/SECURITY.md), [backup/restore](docs/DRIVE_BACKUP_AND_RESTORE.md), and [application diagnostics](docs/APP_DIAGNOSTICS.md).

## Engineering workflow

Use a focused branch and pull request. Never push directly to `main`, force-push, or merge without explicit authorization. Keep real financial data out of GitHub and CI. Run the repository's documented tests and checks for the changed paths; distinguish implemented, verified, owner-accepted, and deployed behavior.

See [AGENTS.md](AGENTS.md) before making changes.
