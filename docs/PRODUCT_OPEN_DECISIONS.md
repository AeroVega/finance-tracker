# Product design: open decisions and resolved questions

**Status:** Living owner-decision register, reconciled against recorded decisions

**Companion document:** [Second Generation Finance Tracker: Product Definition](PRODUCT_DEFINITION.md)

**Last updated:** 2026-11-06

This register preserves unanswered product questions without reopening decisions already recorded elsewhere. It is not a checklist that must be completed immediately. Bring a question to the owner when it materially affects product behavior, architecture, data integrity, privacy, or release scope.

**Verified documentation audit:** Every question in the prior register was checked against PR #26 at `f8c049cb04a406b70e4236b31df3573f0785b916`, the repository's technical contracts, the [recorded milestone discussion][milestone-discussion], and the merged documentation on `main` at `8e8644e00bbb6c985e20f966020eaaf8a4cadcab`. Checked, struck-through items below are answered questions or answered portions of compound questions. Unchecked items are the remaining questions. A documented constraint is not proof of implementation or production approval. Examples, candidate features, and recommendations have not been promoted to owner decisions.

## 1. Product questions after reconciliation

### User experience and application structure

- [x] ~~What is the top-level navigation map and movement between overview and detail?~~ The map is Home / Activity / Accounts / Planning / More, with overview-first drill-down. Accounts contains holdings and liabilities; Planning contains goals, budgets, projections, and scenarios as those capabilities are introduced. Home cards open their related detail. Insights has an easily reached dedicated experience. See [Product §§2.3, 4.8 and 6][product-ux].
- [x] ~~Should Insights have a separate primary navigation tab?~~ Owner-confirmed 2026-11-06: a prominent Home card opens the dedicated Insights page. Keep Home / Activity / Accounts / Planning / More without adding a sixth tab. See [Product §6][product-ux].
- [x] ~~Should transaction labels support finding and grouping activity, and are custom tags needed in v1.0.0?~~ Owner-confirmed 2026-11-06: support search, filtering, sorting, and grouping by a consistent built-in set of transaction types. Refund, bank correction, paycheck, and purchase are examples, not the full taxonomy. Keep types distinct from categories and review status; custom tags are deferred. See [Product §6][product-ux].
- [ ] What detailed screen hierarchy, section contents, and navigation behavior implement that map? The precise report destinations, complete built-in transaction-type set, and detailed discovery controls remain open. The map does not make every eventual planning feature a v1.0.0 requirement.
- [x] ~~What is the first-run entry path, and must current institution imports precede useful history?~~ Establish authorized Drive access, select or confirm the primary database, and validate identity, binding, manifest, and primary role. Show available migrated history immediately without requiring new institution imports. Keep setup lightweight. Unverified folders require initialization, inspection, or recovery under the existing contract, never silent overwrite or database switching. See [Product §6][product-ux] and [database lifecycle §§11, 45, 47 and 50 to 55][database-setup].
- [ ] What exact first-run screens, transitions, and recovery presentation implement those established states and safeguards?
- [x] ~~Which broad Home content and report families belong in the initial experience?~~ The Roadmap specifies a present-day overview, recent activity, category breakdowns, net-worth and historical trends. Home uses flexible two-column cards and a prominent CSV-upload action. Required reporting covers income, spending, cash flow, savings, and net worth. See [Product §6][product-ux], [minimum v1.0.0 scope][product-minimum], and [Roadmap Beta scope][roadmap-beta].
- [ ] Which exact default cards, report layouts, remaining period controls, and breakdowns meet that scope? Apply the reporting-period decision below; the examples do not settle a complete card inventory or every ready-made report.
- [x] ~~May accounts disappear when imports stop, and is manual liability setup acceptable?~~ Accounts persist; closure or status changes must be explicit and preserve history. Manual liability creation and periodic balances are acceptable for v1.0.0. Closed-account history remains reportable. See [Product §§4.3 and 4.9][product-accounts] and [PR25 retained-history decisions][pr25-history].
- [ ] What should account creation, explicit closure, and manual balance-update screens and confirmation flows look like?
- [x] ~~Where do database management and retention settings belong?~~ Database management and the recognized-copy inventory belong in Settings; canonical-history retention is configurable there. More includes settings, data management, and diagnostics. See [database lifecycle §24][database-settings], [Product §7.2][product-quality], and [Product §6][product-ux].
- [ ] What additional settings are required for v1.0.0, and how should advanced settings be organized?

