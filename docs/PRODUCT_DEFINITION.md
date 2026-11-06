# Second Generation Finance Tracker — Product Definition

**Status:** Owner-reviewed design baseline in progress  
**Product:** Second Generation Finance Tracker (working name)  
**Target release:** v1.0.0  
**Last updated:** 2026-11-06

This document captures the product direction and owner-approved principles established during the November 2–6, 2026 product-design discussions. It is intended to guide future product, architecture, implementation, and review sessions.

It is a product specification, not an implementation plan or authorization to enable production financial-data persistence. Detailed technical contracts and release gates remain in their existing architecture and acceptance documents. Where this document identifies a conflict with an existing approved technical constraint, the conflict is called out rather than silently resolved.

## 1. Product vision

Finance Tracker is a **personal financial intelligence application**. Its primary purpose is to help one person understand their current financial position, understand how they arrived there, anticipate where they may be heading, explore alternative decisions, and measure progress toward meaningful financial goals.

It is more than a transaction importer or accounting ledger. A trustworthy historical record is the foundation for useful analysis, but the product should help the user make sense of their finances and evaluate possible futures.

The product should answer four broad questions:

1. **Where am I now?** — a consolidated, trustworthy view of assets, liabilities, cash flow, investments, and financial position.
2. **How did I get here?** — traceable history, understandable reports, and the ability to drill down to the underlying accounts and records.
3. **Where might I be heading?** — projections based on observed history, current circumstances, and explicit future assumptions.
4. **What if I make a different choice?** — goals, budgets where desired, and named scenarios that let the user explore alternatives without changing actual financial records.

## 2. Product principles

### 2.1 Trust before completeness

Conservative accuracy is more important than a complete-looking dashboard. Never invent missing information or silently treat missing, unavailable, stale, or incomplete data as zero. Distinguish verified facts, estimates, incomplete coverage, unavailable sources, and unknown values. Explain calculations and assumptions.

### 2.2 One financial truth, many perspectives

Accounts and activities should have one authoritative underlying representation. The user can view the same information by institution and account, by financial purpose, or as a consolidated financial position. Reports, dashboards, and presentation choices must not create duplicate or divergent financial records.

### 2.3 Overview first, detail on demand

Present a useful, understandable summary by default. Let users progressively drill down into institutions, accounts, holdings, categories, transactions, source records, calculation methods, and supporting evidence. This principle applies throughout the product, not only to the dashboard.

### 2.4 Local-first responsiveness

Routine reading, analysis, reporting, and projection work should use locally available data wherever practical. Minimize unnecessary network activity. Network communication should be reserved for synchronization, authentication, and operations that genuinely require the storage provider.

The product should remain meaningfully useful without an internet connection for viewing previously available information and performing local analysis. Offline write behavior is not decided here; see the open questions and existing database lifecycle ADR.

### 2.5 Explainable, deterministic automation

The product should become more useful through use, using traditional deterministic software engineering rather than external AI services. User corrections and preferences can inform inspectable, editable, reversible rules. Ambiguous cases should be flagged rather than guessed.

Automation should reduce repetitive work without hiding consequential decisions:
- Low-risk routine work may happen automatically and quietly.
- Medium-risk changes may happen automatically with clear notice and easy undo.
- Destructive or consequential actions require explicit user approval.

Undo restores the prior effective state without erasing the audit history. The detailed correction-event and categorization contracts remain governed by the canonical ledger and architecture documents.

### 2.6 Privacy and data sovereignty

Financial information must never be transmitted to services outside the user's own storage provider. Authorized authentication and storage-provider communication are permitted. No external AI service, advertising/data broker, third-party analytics receiving financial information, or unrelated enrichment service may receive financial data.

Do not store bank passwords, scrape financial institutions without authorization, or introduce a paid or expiring-trial dependency. Manual file import remains a permanent supported path.

### 2.7 Portability and long-term continuity

The user owns the financial history, not a particular app generation. Provide complete, documented, portable export and restore capabilities, including the information needed to preserve history and meaning—not only transaction rows. Future generations must be able to import prior-generation archives. Avoid artificial lock-in and unnecessary dependencies.

### 2.8 Deliberate evolution

v1.0.0 is the first complete release of this product direction, not the end of development. Prefer additive, backward-compatible changes. Major changes require documented migration paths and preservation of financial meaning. Keep the architecture modular and maintainable over many years.

