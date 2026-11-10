# Product decisions: remaining v1 reviews and later work

**Status:** Consolidated owner-decision register

**Companion:** [Product Definition](PRODUCT_DEFINITION.md)

**Last updated:** 2026-11-05

After the reporting, savings-rate, forecast, investment/debt, reliability, and release-boundary confirmations, the remaining consequential choices are organized into **three v1.0.0 owner-review bundles**. Engineering should prepare evidence and proposals before the owner reviews them. Unpresented choices remain open; no recommendation becomes an owner decision without confirmation. Reliability implementation and release-evidence preparation are engineering work under the confirmed boundaries. Actual owner release approval is still required.

## At a glance

- **Owner review:** 3 bundles containing 10 detailed entries.
- **Engineering proposals and research:** 4 work packages containing 27 detailed entries.
- **Explicitly later work:** 5 groups containing 15 detailed entries.
- **Existing-policy change, only if requested:** 1 conditional entry, not a v1 release blocker.

**Count basis:** The consolidation preserved 57 earlier unchecked entries as 59 entries by splitting investment performance and debt-payoff forecasting into current-release and later portions. Subsequent owner confirmations resolved Q8, Q15, Q37, Q38, Q39a, and Q46b, leaving 53 open entries. Six remaining entries moved from owner review to engineering after their product rules were confirmed. Resolved IDs remain in the settled record. These are inventory-entry counts, not atomic subquestions or additional owner decisions. Cross-references do not count twice.

Scope and recorded decisions are unchanged except for the owner confirmations already recorded in the Product Definition. The numerical Health Score, goals, saved what-if scenarios, and other explicitly deferred capabilities must not return as v1 prerequisites. Topics without a release decision remain proposals or unresolved details; this organization does not silently defer them.

## Three remaining v1 owner-review bundles

- **O1. Financial reporting and budget rules.** Settle the remaining financial meanings and report boundaries: remaining savings-rate inputs and edge cases, pending activity and dates, corrections/chargebacks, and unresolved budget behavior. Engineering should supply a coherent calculation proposal first. 5 detailed entries below.
- **O2. Cash-forecast methodology.** Review remaining calculation edge cases, unusual activity, and confidence after the confirmed coverage gate. The three-month average, debt-payment inclusion, exclusion of internal cash transfers, editable assumptions, and recalculation after changes are settled alongside cash scope, month-end granularity, horizon, and coverage gate. 2 detailed entries below.
- **O3. Initial investment and debt scope.** Review remaining investment types and consequential data/calculation scope within the confirmed boundaries: imported balances and dated values, holdings and activity, no live prices or performance calculations, and three debt types with manual updates and no payoff modelling. Research source data first. 3 detailed entries below.

Resolve these as coherent bundles after reviewing engineering's proposal, not as separate questions for every field or screen. The owner still decides consequential behavior and risk; engineering handles implementation detail within approved contracts.

### O1. Financial reporting and budget rules

<details>
<summary>5 remaining detailed entries</summary>

- [ ] **Q9.** What detailed aggregation, valuation, remaining period-boundary, and calculation rules implement income, spending, cash flow, savings, assets, liabilities, net worth, and basic investment reporting? Apply the confirmed posted-activity total basis, calendar-year annual views, optional custom ranges, and savings-rate formula without reopening them. Use the agreed meanings and a clean mathematical design, not the old workbook's formulas or quirks.
- [ ] **Q10.** What are the remaining pending-transaction rules for balances, projections, and cash-flow presentation beyond the confirmed posted-activity reporting totals? What date-treatment edge cases remain after preserving the confirmed refund and original-period correction rules? Beyond the confirmed unmatched-refund behavior, what remaining refund edge cases, review-resolution criteria, and linkage/matching behavior need specification, and what report inclusion and date rules apply to chargebacks, reversals, and other non-category corrections? Engineering must assess persistent refund-link feasibility and implementation. The cumulative effective-state calculations and compacted-summary adjustment mechanism still need a contract.
- [ ] **Q11.** When should reporting use trade date versus settlement date? Preserving both dates does not choose a reporting basis.
- [ ] **Q12.** What income basis, including gross versus net, and employer-contribution treatment should the confirmed savings-rate formula use? How should negative-income and other residual input edge cases be handled? The formula is income minus spending, divided by income; savings/investment transfers are not spending, and zero-income months show not applicable. Preserve existing economic classifications without treating those decisions as answers to every input edge case. See [Product §4.4][product-financial].
- [ ] **Q29.** What overspend carryover behavior should apply? The owner rejected unused-budget rollover but did not decide overspend carryover. Budget visualization and forecast-data sufficiency remain engineering work under Q3 and Q54.

</details>

### O2. Cash-forecast methodology

<details>
<summary>2 remaining detailed entries</summary>

- [ ] **Q16.** How should the confirmed three-month-average baseline handle seasonality, unusual one-off activity, and remaining calculation edge cases? Apply the approved averaging method, debt-payment inclusion, internal cash-transfer exclusion, editable assumptions, and coverage gate. See [Product §5.1][product-planning].
- [ ] **Q19.** How should projection confidence reflect remaining data-quality limitations after the confirmed coverage gate is met?

</details>

### O3. Initial investment and debt scope

<details>
<summary>3 remaining detailed entries</summary>