### v1.0.0 scope and release criteria

- [x] ~~What is the minimum coherent release scope and overall release gate?~~ The [owner-confirmed minimum][product-minimum] and [Roadmap][roadmap-minimum] fix the scope. Alpha establishes trustworthy data; Beta validates the scoped experience with synthetic data; integration and real-data acceptance follow only after storage/security authorization. January 1, 2027 is conditional on functional completeness, integrity, security, recovery, and explicit owner acceptance. Move the date if those gates are unmet.
- [ ] What measurable acceptance criteria demonstrate completion of each minimum-scope capability? Reuse the existing import, storage, and recovery contracts rather than asking the owner to redefine them.
- [ ] What dependency-aware schedule and sequencing complete Alpha, Beta, integration, and owner validation toward January 1, 2027? The milestone order and dependency rules are settled, but task estimates, dates, and critical dependencies are not. See [Roadmap sequencing][roadmap-sequencing].
- [ ] Which additional residual limitations block release, and which are acceptable when documented? Do not reopen the settled exclusions or treat correctness, privacy, recovery, cost, or owner-authorization gates as optional.

### Financial definitions and reporting

- [x] ~~Are income, spending, transfers, investment activity, cash movement, and net worth interchangeable, and what is the basic net-worth formula?~~ Their economic meanings are distinct. Net worth is assets minus liabilities; its change is not simply income minus spending. Internal transfers and investment purchases are not spending; card payments and debt principal are not second expenses. Investment income remains income, while market-value changes are not cash income. Net external cash flow excludes internal transfers. See [Product §4.4][product-financial].
- [ ] What detailed aggregation, valuation, remaining period-boundary, and calculation rules implement income, spending, cash flow, savings, assets, liabilities, net worth, and basic investment reporting? Use the agreed meanings and a clean mathematical design, not the old workbook's formulas or quirks.
- [x] ~~Should corrections and reversals overwrite history or count as unrelated extra economic events?~~ Preserve append-only events and derive effective reporting state without double-counting. Manual category corrections affect the transaction's original reporting period and retain an audit trail. Source, effective, and posted/settlement dates remain distinct. See [canonical ledger §§2 and 4][ledger-financial], [Product §4.6][product-categories], and [PR25 correction decisions][pr25-history].
- [x] ~~Should pending transactions appear in Activity and finalized income/spending totals?~~ Owner-confirmed 2026-11-06: show pending transactions clearly in Activity and exclude them from finalized income and spending totals until they post. See [Product §4.4][product-financial].
- [x] ~~Should refunds count as income or reduce spending, and in which reporting month?~~ Owner-confirmed 2026-11-06: apply the refund against its original spending category in the month it posts, preserving earlier months. For a partial refund, reduce spending only by the refunded amount. A persistent, navigable link to the original expense is a desired capability when the relationship can be established. See [Product §4.4][product-financial].
- [x] ~~How should an unmatched refund be handled?~~ Owner-confirmed 2026-11-06: retain a refund type label, visibly mark it for review, and allow manual spending-category assignment instead of guessing or treating it as income. Type, category, and review status remain distinct. See [Product §4.4][product-financial].
- [x] ~~How should a bank correction of a duplicate or erroneous charge affect reporting?~~ Owner-confirmed 2026-11-06: correct the original period's effective totals, preserve the audit trail, and clearly label the bank correction and original error. Do not present it as genuine spending followed by a refund or assume that every credit is a correction. See [Product §4.4][product-financial].
- [ ] What are the remaining pending-transaction rules for balances, cash flow, projections, and posted-date versus effective-date reporting? Beyond the confirmed unmatched-refund behavior, what remaining refund edge cases, review-resolution criteria, and linkage/matching behavior need specification, and what report inclusion and date rules apply to chargebacks, reversals, and other non-category corrections? Engineering must assess persistent refund-link feasibility and implementation. The cumulative effective-state calculations and compacted-summary adjustment mechanism still need a contract.
- [ ] When should reporting use trade date versus settlement date? Preserving both dates does not choose a reporting basis.
- [ ] What is the savings-rate denominator, and how do investment contributions, employer contributions, transfers, and other non-income inflows affect that metric? Their existing economic classifications do not settle the savings-rate formula.
- [x] ~~May incomplete, stale, estimated, or unknown data look like verified complete data or zero?~~ No. Show material limitations and distinguish these states. Declared import coverage, observed dates, and import time remain separate; claimed coverage does not by itself prove completeness. See [Product §§2.1, 7.1 and 10][product-quality], [database lifecycle §§3 to 6][database-coverage], and [Product import safeguards][product-imports].
- [ ] Beyond those safeguards, how should each report aggregate or qualify incomplete coverage, stale sources, and estimates? Define warning versus suppression behavior with the Data quality questions below.
- [x] ~~Which standard report families are required in v1.0.0?~~ Income, spending, cash flow, savings, and net worth are required, with monthly historical trends that identify workbook summaries separately from transaction imports. See [minimum v1.0.0 scope][product-minimum].
- [x] ~~What is the default reporting period for income, spending, and cash flow, and which broader history views should be easy to reach?~~ Owner-confirmed 2026-11-06: default to the current calendar month, with equally accessible previous-month, year, and lifetime views. Lifetime covers available recorded history and retains coverage and source-detail qualifications. See [Product §6][product-ux].
- [ ] What exact ready-made reports, formulas, remaining period controls, and drill-downs implement those families? Custom-date selection and the precise annual-view boundaries remain open. When workbook summaries overlap transaction-covered months, how does a report select or combine sources without double-counting or implying uniform detail? The no-double-counting and source-distinction requirements are settled in [Product §11.1][product-migration]; the selection rule is not.

