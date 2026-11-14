# Visualization and Investigation Design Handoff

**Status:** Owner-confirmed design direction for future implementation planning; not an implementation contract or authorization to expand current application scope.
**Last updated:** November 14, 2026
**Design context:** Finance Tracker visualization-gallery discussions. The earlier gallery iteration is the owner's preferred reference for the Home dashboard; the subsequent connected-chart prototype is an exploration of investigation-page behavior.

This document consolidates the design decisions from the visualization gallery. It is intended to let a future agent continue design and implementation without reconstructing the conversation. It does not supersede the product definition, canonical financial model, storage contracts, current project status, or authorization boundaries.

## 1. Read this first

Before implementation, read:

1. [Contributor and agent instructions](../AGENTS.md) for privacy, authorization, branch, and repository rules.
2. [Agent quick start](AGENT_QUICK_START.md) and [project status](PROJECT_STATUS.md) for current architecture and verified implementation state.
3. [Product definition](PRODUCT_DEFINITION.md) for product principles and financial reporting semantics.
4. [Mobile and tablet workspace design](MOBILE_UI_DESIGN.md) and [mobile workspace pages](MOBILE_WORKSPACE_PAGES.md) for the existing navigation, responsive layout, and mounted-page behavior.
5. [Data model and reconciliation principles](DATA_MODEL.md) for financial meaning and reporting constraints.

This document defines the visualization experience layered on those existing foundations. It does not define a new financial data model, storage lifecycle, or independent reporting truth.

## 2. Design intent and evidence labels

The goal is to make Finance Tracker feel like a personal financial intelligence application rather than a transaction ledger with charts attached. Visualizations should help the user recognize patterns, proportions, relationships, and exceptions, then deliberately investigate the underlying evidence.

Use these evidence labels when extending this document:

- **User-confirmed:** directly selected or clarified by the owner during the gallery discussion.
- **Design recommendation:** a proposed implementation interpretation consistent with confirmed direction, but not separately approved in detail.
- **Exploratory:** an idea shown to stimulate design discussion; not a feature commitment.
- **Open:** requires further design, data-contract, or implementation review.

The visual gallery used invented illustrative values. Those values are not product fixtures, targets, financial history, or requirements.

## 3. The three-level experience

### 3.1 Home dashboard: independent overview widgets

**User-confirmed:** The gallery iteration immediately before the connected-chart prototype is the preferred reference for the Home dashboard. It is the current visual north star for the overview.

The Home dashboard is a launchpad for curiosity, not an investigation workspace. It should present a set of attractive, independently understandable visualization widgets. Each widget answers its own question and offers its own route to more detail.

The widgets should be visually rich and varied, arranged in a responsive bento-style composition appropriate to the available screen. The dashboard should not become one long report or a dense grid of small, interchangeable charts.

Home dashboard behavior:

- Widgets are independent. Selecting a month, category, slice, bar, or point in one widget must not filter, mutate, or otherwise change another widget.
- Widgets may share the dashboard's active account and reporting-period scope. Shared global scope is not cross-filtering.
- Each widget may expose its own contextual tooltip and its own deliberate navigation action.
- The user chooses which question to pursue. Do not impose a predetermined investigation sequence.
- Do not put transaction tables or dressed-up CSV summaries on the Home dashboard.
- Keep summary presentation focused. Detailed record lists, raw source evidence, and dense analytical controls belong deeper in the application.

The Home dashboard should not require the user to understand a reporting workflow before it becomes useful.

### 3.2 Investigation pages: connected visualizations

**User-confirmed:** Connected charts are promising and useful for curious investigation, but they do not belong on the Home dashboard.

After the user deliberately enters a topic from a Home widget, a focused investigation page may coordinate related visualizations. On these pages, selecting a month, category, account, or other dimension can filter or update other visualizations in the same investigation.

The connected-chart prototype demonstrated a possible flow:

- Start with a monthly spending distribution.
- Choose a particular month from the distribution.
- Inspect the selected month's spending composition.
- Choose a category.
- Deliberately open a focused category page.
- Continue to the underlying transactions when needed.

This is an example, not a mandated navigation path. The user must remain free to enter an investigation through another widget or dimension.

Investigation-page behavior:

- Related charts may share selection state and cross-filter one another.
- A selection used to explore context should not automatically navigate away.
- Provide a clear, deliberate action to open a deeper focused page.
- Preserve investigation context when navigating into detail and returning, so the user does not have to reconstruct their exploration.
- Show the active scope and selections clearly, with a straightforward way to revise or clear them.
- Keep the interaction model consistent across chart types.

### 3.3 Record-level detail: actual records

Tables become appropriate at the lowest level, where the user needs to inspect individual records row by row. Transaction detail may include date, merchant or description, amount, account, category, posting status, and relevant source/evidence affordances.

Do not use tables as a substitute for high-level charts. The user explicitly dislikes tables at summary and reporting levels because they resemble dressed-up CSV imports.

The intended progression is:

**Independent overview widgets → focused investigation with connected visualizations → individual records and source evidence.**

This is a conceptual hierarchy, not a requirement that every investigation use all three levels.

## 4. Shared interaction conventions

Use one coherent interaction language across visualizations.

### 4.1 Contextual inspection

**User-confirmed:**

- Hovering (where available) or tapping a chart mark should reveal a small contextual tooltip directly on or beside the visualization.
- The tooltip should provide useful exact values and relevant context without permanently occupying dashboard space.
- Do not force navigation just to inspect a mark.
- A deliberate click/action can navigate to a focused page for deeper investigation.
- A dedicated inspection panel is not the default. If a dedicated page or panel is needed, make it an explicit navigation decision.

The exact tooltip fields depend on the chart. Examples include amount, percentage, transaction count, comparison period, exact date, savings rate, difference, and data completeness.

### 4.2 Ambiguous touch targets

**User-confirmed:** Very small pie slices may be difficult to select accurately on touchscreens. If the first touch is ambiguous because multiple slices overlap the effective touch area, show the candidate slices or otherwise disambiguate. A second deliberate tap can choose the intended slice.

Do not silently select whichever small slice happens to win hit-testing. Keep the behavior understandable and accessible.

### 4.3 Accessibility and input parity

**Design recommendation:** Hover must never be the only way to access information. Provide equivalent touch and keyboard interactions, visible focus, semantic labels, sufficient contrast, and non-color cues where needed. Tooltips should be usable without a pointer and should not obscure the information being inspected. Respect reduced-motion preferences.

These recommendations align with the existing mobile/tablet and accessibility direction; they do not claim that a particular chart library or accessibility implementation is already present.

## 5. Chart family requirements

The chart descriptions below record the owner's expressed preferences. They define intended visual behavior, not a required third-party library or exact rendering implementation.

### 5.1 Spending composition: pie chart

**User-confirmed:** The owner likes a pie chart for spending composition.

Requirements:

- Include a clear legend mapping colors to spending categories.
- Make category identity available through both the slice and legend; do not rely on color alone.
- Inspecting a slice should reveal useful details such as amount, percentage of total, transaction count, and comparison with the previous month where the data supports it.
- Handle very small slices with the ambiguity behavior in §4.2.
- On Home, the pie is independent of other widgets. On a focused investigation page, it may participate in connected selection behavior.

Do not invent category values or treat unavailable categories as zero. The denominator and coverage of the displayed composition must be clear when incomplete.

### 5.2 Income versus spending: grouped bars

**User-confirmed:** Use a grouped bar chart with two side-by-side bars per month: income and spending. Do not use stacked bars for this comparison.

Responsive direction:

- Vertical grouped bars on tablet and desktop.
- Explore horizontal grouped bars on narrow mobile screens when that improves label legibility and touch interaction.