## 3. Intended user and platforms

- **Initial audience:** one individual managing their own finances. This is not a household or multi-user product in v1.0.0.
- **Primary platform:** mobile-first, with iPhone as the priority experience.
- **Tablet:** iPad-friendly, using the additional space for dashboards, charts, comparisons, and detail.
- **Desktop:** fully capable for all core features, not a crippled companion.
- **Accessibility readiness:** use scalable layouts and typography, semantic structure, and avoid color-only communication or hardcoded assumptions that would make future accessibility work require architectural rework. Comprehensive accessibility implementation can be phased; do not introduce barriers now.

## 4. Core financial model and organization

### 4.1 Unified financial picture

The application should consolidate cash, investments, and liabilities into one financial picture while preserving traceability to the original institution, account, source record, and history.

### 4.2 Two complementary account views

Provide at least two primary ways to browse the same accounts:

1. **Institution and account:** institution/company, then its accounts.
2. **Financial purpose:** cash, investments, retirement, credit cards, loans, and other standard purposes.

Also provide a consolidated financial-position view. Switching perspectives must not duplicate or alter the underlying records.

### 4.3 Standard account types

Use a controlled standard set of account types in v1.0.0. Users may give accounts their own names, but arbitrary custom account types are deferred to a future release. Keep the model extensible enough to add them later without rewriting historical records.

Financial accounts are persistent entities. Once an account has been created or recognized and associated with financial history, it remains available even when the user stops importing data from that institution or account. The absence of a new import is not evidence that an account has closed, been deleted, or ceased to exist. Preserve its identity and historical relationships, and distinguish stale or missing recent data from an explicitly closed or inactive account. Any future closure, archival, deletion, or status change must be explicit and preserve historical integrity; do not infer it from import inactivity.

### 4.4 Financial activity and reporting semantics

The application must distinguish the economic meaning of financial activity from the movement of money between accounts. A transaction must not be classified as income or expense merely because cash entered or left an account.

Use these distinct concepts throughout the ledger, calculations, dashboards, and reports:

- **Income:** Economic inflows earned or received, such as wages, interest, and dividends. Classify income according to its source and meaning, not simply its deposit into a cash account.
- **Expenses / spending:** The cost of goods, services, and other consumption or obligations. Spending reports must exclude internal transfers and investment purchases. Credit-card purchases are spending when incurred; paying the card balance is settlement of the liability, not a second expense. Debt principal repayment reduces a liability rather than representing an expense; interest and fees are expenses.
- **Transfers:** Movement of funds between accounts owned by the user. Transfers are neither income nor spending. Link both sides when evidence supports the relationship and avoid double-counting.
- **Investment activity:** A distinct activity domain covering contributions and withdrawals, purchases and sales, dividends, interest, fees, and other investment events. An investment purchase or contribution moves existing funds into an investment and is not ordinary household spending or new income. Investment income (such as dividends and interest) retains its income meaning while also remaining identifiable as investment activity. Changes in market value are investment performance, not cash income.
- **Cash flow:** Movement of cash into and out of cash accounts over a period. Cash-flow reporting must make internal transfers visible as a separate component so users can distinguish gross account movement from flows entering or leaving their overall finances. Net external cash flow excludes transfers between the user's own accounts.
- **Assets and liabilities:** Assets represent what the user owns; liabilities represent what the user owes. Both contribute to a consolidated financial-position view.
- **Net worth:** Assets minus liabilities at a point in time. **Change in net worth** compares those positions across dates and can reflect saving, investment performance, debt changes, and valuation changes—not only income minus expenses.

Provide separate, complementary views for **spending** and **total cash movement**. Spending reports answer what the user consumed or paid for; cash-flow reports answer how money moved through accounts and distinguish internal transfers from external inflows and outflows. Investment activity and performance must remain separately inspectable rather than being folded into ordinary spending.

**Owner-confirmed 2026-11-06:** Show pending transactions clearly in Activity, but exclude them from finalized income and spending totals until they post. This decision does not settle pending balances, cash-flow or projection treatment, or posted-date versus effective-date reporting.

