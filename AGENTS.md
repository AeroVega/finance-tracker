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

## GitHub Pages and PWA engineering guardrails
Apply these checks when implementation or release work is authorized; they do not override the current-phase restrictions below.

### Discovery and deployment
- Before editing, inspect the repository structure, this file and any nested instructions, relevant documentation, current branches/PRs, workflows, Pages configuration assumptions, and recent changes that explain current behavior.
- Do not replace an existing architecture or working behavior without understanding why it exists and documenting the reason for a change.
- Treat deployment as a first-class requirement. Verify the workflow trigger, permissions, artifact contents, publishing configuration, deployed URL/path, workflow result, and live site. A push or commit does not prove that a deployment started or succeeded.
- When a Pages workflow is added or changed, identify any required repository Settings action that code cannot perform, and state it explicitly rather than implying deployment is complete.

### Incremental changes and regression control
- Plan acceptance criteria and likely regression risks before substantial changes. Make small, focused changes and inspect the full diff.
- Run lightweight, deterministic checks appropriate to the change: JavaScript syntax, structured-data validation, required assets/paths, and project-specific financial invariants where applicable.
- Test the changed behavior and nearby functionality. Prioritize parser correctness, duplicate reconciliation, data provenance, financial calculations, import errors, privacy boundaries, and recovery paths.
- Never equate a green workflow, successful commit, or successful deployment with a fully verified application.

### Mobile usability and accessibility
- Treat iPhone and iPad as primary platforms. Check narrow and wide layouts, portrait/landscape where supported, navigation, safe-area insets, viewport changes, overflow, card spacing, touch targets, and long or missing content.
- A desktop screenshot is not evidence of correct mobile behavior. Test on real devices when possible, particularly for Safari/WebKit-specific behavior.
- Use semantic HTML, logical headings, keyboard access and visible focus, meaningful control labels, sufficient contrast, text resizing, and reduced-motion support when relevant.
- Inspect surrounding layouts after visual/CSS changes; avoid accumulating contradictory overrides or fixing one viewport at the expense of another.

### Service workers and offline behavior
- Do not add a service worker, offline mode, install prompt, or offline toggle just because another project had one. First establish a real user need and the required freshness guarantees for financial data.
- If a service worker is introduced, document its caching/update strategy and test first install, repeat launch, new deployments, offline startup, unavailable cached data, recovery after reconnection, and old-client/new-asset compatibility.
- Keep cache/build versions traceable and consistent where appropriate. Do not manually replace generated build placeholders when automated stamping is the source of truth.
- Never let cached or stale financial information appear current without an explicit freshness signal.

### Definition of done and handoff
For each significant change, report what changed and why, the checks actually run and their results, the diff/PR status, deployment status, known limitations, and remaining work. Clearly distinguish **implemented**, **validated**, and **deployed and verified**. Mark unmet acceptance criteria as outstanding rather than claiming completion.

## Current phase
This is a documentation and discovery phase. Do not begin production implementation until data access, private storage, authentication, privacy, deployment, and backup/recovery architecture is documented and reviewed. Do not modify the archived `Finances.xlsx` workbook.