Inspection should expose exact income and spending amounts, their difference, savings rate when defined, and completeness/coverage context. Preserve the distinction between income and spending defined in the product's financial semantics. Internal transfers, credit-card settlements, investment purchases, and other excluded activity must not be misrepresented as spending or income.

### 5.3 Time series: straight line segments

**User-confirmed:**

- Connect actual observations with straight line segments.
- Do not use smoothed curves, splines, or curved interpolation that can imply values or trends not present in the data.
- Show actual data points where useful.
- Missing observations must create visible gaps; do not draw an invented connection across missing periods.
- Tooltips should expose the exact date/period and value.

A line is a connection between observed points, not a claim that the underlying financial value was continuously observed between them.

### 5.4 Transaction-size histogram

**User-confirmed:** The owner likes a histogram for the distribution of transaction sizes.

The chart should help answer questions such as whether activity is dominated by small purchases or contains a long tail of larger transactions. Bin definitions, currency, sample size, and included/excluded record scope should be understandable. Excluded transfers and investment activity should not silently distort an ordinary-spending distribution.

Exact binning strategy, treatment of refunds, and whether multiple currencies are separated remain implementation/design details to define against the canonical reporting model.

### 5.5 Monthly spending histogram

**User-confirmed:** A histogram of monthly spending totals is useful alongside a time-series chart because it answers a different question.

- The time series shows how spending changed over time.
- The histogram shows how unusual a selected month's spending is relative to other observed months.
- Support a selected-month marker and a median marker where useful.
- Show the sample size and avoid implying precision unsupported by the history.
- Use all available complete history at the selected reporting scope; do not artificially limit the distribution to twelve months if more history is available.
- A one-year synthetic dataset has only twelve observations, so bins and percentiles will be coarse. Make that limitation visible rather than overstating statistical significance.

Spending totals must follow the canonical financial semantics: internal transfers and investment purchases are not ordinary spending. Missing or incomplete periods must not be silently treated as complete zero-spend months.

A bin containing multiple months represents a candidate set. Selecting it should let the user distinguish its member months; it must not arbitrarily pretend the bin identifies one specific month.

### 5.6 Investment visualizations

**Exploratory:** The owner invited creative proposals here and has not yet approved a final investment visualization set.

Candidates shown during exploration:

- **Portfolio treemap:** visualizes relative holding sizes and concentration, potentially grouped by asset class.
- **Performance comparison:** compares portfolio market value with net contributions over time, while distinguishing contributions, withdrawals, dividends, fees, and market movement.
- **Allocation heatmap:** explores asset-class, sector, or geographic allocation when the underlying classification data supports it.

These concepts should help the user understand portfolio composition and historical performance, not provide investment recommendations. Never label market-value changes as cash income or imply that a contribution is investment return. Do not fabricate sector, regional, holding, or performance classifications when source evidence is unavailable.

Before implementing any investment chart, define the required data, valuation dates, contribution/withdrawal treatment, fee/dividend treatment, missing-price behavior, and completeness rules. Keep these concepts exploratory until the owner reviews them.

### 5.7 Cash-flow waterfall

**User-confirmed:** The owner preferred the richer waterfall visual from the first gallery iteration over the simplified approximation shown later.

Use a true waterfall:

- Each positive or negative movement is a floating bar positioned from the previous cumulative balance to the next.
- The running total is visually traceable from opening value through each movement to closing value.
- Distinguish the opening and closing totals from intermediate movements.
- Use clear labels and tooltips for exact values.

Do not replace a waterfall with an ordinary bar chart and call it equivalent. A simplified approximation is not an acceptable substitute for the requested cumulative floating-bar structure.

The exact financial measure and included movement categories must be named. The earlier gallery's illustrative example showed starting combined checking/savings, income, spending, debt principal, investment contribution, and ending cash; it was conceptual and should not be treated as a settled formula or a production-ready reconciliation. In particular, distinguish cash movement from net worth movement and avoid treating internal transfers as income or spending.