**Owner-confirmed 2026-11-06:** Count a refund against its original spending category in the month the refund posts. A partial refund reduces spending only by the refunded amount, in the month it posts. Do not treat refunds as income or restate the earlier purchase month solely because of the refund. The desired experience includes a persistent, navigable link to the original expense when the relationship can be established. Engineering must assess how the storage model can support that link and specify feasibility, matching, and implementation details; this is a desired capability, not a claim that it is implemented.

**Owner-confirmed 2026-11-06:** An unmatched refund keeps a clear refund type label, is visibly marked for review, and allows the user to assign a spending category manually. Do not guess its category or original expense, or classify it as income. Its transaction type, spending category, and review status are separate concepts.

**Owner-confirmed 2026-11-06:** When the bank corrects a duplicate or erroneous charge, correct the original reporting period's effective totals while preserving the audit trail. Clearly label the bank correction and its relationship to the original error, so the error is not presented as real spending followed by a refund. This treatment applies to identified bank corrections; a credit alone does not establish that it is a correction.

These distinctions are foundational reporting semantics. They must be applied consistently across categorization, account activity, summaries, charts, and projections. The first-generation workbook is a historical data source for migration, not the mathematical authority for the new application: do not mechanically reproduce its formulas or calculation quirks. Design new formulas using sound, consistent, explainable financial methodology. Detailed formulas and date-treatment edge cases remain open where identified in the product-decision register.

### 4.5 Transfers

Transfers are a distinct financial activity, not income or spending. Link outgoing and incoming sides when evidence supports the relationship, including transfers across institutions. Avoid double-counting. Uncertain or incomplete pairs require review rather than unsupported assumptions.

This reaffirms the existing canonical ledger decision; it is not a new implementation request.

### 4.6 Categories

Provide a standard built-in category set and allow users to manage their categories. Preserve the already-established category semantics: historical classification is retained as recorded; taxonomy changes apply prospectively; renames do not rewrite historical labels; meaningful splits create new identities; merges are prospective; optional subcategories are limited to two classification levels; and manual corrections are auditable, affect the effective historical reporting period, and can be undone through additional events rather than erasing prior history.

The detailed category identity, hierarchy, correction, and compaction rules are governed by the canonical ledger/PR25 acceptance decisions. Do not replace them with a simpler retroactive-recategorization model.

When the user manually corrects a transaction's category, the correction automatically becomes or updates a reusable deterministic categorization rule by default; no separate confirmation or promotion step is required. The corrected transaction reflects the user's selection, and future transactions matching the resulting rule are categorized consistently. Derive the rule from the explicit correction without inferring a broader pattern than the correction supports. Rules must remain inspectable and maintainable, and corrections must preserve the canonical ledger's audit history and historical meaning. Detailed matching keys, rule representation, precedence, conflict resolution, and rule lifecycle remain engineering design matters.

### 4.7 Multi-currency

Multi-currency support belongs in the foundational model, even if the initial setup uses only one currency. Preserve original amounts and currencies. Allow a primary display currency for consolidated views. Converted amounts are derived values; preserve the exchange-rate basis used for historical reporting so past reports remain explainable and do not silently change with today's rates.

### 4.8 Investments

Investments are a first-class financial domain, not merely a balance displayed beside checking accounts. The intended experience includes:
- Portfolio overview and allocation.
- Account-level detail.
- Holdings and point-in-time positions.
- Contributions/deposits, withdrawals, dividends, interest, fees, trades, and other investment activity.
- Performance reporting that distinguishes external cash flows from investment returns.

The user should be able to move from an overall portfolio view to accounts, holdings, and activity. Existing historical-retention decisions for monthly investment values, holdings, and cash-flow/performance components remain applicable.

### 4.9 Liabilities and debt

Liabilities are first-class financial entities and contribute to net worth. The initial experience should support standard debt types such as credit cards, mortgages, and auto loans.

For v1.0.0, manual liability creation and periodic balance updates are acceptable. Use supported file imports where available. Additional institution-specific integrations are deferred rather than expanding the initial integration scope. The interface should establish the intended long-term experience without pretending unsupported automatic feeds exist.

## 5. Planning and decision support

### 5.1 Projections

Projections are a core capability. They estimate likely future outcomes using observed financial history, current circumstances, and explicit future assumptions. They should remain useful even when the user has not created budgets or goals.

### 5.2 Goals