### Projection methodology

- [ ] What horizon, time granularity, and update cadence should the baseline projection use?
- [ ] How should historical activity become baseline assumptions, including seasonality and unusual one-off activity?
- [ ] How should users enter and revise future assumptions?
- [x] ~~Must scenarios change actual records, and may old forecasts be replaced silently?~~ Named alternatives leave actual records unchanged. Historical forecasts retain their assumptions and then-available information for comparison with actual outcomes. See [Product §§5.3 and 5.4][product-planning].
- [ ] What statistical meaning and calibration should the uncertainty cone have when implemented? The intended widening-cone presentation is settled; the methodology is not.
- [ ] How should projection confidence reflect data quality?
- [ ] For later saved what-if scenarios, how should they be versioned and compared beyond the agreed named-alternative behavior?
- [ ] Which error measures and presentation should compare retained forecasts with subsequent actual outcomes, including systematic over- or under-estimation?
- [x] ~~Are sophisticated forecasts and scenario-management capabilities required for the initial release?~~ v1.0.0 requires a straightforward baseline cash-balance projection with stated assumptions. Goals and saved what-if scenarios are explicitly deferred, as is sophisticated forecasting. See [minimum v1.0.0 scope][product-minimum] and [Roadmap Beta scope][roadmap-beta].
- [x] ~~Which outcome should the first baseline projection estimate?~~ Owner-confirmed 2026-11-06: start with cash balance. Net-worth projection is lower priority. This choice does not settle the forecast horizon or methodology. See [Product §5.1][product-planning].
- [ ] What constitutes a useful complete initial cash-balance projection? Its horizon and methodology remain open above; later projection types need separate prioritization.

### Goals

- [x] ~~Are goals and saved what-if scenarios required for v1.0.0 planning?~~ Owner-confirmed 2026-11-06: defer both, retaining basic category budgets and the baseline projection as initial planning features. No later version or date is committed. See [Product §5][product-planning].

The questions below concern later goals. Purchase savings, emergency reserves, debt payoff, and investment milestones remain examples of intended uses, not a committed type list.

