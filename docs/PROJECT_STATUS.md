# Project status

## Storage and safety update, November 11, 2026

**Verified:** [PR36](https://github.com/AeroVega/finance-tracker/pull/36) is merged
in main `04aacf31b8aaae31fa73b10408fa22d417c0d943`. Its description reports completed
owner synthetic/device acceptance. The baseline local Node 24.22.1 suite passes
1,120/1,120. Financial position and reconciled coverage are implemented; the
November 10 branch-status paragraphs below are historical.

The [storage scaling and production-readiness audit](STORAGE_SCALING_AND_PRODUCTION_READINESS.md)
records measured catalog growth, whole-ledger memory limits, safe local codec and
token-cleanup changes, and remaining production gates. The owner subsequently authorized execution and draft publication. The
[incremental storage foundation](SCALABLE_STORAGE_FOUNDATION.md) implements
segmented catalogs, source-bound monthly reports, response bounds and lower-memory
Drive backup. Full bounded loading and production controls remain unfinished.
Nothing is merged or deployed by this work. Deployment is deferred until closer to Alpha.
Historical monthly migration, supported owner-file ingestion and production
controls remain. **Alpha is incomplete and production remains NO-GO.**

## Earlier main snapshot, November 10, 2026

**Verified snapshot:** November 10, 2026. Audited `main` at [`d38681ee013cbe3e52dd861264f70490935c3582`](https://github.com/AeroVega/finance-tracker/commit/d38681ee013cbe3e52dd861264f70490935c3582). This is a dated record, not a live status feed.

The synthetic canonical workspace and storage foundation are implemented. **Alpha is not complete.** Financial position, reconciled coverage, monthly-history migration and production controls remain. Production financial-data persistence is **NO-GO**.

## Financial-position branch update, November 10, 2026

**Implemented, under review:** The owner-authorized [financial-position milestone](FINANCIAL_POSITION.md) builds on main `e0420a70a27cec6f7d13fe6b65258643433e4c64`. It adds dated balance selection, source/conflict history, a 35-day freshness warning, separate-currency position totals, holdings evidence, credit-card/mortgage/auto-loan balances, explicit zero-balance closure and evidence-backed account/month coverage. Position changes use append-only records and the existing verified save/reopen/portable-restore path.

The workspace can stage accounts, balances, balance/holdings conflict decisions, dated holdings, cash/card reconciliation, statement-component reconciliation and closures. Manual investment/loan statements can explicitly declare the full month without a fabricated CSV import; declaration alone does not prove completeness. General provider balance/holdings file importers are outside this milestone. The legacy synthetic-year fixture remains unchanged.

The [PR36 adversarial follow-up](PR36_ADVERSARIAL_REVIEW.md) corrects closure contradictions, corroborating evidence, holdings comparisons and audit-identity collisions. It improves reconciliation choices, local feedback, draft preservation and repeated financial report work. The review remains synthetic-only.

**Verified local review tests:** 1,097/1,097 passed on Node 24.22.1, with no failures or skips. This includes 23 added review regressions across financial evidence, persistence identity checks, cached readers and editor workflows. Changed module syntax and diff checks passed.

**Verification limits:** Automated suites exercise synthetic domain records and in-memory storage/recovery adapters. Browser rendering could not be verified in this environment: Chromium could not create its local socket, and the provided browser could not reach the local test server. Physical iPhone/iPad Safari, live synthetic Drive acceptance and deployment remain outstanding. No real records or live financial services were used.

This branch does not complete Alpha or authorize production persistence. The tables below remain the dated main audit, not a claim that this branch has merged or deployed.

## Repository and deployment

| Work | Verified state | What that establishes |
| --- | --- | --- |
| [PR26](https://github.com/AeroVega/finance-tracker/pull/26) | Merged November 6 | Product baseline and monthly migration requirements. |
| [PR27](https://github.com/AeroVega/finance-tracker/pull/27) | Merged November 8 | Production planning only. No production implementation or activation approval. |
| [PR28](https://github.com/AeroVega/finance-tracker/pull/28) | Merged November 8 | Synthetic provider parsing, canonical import/review/save/reopen. |
| [PR29](https://github.com/AeroVega/finance-tracker/pull/29) | Merged November 8 | Shared visual work; not financial-position completion. |
| [PR30](https://github.com/AeroVega/finance-tracker/pull/30) | Merged November 9 | Synthetic year, storage/CPU improvements and bounded acceptance evidence. |
| [PR33](https://github.com/AeroVega/finance-tracker/pull/33) | Merged November 9 | Sixteen portable engineering workflows, replacing PR31's earlier skills. No application feature completion. |
| [PR34](https://github.com/AeroVega/finance-tracker/pull/34) | Merged into PR32's branch November 10 | Exact preview persistence and manual transfer linking; included in main through PR32. |
| [PR32](https://github.com/AeroVega/finance-tracker/pull/32) | Merged into main November 10 | Canonical main workspace, including its follow-ups. |

At this snapshot, GitHub's open-PR search returned no open PRs. Remaining branch names are not evidence of unfinished or delivered work.

**Verified CI:** [Node contract tests](https://github.com/AeroVega/finance-tracker/actions/runs/42752426272) passed on the audited main SHA. Earlier PR test counts belong to their recorded heads; do not reuse them as today's result.

**Verified deployment failure:** [Pages run 42752426270](https://github.com/AeroVega/finance-tracker/actions/runs/42752426270) failed at `Configure GitHub Pages` on that same main SHA. Checkout, source stamping and generated Google-configuration validation passed. Artifact upload and deployment were skipped. The underlying configuration error and the currently served live SHA were not verified in this audit. The earlier [branch Pages build](https://github.com/AeroVega/finance-tracker/actions/runs/42751899321) succeeded on `4a61325fbd8b1abd20b53c42af83c259b42c9a5b`; that does not prove main deployed.

The workflow in source deploys main pushes or an explicitly selected manual run. Pages is one shared public deployment. Verify actual repository Pages settings and the served source before owner acceptance; do not infer hosting configuration from workflow YAML alone.

## What exists and what remains

| Area | Implemented on audited main | Remaining Alpha work |
| --- | --- | --- |
| Canonical activity | Account/month browsing, exact qualified reports, evidence, append-only corrections, staged undo/revert and manual transfer links. | Finish acceptance of changed save/reopen and transfer-link paths. |
| Imports | Strict known Wells Fargo, SoFi and Fidelity fixture parsers; provenance, mapping, declared coverage, duplicate review and canonical storage in the advanced workbench. | Supported owner-file ingestion in the production-capable application, with the same validation and privacy controls. The main workspace currently does not ingest user CSVs. |
| Storage | Synthetic ownership/session checks, immutable transaction history, recovery, backup/restore, portability and retention machinery. New canonical copies use fragmented v3; v1 remains readable; standalone grouped v2 is rejected. | Production binding, clearing, configuration/privacy/cost review and current end-to-end acceptance. Synthetic implementation is not production approval. |
| Financial position | Known income/spending and checking/savings cash-movement reports, explicitly qualified as partial. | Dated balances, holdings/valuations, assets, liabilities, net worth and reconciliation. Cash movement is not an account balance. |
| Coverage | Import provenance and declared intervals; unresolved source evidence stays visible. | Evidence-backed per-account and per-month reconciliation completeness. An interval or row count does not prove completeness. |
| Historical continuity | Monthly migration requirements are settled. | Separate monthly-summary schema, converter, reconciliation and source-selection rules from January 2023. No conversion is claimed. |
| Devices and deployment | Local automated/browser evidence and bounded owner observations exist. | Verify current served SHA, current live paths and physical-device coverage. Whole-graph loading has no demonstrated large-device capacity guarantee. |

Code evidence: [workspace model](../js/canonical-workspace-model.mjs), [workspace session](../js/canonical-workspace-session.mjs), [provider parsers](../js/provider-csv.mjs), [canonical store](../js/canonical-ledger-storage.mjs) and [guided import](../prototype/pr28-import.mjs). See the linked contracts for exact financial and failure semantics.

## Acceptance evidence has a scope

- **User-confirmed, recorded in the workspace guide:** the owner accepted PR32 local synthetic-year exploration, evidence/corrections and mobile workspace experience. Preserve that observation; do not repeat unaffected checks merely because the PR merged.
- **Open:** the newer preview-to-Drive save, transfer-link persistence and interruption checks. The guide does not provide a new acceptance pass for these paths. Record the full tested SHA with the next result.
- **User-confirmed, historical:** PR25, PR28 and PR30 records contain bounded live synthetic/device results. They do not validate every later screen or every interruption boundary.
- **Verified documentation/runtime mismatch:** the [acceptance plan](../prototype/acceptance-plan.mjs) still requests grouped-v2 seeding and a v2/v3 selector. The [current year page](../prototype/synthetic-year.html) offers v3 only. Mark those obsolete steps blocked; use [the corrected owner guide](OWNER_ACCEPTANCE.md). Fixing the runtime checklist is a separate scoped code change.

## Safety and release boundary

Keep invented fixtures in the public repository and CI. Do not inspect, convert, upload or persist real financial records as part of ordinary synthetic development. Keep the archived workbook unchanged.

The accepted production policy requires working financial data and tokens in memory and clearing on sign-out or orderly release. The synthetic workspace currently retains loaded records and drafts read-only after release. That remains an implementation gap, not permission to weaken the policy.

PR27's later decision removes a separate real-data smoke-test prerequisite. Synthetic test evidence still must be accompanied by actual OAuth/configuration review, live synthetic acceptance, recovery/privacy/cost review, residual-risk acceptance and explicit production authorization. January 1, 2027 remains a conditional v1.0.0 target.

Continue with [next steps](NEXT_STEPS.md). The broader product scope remains in the [roadmap](ROADMAP.md).
