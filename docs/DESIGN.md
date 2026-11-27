# Interface design

**Status:** Shell and Home merged to `main` in [PR 62](https://github.com/AeroVega/finance-tracker/pull/62). See [CURRENT_STATE.md](CURRENT_STATE.md) for acceptance and deployment evidence.

This is the working reference for the main app's look and layout: [index.html](../index.html), [canonical-workspace.css](../canonical-workspace.css), and the presentation code in [canonical-workspace.mjs](../js/canonical-workspace.mjs), [workspace-pages.mjs](../js/workspace-pages.mjs) , [home-dashboard.mjs](../js/home-dashboard.mjs) and [home-period-report.mjs](../js/home-period-report.mjs). Product scope stays in [PRODUCT_DEFINITION.md](PRODUCT_DEFINITION.md). The earlier [mobile UI design](MOBILE_UI_DESIGN.md) and [mobile workspace pages](MOBILE_WORKSPACE_PAGES.md) keep their rationale for the mounted-page architecture, which is unchanged.

## Direction

A calm, information-dense dark finance app (owner choice, 2026-11-24). The screen should answer "how much came in and went out, and what needs me?" before showing tools. Restraint is the brand: one accent, hairlines instead of boxes, aligned exact numbers, and short honest qualifiers. Each screen or state has one primary (mint) action.

## Navigation

| Tab | Route(s) | Holds |
| --- | --- | --- |
| Home | `#overview`, `#import` | Period bar, money in and out, spending by category, needs attention, Import, trend, recent activity |
| Activity | `#transactions`, `#reconciliation`, `#activity-detail` | Search, filters, sort and month sections; Needs review with inline decisions and imported rows awaiting a decision; month reconciliation; transaction detail |
| Accounts | `#position`, `#account` | Accounts grouped by institution with 12 months of coverage each; one account's dated balances, coverage gaps, holdings and evidence editors |
| More | `#storage`, `#migration` | Session and save actions, connect panel once something is open, historical summaries, backup and restore, recovery and diagnostics, sample data, build identity. The temporary History migration page sits under More and is linked from Home's Needs attention list until every month is saved. |

Planning is part of the product direction but has no tab until a feature exists. Route names are unchanged so existing links, history and tests keep working; only titles and grouping changed. The separate Review page was folded into Activity: `#review` still resolves, opening Activity with Needs review on. Holdings were folded into account detail: `#holdings` still resolves, opening the first investment account in scope. If nothing is open yet, the request waits and applies when accounts first render. Hashes name pages only, never an account. Phones use a four-item bottom bar, 761–1199px a labelled rail, and wider screens a sidebar.

## Activity

Activity is an Operate surface: find a record, look at a slice, or clear what needs a decision. It reuses the shell's tokens; nothing here adds a colour or a type size.

- **Toolbar.** Search, then Import. On wide screens the facets sit inline below it: Type and Category open checkbox menus with counts, Needs review and Pending are chips, and Sort is a native select. On phones (760px and below) one Filters button with an active-count badge opens a bottom sheet holding the same controls, with "Show N activities" as its one primary action.
- **Types** are display families over ledger kinds: Spending, Income, Transfer, Refund, Investment (trade, dividend, interest, fee, contribution, distribution, valuation change), Other and Unclassified. Only families present in the scope are offered.
- **Categories** combine the built-in set in [category-catalog.mjs](../js/category-catalog.mjs) with every category already used in the ledger. IDs are slugs; labels are sentence case. "No category" is its own filter.
- **Facet counts** follow account, period and search but not the other facets, so a selected choice never disappears.
- **Active filters** show as removable chips with Clear all. On wide screens, status chips are not repeated there because the inline chip already shows its state.
- **Sort:** newest first (default), oldest first, largest money out, largest money in. Unknown amounts sort last and never read as zero.
- **Month sections** appear under date sorts. A sticky header (on list layouts) gives the month, the number of matching rows, posted In and Out per currency, and "N not counted". Totals use the same per-activity rule as the period report, so an unfiltered section equals Home's month figure. With any filter active the totals are labelled **Shown**, because they are subtotals of matching rows. A section with only transfers says "No income or spending" rather than showing $0.00. Amount sorts are one ranked list without sections.
- **Show more** adds 50 rows at a time and moves focus to the first new row. It replaced Previous and Next so month sections never split across pages.
- **Inline decision.** A row flagged as unclassified, with an amount/type conflict, or as an unmatched refund gets a Decide button. It expands in place with Type (only types compatible with the amount's sign), Category (built-in, used, or a new name), an unchecked opt-in to use the category for later imports with the same description, and a note. The note is filled from a template as the choices change ("Reviewed in Activity: classified as spending (was unclassified); category set to Groceries (was no category)."), and stops updating once edited. Stage decision applies the type and category as one undoable step. Amount, posting status and transfer links stay in the full transaction view, and the panel says which of those reasons remain. Focus then moves to the next flagged row.
- **Full correction form.** The same rules apply: the reason is suggested from the change (for example "Changed category from Groceries to Dining." or "Corrected amount from -$42.35 to -$40.00."), editing it keeps your words, and a category correction offers the same unchecked rule opt-in. The correction history states whether each category correction applies to later imports.
- **Needs review** also shows imported source rows waiting for match, keep or reject in a section above the list. If only activity decisions are waiting, that section stays hidden.

## Accounts

Accounts is an Operate surface whose first job is checking that every account's data is current (owner decisions, 2026-11-25). Balances come second. It reuses the shell's tokens and adds one component, the coverage strip. The financial rules are in [financial position](FINANCIAL_POSITION.md); the read model is [account-history.mjs](../js/account-history.mjs) and the presentation is [accounts-view.mjs](../js/accounts-view.mjs).

- **Layout.** From 1000px the list and one account's detail sit side by side, and the detail is a sticky panel. Below 1000px the list fills the page and a row pushes `#account`, which shows the detail with an *All accounts* back link. Choosing a row on wide screens never navigates.
- **List.** One summary line: net worth per currency, then "every balance current" or, in amber, "partial:" with the reasons. When incomplete, the figure is labelled *Known net worth*. The scope bar above already states the as-of date. Assets, liabilities and the completeness note sit in a disclosure below it. Accounts are grouped under Wells Fargo, SoFi and Fidelity. Each header says how far that institution's declared imports reach ("Imports through Jan 31, 2025" or "No imports yet") and how many accounts need attention. Each row shows the name, its type and freshness ("Current · Jan 31, 2025", or "47 days old", "No balance yet" or "Conflicting balances" in amber), a compact strip, and the balance. The detail repeats freshness with its basis and age ("dated on the as-of day", "12 days before the as-of date"). The selected row has a mint outline. Liabilities read "owed"; a missing balance reads Unavailable.
- **Selection.** The detail opens on the first account that needs attention, otherwise the first account. Switching account with an unfinished balance, holdings or closure form asks before clearing it. Staging evidence for another account moves the detail to that account.
- **Coverage strip.** Twelve calendar months, ending with the as-of month. Each cell is the calculated account-month result: solid green *Reconciled*, tint *Imported, not reconciled*, outline *Declared, no activity*, hatch (detail) or dash (row) *No data*, amber ring *Needs a fix*. The hatch encodes missing data; it is not decoration. The as-of month is labelled *so far*. In the detail, the cells are one button group with roving focus (arrow keys, Home and End), and a mint underline marks the selected month. Cells are 44px tall and about 27px wide on a 390px phone. That is an accepted exception to the 44px target width, because choosing a month changes nothing.
- **Balance observations.** Dots only. Each dated balance sits in its month's column at its day. Nothing joins the dots or carries a value forward: no line, area or trend. A same-date conflict is an open amber ring with no value. Only the latest known value is labelled; the range is in the heading and every exact value is in the plot's accessible name. The selected month's column is highlighted.
- **Gap callout.** For the selected month: its state, plain-language reasons, the balances dated in that month, and up to three next steps, the first as the screen's one primary action. The steps come in this order: choose the supported balance (conflict), import a CSV (cash accounts with no declared import), add the closing or opening balance (opens the balance editor with the date filled), review the month in Activity, reconcile the month. Review sets Activity's period and the Needs review filter, and never changes the account scope, so Accounts lists the same accounts afterwards. Reconcile sets the period and the reconciliation form's account. Reconciliation stays in Activity.
- **Conflicts.** A same-date balance conflict lists one row per candidate (amount, basis, reference) with *Use this balance* and *Inspect source*, after a required reason field. The gap callout and conflict section are hairline-topped sections, not nested panels; amber marks needs-fix and conflict.
- **Detail editors.** The dated balance, holdings (investment accounts only) and closure forms act on the selected account. Their account selects stay in the DOM but are not shown. A staged record clears its form. Closure offers only that account's zero balances. *Add an account* stays under the list.
- **Holdings.** Investment accounts list the selected dated holdings (symbol, type and units, value) with the statement scope and date. They say that holdings support the balance and are never added to it.

## Workspace status

- **Mode pill** (top right, links to More): synthetic or private, preview, saved, or read-only.
- **Save bar** (`#draft-bar`): sticky at the bottom of the content, above the phone tab bar. It appears only when there is something to save, wait for, or recover. It carries one action: Save changes, or Save preview in a local preview. In recovery states the bar becomes a link straight to Recovery, with Verify focused. Short landscape windows keep it in the page flow.
- **Action status** (`#action-status`): the outcome of the last action. Info and success messages clear on navigation; errors stay until the next action.
- **Connect panel** (`#ledger-entry`): on Home while nothing is open, then moved into More, so Open/Reconnect never disappears while a ledger is loaded.

Disabled actions keep their reason beside them. Actions that cannot apply in the current mode are hidden, for example Release without a session.

## Home

Home answers "how much came in and went out, and what needs me?" for one period (owner decisions, 2026-11-26). The read model is [home-period-report.mjs](../js/home-period-report.mjs) and the presentation is [home-dashboard.mjs](../js/home-dashboard.mjs). Customizing the layout is deferred.

- **Period bar.** A Month, Year and Lifetime switch with previous and next arrows, shared by Home, Activity and Reconcile. The account picker sits beside it. A ledger opens on the current calendar month, even when that month has no data yet. The arrows reach from the first month with evidence to the later of today and the last evidence. Month remembers the last month chosen in a year. The hidden `#month-filter` select stores the period: an empty value is Lifetime, `YYYY` a calendar year and `YYYY-MM` a month. Reconcile and account-month coverage need a single month and say so otherwise.
- **One source per month.** A history month uses reconciled transaction detail when its review holds, otherwise the workbook or manual summary. A month with no history summary uses imported activity, labelled **Partial**. This replaced the earlier trend rule that left post-history months blank. Year and Lifetime sum these months, and a gap is never summed as zero. Currencies are never combined: a mixed-currency scope shows each currency's known totals and asks for one account before drawing categories or the trend.
- **Layout.** A two-column bento from 1000px, the breakpoint the shell has used since PR 62, so iPad portrait (820px) shows one column: money in and out, categories and recent activity in the wide column; Needs attention, Import and the trend in the narrow one. Phones show one column: figures, Needs attention, categories, trend, Import, recent activity.
- **Figures.** Money in, Money out and Cash movement, each with one qualifier: the change against the previous month, or against the same data months a year earlier. A comparison appears only when every matching month has data; otherwise the qualifier says which period has gaps. Lifetime has no comparison. Cash movement counts imported months only and says so when workbook months have no cash detail. The block meta names the period, the account and how many months each source supplied. An empty month replaces the figures with "Nothing recorded for November 2026 yet. That is missing data, not $0." and a button to the latest earlier month with data.
- **Spending by category.** A donut with the total in the centre, beside a ranked legend of name, exact amount and share. Workbook and app categories with the same name, ignoring case, merge into one row. Workbook spending without a category is **Not broken down**, and imported spending without one is **No category**. Both are hatched, never a hue. Categories under 3% fold into one expandable **Smaller categories** row, so no target is too small to tap. Selecting a row or slice inspects it in place: amount, share, transaction count, workbook months and the change against the comparison period. **Show … in Activity** then opens Activity filtered to that category for the same account and period. A category from workbook months only has no Activity link. A category whose refunds exceed its spending is listed under the legend with no slice.
- **Category colour.** The six largest lifetime categories keep the slots `--cat-1` to `--cat-6` in every period; every other category uses `--cat-0`. Slices are drawn in slot order with 2px gaps, so neighbours keep the validated contrast.
- **Trend.** Six months ending at the chosen month, that year's months for a year, or one column per year for Lifetime. Columns are labelled **Reconciled**, **Reported**, **Manual**, **Partial**, **No data** or **Not comparable**; year columns say **Full** or how many months have data. Twelve narrow columns draw a gap as the missing-data hatch and keep their source in the accessible name and readout only. Selecting a column shows exact amounts and its source. A month column then offers to open it in Activity, and a year column offers to show that year. No chart library is used.

## Tokens

Defined once on `.canonical-workspace` in `canonical-workspace.css`; the app no longer loads `styles.css`.

## Colors

- **Surfaces:** page `#0b1116` (matches the manifest and icons), surface `#121a21`, raised `#18232c`, hairline `#22303b`, control border `#344654`.
- **Ink:** text `#e9eff2`, secondary `#b7c4ce`, tertiary `#93a3b0`. All are at least 4.5:1 on the surface color.
- **Accent:** mint `#8fdccb` with ink `#06261f`. It marks the primary action, focus and the current place, never decoration.
- **Status:** warning `#f0c56f`, danger `#f4a3b0`, success `#85dcb6`. Each is always paired with words.
- **Chart series:** in `#28a28d`, out `#9079e4`. Validated with the dataviz palette checker for lightness, chroma, colorblind separation and contrast on the page and surface colors.
- **Categories:** `#338ced`, `#e76624`, `#00a888`, `#d28e05`, `#e24d8b`, `#9887ef` in that slot order, plus `#6b7d8a` for every other category. The six pass the dataviz checker as adjacent pairs on the surface color; any two may meet in a donut, so slices keep 2px gaps and the legend carries every name.

## Typography

System sans with a fixed scale of 12/14/16/18/22/28/30px, and tabular numerals for every amount. Form controls stay at 16px so iOS does not zoom on focus.

## Space and shape

4/8/12/16/24/32/48px spacing; 12px panel radius; 8px for controls.

## Components

- Figures are a statement row of label, exact value and one qualifier. They are not a card grid. At every width, the label and qualifier sit on the left and the value sits right-aligned in the same row.
- Lists use hairline rows (recent activity, transactions under 1100px, accounts, review items, links). A table is used only for transactions on wide screens.
- Disclosures are one level deep (`.disclosure`). Nested disclosures are avoided.
- Panels (`--surface`) are used only for Home's side column, the account detail on wide screens, the connect panel and the correction form.
- Icons are inline SVG with a 1.6 stroke. No glyphs stand in for icons.

## Accessibility and motion

Touch targets are at least 44px, apart from the 40px transaction row button, whose whole row is also tappable. Focus is a 2px mint outline. Escape closes transaction detail. The trend columns are buttons with full accessible names. Decorative separators are hidden from assistive tech. With reduced motion, the busy-status pulse stops. In forced-colors mode, chart bars fall back to system colors.

**Verified in Chromium:** 320, 390, 820, 844×390, 1440px and 200% text, all without horizontal overflow. **Unverified:** physical iPhone/iPad Safari, installed Home Screen launch and on-screen keyboard behavior. VoiceOver is out of scope; see [Product § 3](PRODUCT_DEFINITION.md#3-intended-user-and-platforms).
