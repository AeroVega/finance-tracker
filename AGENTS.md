# Contributor and Agent Instructions

Read `README.md`, this file, and relevant `docs/` files before changing the project.

## Git workflow
- Work on a focused branch and submit a pull request into `main`.
- Never push directly to `main`, force-push, rewrite shared history, or merge without explicit authorization.
- Inspect diffs and report changes, tests, and unresolved risks.

## Public-repository privacy
This repository is public. Never commit real transaction CSVs, statements, account exports, holdings, balances, financial summaries, account identifiers, passwords, tokens, private keys, database credentials, cookies, or production environment files. Treat logs, screenshots, workflow output, issues, pull requests, branches, and Git history as potentially public too.

Do not assume deleting a sensitive file in a later commit removes earlier copies. If a secret is exposed, stop, notify the project owner, and recommend immediate revocation/rotation and history remediation.

Use deliberately synthetic test fixtures authored with invented data. Do not copy real exports and merely replace amounts; descriptions and other fields can still identify a person or account. Keep user-provided sanitized samples outside the repository by default.

## Architecture guardrails
- Prefer a modular static HTML/CSS/JavaScript frontend hosted on GitHub Pages; do not add frameworks/build systems without an explicit decision.
- GitHub Pages is public static hosting, not a private database or secret store.
- Never put private records or privileged credentials in frontend code or public assets.
- Do not choose a backend, database, authentication provider, or financial API before reviewing security, cost, sustainability, backups/recovery, and portability.
- No recurring costs; free trials and development sandboxes do not qualify as sustainable free production.
- No stored bank passwords or unauthorized scraping.
- MVP1 is file imports. MVP2 may investigate free, authorized direct integrations. Keep file imports permanently.
- Prefer deterministic, inspectable categorization rules and a review queue over AI as a default categorizer.

## Data correctness
- Preserve source descriptions, stable identifiers where available, and import provenance.
- Re-imports and overlapping exports must not silently duplicate transactions.
- Explicitly handle pending-to-posted transitions, corrections, and incomplete history.
- Track import coverage/freshness; never present stale or incomplete data as fully current.
- Internal transfers are not income or spending. Do not double-count credit-card purchases and payments.
- Separate investment contributions, trades, fees, dividends, and market-value changes from ordinary spending.
- Unavailable data is not zero. Do not fabricate historical figures.

## Documentation
Label claims as **Verified**, **User-confirmed**, **Hypothesis**, or **Open**. Use primary-source URLs for provider claims and recheck time-sensitive terms. Update decision records when choices change.

## Current phase
This is a documentation and discovery phase. Do not begin production implementation until data access, private storage, authentication, privacy, deployment, and backup/recovery architecture is documented and reviewed. Do not modify the archived `Finances.xlsx` workbook.