- [ ] For later goals, which simple types and fields should be introduced first, and in which release? Goals are explicitly outside v1.0.0.
- [ ] For that scoped goal experience, should milestones, multiple funding sources, priorities, or dependencies be supported? Do not make the deferred complex hierarchy a v1.0.0 prerequisite.
- [ ] How should goals without a fixed date or amount be represented?
- [ ] How should goal progress and likelihood of achievement be calculated and explained?
- [ ] How should competing goals be shown when available resources cannot satisfy all of them?

### Budgeting

- [x] ~~What initial budget period applies, and should unused budget carry forward?~~ Owner-confirmed 2026-11-06: use calendar-month category budgets, start each month fresh without unused-budget rollover, and retain previous months for comparison. No savings-transfer or overspend-carryover behavior was decided. See [Product §5.5][product-planning].
- [x] ~~Which budgeting capabilities are essential for v1.0.0 versus later releases?~~ Basic category budgets and spending comparisons are the required initial form; advanced rollover/customization can follow. Budgeting remains optional, and budgets represent targets while projections estimate outcomes. See [Product §5.5][product-planning] and [minimum scope][product-minimum].
- [x] ~~When should a changed budget target take effect?~~ Owner-confirmed 2026-11-06: apply the change to the current month onward and preserve previous months' targets for comparison. Retroactive overrides and prorating were not decided. See [Product §5.5][product-planning].
- [x] ~~Should v1.0.0 budgets also cover income targets or savings goals?~~ Owner-confirmed 2026-11-06: limit initial budgets to spending categories. Income targets and savings goals are deferred to separate later planning features, without a promised date or an implied v1.0.0 goals requirement. See [Product §5.5][product-planning].
- [x] ~~How do parent and subcategory actuals aggregate?~~ The hierarchy has two classification levels. A parent with subcategories is a reporting parent; child totals roll up without double-counting. Historical assignments and taxonomy changes preserve their established meanings. See [PR25 category decisions][pr25-history] and [Product §4.6][product-categories].
- [x] ~~Are subcategory budgets part of the initial release?~~ Owner-confirmed 2026-11-06: keep initial budgets at the main category level. Subcategory budgeting may be considered for a compatible 1.x release; no date or shared-allowance allocation design was approved. See [Product §5.5][product-planning].
- [ ] For later subcategory budgeting, how should parent and child targets interact, share limits, and handle historical parent-level actuals? The category rules settle actuals classification, not budget allocation. This is not a v1.0.0 requirement.
- [x] ~~Which values and wording should the budget display use?~~ Owner-confirmed 2026-11-06: show the target, actual spending, and remaining or over-target amount, plus a clearly labeled estimated month-end total when enough data is available. Use neutral wording. See [Product §5.5][product-planning].
- [x] ~~What should a budget show when import coverage is incomplete?~~ Owner-confirmed 2026-11-06: show recorded spending with a warning and withhold the month-end estimate if coverage gaps make it unreliable. See [Product §5.5][product-planning].
- [ ] What exact visualization communicates those values, and what forecast-data sufficiency criteria should govern month-end estimates? Overspend carryover behavior remains open.

### Multi-currency

- [x] ~~Is full multi-currency capability a v1.0.0 release requirement, and must historical rate context be preserved?~~ Full support is not required for v1.0.0. The foundational model preserves original amounts/currencies and treats converted amounts as derived values with a retained historical rate basis. Past reports must not silently change with today's rates. See [Product §4.7][product-currency] and [minimum scope][product-minimum].
- [ ] For later multi-currency capability, which currencies are supported and how is the primary display currency selected?
- [ ] Which exchange-rate source, if any, is authorized under the privacy and $0 constraints?
- [ ] Which date's rate applies to transactions and account/portfolio valuations?
- [ ] How should fees, spreads, and user-provided rates be represented?
- [ ] How should rate data be corrected or handled when unavailable while preserving the agreed historical basis and auditability?

### Investments

