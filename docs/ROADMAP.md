# Roadmap

**Status:** Active milestone scope, reconciled November 10, 2026. Alpha implementation is incomplete; see [project status](PROJECT_STATUS.md) and the [four-step Alpha plan](NEXT_STEPS.md). Estimates and delivery dates remain open.
**Target 1.0.0 release date:** 2027-01-01 (owner's intended target; planning target, subject to release gates)

This is a plan, not a guarantee that all proposed capabilities are feasible under the security and $0 recurring-cost constraints. The owner-reviewed [Second Generation Product Definition](PRODUCT_DEFINITION.md) captures the broader product direction. Unresolved owner questions remain tracked separately until they are resolved or transferred into their appropriate planning and engineering homes. The [Alpha sequence](NEXT_STEPS.md) now defines dependencies and completion checks. It does not establish estimates or a delivery commitment.

## Product direction and workstream boundaries — 2026-11-02

The product direction now extends beyond the original MVP1 file-based tracker into a personal financial intelligence application with reporting, investments, liabilities, budgeting, goals, projections, insights, data-quality transparency, local-first operation, and long-term portability. The owner-confirmed minimum v1.0.0 scope is now recorded below; capabilities beyond that minimum remain product direction or later-release candidates, not automatic additions to the next PR.

**PR #25's synthetic-only storage-readiness implementation is merged.** Its owner-reported acceptance evidence and remaining limitations are recorded in [PR #25](https://github.com/AeroVega/finance-tracker/pull/25), [the synthetic acceptance record](SYNTHETIC_STORAGE_ACCEPTANCE.md), and the subject-based [backup/restore](DRIVE_BACKUP_AND_RESTORE.md), [retention](ORIGINAL_SOURCE_RETENTION.md), and [Google Drive configuration](GOOGLE_DRIVE_CONFIGURATION.md) guides. Remaining owner review concerns the documented deletion-receipt recovery limitation, actual Cloud OAuth/API-key configuration and quota/usage/billing, and final deployed-artifact privacy/security inspection. These are residual acceptance and production-readiness gates, not unfinished PR #25 implementation scope. The product-definition discussion does not authorize production financial-data persistence.

## Delivery progression — Alpha → Beta → 1.0.0 → 2.0.0

This is the agreed product delivery model. The Product Definition describes the intended product; this roadmap organizes the work into coherent, testable stages. These milestones are ordered by dependency and readiness, not by PR number. PRs may overlap, remain in draft, or merge out of numerical order when that is the safest and clearest sequence.

### Alpha — trustworthy financial foundation

**Purpose:** Establish a reliable, auditable financial data foundation before investing heavily in the analytical presentation.

Expected scope:
- Supported CSV import and strict provider-format recognition for the initial Wells Fargo, SoFi, and Fidelity exports.
- Explicit import provenance, account mapping, coverage-period declaration/confirmation, and validation of observed transaction dates against declared coverage.
- One-time migration of the first-generation Excel history beginning in 2023, using a purpose-built Python conversion script rather than a permanent Excel-import feature.
  - Preserve monthly net-worth snapshots, monthly income totals and available income-source breakdowns, and monthly expense totals and available primary expense-category breakdowns.
  - Store these as historical monthly-summary records, distinct from the canonical transaction/activity ledger.
  - Never fabricate transaction-level records from monthly totals.
  - Preserve the original workbook, mapping, source provenance, and reconciliation report; validate month-by-month totals and flag discrepancies for owner review.
  - Expense subcategory migration is pending inspection of the workbook and is not yet committed.
- Canonical typed activity ledger, conservative matching, overlap/idempotency handling, pending/posted relationships where evidence supports them, and append-only corrections/reversals.
- Deterministic categorization, efficient user review and correction, and consistent application of learned corrections to future matching records.
- Trustworthy account balances, assets, liabilities, cash flow, and net-worth calculations with clear definitions and data-quality/freshness/coverage context.
- Approved private storage, authentication, backup, recovery, and portable export, all validated under the $0 recurring-cost and privacy constraints.

**Alpha exit criteria:** The owner can import and migrate financial history, review and correct it, understand its coverage and provenance, reconcile the resulting financial position, and trust that the data is safely preserved and recoverable. No real financial data may be used until the applicable security and storage gates have been explicitly satisfied.

### Beta — visual and analytical experience

**Purpose:** Build the user-facing overview and analytical tools on top of the Alpha foundation.

Expected scope:
- Home dashboard and primary navigation, with drill-down into detailed experiences.
- Present-day financial overview, recent activity, category breakdowns, net-worth and historical trend visualizations.
- Historical reporting and insights with documented calculation definitions.
- The minimum-scope planning experience: basic category budgets and comparisons, plus a straightforward three-month baseline cash-balance projection with stated assumptions. The owner confirmed on 2026-11-05 that goals and saved what-if scenarios are deferred beyond v1.0.0, without a committed later version or date. The forecast combines checking and savings, excludes investments and available credit, and treats internal transfers between included accounts as neutral to that balance. Show projected month-end cash balances for each of the next three months; daily detail is deferred. Forecasting requires confirmed coverage across the included accounts for the three most recent completed calendar months, consecutively; otherwise show missing coverage instead of a projection, without a manual-assumption bypass. Use the average inflows and outflows from those three qualifying months, including debt payments and excluding transfers between included checking and savings accounts. Assumptions are editable; recalculate after changes and label the result as a baseline estimate. Seasonality, unusual one-off activity, remaining calculation edge cases, and confidence methodology remain open.
- Investment and liability presentation appropriate to the agreed initial scope: imported investment balances and dated values, holdings and basic activity, without live pricing or performance calculations. Debt covers credit cards, mortgages, and auto loans with manual updates, without payoff modelling.
- Responsive, usable interactions across the target iPhone and iPad experiences.

**Validation approach:** Use controlled synthetic datasets to exercise chart layouts, unusual financial patterns, missing data, uncertainty ranges, and interaction behavior. Synthetic data is the appropriate basis for Beta visual and analytical testing; actual personal financial data is not a prerequisite for this stage.

**Beta exit criteria:** The visual and analytical experience operates against controlled datasets, communicates limitations honestly, and is usable through the existing GitHub Pages deployment workflow on target devices.

### Owner-confirmed minimum v1.0.0 scope — 2026-11-05

The January 1 target is a minimum coherent replacement for the first-generation workbook, not full maturity of every capability in the Product Definition. The release baseline is:

- **Required replacement foundation:** historical workbook migration (monthly history from 2023 onward, with available breakdowns and provenance); reliable Wells Fargo, SoFi, and Fidelity CSV imports including overlapping/repeat imports; unified ledger with duplicate prevention, corrections, and deterministic categorization; persistent accounts, balances, assets, and liabilities; trustworthy income, spending, cash-flow, savings, and net-worth reporting; historical trends that distinguish workbook-derived monthly summaries from transaction-level imports; and approved, validated private storage, authentication, backup, recovery, and portable export.
- **Core experience:** usable Home, Activity, Accounts, Planning, and More experiences on iPhone and iPad.
- **Useful initial forms:** meaningful Insights with optional evidence-based recommendations; basic investment balances/holdings/activity; basic category budgets and comparisons; a straightforward three-month baseline cash-balance projection with stated assumptions; and clear data-quality/freshness/coverage indicators.
- **Deferred refinements:** live investment pricing, investment performance calculations and advanced tax-lot analysis, debt-payoff modelling, sophisticated forecasting, goals and saved what-if scenarios, advanced budget rollover/customization, multi-currency, extensive dashboard/report customization, additional institution integrations, and simultaneous multi-device operation.

The owner expects deeper compatible refinements to be considered for minor releases (1.1.0, 1.2.0, and later), rather than making them prerequisites for 1.0.0. Minor-release planning remains subject to compatibility and separate prioritization; these are not automatic feature commitments. January 1 remains conditional on functional completeness, data integrity, security/recovery gates, and explicit owner acceptance after reconciliation. Move the release date if those conditions are not met; do not lower the standard. This scope does not alter PR #25's synthetic-only boundaries or authorize production financial-data persistence.

### 1.0.0 — integrated first product release

**Purpose:** Integrate the Alpha foundation and Beta experience into a coherent, trustworthy application.

Release requires:
- Alpha and Beta capabilities integrated without weakening data integrity, privacy, or recovery.
- End-to-end acceptance with synthetic financial records in the production-capable path, plus actual OAuth/configuration, privacy, cost, recovery and owner authorization gates. PR27 later confirmed that a separate real-data smoke test is not required. Real-data use remains unauthorized until explicit activation approval.
- Successful validation of imports, historical migration, categorization and corrections, balances and reports, persistence, backup/restore, and recovery.
- Clear known limitations, documented operational procedures, and a usable target-device experience.
- Confirmation that ongoing operation remains within the $0 recurring-cost constraint and does not depend on expiring trials, unauthorized scraping, or stored bank passwords.

**1.0.0 exit criteria:** The integrated application reliably preserves, represents, and explains the owner's financial history and provides the agreed core user-facing experience. If the criteria are not met, defer the release rather than weakening safeguards.

### 2.0.0 — expanded capabilities

**Purpose:** Deliberately expand beyond the first coherent product release.

Potential scope includes deeper investment analysis, more sophisticated planning and projection methods, expanded automation, additional institution integrations where sustainable and authorized, and other advanced capabilities deferred from 1.0.0. Each addition remains subject to privacy, correctness, portability, and $0 recurring-cost constraints.

**2.0.0 scope and exit criteria:** To be defined through subsequent product decisions and roadmap updates; these opportunities are not automatic commitments for 1.0.0.

### Milestone and PR sequencing rules

- Alpha and Beta are deployable development milestones, not public semantic-version releases. The owner should be able to use each milestone through the existing GitHub Pages workflow and perform hands-on smoke tests on target devices before advancing.
- 1.0.0 and 2.0.0 are product release versions.
- Synthetic data supplies Alpha, Beta and integrated acceptance test evidence. A separate real-data smoke test is not a prerequisite, per the later PR27 decision. Production controls and explicit owner authorization remain required before real-data use.
- PR numbers do not prescribe merge order. Sequence work by dependency, reviewability, and readiness; a higher-numbered PR may merge before a lower-numbered PR.
- Keep documentation/design work and engineering implementation in their appropriate PRs. A roadmap milestone does not silently expand the scope or authorization of an existing PR.
- PR #25's synthetic-only implementation is merged. Its remaining owner-review and production-readiness items are documented separately; this roadmap does not authorize production financial-data persistence.


## Current project position, November 10, 2026

**Verified:** PR26 through PR34 are merged, including the planning-only PR27 and PR34's merge through PR32. The canonical workspace and synthetic import/storage foundation are on main. Main CI passed; the main Pages workflow failed before upload/deployment. [Project status](PROJECT_STATUS.md) records the exact commits, runs and limits.

Step 1 of the application sequence is implemented, with additional live acceptance still open. Steps 2 through 4 cover financial position/reconciled coverage, monthly history from January 2023, and production controls/authorization. The app remains synthetic-only.

### M1 status — Canonical import contract and synthetic reconciliation

**Verified:** PR11's contract is merged and later PR28 implemented strict fixture parsers, canonical persistence, review, corrections and reporting tests. Do not treat provider-parser development or synthetic persistence as untouched work. The remaining gap is the complete Alpha application and production-capable owner-file path, not a new canonical foundation.

Earlier PR20 through PR25 storage and recovery results remain in the [synthetic acceptance record](SYNTHETIC_STORAGE_ACCEPTANCE.md). PR28 through PR34 extend that base. Each record's tests and owner observations apply to the revision and workflow actually tested.

## Current delivery work and dependencies

The stage definitions above describe the intended product progression, not a claim that all work is complete. The owner-confirmed minimum v1.0.0 scope is recorded in the Product Definition and this roadmap. The [next-steps plan](NEXT_STEPS.md) defines the Alpha dependencies and completion checks. Estimates and a dependency-based calendar remain open. Complete current acceptance and the documented production controls without weakening the synthetic-only boundary. Alpha implementation must proceed in separate reviewable PRs and remain subject to the required design, security, and production-authorization gates.

The following dependencies apply across Alpha and later stages:

- Complete production evaluation of private storage, authentication, backup/recovery, and portability before enabling persistence for real financial records.
- Extend the existing provider parsers and canonical import path only for supported formats and approved application work; preserve strict synthetic regressions and keep production data out of repositories and CI.
- Preserve manual CSV import as a permanent workflow even if an authorized direct integration is later available.
- Treat the 540-day (18-month) retention policy for original imported source files separately from the indefinite retention of canonical financial history, unless a future explicit decision changes either policy.
- Keep simultaneous multi-device use unsupported under the accepted single-active-device operating model; do not imply synchronization guarantees that have not been implemented and tested.

### Schedule guardrails

- Prioritize financial correctness, privacy, and recoverability over visual polish or calendar dates.
- Evaluate the storage/authentication/security architecture before implementing persistence for real records. This is a gating dependency, not a reason to publish private data to a static site.
- Keep direct integrations optional and subject to free, authorized, sustainable access; manual file imports remain permanent.
- Treat January 1, 2027 as the intended 1.0.0 target date. The former MVP1 framing is historical; the date itself remains the owner's target for the integrated 1.0.0 product.