- [ ] **Q35.** What exact investment account and security types belong in the basic v1.0.0 balances, holdings, and activity scope?
- [ ] **Q40.** What initial cost-basis, source-provided realized/unrealized-gain, and employer-match data behavior is necessary? Field and retention requirements remain open within the existing historical-record contract. Do not add performance calculations or advanced tax-lot analysis to v1.0.0.
- [ ] **Q44.** Should v1.0.0 include interest rates, minimum payments, scheduled payments, and amortization, or defer some of them? These details were not approved by the initial debt-scope decision. Debt-payoff modelling is excluded from v1.0.0.

</details>

## Engineering proposals and research

Prepare concrete designs, inspect source formats, and define tests. Escalate choices that change user-visible financial meaning, privacy, cost, data integrity, release scope, or an accepted contract. Inclusion here does not approve a design, notification, implementation, or a new release requirement.

### E1. Interface and review flows

Propose screens, navigation/report destinations, default cards, transaction-type controls, settings, account lifecycle flows, and review interactions within the agreed scope.

<details>
<summary>8 remaining detailed entries</summary>

- [ ] **Q1.** What detailed screen hierarchy, section contents, and navigation behavior implement the agreed Home / Activity / Accounts / Planning / More map? The precise report destinations, complete built-in transaction-type set, and detailed discovery controls remain open. The map does not make every eventual planning feature a v1.0.0 requirement.
- [ ] **Q2.** What exact first-run screens, transitions, and recovery presentation implement those established states and safeguards?
- [ ] **Q3.** Which exact default cards, report layouts, remaining period controls, and breakdowns implement the agreed Home content and reporting families? What budget visualization communicates the confirmed target, actual, remaining/over-target, and labeled month-end estimate? Apply the settled reporting-period decision; the examples do not settle a complete card inventory or every ready-made report.
- [ ] **Q4.** What should account creation, explicit closure, and manual balance-update screens and confirmation flows look like?
- [ ] **Q5.** What additional settings are required for v1.0.0, and how should advanced settings be organized?
- [ ] **Q49.** How should users dismiss, revisit, or mark an insight as understood?
- [ ] **Q55.** What remaining resolution screens and actions are needed for each quality finding, and how should the user see its effect on indicators, scores, reports, and projections?
- [ ] **Q17.** What assumption fields and editing controls implement the confirmed editable assumptions and recalculation after changes? Manual assumptions cannot bypass missing required coverage. See [Product §5.1][product-planning].

</details>

### E2. Inputs, reconciliation, and storage design

Inspect provider formats and propose schema mappings, required debt fields, report/source-selection contracts, refund linkage, balance provenance, numerical reconciliation, and permitted local-cache behavior. Escalate changes to approved contracts before implementation.

<details>
<summary>7 remaining detailed entries</summary>