Goals provide measurable desired outcomes for projections to evaluate. They may include saving for a purchase, building or maintaining an emergency reserve, paying off debt, or reaching an investment milestone. Goals should be optional and should help users understand whether, when, and under what assumptions an outcome may be reached.

The product should connect goals, projections, and scenarios without requiring users to configure every part of the system.

### 5.3 Projection scenarios

Allow users to create named alternative scenarios and compare them. Examples include a salary change, new mortgage, major expense, changed savings contribution, or altered debt payoff plan. Hypotheticals must never alter actual financial records.

The default projection should represent the expected trajectory based on currently available data and assumptions. Scenarios are alternatives, not competing versions of actual history.

### 5.4 Uncertainty and forecast accountability

Future projections should communicate uncertainty rather than presenting a single precise-looking number. The intended presentation includes an uncertainty cone that widens over time. Detailed statistical methodology, confidence interpretation, and calibration remain open design work.

Preserve past forecasts as historical projections with their assumptions and information available at the time. Compare them with subsequent actual outcomes and assess forecast error, including systematic over- or under-estimation. Do not silently replace old forecasts with newer ones.

### 5.5 Budgeting

Budgeting is optional. The application must be useful without user-created budgets. Where used, budgets represent user intent (targets), while projections estimate likely outcomes. Actual activity connects the two.

A lightweight initial budget experience may include periodic category targets, actual-versus-target comparisons, remaining budget, projected end-of-period spending, and historical comparisons. Exceeding a target is information, not a moral judgment or product failure.

**Owner-confirmed 2026-11-06:** Initial budgets cover spending categories only, at the main category level. Income targets and savings goals belong to separate later planning features; no later release date or v1.0.0 goals requirement is implied. Subcategory budgets are deferred as a possible compatible 1.x addition, without a committed date or allocation design. Category budgets use calendar months, with each month starting fresh. Unused budget does not carry forward into the next month. Keep previous months available for comparison. Budget-target changes apply to the current month onward, while previous months retain their targets for honest comparisons. Savings transfers, overspend carryover, retroactive target overrides, and prorating remain unspecified.

### 5.6 Insights

Provide a dedicated Insights experience that the user can visit. Do not default to unsolicited push notifications. Insights should identify meaningful patterns and risks—such as spending changes, savings pace, cash-flow risk, unusual activity, or projection outcomes—and explain the evidence and assumptions.

For potentially low balances or cash-flow problems, provide useful analysis: when a threshold may be crossed, estimated magnitude and duration, uncertainty, sensitivity to assumptions, and whether the issue appears temporary or sustained. Avoid generic or obvious advice.

Insights may include actionable recommendations when supported by reliable financial evidence. Present the progression from observation to interpretation to an optional recommendation. Recommendations must be specific, explainable, proportionate to the evidence, and disclose material assumptions and uncertainty. They must preserve user control and never modify financial records, budgets, goals, or planning assumptions without explicit user action. When data is incomplete or unreliable, qualify the finding or withhold a recommendation rather than guessing. Not every insight needs a recommendation; descriptive or analytical findings remain appropriate when no meaningful action is warranted. Offer scenario exploration; leave financial decisions to the user.

Use progressive transparency: concise finding first, then analysis, then supporting records and methodology.

## 6. Dashboard, reporting, and navigation

- Provide a sensible useful dashboard by default; users must not have to build one.
- Allow optional dashboard customization: add, remove, and rearrange components, with a way to restore defaults.
- Provide ready-made reports with documented definitions.
- Allow users to create custom report views and pivot-style analysis without attempting to recreate all of Excel.
- Presentation and report customization must not alter the underlying financial records.
- Maintain consistent overview-first, drill-down behavior throughout the application.

The intended primary navigation is:

- **Home:** a present-day, bird's-eye overview of financial position, recent developments, and broad trends.
- **Activity:** historical transactions, transfers, and day-to-day financial history.
- **Accounts:** institutions, individual accounts, balances, holdings, assets, and liabilities.
- **Planning:** goals, budgets, projections, and scenarios.
- **More:** settings, data management, diagnostics, and less frequently used functions.