- [x] ~~Which broad investment capabilities are required initially?~~ v1.0.0 includes account balances, holdings, contributions, distributions, dividends, and basic investment activity. Advanced performance and tax-lot analysis are not release requirements. See [minimum scope][product-minimum].
- [ ] What exact investment account and security types belong in that basic supported set?
- [x] ~~Are Fidelity transaction and holdings exports available at all?~~ The owner confirmed brokerage and workplace-retirement transaction/holdings exports. The provider spec records a sanitized Accounts History sample covering brokerage and employer 401(k) activity. See [data-source evidence][provider-sources] and [Fidelity format observations][provider-fidelity]. These are availability confirmations and sample observations, not complete production parser validation.
- [ ] Which exact holdings schemas, original CSV mechanics, action semantics, and other initial-provider formats remain to be inspected and supported?
- [ ] Should security prices be imported, manually supplied, or obtained from an approved provider?
- [ ] How should stale/missing prices and unpriced assets be displayed beyond the settled rule that unknown is not zero?
- [ ] What basic performance measures, if any, belong in v1.0.0? Which methodology, such as time-weighted or money-weighted return, should later performance analysis use?
- [ ] What initial cost-basis, realized/unrealized-gain, and employer-match behavior is necessary? Do not reopen the exclusion of advanced performance/tax-lot analysis as a v1.0.0 gate.
- [x] ~~Can portfolio-value change alone represent investment return, or can investment purchases become ordinary spending?~~ No. Keep external flows, trades, dividends, interest, fees, distributions, and market changes distinguishable. Monthly retained history includes portfolio value, holdings, and specified cash-flow/performance components, including realized gains/losses; nominal values remain authoritative. See [Product §§4.4 and 4.8][product-financial], [canonical reporting boundaries][ledger-financial], and [PR25 monthly-history decisions][pr25-history]. Retaining components does not select a performance formula or require advanced analysis in v1.0.0.
- [ ] How do those components reconcile numerically to account balances and basic portfolio reporting, including incomplete holdings or activity?

### Liabilities

- [x] ~~Which standard debt examples and input approach are already agreed?~~ Credit cards, mortgages, and auto loans are named initial debt types. Manual liability creation and periodic balance updates are acceptable; use supported imports where available. See [Product §4.9][product-liabilities].
- [ ] What is the complete initial supported debt-type list and each type's required fields? Align the technical account-type representation with those product types; see §2.
- [ ] How should manual balance updates be dated and sourced?
- [ ] Should v1.0.0 include interest rates, minimum payments, scheduled payments, and amortization, or defer some of them?
- [x] ~~Are credit-card payments a second expense, and is debt principal repayment spending?~~ Card purchases count as spending when incurred; payments settle the liability. Principal repayment reduces debt; interest and fees are expenses. See [Product §4.4][product-financial].
- [ ] How should purchases, statements, payments, and liability-balance snapshots reconcile, beyond those settled classifications?
- [ ] What debt-payoff projection, if any, belongs in the initial baseline projection?

### Insights

- [ ] Which specific insight types are reliable and useful enough for v1.0.0? Spending changes, savings pace, unusual activity, and cash-flow risk are examples, not a selected initial catalog.
- [ ] How should findings be prioritized without repetitive or low-value observations?
- [ ] How should users dismiss, revisit, or mark an insight as understood?
- [x] ~~What evidence and calculation detail must an insight expose?~~ Explain evidence, assumptions, and uncertainty through a concise finding, analysis, then supporting records and methodology. Cash-flow risk analysis includes timing, magnitude, duration, uncertainty, sensitivity, and whether the issue is temporary or sustained. Recommendations are optional, evidence-based, and leave decisions and changes to the user. Qualify unreliable findings or withhold recommendations. See [Product §5.6][product-insights].
- [ ] What exact fields, calculations, and drill-downs implement that evidence standard for each chosen insight type?
- [ ] Are user-configurable thresholds needed? The dedicated Insights experience and no-default-push-notification direction are already settled in [Product §§5.6 and 6][product-insights].

### Data quality

