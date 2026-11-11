# Focused mobile workspace pages

**Implemented, November 10, 2026:** the owner requested feature-focused pages after reviewing the iPhone dashboard. This presentation change stays within PR36's synthetic-only scope. It does not change financial calculations, storage formats, production permissions or deployment behavior.

## Design decision

The previous main page placed setup, income and spending, account balances, holdings, reconciliation, transactions, corrections, review and storage in a single scroll. Its anchor navigation only highlighted a section; it did not switch pages. A permanent five-action save tray used substantial phone space even when there were no changes.

We considered three options:

- Keep the long dashboard and collapse sections. This reduces initial height but leaves core features hidden in disclosures and makes navigation dependent on scroll position.
- Load a separate HTML document for each feature. This gives distinct URLs but would replace the in-memory ledger, connection and unfinished editors. Maintaining them would require new persistence or session machinery.
- Keep one live workspace with separate, addressable page views. This provides focused destinations and browser history while preserving the existing session and mounted editors. This is the selected approach.

The five primary destinations are **Overview**, **Activity**, **Position**, **Review** and **Storage**. Phones use a persistent bottom bar with icon and text labels. Wider screens keep the sidebar. Position has **Balances** and **Holdings** pages; Review has **Decisions** and **Reconciliation** pages. Transaction detail opens as its own view, with a return control and a resume link from Activity.

The existing charcoal and cyan visual direction remains. The large marketing-style header is replaced by a page title and short description. The Overview contains known cash-flow subtotals, evidence qualifications and short links to deeper work. Setup and session tools belong to Storage. A compact draft bar appears while changes, an operation or uncertain recovery need attention; clean saved data no longer carries a floating five-button tray. Transaction rows become readable stacked records on phones rather than requiring sideways scrolling.

## Research used

These sources informed the navigation and information hierarchy, not the financial behavior:

- [Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars): persistent, recognizable top-level destinations.
- [Android primary navigation](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns): three to five destinations, adapting navigation to available width.
- [Apple layout](https://developer.apple.com/design/human-interface-guidelines/layout): safe areas and layouts suited to the available space.
- [Copilot Cash Flow](https://help.copilot.money/en/articles/9682232-cash-flow-tab-overview): a focused financial question with connected detail views.
- [Monarch dashboard customization](https://help.monarch.com/hc/en-us/articles/360058127551-Customizing-Your-Dashboard): a dashboard as a set of summaries, with mobile and desktop differences.

These are design references, not evidence that this app has passed user or device testing. No graphics, fonts, scripts or financial records from those products were copied.

## Navigation and data boundaries

`js/workspace-pages.mjs` owns page visibility, titles, active navigation, focus and per-view scroll position. It does not read or write the ledger or storage. Only page names enter the URL, never account IDs, transaction details or evidence text. The original navigation script remains for the separate legacy diagnostic.

All feature views and editors stay mounted. Switching views, using browser Back/Forward or returning to transaction detail preserves unfinished fields, staged changes, search, page selection and the active storage session. No route action saves, releases, discards or reconnects. Existing explicit replacement confirmation, save verification, uncertain-outcome blocking, offline gating, undo/revert and unload warnings remain in the canonical controller.

Account scope remains shared. Activity month applies to Overview, Activity and Review. The as-of date applies to Position and Holdings and remains separate from the activity month. Hidden conditional controls are not revealed by routing. Empty direct links show a route-appropriate prompt; invalid hashes fall back to Overview, and detail without a selected transaction falls back to Activity.

The five navigation targets remain available during a save so the user can inspect the workspace. Mutating controls remain disabled by the existing busy/session rules. Interrupted-operation and stale-session controls are exposed on Storage when recovery is required.

## Automated verification

The complete serial Node 24.22.1 suite passes **1,120/1,120** checks with no failures or skips. The focused controller suite passes **52/52** checks and the dedicated routing suite passes **16/16** checks. The controller uses real synthetic ledger/session engines and controlled in-memory storage. The router suite uses a small DOM/history substitute. Coverage includes:

- Exactly one page visible, accessible current-page markers and direct-link fallbacks.
- Native hash changes and pushState Back/Forward, title/focus changes and per-page scroll.
- Pending correction, balance, holdings and statement-component fields across navigation.
- Shared account scope and independent activity/as-of dates.
- Staged changes surviving page changes and reaching storage only on explicit save.
- Uncertain saves preserving the draft, blocking retry and retaining recovery controls.
- Review-to-Activity drilldowns, close/resume behavior and replacement-ledger detail cleanup.
- Newer navigation is respected when an in-flight ledger open finishes.

Run the focused checks with:

```sh
node --test tests/workspace-pages.test.mjs tests/canonical-workspace-ui.test.mjs
```

Run the complete repository suite with:

```sh
node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

**Unverified:** actual rendered layout, native browser scrolling, text enlargement, Safari table accessibility and physical iPhone/iPad interaction. The supplied browser returned `net::ERR_CONNECTION_REFUSED` for the local app server. The previously blocked Chromium route was not retried. No screenshots of this new UI are claimed as rendered evidence. No live Google action, merge or deployment was performed for this change.

## Owner acceptance on the intended commit

After a separately authorized deployment, verify its full source SHA in Storage. The older PR32 mobile acceptance does not establish acceptance of this new navigation and layout.

1. On a narrow iPhone, open **Explore a synthetic preview**. Check every bottom navigation destination without scrolling to discover it. Verify only the selected page is visible and the synthetic label remains readable.
2. In Activity, inspect a transaction and type an unfinished correction. Visit every primary page, return through **Continue inspecting**, then try Back/Forward. Confirm the text, account/month filters and selection remain.
3. In Position, stage a balance and leave another form unfinished. Switch to Holdings and then Review → Reconciliation. Confirm both the staged change and unfinished fields survive. Changing the activity month must not change the position date.
4. Check readable amounts, long descriptions, missing data, all input labels, keyboard focus and VoiceOver table navigation. Check 320px, typical iPhone and tablet widths, both orientations, enlarged text and the on-screen keyboard. Bottom navigation and the draft bar must not cover the final control on any page.
5. Verify that a clean saved ledger has no floating save tray. Stage a change and confirm the compact bar shows it as not saved. In Storage, verify Undo, Revert, Reopen and Release remain separate deliberate actions.
6. Use the existing owner-run synthetic save/reopen, cancellation and interrupted-save procedure. Navigation during a pending or uncertain save must not start another write, discard the draft or hide the recovery path. This redesign does not authorize agent-run live Drive tests.
