# Mobile and tablet workspace design

The owner requested a design rethink within [PR38](https://github.com/AeroVega/finance-tracker/pull/38),
after its Apple web app foundation. This changes presentation and navigation
interactions. The canonical financial model, storage contracts, explicit save,
uncertain-outcome blocking and synthetic-only limits remain in force.

## Research and choice

First-party sources consulted November 11, 2026:

| Source | Pattern used here |
| --- | --- |
| [Monarch dashboard](https://help.monarch.com/hc/en-us/articles/360058127551-Customizing-Your-Dashboard) | Distinct summary and transaction cards rather than one undifferentiated report. Our layout is fixed; it does not implement customization. |
| [YNAB Home and Spending](https://www.ynab.com/whats-new/the-great-ynab-remodel) | Home puts decisions and shortcuts beside financial context; transaction work has its own destination. |
| [Copilot for iPad](https://help.copilot.money/en/articles/10003978-copilot-money-for-ipad) | Adapt to window width, keep navigation labeled, and make account and review context visible. |

These are interaction references. No brand artwork, screenshots, stylesheets,
fonts or app code were copied. This app does not gain those products' budgets,
recurring-payment forecasts, automatic account sync or multi-device promises.

We compared expanding the existing report and forms on one page with a compact
Home plus focused work pages. The long report keeps everything discoverable but
puts setup and explanations before the next useful action on a phone. The
selected design keeps the existing mounted-page architecture and brings the
common tasks forward. A separate-document redesign would lose in-memory editors
without new persistence, which is unnecessary for this request.

## Implemented behavior

- Home shows the existing exact income, spending and cash-movement measures,
  four recent source activities, and the scoped unresolved-record count. Recent
  activity includes excluded records and says so. Currency separation, missing
  values and completeness qualifications remain visible.
- Recent activity uses the existing view reader with the shared account/month
  scope. Activity search, review-only filtering and pagination never filter Home.
  Tapping a recent record opens the existing detail page; Back returns to Home
  and restores focus to its record, or the heading if the record is no longer
  present. The first-run synthetic preview now opens Home. The dedicated
  balances preview in Storage still opens Accounts.
- A native expandable filter row shows the active account and period or balance
  date. It supports keyboard activation and retains selections across pages.
  Changing the position date remains independent of the activity month.
- Activity uses full-width records through 1100px. A row tap opens detail;
  selecting description text does not. An explicit Inspect button preserves
  keyboard access, and its bubbled click cannot open detail twice. Review reasons
  remain visible. Above 1100px, the semantic table retains its column layout.
- Accounts puts dated totals and balance cards before the grouped account,
  balance and closure editors. Source evidence and conflict-resolution controls
  remain available. Detail puts the correction form before source/history on
  phones, so editing does not require scrolling past raw evidence.
- Review has an explicit empty state with a reconciliation link. Zero unresolved
  records never claims complete coverage or complete net worth.
- Phones retain five labeled bottom destinations. At 761–1199px, a 96px rail
  plus any left safe-area inset gives content more room than the previous 220px
  sidebar. Larger screens use a 224px sidebar. Window resizing keeps the same
  mounted editors and shared scope. Measured bar clearance and Apple safe-area
  rules from the foundation remain in place.
- The main app uses graphite surfaces, mint actions, tabular amounts and larger
  supporting text. Diagnostic pages retain their shared design tokens. The
  manifest and generated opaque icons match the main app's first-rendered color.

## Acceptance and limits

The optional `scripts/check-apple-ui.cjs` exercises the actual rendered app with
external HTTPS blocked. It checks eight phone, landscape, tablet, desktop and
200% text layouts, Home/detail return, keyboard-operated filters, unfinished
balance fields across navigation, whole-row taps, overflow and fixed-bar
clearance. It also resizes a live tablet window to phone width and back while
retaining a staged change and unfinished balance/correction text. The controller tests cover Home scope isolation, empty states, exact
source amounts, text-selection guards and focus return. Existing tests retain
save, failed-save, recovery, offline and draft-preservation checks.

**Verified, November 11, 2026:** all eight browser layouts and live resize checks
pass. The complete extended suite passes 2,003/2,003 on Node 24.22.1 in 350.519
seconds, with no failures, skips or cancellations. Focused controller/routing
checks pass 76/76. Source syntax, documentation, opaque icon dimensions and
anonymous subpath delivery pass. Current results are recorded in
[project status](PROJECT_STATUS.md). The earlier
foundation's results in [Apple web app UI](APPLE_WEB_APP.md) describe its own
revision, not this redesign. Chromium checks cannot establish physical iOS
keyboard behavior, Safari tinting, VoiceOver, iPad window-control overlap or
Home Screen launch appearance. Those remain **Unverified**. No merge, deployment
or live owner Drive operation is part of this change.
