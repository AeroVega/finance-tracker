# Second Generation Finance Tracker — Product Definition

**Status:** Owner-reviewed design baseline in progress  
**Product:** Second Generation Finance Tracker (working name)  
**Target release:** v1.0.0  
**Last updated:** 2026-11-02

This document captures the product direction and owner-approved principles established during the November 2, 2026 product-design discussion. It is intended to guide future product, architecture, implementation, and review sessions.

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

### 4.4 Transfers

Transfers are a distinct financial activity, not income or spending. Link outgoing and incoming sides when evidence supports the relationship, including transfers across institutions. Avoid double-counting. Uncertain or incomplete pairs require review rather than unsupported assumptions.

This reaffirms the existing canonical ledger decision; it is not a new implementation request.

### 4.5 Categories

Provide a standard built-in category set and allow users to manage their categories. Preserve the already-established category semantics: historical classification is retained as recorded; taxonomy changes apply prospectively; renames do not rewrite historical labels; meaningful splits create new identities; merges are prospective; optional subcategories are limited to two classification levels; and manual corrections are auditable, affect the effective historical reporting period, and can be undone through additional events rather than erasing prior history.

The detailed category identity, hierarchy, correction, and compaction rules are governed by the canonical ledger/PR25 acceptance decisions. Do not replace them with a simpler retroactive-recategorization model.

### 4.6 Multi-currency

Multi-currency support belongs in the foundational model, even if the initial setup uses only one currency. Preserve original amounts and currencies. Allow a primary display currency for consolidated views. Converted amounts are derived values; preserve the exchange-rate basis used for historical reporting so past reports remain explainable and do not silently change with today's rates.

### 4.7 Investments

Investments are a first-class financial domain, not merely a balance displayed beside checking accounts. The intended experience includes:
- Portfolio overview and allocation.
- Account-level detail.
- Holdings and point-in-time positions.
- Contributions/deposits, withdrawals, dividends, interest, fees, trades, and other investment activity.
- Performance reporting that distinguishes external cash flows from investment returns.

The user should be able to move from an overall portfolio view to accounts, holdings, and activity. Existing historical-retention decisions for monthly investment values, holdings, and cash-flow/performance components remain applicable.

### 4.8 Liabilities and debt

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

A lightweight initial budget experience may include periodic category targets, actual-versus-target comparisons, remaining budget, projected end-of-period spending, historical comparisons, and optional savings targets. Exceeding a target is information, not a moral judgment or product failure.

### 5.6 Insights

Provide a dedicated Insights experience that the user can visit. Do not default to unsolicited push notifications. Insights should identify meaningful patterns and risks—such as spending changes, savings pace, cash-flow risk, unusual activity, or projection outcomes—and explain the evidence and assumptions.

For potentially low balances or cash-flow problems, provide useful analysis: when a threshold may be crossed, estimated magnitude and duration, uncertainty, sensitivity to assumptions, and whether the issue appears temporary or sustained. Avoid generic or obvious advice. Offer scenario exploration; leave financial decisions to the user.

Use progressive transparency: concise finding first, then analysis, then supporting records and methodology.

## 6. Dashboard, reporting, and navigation

- Provide a sensible useful dashboard by default; users must not have to build one.
- Allow optional dashboard customization: add, remove, and rearrange components, with a way to restore defaults.
- Provide ready-made reports with documented definitions.
- Allow users to create custom report views and pivot-style analysis without attempting to recreate all of Excel.
- Presentation and report customization must not alter the underlying financial records.
- Maintain consistent overview-first, drill-down behavior throughout the application.

The detailed navigation structure, report catalog, and first-run experience remain open.

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
- GitHub Pages is public static hosting and must never serve private financial records.
- No bank passwords, unauthorized scraping, third-party AI, paid recurring dependencies, expiring trials, or financial-data analytics/advertising services.
- Manual file import remains permanent.
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

The existing January 1, 2027 MVP1 target is a planning target, not permission to weaken correctness, privacy, recovery, or production-readiness requirements. The v1.0.0 feature scope and schedule must be re-baselined against this product definition rather than assuming every capability described here must be fully mature on that date.

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