- [x] ~~What does the Health Score measure, and what is the v1.0.0 minimum?~~ It concerns underlying data quality, not personal financial health. The wider product direction calls for an explainable overall score with component drill-down; listed dimensions are candidates. The minimum release explicitly requires stale-import, missing-coverage, and reconciliation indicators. See [Product §7.1][product-quality] and [minimum scope][product-minimum].
- [x] ~~Is a numerical Health Score needed in v1.0.0?~~ Owner-confirmed 2026-11-06: use clear coverage-gap, stale-balance, and reconciliation indicators for the initial release. Defer the numerical score until its method is defined, retaining it as longer-term product direction. See [Product §7.1][product-quality].
- [ ] For the later numerical Health Score, what components, weights, thresholds, and interpretation should it use? No later release or date is committed.
- [x] ~~May an unavailable institution source imply account closure, and may unavailable Drive storage trigger silent fallback?~~ No. Keep account identity/history and distinguish stale data from closure. If the primary cannot be verified, stop database operations, offer retry/reauthorization, and follow recovery. Do not silently switch copies or perform offline writes. See [Product §4.3][product-accounts] and [database lifecycle §§11, 47 and 48][database-setup].
- [x] ~~Should a stale account's balance disappear or look current in combined net worth?~~ Owner-confirmed 2026-11-06: keep the last known balance visible with an "as of" date, and mark combined net worth as containing stale values. See [Product §4.3][product-accounts].
- [ ] What stale-data thresholds, source-remediation actions, and any optional reminders are appropriate beyond that agreed presentation? Keep institution-source unavailability separate from the already-defined Drive failure behavior.
- [x] ~~How should uncovered import periods be shown?~~ Owner-confirmed 2026-11-06: show coverage per account, with red gaps and text labels, so one account's imports cannot hide another's gaps and color is not the only cue. Preserve declared coverage, observed dates, import time, and completeness distinctions; transaction-free days alone do not establish a gap. See [Product §7.1][product-quality].
- [ ] What detailed timeline presentation and reliability thresholds should govern coverage gaps and budget estimates? What rules should govern combining account data in reports beyond the confirmed per-account coverage view? Beyond the settled budget behavior, when should financial-data quality suppress other reports or projections rather than add a warning? Storage-integrity failures already have fail-closed constraints under [database lifecycle §§39 to 42][database-integrity].
- [x] ~~Must resolving a quality issue discard evidence or overwrite prior decisions?~~ Review decisions preserve evidence and history. The contract supports confirming a match, keeping records separate, and correction handling; category corrections and undo are auditable events. See [canonical review decisions][ledger-review] and [PR25 correction decisions][pr25-history].
- [ ] What remaining resolution screens and actions are needed for each quality finding, and how should the user see its effect on indicators, scores, reports, and projections?

## 2. Existing constraints and documentation conflicts

### Offline use versus offline writes

- [x] ~~Does the offline product direction approve offline financial writes?~~ No. Offline viewing and local analysis are product direction; offline financial writes remain prohibited, and browser storage is non-authoritative. See [Product §8][product-sync], [ADR-011][adr-device], and [database lifecycle §107][database-offline].
- [ ] Engineering must reconcile persistent offline-reading/cache behavior with §107's current restriction of IndexedDB to inventory and narrow recovery diagnostics before proposing that implementation. A change to the accepted storage contract requires explicit review; the product direction does not silently authorize it.

### Multi-device conflicts versus single-active-device operation

- [x] ~~Does automatic conflict-safe synchronization authorize simultaneous multi-device editing?~~ No. Single-user, single-active-device operation is accepted, simultaneous use is unsupported, and session coordination is best-effort. v1.0.0 does not require simultaneous multi-device operation. See [ADR-011][adr-device], [Product §8][product-sync], and [minimum scope][product-minimum]. Any future change requires a separate decision and a safe, tested architecture.

### Canonical history versus original imported files

- [x] ~~Does indefinite canonical-history retention replace the 540-day original-source policy now?~~ No. The current policies apply to different data: canonical history defaults to indefinite retention with automatic cleanup off; original imports retain their approved 540-day lifecycle. See [Product §7.2][product-quality], [ADR-010][adr-retention], and [Roadmap dependencies][roadmap-dependencies].
- [ ] If the owner wants the indefinite-retention preference to extend to original imported files too, should that separate policy change? That intention remains unconfirmed. No such change is approved or required to proceed under the present policies.