### 5.8 Cash-flow Sankey

**User-confirmed:** The owner preferred the richer flow-band Sankey from the first gallery iteration.

Use a genuine Sankey with proportional flow bands connecting sources and destinations. The chart should make the movement and allocation of funds legible, not imitate a Sankey with disconnected bars.

Requirements:

- Flow widths represent grounded amounts using a consistent unit and scope.
- Distinguish income, ordinary spending, debt payments, investment contributions, and retained cash as appropriate to the chosen measure.
- Keep internal transfers distinct. They must not appear to create new income or ordinary spending.
- Avoid double-counting both sides of an internal transfer or a credit-card purchase/payment pair.
- Make the accounting boundary and treatment of unallocated/unknown flows clear.

The earlier illustrative flow values were not a finalized accounting specification. Define the flow model and reconciliation rules before implementation.

## 6. Financial correctness and data qualification

Visualization code must consume the existing canonical application/reporting data and preserve the financial semantics already documented in [Product Definition §4.4](PRODUCT_DEFINITION.md#44-financial-activity-and-reporting-semantics) and [Data Model](DATA_MODEL.md).

At minimum:

- Posted activity is used for finalized income and spending reporting; pending activity remains visibly pending and excluded from finalized totals.
- Internal transfers are neither income nor spending when both sides are known.
- Credit-card purchases are spending when incurred; paying the card settles a liability and is not a second expense.
- Investment contributions and purchases move existing funds; they are not new income or ordinary household spending.
- Dividends and interest retain their income meaning when identifiable; market-value changes are investment performance, not cash income.
- Refunds follow the established posting-month/category treatment rather than silently rewriting the original month.
- Debt principal repayment reduces a liability; interest and fees are expenses.
- Net worth is assets minus liabilities at a point in time. Changes in net worth are not interchangeable with cash flow.
- Missing, unavailable, stale, or incomplete values are not zero.
- Every summary must retain enough scope and coverage context to avoid presenting partial data as a complete financial picture.

Use the canonical report definitions and application scope. Do not recalculate competing versions of financial truth inside individual widgets.

## 7. Data flow and application architecture boundaries

**Design recommendation:** Visualization components should be presentation and interaction layers over the existing application data/reporting interfaces.

- Reuse the application's active account and reporting-period scope.
- Reuse canonical report values and their completeness/provenance metadata.
- Do not introduce independent file loading, storage sessions, database ownership, or a competing financial record model for charts.
- Do not create a separate synthetic-data database or visualization pipeline. The existing application can seed an invented year into an empty synthetic Drive directory and load it through the same application lifecycle used for other data. Calculations and visualization logic should behave identically for synthetic and real datasets; current repository authorization still limits work to synthetic data.
- Keep financial calculations deterministic, inspectable, and testable in JavaScript. Do not send financial information to an external AI or analytics service.
- Do not infer a charting framework or dependency from the gallery images. Evaluate any library against the existing static HTML/CSS/JavaScript architecture, GitHub Pages deployment, mobile performance, accessibility, maintenance, privacy, and recurring-cost constraints before proposing adoption.
- A chart's selection state belongs to its local dashboard widget or its focused investigation workspace. Do not introduce global cross-widget coupling on Home.
- Preserve the existing mounted-workspace/session/editor behavior when adding routes or focused pages. Navigation must not discard unfinished edits or alter explicit-save semantics.

This design does not authorize real financial records, private workbook access, production Drive operations, production persistence, merge, or deployment. Follow the current phase and authorization in [AGENTS.md](../AGENTS.md) and [Project Status](PROJECT_STATUS.md).

## 8. Responsive presentation

Follow the existing mobile-first design in [Mobile UI Design](MOBILE_UI_DESIGN.md):

- Keep iPhone as the primary experience; use iPad/tablet width for richer chart composition and desktop for full analytical capability.
- Prefer a small number of readable, well-composed widgets over a dense wall of miniature charts.
- Adapt chart orientation and labeling to available width; horizontal grouped bars are a candidate for narrow screens.
- Keep tooltips and touch targets usable on phones. Do not require hover.
- Avoid horizontal overflow, clipped labels, and controls hidden behind navigation or safe-area insets.
- Respect text scaling, keyboard navigation, focus visibility, contrast, and reduced motion.

The exact Home widget ordering, card dimensions, breakpoint-specific arrangement, and responsive chart transformations remain open to visual implementation review. The earlier gallery establishes the preferred overall visual direction, not pixel-perfect measurements.

## 9. Suggested implementation sequence

This is a design-oriented sequence, not authorization or a claim that these features are already implemented.

1. Inspect the current Home workspace, reporting interfaces, existing chart code (if any), and relevant route/state architecture before proposing changes.
2. Translate the preferred first gallery iteration into a static, synthetic-only Home dashboard prototype using independent widgets. Keep the existing account and period scope.
3. Implement shared tooltip, focus, keyboard, and deliberate-navigation conventions with one or two representative chart types.
4. Add the remaining confirmed chart families, verifying their financial semantics and missing-data behavior.
5. Design a focused investigation page with connected visualizations, explicit selection state, clear reset/back behavior, and preserved context.
6. Add record-level detail only where a genuine row-by-row inspection task exists.
7. Treat investment concepts as a separate design review before committing to implementation.
8. Validate phone, tablet, desktop, accessibility, performance, and synthetic financial edge cases. Report implemented, tested, owner-accepted, and deployed states separately.

## 10. Acceptance checklist for future design/implementation work

A proposed Home dashboard is directionally correct when:

- [ ] It resembles the earlier preferred gallery: dark, visually rich, varied, and composed of independently understandable widgets.
- [ ] Home widgets do not cross-filter or update one another when selected.
- [ ] Each widget can be inspected in place and has a deliberate path to a deeper page.
- [ ] The shared account and reporting-period scope remains clear.
- [ ] No high-level transaction table or dressed-up CSV report is introduced.
- [ ] Pie composition has a category legend and handles ambiguous small-slice touch targets.
- [ ] Income and spending use grouped, side-by-side bars, not stacked bars.
- [ ] Time series use straight segments between actual observations and visible gaps for missing observations.
- [ ] Both transaction-size and monthly-spending histogram use a clearly defined population and sample size.
- [ ] Waterfall uses cumulative floating bars; Sankey uses proportional flow bands.
- [ ] Financial exclusions, missing values, and incomplete coverage are represented honestly.
- [ ] Responsive and accessible interaction does not depend on hover.

A proposed investigation workspace is directionally correct when:

- [ ] Connected visualizations appear only after deliberate navigation away from Home.
- [ ] Related charts share selection state only within the relevant investigation context.
- [ ] Exploring a mark does not unexpectedly navigate away.
- [ ] Explicit navigation opens focused detail and preserves context on return.
- [ ] Tables are reserved for record-level inspection.

## 11. Open design questions

Resolve these against the actual reporting interfaces and synthetic fixtures before treating them as implementation requirements:

- Which exact widgets and ordering best serve the first Home dashboard release?
- Which metrics should be displayed in each chart tooltip, and how should prior-period comparisons handle incomplete coverage?
- What binning and outlier policy should the transaction-size and monthly-spending histograms use?
- How should refunds and multi-currency activity appear in distribution charts?
- Which exact financial measure and movement taxonomy should the waterfall represent?
- Which flow boundaries make the Sankey both useful and financially reconciled?
- Which investment chart concepts are valuable with the currently supportable holdings and valuation evidence?
- Which charting implementation best satisfies the existing architecture, accessibility, mobile performance, and maintenance constraints?

Do not block the initial independent Home dashboard on resolving every exploratory question. Build only against metrics with defined, trustworthy reporting semantics; keep unsupported or unresolved visualizations out of the production dashboard until their data contracts are ready.