**Owner-confirmed 2026-11-06:** Activity must let the user search, filter, sort, and group transactions by clear, consistent built-in transaction type labels in v1.0.0. Refund, bank correction, paycheck, and purchase are examples, not an exhaustive taxonomy. Transaction type is separate from categories such as groceries and from review status, so the user can find all refunds or just grocery refunds. Arbitrary custom tags are deferred to later releases. The complete built-in type set, its mapping to the canonical ledger, and the detailed controls remain to be specified; this records the intended behavior, not an implemented feature.

Home should use a flexible two-column bento-style arrangement of dashboard cards rather than a rigid uniform grid. Cards may vary in size and height. A net-worth trend chart is one card among others, not a mandatory full-width banner. Other useful cards may include a category breakdown, recent transactions, and current financial-position summaries. Each card should open the relevant detailed experience when selected.

CSV upload should be a prominent, readily accessible Home action because importing data is a frequent and essential task during the initial release.

**Owner-confirmed 2026-11-06:** A prominent Home card opens the dedicated Insights page. Keep the five primary tabs: Home / Activity / Accounts / Planning / More. Insights does not add a sixth tab and must not be buried among infrequently used settings.

**Owner-confirmed 2026-11-06:** Income, spending, and cash-flow reports default to the current calendar month. Views for previous months, the year, and lifetime must be equally easy to access. Lifetime means all available recorded history, with incomplete coverage, missing periods, and differences between workbook-derived summaries and transaction-level data still made clear. It does not imply a complete lifetime financial record.

The first-run experience should prioritize getting useful financial history into the application. Initial setup should be lightweight and should not require a lengthy guided tutorial. Without imported or migrated data, most of the product has little value.

After the user establishes authorized access to Google Drive and selects or confirms the primary Finance Tracker database directory, the application should validate the database identity, folder binding, manifest, and primary role under the accepted database lifecycle contract. A folder name or remembered path alone is not sufficient proof. If the selected directory is empty, unrecognized, or cannot be verified as the primary database, follow the established initialization, inspection, or recovery process; never silently create, overwrite, or switch databases. If Drive access is unavailable, explain the access or recovery state rather than presenting financial history as empty or zero.

Once the authoritative Drive data is accessible, show the user's migrated historical financial summaries immediately. Do not require current Wells Fargo, SoFi, or Fidelity imports before presenting useful historical information. Clearly distinguish the available historical baseline from current institution data that has not yet been imported. The exact screens, sequence, and recovery behavior remain open design work.

## 7. Data quality, history, and trust

### 7.1 Data quality health

Provide an explicit **Data Quality Health Score** describing the quality of the underlying financial data—not the user's personal financial health. Provide one overall score with component-level explanations available on drill-down. Candidate dimensions include freshness, completeness, reconciliation, import integrity, and source availability.

The score must be explainable; it must not be a mysterious algorithm. Reports and projections should make material data-quality limitations visible.

### 7.2 Historical retention

Default canonical financial-history retention to indefinite, with automatic cleanup disabled. Retention settings should be user-configurable in Settings. Destructive cleanup must explain what will be removed, what summaries remain, and what backup safeguards apply; permanent deletion requires explicit authorization.

This is a product-level direction for financial history. It does not silently change the separately approved 540-day policy for original imported source files; the relationship between those retention domains is explicitly listed as an open question.

### 7.3 Historical continuity

Long-term reports should remain meaningful across account closure, category evolution, data compaction, and application generations. Preserve stable identities and historical semantics. Monthly summaries and verifiable checkpoints may support long-term reporting while detailed old events are compacted only under the already-established safeguards and explicit authorization.

## 8. Local operation and synchronization

- Routine reading, reports, analysis, and projections should run locally from available data wherever practical.
- Minimize network activity and avoid re-fetching unchanged information unnecessarily.
- Synchronization should happen automatically in the background when connectivity is available.
- Provide an accessible **Sync Now** action for user reassurance and manual initiation.
- Clearly distinguish synchronized, synchronizing, pending local changes, stale data, and synchronization errors.
- Recover safely from interrupted synchronization without silently losing or duplicating financial records.
- Resolve independent changes automatically where safe; flag genuine conflicts for user review rather than silently choosing a version.
- Manual synchronization is an additional control, not a routine requirement for data safety.

**Important existing constraint:** the accepted database lifecycle architecture currently prohibits offline financial writes and defines single-user, single-active-device operation; simultaneous multi-device use is unsupported. This product discussion establishes offline reading/analysis and a desired conflict-safe synchronization experience, but does not override that technical contract. See the open-decision register before implementing offline writes or simultaneous-device merge behavior.

