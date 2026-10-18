# Finance Tracker

A second-generation personal finance tracker built around trustworthy data, transparent calculations, and privacy-first handling of financial information.

**North Star:** a dependable personal finance dashboard for iPhone and iPad. Target MVP date: **January 1, 2027**.

> **Privacy warning:** This repository is public. Never commit real financial data, account exports, statements, credentials, access tokens, or production secrets. Assume everything committed here can be read by anyone.

## Project status

MVP1 uses user-provided CSV imports. Google Drive is the **selected private-storage direction**, pending verification of OAuth setup, synchronization/recovery behavior, current production terms, and the $0 recurring-cost requirement. No production financial data or secrets belong in this repository. Free, authorized direct financial-institution integrations remain an MVP2 research goal, not a dependency for the first release.

## Start here

- [Project charter](docs/PROJECT_CHARTER.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture decisions and open questions](docs/ARCHITECTURE_DECISIONS.md)
- [Private storage architecture](docs/PRIVATE_STORAGE_ARCHITECTURE.md)
- [Security and privacy requirements](docs/SECURITY.md)
- [Data-source research](docs/DATA_SOURCES.md)
- [Data model and reconciliation principles](docs/DATA_MODEL.md)
- [Contributor and agent instructions](AGENTS.md)

## Non-negotiable constraints

1. No recurring costs for hosting, storage, aggregation, refresh, or AI.
2. No real personal financial data or secrets in this public repository.
3. No stored bank passwords, unauthorized scraping, or reliance on expiring trials.
4. Manual file imports remain a permanent fallback.
5. Do not enable production financial-data storage until data access, storage, authentication, synchronization, recovery, and security have been implemented and reviewed.
6. Distinguish verified facts, user-confirmed observations, hypotheses, and open questions.

## Working approach

Use focused branches and pull requests. Do not push directly to `main`, force-push, rewrite shared history, or merge without explicit authorization. Update documentation when decisions change.

No license has been selected. Until one is added, do not assume the project grants permission to reuse its code.
