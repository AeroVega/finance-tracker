# Security and Privacy Requirements

**Status:** Required baseline  
**Last updated:** 2026-10-10

## Objective
Keep personal financial records private while allowing the owner to import, review, analyze, and recover them. Security is an MVP1 requirement.

## Public repository rules
Treat all committed content, branches, issues, pull requests, workflow output, and Git history as potentially public. Never commit:
- Real transaction CSVs, statements, account exports, or holdings.
- Real balances, income, spending, net worth, account identifiers, or other identifying financial details.
- Passwords, access tokens, API keys, private keys, cookies, database credentials, or production environment files.
- Logs, screenshots, fixtures, or bug reports containing sensitive data.

Synthetic fixtures must be deliberately authored with invented values. Do not create them by copying a real export and replacing only amounts. Keep owner-provided samples outside this public repository by default.

## GitHub Pages boundary
GitHub Pages serves public static content. Never publish private ledger records as JSON, CSV, JavaScript constants, reports, or downloadable assets. Obfuscation, minification, hiding links, or shipping an encryption key in the same frontend does not make data private. Anything delivered to a browser must be treated as visible to the user and potentially extractable.

Any separate backend/storage must enforce authentication and authorization independently. The public repository is not a private data store.

## Import handling
- Prefer local parsing of user-selected files unless an approved design requires transmission.
- Document any transfer and protect it in transit.
- Validate file structure, dates, amounts, and row types; treat CSV contents as untrusted input.
- Never execute imported values as code or HTML.
- Avoid retaining raw imports longer than necessary; retention policy remains open.
- Do not log full rows, account identifiers, or sensitive amounts by default.
- Show import errors without leaking sensitive details to public logs.

## Credentials and integrations
Never store bank passwords or use unauthorized scraping. Verify production authorization and terms. If an approved backend requires secrets, keep them server-side in an appropriate secret store. Define revocation and incident response before enabling direct integrations.

## Required decisions before production
Authentication/session management; private storage and access control; encryption; retention/deletion; backup location and restore procedure; logs/telemetry; device-loss and compromise response; export strategy; third-party terms and total cost.

## Secret exposure response
1. Stop changes that may spread the exposure and notify the owner.
2. Revoke/rotate exposed credentials promptly, where applicable.
3. Assess Git history, forks, caches, artifacts, and logs; a deletion commit alone is insufficient.
4. Document remediation without repeating the exposed data.

## Release review
Verify that no real financial data or secrets exist in tracked files, diffs, assets, fixtures, logs, or workflow artifacts; no frontend bundle contains private data or privileged credentials; approved storage enforces access controls; backups restore successfully; and stale/incomplete data is not presented as current.