## 9. Automation model

Automation is a core value proposition. It should reduce manual work as the system learns the user's preferences through explicit, inspectable deterministic rules.

- **Low risk:** perform routine operations automatically without interrupting the user.
- **Medium risk:** perform automatically with clear notice and easy undo.
- **Consequential/destructive:** require explicit user approval.

Examples and detailed behavior should follow the existing canonical ledger, categorization, correction, and storage contracts. Never let an automation silently discard a potentially legitimate financial record or erase audit history.

## 10. Privacy, storage, and portability constraints

- No financial information may be transmitted to services outside the user's own storage provider.
- Google Drive is the selected private-storage direction, subject to the existing production-readiness gates.
- First-run setup must establish the user's primary Finance Tracker database directory in Google Drive and validate its identity and primary role under the accepted database lifecycle contract before using it. Do not silently initialize, overwrite, or switch to an unverified directory.
- GitHub Pages is public static hosting and must never serve private financial records.
- No bank passwords, unauthorized scraping, third-party AI, paid recurring dependencies, expiring trials, or financial-data analytics/advertising services.
- Manual file import remains permanent.
- CSV import must track the coverage period represented by each file separately from the transaction dates observed within it. When a file contains explicit coverage-period metadata, extract it and ask the user to confirm it. When it does not, require the user to declare an inclusive start and end date using two independently navigable, side-by-side calendars.
- For repeat imports into the same account, the importer may prefill a suggested start date based on the day after the previous confirmed coverage end date. The suggestion must remain editable and must never be treated as user confirmation.
- Validate every usable transaction date in the file against the declared coverage period. Flag and identify any out-of-range dates; do not silently expand the period or infer coverage from account-balance arithmetic. The user must resolve the discrepancy—by correcting the selected dates or investigating the file—before finalizing the import. Files with no usable transaction dates require review.
- Preserve declared coverage, observed transaction-date range, and import timestamp as distinct metadata. Preserve whether coverage came from explicit source metadata or a user declaration.
- Supported initial institution/file scope remains Wells Fargo, SoFi, and Fidelity; adding more institution integrations is not required merely because the financial model supports more account types.
- Provide a complete portable export and restore path. Include historical records, corrections, categorization rules, account relationships, projection scenarios, and necessary metadata—not just transaction rows.
- Future application generations must be able to import prior-generation archives.

## 11. Delivery and release philosophy

v1.0.0 must be both feature-complete for its deliberately scoped initial product and production-ready. A feature can have a limited but coherent initial implementation; the product must not pretend unsupported capabilities are complete.

Use semantic versioning:
- Patch releases (for example, 1.0.1) fix defects without changing established behavior.
- Minor releases (for example, 1.1.0) add compatible capabilities.
- Major releases (for example, 2.0.0) introduce breaking changes or substantial changes to established behavior and require documented migrations.

Preserve backward compatibility where reasonable, keep financial history portable, and make breaking changes deliberate and explainable.

The January 1, 2027 v1.0.0 target is a planning target, not permission to weaken correctness, privacy, recovery, or production-readiness requirements. The owner-confirmed minimum feature scope is recorded below; the detailed dependency-aware delivery schedule and measurable acceptance criteria remain to be established.

### Minimum coherent v1.0.0 scope — owner-confirmed 2026-11-05

The January 1, 2027 target is for a minimum coherent, trustworthy replacement for the first-generation workbook—not for full maturity of every capability in this product vision. The following release scope is the planning baseline for the remaining development window. Each capability must meet its stated minimum; advanced refinement may follow in compatible minor releases (1.1.0, 1.2.0, and so on).

| Capability | Minimum v1.0.0 requirement |
|---|---|
| Historical migration | Import the workbook's monthly history from 2023 onward, preserving available breakdowns, provenance, and reconciliation evidence. |
| CSV imports | Reliably import supported Wells Fargo, SoFi, and Fidelity exports, including repeat and overlapping imports. |
| Financial ledger | Maintain a unified activity history, prevent duplicates, and support corrections and deterministic categorization. |
| Accounts | Show persistent accounts, balances, assets, and liabilities. |
| Financial reporting | Provide trustworthy income, spending, cash-flow, savings, and net-worth reporting. |
| Historical trends | Present migrated financial history with monthly detail and clearly distinguish workbook-derived summaries from imported transactions. |
| Private storage | Google Drive persistence, authentication, recovery, backup, and portable export must pass their applicable acceptance and authorization gates. |
| Core interface | Provide a usable Home, Activity, Accounts, Planning, and More experience on iPhone and iPad. |