### Product vision versus PR #25 scope

- [x] ~~Does this product definition expand PR #25 or authorize production financial-data persistence?~~ No. PR #25's synthetic storage-readiness scope remains separate. Its merged [acceptance record][pr25-acceptance] still requires a separate production design/approval milestone and implementation PR. See also [Product §12][product-pr25].

### Wording and contract mismatches to reconcile

These are documentation or engineering follow-ups, not new owner decisions:

1. **Resolved: Beta planning scope.** The owner confirmed on 2026-11-06 that v1.0.0 planning is limited to basic category budgets and a baseline cash-balance projection. Goals and saved what-if scenarios are deferred. [Product §11's Beta paragraph][product-milestones] and [Roadmap Beta][roadmap-beta] now match that scope. The baseline projection's horizon and methodology remain open.
2. **Later versions.** The "2.0.0 expanded capabilities" paragraphs may read as reserving all refinements for 2.0.0, while [Product §11][product-minimum] and [Roadmap minimum scope][roadmap-minimum] explicitly allow compatible 1.x additions. Later capabilities are candidates, not automatic commitments to a major version.
3. **Historical migration.** [Data Model's annual-summary proposal][data-model-history] is stale against the later [monthly migration decision][product-migration]. Preserve monthly summaries from 2023 onward. Workbook refund labels are historical evidence, not approval to count refunds as income in the new tracker. Expense-subcategory migration remains subject to workbook inspection, as §11.1 already states.
4. **Liability schema.** The [canonical account-type enum][ledger-account] lists checking, savings, credit card, brokerage, retirement, and other, while [Product §4.9][product-liabilities] names mortgages and auto loans. Engineering must specify a compatible representation; neither list silently cancels the other.
5. **Stale status.** The [Data Model introduction][data-model-history] still calls the canonical contract proposed, while [Roadmap M1 status][roadmap-m1] records it merged. PR26's README and Product §13 also retain older PR24/PR25 status wording. Consult the current accepted contracts and [merged PR25 acceptance record][pr25-acceptance]; a merge does not authorize production data.

## 3. Future-version opportunities already identified

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

## 4. Engineering questions are not automatically owner questions

The engineering workstream should normally propose and resolve internal module boundaries, cache implementation within approved constraints, sync retry scheduling, data structures/indexing, deterministic rule evaluation, rendering, and CI/test organization. Escalate when a choice changes user-visible behavior, privacy, cost, data integrity, or an approved contract.

Provider-schema inspection, workbook inspection, testable acceptance criteria, and the delivery schedule require research and engineering proposals before asking the owner for consequential choices. Preserve product principles and explain tradeoffs rather than asking the owner to approve every implementation detail.

## 5. Decision process

For each unresolved topic:
1. Check this register and its linked decisions first.
2. State the remaining user-visible decision in plain language.
3. Explain meaningful options and tradeoffs, and label a recommended default as a recommendation.
4. Ask one question at a time only when owner input is needed.
5. Record the answer in the Product Definition or relevant authoritative contract, then resolve the corresponding question here with a reference.
6. Keep unanswered portions open. Never convert an assistant recommendation, example, or implementation observation into an owner decision.

The owner has already spent substantial time on product definition. Do not restart settled discussions.

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
[product-pr25]: PRODUCT_DEFINITION.md#12-pr-25-scope-boundary--do-not-expand
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
[data-model-history]: DATA_MODEL.md#historical-annual-summaries
[pr25-history]: https://github.com/AeroVega/finance-tracker/blob/8e8644e00bbb6c985e20f966020eaaf8a4cadcab/docs/PR25_ACCEPTANCE.md#L67-L77
[pr25-acceptance]: https://github.com/AeroVega/finance-tracker/blob/8e8644e00bbb6c985e20f966020eaaf8a4cadcab/docs/PR25_ACCEPTANCE.md#release-decision