- [ ] **Q36.** Which exact holdings schemas, original CSV mechanics, action semantics, and other initial-provider formats remain to be inspected and supported?
- [ ] **Q41.** How do those components reconcile numerically to account balances and basic portfolio reporting, including incomplete holdings or activity?
- [ ] **Q43.** How should manual balance updates be dated and sourced?
- [ ] **Q45.** How should purchases, statements, payments, and liability-balance snapshots reconcile, beyond those settled classifications?
- [ ] **Q56.** Engineering must reconcile persistent offline-reading/cache behavior with §107's current restriction of IndexedDB to inventory and narrow recovery diagnostics before proposing that implementation. A change to the accepted storage contract requires explicit review; the product direction does not silently authorize it.
- [ ] **Q14.** What exact ready-made reports, formulas, remaining period controls, and drill-downs implement the required income, spending, cash-flow, savings, and net-worth report families? Calendar-year annual views and optional custom ranges are settled in [Product §6][product-ux]. For overlapping history, what evidence and reconciliation criteria establish a complete month, and how should source selection work where workbook and transaction data have different scopes or levels of detail? Use transaction detail only for months reconciled as complete; otherwise retain workbook summaries and label coverage. Never double-count or assume unsupported per-account workbook detail. The selection principle is settled in [Product §11.1][product-migration]; its engineering contract remains open.
- [ ] **Q42.** What fields are required for the confirmed initial credit-card, mortgage, and auto-loan scope with manual updates? Align the technical account-type representation with those product types; see [documented mismatches](#documentation-conflicts-and-existing-constraints).

</details>

### E3. Analysis, insights, and data-quality proposals

Prepare report-reliability criteria, forecast-accountability and uncertainty proposals, initial insight candidates, evidence drill-downs, and stale-data/remediation thresholds. These are proposals to review, not automatically new v1 requirements or approved notifications.

<details>
<summary>9 remaining detailed entries</summary>

- [ ] **Q18.** What statistical meaning and calibration should the uncertainty cone have when implemented? The intended widening-cone presentation is settled; the methodology is not.
- [ ] **Q21.** Which error measures and presentation should compare retained forecasts with subsequent actual outcomes, including systematic over- or under-estimation?
- [ ] **Q47.** Which specific insight types are reliable and useful enough for v1.0.0? Spending changes, savings pace, unusual activity, and cash-flow risk are examples, not a selected initial catalog.
- [ ] **Q48.** How should findings be prioritized without repetitive or low-value observations?
- [ ] **Q50.** What exact fields, calculations, and drill-downs implement that evidence standard for each chosen insight type?
- [ ] **Q51.** Are user-configurable thresholds needed? The dedicated Insights experience and no-default-push-notification direction are already settled in [Product §§5.6 and 6][product-insights].
- [ ] **Q53.** What stale-data thresholds, source-remediation actions, and any optional reminders are appropriate beyond that agreed presentation? Keep institution-source unavailability separate from the already-defined Drive failure behavior.
- [ ] **Q13.** What report-specific engineering rules implement the confirmed known-amount, date, and coverage-warning behavior? If a missing value prevents a trustworthy complete total, show a clearly labeled known subtotal and withhold the complete total. Preserve stale-value qualifications; define exact reliability thresholds and estimate treatment without treating missing data as zero. See [Product §7][product-quality].
- [ ] **Q54.** What detailed timeline presentation and reliability thresholds should govern coverage gaps and budget estimates? How should engineering implement the confirmed dated-value and coverage-warning rules when combining account data? Complete totals must be withheld when missing values prevent a trustworthy total, with known subtotals clearly labeled. Exact thresholds and treatment of other reports or projections remain to be specified alongside the settled budget and baseline-forecast gates. Storage-integrity failures already have fail-closed constraints under [database lifecycle §§39 to 42][database-integrity].

</details>

### E4. Acceptance criteria and delivery plan

The [four-step Alpha plan](NEXT_STEPS.md) now records dependencies and proposed completion checks against current implementation. Complete estimates, a realistic calendar and later Beta/release checks without treating this documentation as acceptance evidence. Preserve the confirmed release boundary and obtain the owner's evidence review and explicit release approval; preparation does not approve release.

<details>
<summary>3 remaining detailed entries</summary>

- [ ] **Q6.** What additional measurable acceptance criteria demonstrate completion of the minimum v1.0.0 scope? Alpha checks are now mapped in [next steps](NEXT_STEPS.md); validate them during the relevant engineering review. Beta/integrated-release detail remains open. Reuse existing contracts rather than asking the owner to redefine them.
- [ ] **Q7.** What dependency-aware schedule and sequencing complete Alpha, Beta, integration, and owner validation toward January 1, 2027? The milestone order and dependency rules are settled, but task estimates, dates, and critical dependencies are not. See [Roadmap sequencing][roadmap-sequencing].
- [ ] **Q22.** What remaining acceptance criteria demonstrate a useful complete initial cash-balance projection under the confirmed averaging method, recalculation behavior, cash boundary, coverage gate, and three-month horizon? Later projection types need separate prioritization.

</details>

## Explicitly later work

These topics are outside the agreed initial scope. Their questions remain available for later design; no dates or automatic feature commitments are added.

### L1. Goals and saved what-if scenarios

Explicitly deferred beyond v1.0.0. Preserve the intended behavior and questions without promising a later date or version.

<details>
<summary>6 preserved detailed entries</summary>

- [ ] **Q20.** For later saved what-if scenarios, how should they be versioned and compared beyond the agreed named-alternative behavior?
- [ ] **Q23.** For later goals, which simple types and fields should be introduced first, and in which release? Goals are explicitly outside v1.0.0.
- [ ] **Q24.** For the later goal experience, should milestones, multiple funding sources, priorities, or dependencies be supported? Do not make the deferred complex hierarchy a v1.0.0 prerequisite.
- [ ] **Q25.** How should goals without a fixed date or amount be represented?
- [ ] **Q26.** How should goal progress and likelihood of achievement be calculated and explained?
- [ ] **Q27.** How should competing goals be shown when available resources cannot satisfy all of them?

</details>

### L2. Subcategory budgets

Deferred as a possible compatible 1.x addition. No allocation design or delivery date is approved.

<details>
<summary>1 preserved detailed entry</summary>

- [ ] **Q28.** For later subcategory budgeting, how should parent and child targets interact, share limits, and handle historical parent-level actuals? The category rules settle actuals classification, not budget allocation. This is not a v1.0.0 requirement.

</details>

### L3. Multi-currency capability

Not a v1.0.0 release requirement. Preserve the foundational currency/history constraints while leaving the later product choices open.

<details>
<summary>5 preserved detailed entries</summary>

- [ ] **Q30.** For later multi-currency capability, which currencies are supported and how is the primary display currency selected?
- [ ] **Q31.** Which exchange-rate source, if any, is authorized under the privacy and $0 constraints?
- [ ] **Q32.** Which date's rate applies to transactions and account/portfolio valuations?
- [ ] **Q33.** How should fees, spreads, and user-provided rates be represented?
- [ ] **Q34.** How should rate data be corrected or handled when unavailable while preserving the agreed historical basis and auditability?

</details>

### L4. Numerical Data Quality Health Score

Explicitly deferred until its scoring method is defined. Useful v1 indicators remain required.

<details>
<summary>1 preserved detailed entry</summary>

- [ ] **Q52.** For the later numerical Health Score, what components, weights, thresholds, and interpretation should it use? No later release or date is committed.

</details>

### L5. Advanced performance and additional forecast outputs

Advanced investment performance analysis is outside the v1 minimum, and the initial forecast output is cash balance. Retain later performance-method and debt-payoff questions without adding a release commitment.

<details>
<summary>2 preserved detailed entries</summary>

- [ ] **Q39b.** Which methodology, such as time-weighted or money-weighted return, should later performance analysis use?
- [ ] **Q46a.** What debt-payoff projection should be considered later?

</details>

## Existing policy, change only if requested

The current policy is already usable: canonical financial history defaults to indefinite retention, while original imported files keep their separately approved 540-day lifecycle. This is not another v1 decision to solicit.

- [ ] **Q57.** If the owner wants the indefinite-retention preference to extend to original imported files too, should that separate policy change? That intention remains unconfirmed. No such change is approved or required to proceed under the present policies.

## Settled decision record

<details>
<summary>Resolved questions and authoritative references</summary>

### User experience and application structure

- [x] ~~What is the top-level navigation map and movement between overview and detail?~~ The map is Home / Activity / Accounts / Planning / More, with overview-first drill-down. Accounts contains holdings and liabilities; Planning contains goals, budgets, projections, and scenarios as those capabilities are introduced. Home cards open their related detail. Insights has an easily reached dedicated experience. See [Product §§2.3, 4.8 and 6][product-ux].
- [x] ~~Should Insights have a separate primary navigation tab?~~ Owner-confirmed 2026-11-05: a prominent Home card opens the dedicated Insights page. Keep Home / Activity / Accounts / Planning / More without adding a sixth tab. See [Product §6][product-ux].
- [x] ~~Should transaction labels support finding and grouping activity, and are custom tags needed in v1.0.0?~~ Owner-confirmed 2026-11-05: support search, filtering, sorting, and grouping by a consistent built-in set of transaction types. Refund, bank correction, paycheck, and purchase are examples, not the full taxonomy. Keep types distinct from categories and review status; custom tags are deferred. See [Product §6][product-ux].
- [x] ~~What is the first-run entry path, and must current institution imports precede useful history?~~ Establish authorized Drive access, select or confirm the primary database, and validate identity, binding, manifest, and primary role. Show available migrated history immediately without requiring new institution imports. Keep setup lightweight. Unverified folders require initialization, inspection, or recovery under the existing contract, never silent overwrite or database switching. See [Product §6][product-ux] and [database lifecycle §§11, 45, 47 and 50 to 55][database-setup].
- [x] ~~Which broad Home content and report families belong in the initial experience?~~ The Roadmap specifies a present-day overview, recent activity, category breakdowns, net-worth and historical trends. Home uses flexible two-column cards and a prominent CSV-upload action. Required reporting covers income, spending, cash flow, savings, and net worth. See [Product §6][product-ux], [minimum v1.0.0 scope][product-minimum], and [Roadmap Beta scope][roadmap-beta].
- [x] ~~May accounts disappear when imports stop, and is manual liability setup acceptable?~~ Accounts persist; closure or status changes must be explicit and preserve history. Manual liability creation and periodic balances are acceptable for v1.0.0. Closed-account history remains reportable. See [Product §§4.3 and 4.9][product-accounts] and [PR25 retained-history decisions][pr25-history].
- [x] ~~Where do database management and retention settings belong?~~ Database management and the recognized-copy inventory belong in Settings; canonical-history retention is configurable there. More includes settings, data management, and diagnostics. See [database lifecycle §24][database-settings], [Product §7.2][product-quality], and [Product §6][product-ux].

### v1.0.0 scope and release criteria

- [x] ~~What is the minimum coherent release scope and overall release gate?~~ The [owner-confirmed minimum][product-minimum] and [Roadmap][roadmap-minimum] fix the scope. Alpha establishes trustworthy data; Beta validates the scoped experience with synthetic data; integrated synthetic acceptance and production controls remain required. The later PR27 decision removes a separate real-data smoke-test prerequisite; actual real-data use still requires explicit production authorization. January 1, 2027 is conditional on functional completeness, integrity, security, recovery, and explicit owner acceptance. Move the date if those gates are unmet.

- [x] **Q8.** ~~Which residual limitations are acceptable, and which block release?~~ Owner-confirmed 2026-11-05: documented cosmetic issues may be acceptable, but incorrect totals, data loss, and privacy failures block release. The owner reviews evidence before approving. Existing mandatory security, cost, recovery, and production-authorization gates remain in force. This is an acceptance boundary, not release or merge approval. See [Product §11][product-release].

### Financial definitions and reporting

- [x] ~~Are income, spending, transfers, investment activity, cash movement, and net worth interchangeable, and what is the basic net-worth formula?~~ Their economic meanings are distinct. Net worth is assets minus liabilities; its change is not simply income minus spending. Internal transfers and investment purchases are not spending; card payments and debt principal are not second expenses. Investment income remains income, while market-value changes are not cash income. Net external cash flow excludes internal transfers. See [Product §4.4][product-financial].
- [x] ~~Should corrections and reversals overwrite history or count as unrelated extra economic events?~~ Preserve append-only events and derive effective reporting state without double-counting. Manual category corrections affect the transaction's original reporting period and retain an audit trail. Source, effective, and posted/settlement dates remain distinct. See [canonical ledger §§2 and 4][ledger-financial], [Product §4.6][product-categories], and [PR25 correction decisions][pr25-history].
- [x] ~~Should pending transactions appear in Activity and finalized income/spending totals?~~ Owner-confirmed 2026-11-05: show pending transactions clearly in Activity and exclude them from finalized income and spending totals until they post. See [Product §4.4][product-financial].
- [x] ~~What is the general activity basis for reporting totals?~~ Owner-confirmed 2026-11-05: use posted activity, preserving the existing refund and original-period bank/category-correction rules and audit trail. Trade versus settlement dates and remaining date-treatment edge cases are not settled by this decision. See [Product §4.4][product-financial].
- [x] ~~What savings-rate formula applies, do savings/investment transfers count as spending, and what happens in zero-income months?~~ Owner-confirmed 2026-11-05: income minus spending, divided by income. Savings/investment transfers are not spending; zero-income months show not applicable. Gross versus net income, employer contributions, and negative-income edge cases remain open. See [Product §4.4][product-financial].
- [x] ~~Should refunds count as income or reduce spending, and in which reporting month?~~ Owner-confirmed 2026-11-05: apply the refund against its original spending category in the month it posts, preserving earlier months. For a partial refund, reduce spending only by the refunded amount. A persistent, navigable link to the original expense is a desired capability when the relationship can be established. See [Product §4.4][product-financial].
- [x] ~~How should an unmatched refund be handled?~~ Owner-confirmed 2026-11-05: retain a refund type label, visibly mark it for review, and allow manual spending-category assignment instead of guessing or treating it as income. Type, category, and review status remain distinct. See [Product §4.4][product-financial].
- [x] ~~How should a bank correction of a duplicate or erroneous charge affect reporting?~~ Owner-confirmed 2026-11-05: correct the original period's effective totals, preserve the audit trail, and clearly label the bank correction and original error. Do not present it as genuine spending followed by a refund or assume that every credit is a correction. See [Product §4.4][product-financial].
- [x] ~~May incomplete, stale, estimated, or unknown data look like verified complete data or zero?~~ No. Show material limitations and distinguish these states. Declared import coverage, observed dates, and import time remain separate; claimed coverage does not by itself prove completeness. See [Product §§2.1, 7.1 and 10][product-quality], [database lifecycle §§3 to 6][database-coverage], and [Product import safeguards][product-imports].
- [x] ~~Which standard report families are required in v1.0.0?~~ Income, spending, cash flow, savings, and net worth are required, with monthly historical trends that identify workbook summaries separately from transaction imports. See [minimum v1.0.0 scope][product-minimum].
- [x] ~~What is the default reporting period for income, spending, and cash flow, and which broader history views should be easy to reach?~~ Owner-confirmed 2026-11-05: default to the current calendar month, with equally accessible previous-month, year, and lifetime views. Lifetime covers available recorded history and retains coverage and source-detail qualifications. See [Product §6][product-ux].
- [x] ~~What annual period and optional date-range support should reports offer?~~ Owner-confirmed 2026-11-05: annual views use calendar years, with optional custom date ranges. The exact controls remain design work. See [Product §6][product-ux].
- [x] ~~Which historical source should reports use when workbook summaries overlap imported activity?~~ Owner-confirmed 2026-11-05: use transaction detail only when that month has been reconciled as complete; otherwise retain workbook summaries and label coverage. Never double-count the same activity or infer unsupported workbook detail. Completeness criteria, reconciliation, and differing source scopes still need specification. See [Product §11.1][product-migration].

### Projection methodology

- [x] ~~What forecast horizon should v1.0.0 use?~~ Owner-confirmed 2026-11-05: use three months initially. Extending to at least a full year is a later aspiration, without a committed date or release. See [Product §5.1][product-planning].
- [x] ~~What forecast granularity should v1.0.0 show?~~ Owner-confirmed 2026-11-05: show projected month-end cash balances for each of the next three months. Daily projected balances are deferred; no implementation-effort estimate is established. See [Product §5.1][product-planning].
- [x] ~~Must scenarios change actual records, and may old forecasts be replaced silently?~~ Named alternatives leave actual records unchanged. Historical forecasts retain their assumptions and then-available information for comparison with actual outcomes. See [Product §§5.3 and 5.4][product-planning].
- [x] ~~What minimum history permits a v1.0.0 baseline forecast?~~ Owner-confirmed 2026-11-05: require confirmed coverage across the included accounts for the three most recent completed calendar months, consecutively. Otherwise show missing coverage instead of a projection, without a manual-assumption bypass. See [Product §5.1][product-planning].
- [x] **Q15.** ~~What update cadence should the baseline projection use?~~ Owner-confirmed 2026-11-05: recalculate after changes. See [Product §5.1][product-planning].
- [x] **Q46b.** ~~How should debt-payment assumptions affect the initial cash-balance forecast?~~ Owner-confirmed 2026-11-05: include debt payments in the three qualifying months' inflows/outflows used for the baseline, with editable assumptions. See [Product §5.1][product-planning].
- [x] ~~Which baseline calculation and assumption behavior should v1.0.0 use?~~ Owner-confirmed 2026-11-05: average the three qualifying months' inflows and outflows, include debt payments, exclude transfers between included checking and savings accounts, allow editable assumptions, recalculate after changes, and label the result as a baseline estimate. The latest-three-completed-consecutive-month coverage gate remains mandatory; seasonality, one-off activity, and confidence-band choices remain open. See [Product §5.1][product-planning].
- [x] ~~Are sophisticated forecasts and scenario-management capabilities required for the initial release?~~ v1.0.0 requires a straightforward baseline cash-balance projection with stated assumptions. Goals and saved what-if scenarios are explicitly deferred, as is sophisticated forecasting. See [minimum v1.0.0 scope][product-minimum] and [Roadmap Beta scope][roadmap-beta].
- [x] ~~Which outcome should the first baseline projection estimate?~~ Owner-confirmed 2026-11-05: start with cash balance. Net-worth projection is lower priority. Apply the subsequently confirmed baseline method while preserving its remaining calculation edge cases. See [Product §5.1][product-planning].
- [x] ~~Which accounts and movements define cash for the baseline projection?~~ Owner-confirmed 2026-11-05: combine checking and savings accounts, exclude investments and available credit, and treat transfers between included accounts as having no effect on the combined balance. See [Product §5.1][product-planning].

### Goals

- [x] ~~Are goals and saved what-if scenarios required for v1.0.0 planning?~~ Owner-confirmed 2026-11-05: defer both, retaining basic category budgets and the baseline projection as initial planning features. No later version or date is committed. See [Product §5][product-planning].

### Budgeting

- [x] ~~What initial budget period applies, and should unused budget carry forward?~~ Owner-confirmed 2026-11-05: use calendar-month category budgets, start each month fresh without unused-budget rollover, and retain previous months for comparison. No savings-transfer or overspend-carryover behavior was decided. See [Product §5.5][product-planning].
- [x] ~~Which budgeting capabilities are essential for v1.0.0 versus later releases?~~ Basic category budgets and spending comparisons are the required initial form; advanced rollover/customization can follow. Budgeting remains optional, and budgets represent targets while projections estimate outcomes. See [Product §5.5][product-planning] and [minimum scope][product-minimum].
- [x] ~~When should a changed budget target take effect?~~ Owner-confirmed 2026-11-05: apply the change to the current month onward and preserve previous months' targets for comparison. Retroactive overrides and prorating were not decided. See [Product §5.5][product-planning].
- [x] ~~Should v1.0.0 budgets also cover income targets or savings goals?~~ Owner-confirmed 2026-11-05: limit initial budgets to spending categories. Income targets and savings goals are deferred to separate later planning features, without a promised date or an implied v1.0.0 goals requirement. See [Product §5.5][product-planning].
- [x] ~~How do parent and subcategory actuals aggregate?~~ The hierarchy has two classification levels. A parent with subcategories is a reporting parent; child totals roll up without double-counting. Historical assignments and taxonomy changes preserve their established meanings. See [PR25 category decisions][pr25-history] and [Product §4.6][product-categories].
- [x] ~~Are subcategory budgets part of the initial release?~~ Owner-confirmed 2026-11-05: keep initial budgets at the main category level. Subcategory budgeting may be considered for a compatible 1.x release; no date or shared-allowance allocation design was approved. See [Product §5.5][product-planning].
- [x] ~~Which values and wording should the budget display use?~~ Owner-confirmed 2026-11-05: show the target, actual spending, and remaining or over-target amount, plus a clearly labeled estimated month-end total when enough data is available. Use neutral wording. See [Product §5.5][product-planning].
- [x] ~~What should a budget show when import coverage is incomplete?~~ Owner-confirmed 2026-11-05: show recorded spending with a warning and withhold the month-end estimate if coverage gaps make it unreliable. See [Product §5.5][product-planning].

### Multi-currency

- [x] ~~Is full multi-currency capability a v1.0.0 release requirement, and must historical rate context be preserved?~~ Full support is not required for v1.0.0. The foundational model preserves original amounts/currencies and treats converted amounts as derived values with a retained historical rate basis. Past reports must not silently change with today's rates. See [Product §4.7][product-currency] and [minimum scope][product-minimum].

### Investments

- [x] ~~Which broad investment capabilities are required initially?~~ v1.0.0 includes account balances, holdings, contributions, distributions, dividends, and basic investment activity. Live pricing and performance calculations are excluded from v1.0.0; advanced tax-lot analysis is not a release requirement. See [minimum scope][product-minimum].
- [x] **Q37.** ~~What investment price-input approach should v1.0.0 use?~~ Owner-confirmed 2026-11-05: use imported balances and dated values, with no live pricing. Exact source formats remain engineering research; do not infer unsupported security-level inputs. See [Product §4.8][product-investments].
- [x] **Q39a.** ~~What performance calculations belong in v1.0.0?~~ Owner-confirmed 2026-11-05: none. Preserve the holdings/activity baseline and retained historical components without requiring performance calculations. See [Product §4.8][product-investments].
- [x] ~~Are Fidelity transaction and holdings exports available at all?~~ The owner confirmed brokerage and workplace-retirement transaction/holdings exports. The provider spec records a sanitized Accounts History sample covering brokerage and employer 401(k) activity. See [data-source evidence][provider-sources] and [Fidelity format observations][provider-fidelity]. These are availability confirmations and sample observations, not complete production parser validation.
- [x] ~~Can portfolio-value change alone represent investment return, or can investment purchases become ordinary spending?~~ No. Keep external flows, trades, dividends, interest, fees, distributions, and market changes distinguishable. Monthly retained history includes portfolio value, holdings, and specified cash-flow/performance components, including realized gains/losses; nominal values remain authoritative. See [Product §§4.4 and 4.8][product-financial], [canonical reporting boundaries][ledger-financial], and [PR25 monthly-history decisions][pr25-history]. Retaining components does not select a performance formula or require advanced analysis in v1.0.0.

### Liabilities

- [x] ~~Which initial debt types and input approach are agreed?~~ Owner-confirmed 2026-11-05: credit cards, mortgages, and auto loans with manual updates and no debt-payoff modelling in v1.0.0. Preserve supported imports where available. Required fields and remaining interest/payment/amortization details are still open. See [Product §4.9][product-liabilities].
- [x] ~~Are credit-card payments a second expense, and is debt principal repayment spending?~~ Card purchases count as spending when incurred; payments settle the liability. Principal repayment reduces debt; interest and fees are expenses. See [Product §4.4][product-financial].

### Insights

- [x] ~~What evidence and calculation detail must an insight expose?~~ Explain evidence, assumptions, and uncertainty through a concise finding, analysis, then supporting records and methodology. Cash-flow risk analysis includes timing, magnitude, duration, uncertainty, sensitivity, and whether the issue is temporary or sustained. Recommendations are optional, evidence-based, and leave decisions and changes to the user. Qualify unreliable findings or withhold recommendations. See [Product §5.6][product-insights].

### Data quality

- [x] **Q38.** ~~How should missing or stale values and unpriced assets affect the display?~~ Owner-confirmed 2026-11-05: show known amounts with dates and coverage warnings. If a missing value prevents a trustworthy complete total, show the known subtotal, explicitly label it as a subtotal, and withhold the complete total. Missing is not zero; preserve stale-value qualifications. Exact thresholds remain engineering detail. See [Product §7][product-quality].
- [x] ~~What does the Health Score measure, and what is the v1.0.0 minimum?~~ It concerns underlying data quality, not personal financial health. The wider product direction calls for an explainable overall score with component drill-down; listed dimensions are candidates. The minimum release explicitly requires stale-import, missing-coverage, and reconciliation indicators. See [Product §7.1][product-quality] and [minimum scope][product-minimum].
- [x] ~~Is a numerical Health Score needed in v1.0.0?~~ Owner-confirmed 2026-11-05: use clear coverage-gap, stale-balance, and reconciliation indicators for the initial release. Defer the numerical score until its method is defined, retaining it as longer-term product direction. See [Product §7.1][product-quality].
- [x] ~~May an unavailable institution source imply account closure, and may unavailable Drive storage trigger silent fallback?~~ No. Keep account identity/history and distinguish stale data from closure. If the primary cannot be verified, stop database operations, offer retry/reauthorization, and follow recovery. Do not silently switch copies or perform offline writes. See [Product §4.3][product-accounts] and [database lifecycle §§11, 47 and 48][database-setup].
- [x] ~~Should a stale account's balance disappear or look current in combined net worth?~~ Owner-confirmed 2026-11-05: keep the last known balance visible with an "as of" date, and mark combined net worth as containing stale values. See [Product §4.3][product-accounts].
- [x] ~~How should uncovered import periods be shown?~~ Owner-confirmed 2026-11-05: show coverage per account, with red gaps and text labels, so one account's imports cannot hide another's gaps and color is not the only cue. Preserve declared coverage, observed dates, import time, and completeness distinctions; transaction-free days alone do not establish a gap. See [Product §7.1][product-quality].
- [x] ~~Must resolving a quality issue discard evidence or overwrite prior decisions?~~ Review decisions preserve evidence and history. The contract supports confirming a match, keeping records separate, and correction handling; category corrections and undo are auditable events. See [canonical review decisions][ledger-review] and [PR25 correction decisions][pr25-history].

</details>

## Documentation conflicts and existing constraints

### Offline use versus offline writes

- [x] ~~Does the offline product direction approve offline financial writes?~~ No. Offline viewing and local analysis are product direction; offline financial writes remain prohibited, and browser storage is non-authoritative. See [Product §8][product-sync], [ADR-011][adr-device], and [database lifecycle §107][database-offline].

### Multi-device conflicts versus single-active-device operation

- [x] ~~Does automatic conflict-safe synchronization authorize simultaneous multi-device editing?~~ No. Single-user, single-active-device operation is accepted, simultaneous use is unsupported, and session coordination is best-effort. v1.0.0 does not require simultaneous multi-device operation. See [ADR-011][adr-device], [Product §8][product-sync], and [minimum scope][product-minimum]. Any future change requires a separate decision and a safe, tested architecture.

### Canonical history versus original imported files

- [x] ~~Does indefinite canonical-history retention replace the 540-day original-source policy now?~~ No. The current policies apply to different data: canonical history defaults to indefinite retention with automatic cleanup off; original imports retain their approved 540-day lifecycle. See [Product §7.2][product-quality], [ADR-010][adr-retention], and [Roadmap dependencies][roadmap-dependencies].

### Product vision versus PR #25 scope

- [x] ~~Does this product definition expand PR #25 or authorize production financial-data persistence?~~ No. PR #25's synthetic storage-readiness scope remains separate. Its merged [acceptance record][pr25-acceptance] still requires a separate production design/approval milestone and implementation PR. See also [Product §12][product-pr25].

### Wording and contract mismatches to reconcile

These are documentation or engineering follow-ups, not new owner decisions:

1. **Resolved: Beta planning scope.** The owner confirmed on 2026-11-05 that v1.0.0 planning is limited to basic category budgets and a baseline cash-balance projection. Goals and saved what-if scenarios are deferred. [Product §11's Beta paragraph][product-milestones] and [Roadmap Beta][roadmap-beta] now match that scope. The baseline averaging method and recalculation after changes are now confirmed; remaining calculation edge cases and confidence methodology still need specification.
2. **Later versions.** The "2.0.0 expanded capabilities" paragraphs may read as reserving all refinements for 2.0.0, while [Product §11][product-minimum] and [Roadmap minimum scope][roadmap-minimum] explicitly allow compatible 1.x additions. Later capabilities are candidates, not automatic commitments to a major version.
3. **Resolved documentation conflict, November 10.** [Data Model][data-model-history] now matches the [monthly migration decision][product-migration], with monthly summaries from January 2023. Workbook refund labels are historical evidence, not approval to count refunds as income in the new tracker. Expense-subcategory migration remains subject to workbook inspection, as §11.1 already states.
4. **Liability schema.** The [canonical account-type enum][ledger-account] lists checking, savings, credit card, brokerage, retirement, and other, while [Product §4.9][product-liabilities] names mortgages and auto loans. Engineering must specify a compatible representation; neither list silently cancels the other.
5. **Resolved status conflict, November 10.** Data Model and [Roadmap M1 status][roadmap-m1] now distinguish the merged contract and synthetic implementation from remaining Alpha work. [Project status](PROJECT_STATUS.md) owns the dated implementation/CI/deployment snapshot; a merge does not authorize production data.


## Other later opportunities already identified

These remain candidates unless separately prioritized. They are not unanswered prerequisites for v1.0.0:
- User-defined custom account types.
- Arbitrary custom transaction tags beyond the initial built-in types.
- Additional institution integrations beyond Wells Fargo, SoFi, and Fidelity.
- Advanced investment analysis, pricing, tax-lot, and performance features.
- Goals and saved what-if scenarios beyond v1.0.0, without a committed later version or date.
- More sophisticated budgets and projections.
- Full multi-currency capability.
- A numerical Data Quality Health Score once its scoring method is defined.
- Broader dashboard/report customization.
- Additional automation and categorization capabilities as deterministic rules mature.

Compatible additions may fit a minor release. No feature or date is committed merely by appearing here. See [minimum scope and version policy][product-minimum].


## Decision process

1. Consult the settled decisions and Product Definition before proposing changes.
2. Engineering prepares evidence, options, and a clearly labeled proposal for each relevant bundle.
3. Ask for owner input only on consequential choices that remain unresolved.
4. Keep recommendations separate from owner decisions. No recommended answers have been added by this consolidation.
5. Record each confirmed answer in the authoritative document and close only its resolved portion here.
6. Do not reopen deferred features or settled constraints merely to complete a checklist.

[milestone-discussion]: https://github.com/AeroVega/finance-tracker/pull/26#issuecomment-6652774716
[product-ux]: PRODUCT_DEFINITION.md#6-dashboard-reporting-and-navigation
[product-accounts]: PRODUCT_DEFINITION.md#43-standard-account-types
[product-liabilities]: PRODUCT_DEFINITION.md#49-liabilities-and-debt
[product-financial]: PRODUCT_DEFINITION.md#44-financial-activity-and-reporting-semantics
[product-categories]: PRODUCT_DEFINITION.md#46-categories
[product-currency]: PRODUCT_DEFINITION.md#47-multi-currency
[product-planning]: PRODUCT_DEFINITION.md#5-planning-and-decision-support
[product-insights]: PRODUCT_DEFINITION.md#56-insights
[product-quality]: PRODUCT_DEFINITION.md#7-data-quality-history-and-trust
[product-sync]: PRODUCT_DEFINITION.md#8-local-operation-and-synchronization
[product-imports]: PRODUCT_DEFINITION.md#10-privacy-storage-and-portability-constraints
[product-minimum]: PRODUCT_DEFINITION.md#minimum-coherent-v100-scope--owner-confirmed-2026-11-05
[product-milestones]: PRODUCT_DEFINITION.md#development-milestones-alpha--beta--100--200
[product-migration]: PRODUCT_DEFINITION.md#111-one-time-migration-of-first-generation-excel-history
[product-pr25]: PRODUCT_DEFINITION.md#12-pr-25-scope-boundary-synthetic-implementation-merged-production-remains-gated
[roadmap-beta]: ROADMAP.md#beta--visual-and-analytical-experience
[roadmap-minimum]: ROADMAP.md#owner-confirmed-minimum-v100-scope--2026-11-05
[roadmap-sequencing]: ROADMAP.md#milestone-and-pr-sequencing-rules
[roadmap-dependencies]: ROADMAP.md#current-delivery-work-and-dependencies
[roadmap-m1]: ROADMAP.md#m1-status--canonical-import-contract-and-synthetic-reconciliation
[database-coverage]: DATABASE_IDENTITY_AND_LIFECYCLE.md#3-preserve-import-level-coverage-derive-account-level-coverage
[database-setup]: DATABASE_IDENTITY_AND_LIFECYCLE.md#11-stop-database-operations-when-the-primary-is-unavailable
[database-settings]: DATABASE_IDENTITY_AND_LIFECYCLE.md#24-keep-everyday-ui-focused-put-full-inventory-in-settings
[database-integrity]: DATABASE_IDENTITY_AND_LIFECYCLE.md#39-gate-write-eligibility-on-integrity
[database-offline]: DATABASE_IDENTITY_AND_LIFECYCLE.md#107-keep-local-browser-storage-non-authoritative
[adr-device]: ARCHITECTURE_DECISIONS.md#adr-011--single-user-single-active-device-operation
[adr-retention]: ARCHITECTURE_DECISIONS.md#adr-010--original-csv-retention-duration
[ledger-account]: CANONICAL_LEDGER_CONTRACT.md#account
[ledger-financial]: CANONICAL_LEDGER_CONTRACT.md#4-financial-meaning-and-reporting-boundaries
[ledger-review]: CANONICAL_LEDGER_CONTRACT.md#review-decision
[provider-sources]: DATA_SOURCES.md#fidelity-brokerage
[provider-fidelity]: PROVIDER-IMPORT-SPECS.md#fidelity-accounts-history-export
[data-model-history]: DATA_MODEL.md#historical-monthly-summaries
[pr25-history]: https://github.com/AeroVega/finance-tracker/blob/8e8644e00bbb6c985e20f966020eaaf8a4cadcab/docs/PR25_ACCEPTANCE.md#L67-L77
[pr25-acceptance]: https://github.com/AeroVega/finance-tracker/blob/8e8644e00bbb6c985e20f966020eaaf8a4cadcab/docs/PR25_ACCEPTANCE.md#release-decision

[product-investments]: PRODUCT_DEFINITION.md#48-investments

[product-release]: PRODUCT_DEFINITION.md#11-delivery-and-release-philosophy
