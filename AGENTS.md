# Contributor and Agent Instructions

Read [the agent quick start](docs/AGENT_QUICK_START.md) first. It points to the concise [current state](docs/CURRENT_STATE.md), this file, and only the focused contracts needed for the task. Use [the documentation index](docs/README.md) to navigate; do not ingest every document by default.

## Agent workflows
Read [the engineering workflow index](engineering-workflows/README.md) when a task needs a defined workflow. Canonical skill files live in `engineering-workflows/skills/`; `.agents/skills/` exposes them for agent discovery. Skills supplement these instructions and never grant permission to merge, deploy, or use real financial data.

## Git workflow and permissions
- Work on a focused branch and submit a pull request into `main`.
- Never push directly to `main`, force-push, rewrite shared history, or merge without explicit owner authorization.
- Do not deploy, change production configuration, or activate production financial persistence without explicit authorization.
- Inspect the full diff and report changes, tests, deployment state, limitations, and unresolved risks.
- Current authorization and phase boundaries are in [CURRENT_STATE.md](docs/CURRENT_STATE.md). Recheck it before acting; historical PR descriptions do not grant current permission.

## Public-repository privacy
This repository is public. Never commit real transaction CSVs, statements, account exports, holdings, balances, financial summaries, account identifiers, passwords, tokens, private keys, database credentials, cookies, or production environment files. Treat logs, screenshots, workflow output, issues, pull requests, branches, and Git history as potentially public.

Deleting a sensitive file in a later commit does not remove earlier copies. If a secret is exposed, stop, notify the owner, and recommend immediate revocation/rotation and history remediation.

Use deliberately synthetic fixtures authored with invented data. Do not copy real exports and merely replace amounts; descriptions and other fields can still identify a person or account. Keep sanitized user-provided samples outside the repository by default.

## Architecture guardrails
- Prefer the modular static HTML/CSS/JavaScript frontend hosted on GitHub Pages. Do not add frameworks or build systems without an explicit decision.
- GitHub Pages is public static hosting, not a private database or secret store. Never put private records or privileged credentials in frontend code or public assets.
- Do not select a backend, database, authentication provider, or financial API without reviewing security, cost, sustainability, backups/recovery, and portability.
- The operating-cost constraint is $0 recurring. Free trials and development sandboxes are not sustainable free production.
- No stored bank passwords or unauthorized scraping.
- File imports are permanent product capability. MVP1 is file imports; MVP2 may investigate free, authorized direct integrations.
- Prefer deterministic, inspectable categorization rules and review over AI as a default categorizer.
- New throw sites use registered codes through `AppError`/`fail`; wrapped native errors retain `cause`. Shared reports use typed allowlisted fields, never raw errors or messages.

## Financial correctness
- Preserve source descriptions, stable identifiers where available, and import provenance.
- Re-imports and overlapping exports must not silently duplicate transactions.
- Explicitly handle pending-to-posted transitions, corrections, and incomplete history.
- Track import coverage/freshness; never present stale or incomplete data as fully current.
- Internal transfers are not income or spending. Do not double-count credit-card purchases and payments.
- Separate investment contributions, trades, fees, dividends, and market-value changes from ordinary spending.
- Unavailable data is not zero. Never fabricate historical figures.

## Documentation governance
Documentation preserves project knowledge while making current direction unambiguous:
1. Preserve meaningful decisions, rationale, constraints, lessons, and historical evidence.
2. Centralize mutable project direction in [CURRENT_STATE.md](docs/CURRENT_STATE.md). Other documents link to it instead of copying status.
3. Keep implementation truth near code or in focused technical contracts referenced by the code.
4. Separate historical context from current instructions. Archive superseded reports when they retain historical value.
5. Distinguish proposed, experimental, partially implemented, integrated, verified, owner-accepted, and deployed work.
6. Make the current state and permission boundary quick to establish.

When sources conflict, use the newest verified implementation evidence for code behavior, the focused contract for module invariants, CURRENT_STATE.md for current project status, and this file for permissions. Resolve contradictions at their source; do not add another competing summary.

Use **Verified**, **User-confirmed**, **Hypothesis**, and **Open** precisely. Preserve dates and source revisions. Recheck time-sensitive provider terms against primary sources.

## Engineering and verification
Before changing code, inspect repository structure, nested instructions, relevant contracts, recent changes, current branches/PRs, and applicable workflows. Understand existing behavior before replacing it.

For significant changes:
- Define acceptance criteria and likely regression risks before implementation.
- Make focused changes and inspect the complete diff.
- Run deterministic checks appropriate to the change: syntax, structured-data validation, generated-reference checks, documentation links/anchors, and financial invariants.
- Test changed behavior and adjacent paths, prioritizing parser correctness, duplicate reconciliation, provenance, financial calculations, privacy, and recovery.
- Never equate a green workflow, successful commit, or deployment with complete application acceptance.

### GitHub Pages and mobile
Treat iPhone and iPad as primary platforms. For relevant UI changes, check narrow/wide layouts, portrait/landscape, navigation, safe areas, viewport changes, overflow, touch targets, accessibility, and long/missing content. Desktop screenshots do not establish correct mobile behavior; use physical Safari when possible.

For deployment changes, verify workflow trigger, permissions, artifact contents, publishing configuration, deployed URL/path, workflow result, and served SHA. A commit or push does not prove deployment. Identify any required repository Settings action that code cannot perform.

### Service workers and offline behavior
Do not add service workers, offline modes, install prompts, or offline toggles without an established user need and freshness requirements. If introduced, document and test cache/update behavior, first install, repeat launch, deployment updates, offline startup, stale/missing data, reconnection, and old-client/new-asset compatibility. Never present stale financial information as current.

## Definition of done
Report what changed and why; checks actually run and results; branch/PR and deployment status; known limitations; and remaining work. Distinguish **implemented**, **validated**, **owner-accepted**, and **deployed and verified**. Mark unmet criteria as outstanding. See [CURRENT_STATE.md](docs/CURRENT_STATE.md) for current project-specific boundaries.
