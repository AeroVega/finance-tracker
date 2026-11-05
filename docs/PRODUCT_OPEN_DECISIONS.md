# Product Design — Open Decisions and Future Questions

**Status:** Living owner-decision register  
**Companion document:** [Second Generation Finance Tracker — Product Definition](PRODUCT_DEFINITION.md)  
**Last updated:** 2026-11-05

This register preserves questions that have not yet been answered during product design. It is intentionally not a checklist that must be completed immediately. Bring decisions to the owner when they materially affect product behavior, architecture, data integrity, privacy, or release scope.

Do not infer an answer merely because a topic appears here. Do not reopen settled decisions without a concrete conflict or new evidence. Technical implementation details should be handled by the engineering workstream unless they require a consequential product decision.

## 1. Owner decisions recorded

These decisions are settled at the product-direction level. Detailed implementation choices may still be developed by the engineering workstream without reopening the underlying intent.

### Release progression
- Development proceeds through **Alpha** (trustworthy financial foundation), **Beta** (visual and analytical experience using controlled synthetic data), **1.0.0** (integrated release validated against actual financial data), and **2.0.0** (expanded capabilities).
- Alpha and Beta are deployable development milestones, not semantic-version product releases. The owner should be able to smoke-test each on target devices through the existing GitHub Pages workflow.
- PR numbering does not prescribe merge order; dependency and readiness determine sequencing.
- The prior-generation Excel history is a first-class Alpha input. Monthly aggregate history must retain its granularity and must not be fabricated into transaction-level records.

### Dashboard and application structure
- The intended primary navigation is **Home | Activity | Accounts | Planning | More**, with the broad responsibilities documented in the Product Definition.
- Home is a present-day overview with a flexible two-column bento-style card layout. Cards may vary in size and should drill into their relevant detailed experiences.
- CSV upload is a prominent Home action during the initial release.
- Insights has a dedicated, readily accessible experience and must not be buried in infrequently used settings. A prominent Home card is an intended entry point; whether Insights becomes its own primary navigation destination remains unresolved.

### First-run priorities
- Initial setup should be lightweight and prioritize importing or migrating financial history rather than requiring a lengthy tutorial.
- Exact first-run screens, sequence, and recovery behavior remain unresolved.

### CSV coverage and import validation
- Coverage period is distinct from the earliest/latest transaction dates observed in a CSV. Do not infer coverage from account-balance arithmetic.
- If explicit coverage metadata exists in the file, extract it and ask the user to confirm it. Otherwise, the user declares inclusive start and end dates using two independently navigable side-by-side calendars.
- For repeat imports into the same account, the app may suggest a start date based on the day after the previous confirmed coverage end date. The suggestion remains editable and is not confirmation.
- Validate every usable transaction date against the declared period. Flag and identify out-of-range dates; do not silently expand the period. The user resolves the discrepancy by adjusting the selected range or investigating the file before finalizing the import.
- Files with no usable transaction dates require review. Preserve declared coverage, observed transaction-date range, import timestamp, and whether coverage came from source metadata or user declaration as separate facts.

## 2. Explicitly unresolved product decisions

### User experience and application structure
- What detailed screen hierarchy, section contents, and navigation behavior should implement the agreed Home / Activity / Accounts / Planning / More structure?
- What exact first-run screens, sequence, and recovery behavior should support the agreed import-first, lightweight setup?
- How should the user move between dashboard, accounts, transactions, reports, investments, goals, projections, budgets, and insights?
- Which dashboard components and ready-made reports are essential for the first release?
- What should account creation, account closure, and manual balance updates look like?
- Which settings belong in the first release, and how should advanced settings be organized?

### v1.0.0 scope and release criteria
- What is the minimum coherent v1.0.0 implementation for each capability in the Product Definition?
- Which capabilities must be fully implemented at release, and which can have a deliberately limited initial form?
- What are the measurable acceptance criteria for feature completeness and production readiness?
- How should the original January 1, 2027 target be re-baselined against the expanded product vision?
- What are the release-blocking limitations versus acceptable documented limitations?

### Financial definitions and reporting
- Final definitions for income, spending, net cash flow, savings rate, assets, liabilities, net worth, and investment performance.
- Reporting treatment and date basis for pending activity, refunds, chargebacks, reversals, and corrections.
- Trade-date versus settlement-date treatment where relevant.
- Savings-rate denominator and treatment of investment contributions, transfers, employer contributions, and other non-income inflows.
- How reports should treat incomplete account coverage, stale sources, and estimated values beyond the already-established rule that missing is not zero.
- Which standard reports are required in v1.0.0 and their exact calculation definitions.

### Projection methodology
- Projection horizon, time granularity, and update cadence.
- How historical activity is converted into baseline assumptions, including seasonality and unusual one-off activity.
- How users enter and revise future assumptions.
- Statistical interpretation and calibration of the uncertainty cone.
- How projection confidence and data quality interact.
- How saved scenarios are versioned and compared.
- How forecast accuracy is measured and presented over time.
- Which projection types are required in the initial release versus later versions.

### Goals
- Initial supported goal types and required fields.
- Whether goals can have milestones, multiple funding sources, priorities, or dependencies.
- How to represent goals without a fixed target date or target amount.
- How goal progress and likelihood of achievement should be calculated and explained.
- How competing goals should be shown when available resources cannot satisfy all of them.