The following capabilities should have useful but deliberately limited initial implementations rather than their eventual advanced forms:

- **Insights:** meaningful observations and evidence-based, optional recommendations.
- **Investments:** account balances, holdings, contributions, distributions, dividends, and basic investment activity; advanced performance analysis may follow.
- **Budgets:** basic category budgets and spending comparisons.
- **Projections:** a straightforward baseline projection with clearly stated assumptions.
- **Data quality:** clear indicators for stale imports, missing coverage, and reconciliation problems.

Advanced investment performance and tax-lot analysis, sophisticated forecasting, complex goal hierarchies and optimization, advanced budget rollover/customization, multi-currency support, extensive dashboard/report customization, additional institution integrations, and simultaneous multi-device operation are not v1.0.0 release requirements. They may be considered for later releases subject to compatibility, correctness, privacy, cost, and product review.

The minor-version sequence is an opportunity, not an automatic commitment to a particular feature or date. A refinement belongs in a 1.1.x or 1.2.x release when it can be added compatibly without weakening established financial meaning or requiring an unplanned breaking migration. The v1.0.0 release remains conditional on functional completeness, data integrity/security/recovery acceptance, and explicit owner acceptance after reconciliation. If those gates are not met by January 1, move the release date rather than lower the standard.

This scope baseline does not authorize production financial-data persistence or alter PR #25's existing acceptance boundaries. All applicable security, storage, and owner-authorization gates remain in force.

### Development milestones: Alpha → Beta → 1.0.0 → 2.0.0

Use the following progression to separate foundational correctness from the richer analytical experience:

- **Alpha — trustworthy financial foundation.** Establish supported CSV imports, migration of the prior-generation monthly financial history, the canonical ledger and reconciliation, categorization and auditable corrections, accurate account balances/assets/liabilities/net worth, and dependable storage, backup, recovery, and portability. Alpha is successful when the owner can load and review financial history, correct it, and trust that the information is preserved and represented honestly.
- **Beta — visual and analytical experience.** Build the dashboard and navigation, present-day overview, historical trends and reports, insights, and the initial goals/budgets/projections/scenarios experience on top of the trusted foundation. Use controlled synthetic datasets to test chart layouts, uncertainty cones, edge cases, and interactions. Beta is successful when the experience works on target devices against those controlled datasets and is usable.
- **1.0.0 — integrated first product release.** Combine the Alpha foundation and Beta experience, then validate the integrated application against actual financial data. Release requires reliable import, historical migration, categorization, storage/recovery, and the user-facing experience to work together.
- **2.0.0 — expanded capabilities.** Reserve deeper investment analysis, more advanced planning and projection methods, expanded automation, additional integrations, and other deliberately deferred ambitions for later development.

Alpha and Beta are deployable development milestones, not public semantic-version releases. The owner should be able to interact with each milestone on the target devices through the existing GitHub Pages workflow and perform a hands-on smoke test before the next milestone advances. The milestones may be delivered through separate or overlapping PRs; PR number order does not dictate merge order. In particular, a later-numbered PR may merge before an earlier-numbered PR when dependencies and readiness justify it.

The first-generation Excel archive is a first-class Alpha input. Its month-by-month historical records must retain their actual granularity and provenance. Do not manufacture transaction-level detail from monthly aggregates or present aggregate values as if they were individual transactions.

## 11.1 One-time migration of first-generation Excel history

The first-generation Excel workbook is a one-time Alpha migration input, not a permanent import format or a reason to build a general-purpose Excel-import interface.

The migration should use a small, purpose-built Python conversion script. The script may be disposable after successful migration; the converted records, source workbook archive, mapping specification, validation results, and provenance are durable.

The agreed historical scope is month-by-month financial summaries beginning in 2023, preserving the level of detail the workbook actually contains:

- Monthly net-worth snapshot.
- Monthly total income and the available income-source breakdown (for example, paychecks, refunds, bonuses).
- Monthly total expenses and the available primary expense-category breakdown (for example, daily living, transportation, food, hobbies and activities).
- The represented month and any source context needed to interpret the values.

Do not reconstruct individual transactions or imply that monthly aggregates are transaction-level ledger entries. Expense subcategory preservation remains subject to inspection of the workbook's structure; the owner has not committed to the additional effort until the actual workbook is reviewed. Preserve any other reliably represented monthly detail only where its meaning and reconciliation can be established.

Represent these records as a distinct historical monthly-summary record type, separate from the canonical transaction/activity ledger. This allows historical net-worth and cash-flow trends to extend back to 2023 without confusing aggregates with imported transactions or double-counting them in ledger reports. The user-facing experience must preserve and communicate this distinction: historical monthly summaries must be identifiable as workbook-derived aggregate records, while institution-imported activity is presented as transaction-level or other source-supported detail. Do not place monthly totals in a transaction list as though they were individual transactions. Where a report or chart combines both periods, make the change in source and level of detail clear rather than implying uniform transaction coverage.

Before importing, the conversion must produce a reviewable output and reconciliation report. Validate month coverage, source-to-output values, income-source sums against monthly income totals, expense-category sums against monthly expense totals, and any available net-cash-flow totals. Treat monthly net worth as its own reported snapshot; do not assume changes in net worth must equal monthly income minus expenses, since transfers, market movements, valuation changes, and other factors may affect it. Flag missing months, ambiguous labels, formula errors, and mismatches; do not silently fill, interpolate, or correct source values. Retain the original workbook unchanged and record source workbook/worksheet and migration provenance for each output record.

The actual workbook inspection, conversion script, reconciliation, and import will be implemented in a separate, dedicated engineering PR. PR #26 records the product decision and migration approach only; it does not perform the migration or authorize use of real financial data before the applicable storage/security gates.

## 12. PR #25 scope boundary — do not expand

PR #25 remains responsible for its original synthetic-only storage-readiness and acceptance work, as documented in [PR #25 acceptance record](https://github.com/AeroVega/finance-tracker/blob/feat/production-readiness-acceptance/docs/PR25_ACCEPTANCE.md) and [pull request #25](https://github.com/AeroVega/finance-tracker/pull/25). The product vision in this document does **not** add reporting, investments, debt, budgeting, goals, projections, insights, or other product features to PR #25.

The PR #25 workstream must still complete its originally assigned responsibilities, including:
- Reconcile the physical object-locator model with accepted database identity/lifecycle ADR §81.
- Wire backup/restore and portability to the actual Drive adapters and complete live synthetic backup, quarantine, portable-export, and restore rehearsals.
- Complete original-source retention metadata and actual Drive deletion/confirmed-absence verification under the approved 540-day source-file policy.
- Perform real browser interruption/reload recovery rehearsals at transaction boundaries.
- Test OAuth expiry, revocation, wrong-account, denied-permission, and reconnect behavior.
- Review the actual Cloud project configuration, OAuth publishing status/scopes/restrictions, quota and usage, current terms/billing, Google's announced 2026 quota/billing changes, and the $0 recurring-cost constraint.
- Obtain explicit owner acceptance of the evidence and residual risks.

PR #25 remains synthetic-only. Its merge does not authorize production financial-data persistence. Do not treat this product document as a release approval or a change to PR #25's acceptance criteria.

## 13. Relationship to existing authoritative documents

This document captures product-level intent. Detailed technical decisions remain in their specific contracts:
- [Project charter](PROJECT_CHARTER.md)
- [Roadmap](ROADMAP.md)
- [Next steps and handoff](NEXT_STEPS.md)
- [Architecture decisions](ARCHITECTURE_DECISIONS.md)
- [Database identity and lifecycle](DATABASE_IDENTITY_AND_LIFECYCLE.md)
- [Data model and reconciliation principles](DATA_MODEL.md)
- [Security and privacy requirements](SECURITY.md)
- [PR #25 acceptance evidence](https://github.com/AeroVega/finance-tracker/blob/feat/production-readiness-acceptance/docs/PR25_ACCEPTANCE.md) (on the active PR #25 branch until merged)

When a future implementation proposal appears to conflict with an established decision, identify the conflict and bring it forward for resolution. Do not silently reinterpret this document or an existing technical contract.
