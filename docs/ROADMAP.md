# Roadmap

**Status:** Active delivery strategy; minimum v1.0.0 scope established 2026-11-05; dependency-aware schedule and detailed acceptance criteria remain to be baselined  
**Target 1.0.0 release date:** 2027-01-01 (owner's intended target; planning target, subject to release gates)

This is a plan, not a guarantee that all proposed capabilities are feasible under the security and $0 recurring-cost constraints. The owner-reviewed [Second Generation Product Definition](PRODUCT_DEFINITION.md) captures the broader product direction. Unresolved owner questions remain tracked separately until they are resolved or transferred into their appropriate planning and engineering homes. The feature map is not yet a sequenced implementation plan. Re-baseline scope and dates before treating the original schedule as a commitment.

## Product direction and workstream boundaries — 2026-11-02

The product direction now extends beyond the original MVP1 file-based tracker into a personal financial intelligence application with reporting, investments, liabilities, budgeting, goals, projections, insights, data-quality transparency, local-first operation, and long-term portability. The owner-confirmed minimum v1.0.0 scope is now recorded below; capabilities beyond that minimum remain product direction or later-release candidates, not automatic additions to the next PR.

**PR #25 remains a separate engineering workstream.** It must complete its originally assigned synthetic-only storage-readiness and production-acceptance responsibilities as recorded in [PR #25](https://github.com/AeroVega/finance-tracker/pull/25) and its acceptance evidence on that branch. The product-definition discussion does not add feature-development scope to PR #25 and does not authorize production financial-data persistence.

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
- The minimum-scope planning experience: basic category budgets and comparisons, plus a straightforward baseline projection with stated assumptions. Advanced goal hierarchies, scenario management, and forecasting sophistication are not implied v1.0.0 requirements.
- Investment and liability presentation appropriate to the agreed initial scope.
- Responsive, usable interactions across the target iPhone and iPad experiences.

**Validation approach:** Use controlled synthetic datasets to exercise chart layouts, unusual financial patterns, missing data, uncertainty ranges, and interaction behavior. Synthetic data is the appropriate basis for Beta visual and analytical testing; actual personal financial data is not a prerequisite for this stage.

**Beta exit criteria:** The visual and analytical experience operates against controlled datasets, communicates limitations honestly, and is usable through the existing GitHub Pages deployment workflow on target devices.

### Owner-confirmed minimum v1.0.0 scope — 2026-11-05

The January 1 target is a minimum coherent replacement for the first-generation workbook, not full maturity of every capability in the Product Definition. The release baseline is:

- **Required replacement foundation:** historical workbook migration (monthly history from 2023 onward, with available breakdowns and provenance); reliable Wells Fargo, SoFi, and Fidelity CSV imports including overlapping/repeat imports; unified ledger with duplicate prevention, corrections, and deterministic categorization; persistent accounts, balances, assets, and liabilities; trustworthy income, spending, cash-flow, savings, and net-worth reporting; historical trends that distinguish workbook-derived monthly summaries from transaction-level imports; and approved, validated private storage, authentication, backup, recovery, and portable export.
- **Core experience:** usable Home, Activity, Accounts, Planning, and More experiences on iPhone and iPad.
- **Useful initial forms:** meaningful Insights with optional evidence-based recommendations; basic investment balances/holdings/activity; basic category budgets and comparisons; a straightforward baseline projection with stated assumptions; and clear data-quality/freshness/coverage indicators.
- **Deferred refinements:** advanced investment performance/tax-lot analysis, sophisticated forecasting, complex goal hierarchies and optimization, advanced budget rollover/customization, multi-currency, extensive dashboard/report customization, additional institution integrations, and simultaneous multi-device operation.

The owner expects deeper compatible refinements to be considered for minor releases (1.1.0, 1.2.0, and later), rather than making them prerequisites for 1.0.0. Minor-release planning remains subject to compatibility and separate prioritization; these are not automatic feature commitments. January 1 remains conditional on functional completeness, data integrity, security/recovery gates, and explicit owner acceptance after reconciliation. Move the release date if those conditions are not met; do not lower the standard. This scope does not alter PR #25's synthetic-only boundaries or authorize production financial-data persistence.

### 1.0.0 — integrated first product release

**Purpose:** Integrate the Alpha foundation and Beta experience into a coherent, trustworthy application.

Release requires:
- Alpha and Beta capabilities integrated without weakening data integrity, privacy, or recovery.
- End-to-end validation using actual financial data only after production storage and authorization gates have been approved.
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
- Synthetic data is sufficient for Beta visual and analytical validation. Real-data acceptance belongs to the 1.0.0 integration/release gate and is permitted only after the relevant security approvals.
- PR numbers do not prescribe merge order. Sequence work by dependency, reviewability, and readiness; a higher-numbered PR may merge before a lower-numbered PR.
- Keep documentation/design work and engineering implementation in their appropriate PRs. A roadmap milestone does not silently expand the scope or authorization of an existing PR.
- PR #25 retains its original synthetic-only storage-readiness and production-acceptance responsibilities. This roadmap update does not authorize production financial-data persistence.


## Current project position — 2026-11-05

**Current phase:** PR #19's 108-decision database identity/lifecycle/storage/recovery architecture baseline is merged. PR #26 remains an open, draft, documentation-only product-definition PR; its owner-confirmed minimum v1.0.0 scope is now recorded, while the dependency-aware schedule and measurable acceptance criteria remain open. Google Drive remains the selected private-storage direction. The tested Drive v3 stale-`If-Match` path failed; the owner accepted single-user, single-active-device operation, with simultaneous multi-device use explicitly unsupported and writes refused when another active session is detected. Production ledger writes remain blocked pending session coordination, serialized writes, recovery, snapshot consistency, privacy, and $0 recurring-cost validation.

### Completed or demonstrated
- Project constraints, provider-export research, and initial Wells Fargo, SoFi, and Fidelity sample-schema observations are documented.
- The public-repository privacy rules and source-independent, conservative import/reconciliation principles are documented.
- Google Drive remains the selected private-storage direction. The deployed synthetic probe has passed a user-confirmed create/read-back/confirmed-delete test, including a repeat after API-key rotation.
- The Drive probe validates only the tested prototype paths. Sequential device handoff is the intended cross-device model; simultaneous multi-device use is unsupported. Production ledger writes, session-conflict handling, recovery, backup/restore, and current production cost/terms are **not yet validated**.
- Drive Experiments A+B were integrated in PR #16. PR #17 then hardened folder discovery, Picker fallback, and authorization/error handling; it is merged, and its final-head Node contract-test run #72 passed.
- PR #19 merged 108 accepted database identity, schema/versioning, immutable storage, commit/journal, initialization, migration, backup/restore, and recovery decisions. It is documentation-only and does not authorize production storage.

### M1 status — Canonical import contract and synthetic reconciliation

**Status: Merged.** PR #11 is merged to `main`. Areas 1–7 were completed, the 540-day (18-month) original-file retention policy was approved and documented, and the cross-institution composite-match gap was fixed with a regression test. The complete Node suite passed 41/41 tests on the final reviewed PR head before merge.

Recorded decisions: integer minor units with decimal-string fallback; preserve source dates separately from effective/posted dates; one unified typed activity ledger; retain pending and posted observations linked to one activity only with strong evidence; allow explicitly reported partial results; accept valid empty files; strict known-format recognition; retain the original CSV privately; require explicit account mapping; append-only correction/reversal events; no production storage in PR #11; full synthetic reconciliation suite before merge.

**Remaining M1 follow-through:** provider-specific strict parser tests, report-level reversal/correction/transfer accounting, schema/persistence integration, and recovery tests remain outstanding. The pure reference module is not a provider parser, durable ledger, or reporting engine. Keep production Drive writes and real financial data blocked.

**Parallel but separate release gate:** continue documenting and testing Drive authorization, best-effort single-session detection, serialized writes, interruption recovery, backup/restore, revocation, and $0-cost production terms. A successful synthetic round trip is not a substitute for those gates.

## Phase 0 — Foundation and discovery
- [x] Set North Star, MVP1 file-import path, and $0 recurring-cost constraint.
- [x] Establish public-repository privacy rules.
- [x] Record Fidelity export capabilities confirmed by the project owner.
- [x] Inspect sanitized sample exports for MVP1 account types (Wells Fargo, SoFi, Fidelity).
- [x] Document observed schemas, date formats, confirmed signs, and available identifiers/activity fields; validate raw CSV mechanics when appropriate.
- [x] Record and merge canonical ledger/import-run contract decisions and a pure synthetic reconciliation reference module (PR #11; complete).
- [ ] Complete production evaluation of private storage, authentication, backup/recovery, and portability. The synthetic Drive and transaction-engine work in PRs #20–24 provides prototype evidence, not production approval; PR #25 retains the remaining synthetic-only production-readiness gates.
- [x] Document and review the database identity/lifecycle/storage architecture (PR #19 merged; production implementation remains separately gated).

Phase 0 discovery is substantially complete. The canonical contract and synthetic reference behavior are merged through PR #11. Provider parsers can now be developed against that contract using invented fixtures; production persistence remains separately gated. The Drive probe does not complete the storage/security phase.

## Current delivery work and dependencies

The stage definitions above describe the intended product progression, not a claim that all work is complete. The owner-confirmed minimum v1.0.0 scope is recorded in the Product Definition and this roadmap. The next planning task is to establish a dependency-aware schedule and measurable acceptance criteria, while keeping PR #25 within its original synthetic-only boundary. Alpha implementation must proceed in separate reviewable PRs and remain subject to the required design, security, and production-authorization gates.

The following dependencies apply across Alpha and later stages:

- Complete production evaluation of private storage, authentication, backup/recovery, and portability before enabling persistence for real financial records.
- Implement provider parsers against strict, synthetic fixtures and the canonical import contract; keep production data out of public repositories and CI.
- Preserve manual CSV import as a permanent workflow even if an authorized direct integration is later available.
- Treat the 540-day (18-month) retention policy for original imported source files separately from the indefinite retention of canonical financial history, unless a future explicit decision changes either policy.
- Keep simultaneous multi-device use unsupported under the accepted single-active-device operating model; do not imply synchronization guarantees that have not been implemented and tested.

### Schedule guardrails

- Prioritize financial correctness, privacy, and recoverability over visual polish or calendar dates.
- Evaluate the storage/authentication/security architecture before implementing persistence for real records. This is a gating dependency, not a reason to publish private data to a static site.
- Keep direct integrations optional and subject to free, authorized, sustainable access; manual file imports remain permanent.
- Treat January 1, 2027 as the intended 1.0.0 target date. The former MVP1 framing is historical; the date itself remains the owner's target for the integrated 1.0.0 product.