### Budgeting
- Initial budget periods and whether rollover is supported.
- Whether targets apply only to categories or also to income, savings, and goals.
- How shared parent/subcategory budgets behave under the established two-level category model.
- How to present overspending, remaining budgets, and projected end-of-period totals without judgmental language.
- Which budgeting capabilities are essential for v1.0.0 versus later releases.

### Multi-currency
- Supported currency list and how the primary display currency is selected.
- Authorized source of exchange rates, if any, consistent with the privacy and $0 recurring-cost constraints.
- Which date's rate applies to transaction conversions and account/portfolio valuations.
- How to represent fees, spreads, and user-provided exchange rates.
- How historical conversions are preserved and corrected when source-rate data changes or is unavailable.

### Investments
- Initial investment account and security types supported.
- Which holdings and transaction formats are available from the agreed initial providers.
- Whether security prices are imported, manually supplied, or sourced through an approved provider.
- How stale/missing prices and unpriced assets are displayed.
- Which performance methodologies are needed initially (for example, time-weighted versus money-weighted return).
- Cost-basis, realized/unrealized gain, tax-lot, and employer-match scope for v1.0.0 versus later releases.
- How investment cash, trades, dividends, fees, and distributions reconcile to account balances and portfolio performance.

### Liabilities
- Initial standard debt types and fields.
- How manual balance updates are dated and sourced.
- Whether v1.0.0 should support interest rates, minimum payments, scheduled payments, and amortization, or defer some of these.
- How credit-card purchases, statements, payments, and liability balances reconcile.
- What level of debt payoff projection is appropriate initially.

### Insights
- Which insight types are useful and reliable enough for v1.0.0.
- How to prioritize findings and avoid repetitive or low-value observations.
- How users can dismiss, revisit, or mark an insight as understood.
- What evidence and calculation detail each insight must expose.
- Whether any user-configurable thresholds are needed; unsolicited push notifications remain off by default unless separately approved.

### Data quality
- Exact components, weights, thresholds, and interpretation of the Data Quality Health Score.
- How to handle a source that is unavailable for an extended period.
- When a quality issue should suppress a report or projection versus simply add a warning.
- How users can resolve data-quality findings and see the effect of the resolution.

## 3. Cross-cutting questions requiring explicit reconciliation

These are especially important because existing engineering contracts constrain what the product can safely do.

### Offline use versus offline writes
The product decision supports offline viewing and local analysis (reports, searches, and projections) using locally available data. It does **not** yet approve offline financial writes. The accepted database lifecycle ADR currently says offline writes are prohibited and local browser storage is non-authoritative. Any proposal to queue offline changes or make local data writable requires a separate owner decision and a revised, tested architecture.

### Multi-device conflict resolution versus single-active-device operation
The product-level direction is to synchronize independent changes automatically and surface genuine conflicts for review. The current accepted storage architecture is single-user, single-active-device; simultaneous use on two devices is unsupported and coordination is best-effort, not a server-enforced lock. Do not implement simultaneous multi-device editing or imply it is supported until the owner explicitly revisits that constraint and the storage architecture can demonstrate safe conflict handling.

### Canonical financial history versus original imported source files
The product-level retention decision is indefinite retention of canonical financial history by default, with automatic cleanup disabled and configurable settings. A separate existing decision specifies a 540-day retention period for original imported source files. Confirm whether the new indefinite-retention preference applies only to canonical ledger/history and summaries, or whether the owner intends to revisit the original-source-file policy too. Do not change PR #25's approved 540-day source-file retention scope without explicit approval.

### Product vision versus PR #25 scope
PR #25 remains limited to its original synthetic-only backup, restore, portability, retention, recovery, OAuth/security, cost/terms, and owner-acceptance gates. The product features in the companion definition are future product work, not additions to PR #25.

## 4. Future-version opportunities already identified

These are intentionally deferred unless the owner promotes them:
- User-defined custom account types.
- Additional institution-specific integrations beyond the initially agreed Wells Fargo, SoFi, and Fidelity scope.
- More advanced investment analysis, pricing, tax-lot, and performance features.
- More sophisticated budgeting and goal planning.
- Expanded projection methodology and scenario tools.
- Broader customization of reports and dashboards.
- Additional automation and categorization capabilities as deterministic rules mature.

## 5. Engineering questions are not automatically owner questions

The following should normally be proposed and resolved by the engineering workstream, escalating only when they change user-visible behavior, privacy, cost, data integrity, or a previously approved contract:
- Internal module boundaries and code organization.
- Exact local caching strategy and cache invalidation.
- Sync scheduling and retry backoff within the approved synchronization behavior.
- Data structures, indexing, and query performance.
- Detailed deterministic rule evaluation and test fixtures.
- Internal charting and report-rendering implementation.
- CI organization and test harness details.

Engineering must preserve the product principles, explain tradeoffs, and bring back consequential choices rather than asking the owner to approve every implementation detail.

## 6. Decision process

For each unresolved topic:
1. State the user-visible decision in plain language.
2. Explain the meaningful options and tradeoffs.
3. Recommend a default.
4. Ask one question at a time only when owner input is needed.
5. Record the answer in the companion Product Definition or the relevant authoritative technical contract.
6. Keep unanswered items open; never silently turn an assistant recommendation into an owner decision.

The owner has already spent substantial time on product definition. Future sessions should consult this register and avoid restarting settled discussions. Ask only the next consequential question when it is genuinely needed.
