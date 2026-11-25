# Interface design

**Status:** Implemented on the `t3/finance-app-ux-overhaul` branch; not owner-accepted or deployed. See [CURRENT_STATE.md](CURRENT_STATE.md) for what is on `main`.

This is the working reference for the main app's look and layout: `index.html`, `canonical-workspace.css`, and the presentation code in `js/canonical-workspace.mjs`, `js/workspace-pages.mjs` and `js/home-monthly-trend.mjs`. Product scope stays in [PRODUCT_DEFINITION.md](PRODUCT_DEFINITION.md). The earlier [mobile UI design](MOBILE_UI_DESIGN.md) and [mobile workspace pages](MOBILE_WORKSPACE_PAGES.md) keep their rationale for the mounted-page architecture, which is unchanged.

## Direction

A calm, information-dense dark finance app (owner choice, 2026-11-24). The screen should answer "how much came in and went out, and what needs me?" before showing tools. Restraint is the brand: one accent, hairlines instead of boxes, aligned exact numbers, and short honest qualifiers. Each screen or state has one primary (mint) action.

## Navigation

| Tab | Route(s) | Holds |
| --- | --- | --- |
| Home | `#overview`, `#import` | Period, money in and out, needs attention, Import, six-month trend, recent activity |
| Activity | `#transactions`, `#review`, `#reconciliation`, `#activity-detail` | Search and filters, imported rows awaiting a decision, month reconciliation, transaction detail |
| Accounts | `#position`, `#holdings` | Dated balances with provenance on demand, holdings, evidence editors |
| More | `#storage` | Session and save actions, connect panel once something is open, historical summaries, backup and restore, recovery and diagnostics, sample data, build identity |

Planning is part of the product direction but has no tab until a feature exists. Route names are unchanged so existing links, history and tests keep working; only titles and grouping changed. Phones use a four-item bottom bar, 761–1199px a labelled rail, and wider screens a sidebar.

## Workspace status

- **Mode pill** (top right, links to More): synthetic or private, preview, saved, or read-only.
- **Save bar** (`#draft-bar`): sticky at the bottom of the content, above the phone tab bar. It appears only when there is something to save, wait for, or recover. It carries one action: Save changes, or Save preview in a local preview. In recovery states the bar becomes a link straight to Recovery, with Verify focused. Short landscape windows keep it in the page flow.
- **Action status** (`#action-status`): the outcome of the last action. Info and success messages clear on navigation; errors stay until the next action.
- **Connect panel** (`#ledger-entry`): on Home while nothing is open, then moved into More, so Open/Reconnect never disappears while a ledger is loaded.

Disabled actions keep their reason beside them. Actions that cannot apply in the current mode are hidden, for example Release without a session.

## Home trend

`js/home-monthly-trend.mjs` (data rules from draft PR 59) shows six calendar months, ending with the latest month that has evidence. It uses reconciled or workbook monthly history when available, otherwise known transaction subtotals from the existing canonical report. Each month is labelled **Reconciled**, **Reported**, **Manual**, **Partial**, **No data** or **Not comparable**. Gaps are never drawn as zero, and currencies are never combined. Selecting a column shows exact amounts and its source, and offers to open that month in Activity. No chart library is used.

## Tokens

Defined once on `.canonical-workspace` in `canonical-workspace.css`; the app no longer loads `styles.css`.

- **Surfaces:** page `#0b1116` (matches the manifest and icons), surface `#121a21`, raised `#18232c`, hairline `#22303b`, control border `#344654`.
- **Ink:** text `#e9eff2`, secondary `#b7c4ce`, tertiary `#93a3b0`. All are at least 4.5:1 on the surface color.
- **Accent:** mint `#8fdccb` with ink `#06261f`. It marks the primary action, focus and the current place, never decoration.
- **Status:** warning `#f0c56f`, danger `#f4a3b0`, success `#85dcb6`. Each is always paired with words.
- **Chart series:** in `#28a28d`, out `#9079e4`. Validated with the dataviz palette checker for lightness, chroma, colorblind separation and contrast on the page and surface colors.
- **Type:** system sans with a fixed scale of 12/14/16/18/22/28/30px, and tabular numerals for every amount. Form controls stay at 16px so iOS does not zoom on focus.
- **Space and shape:** 4/8/12/16/24/32/48px spacing; 12px panel radius; 8px for controls.

## Components

- Figures are a statement row of label, exact value and one qualifier. They are not a card grid. On phones, the value sits right-aligned in each row.
- Lists use hairline rows (recent activity, transactions under 1100px, accounts, review items, links). A table is used only for transactions on wide screens.
- Disclosures are one level deep (`.disclosure`). Nested disclosures are avoided.
- Panels (`--surface`) are used only for Home's side column, the connect panel and the correction form.
- Icons are inline SVG with a 1.6 stroke. No glyphs stand in for icons.

## Accessibility and motion

Touch targets are at least 44px, apart from the 40px transaction row button, whose whole row is also tappable. Focus is a 2px mint outline. Escape closes transaction detail. The trend columns are buttons with full accessible names. Decorative separators are hidden from assistive tech. With reduced motion, the busy-status pulse stops. In forced-colors mode, chart bars fall back to system colors.

**Verified in Chromium:** 320, 390, 820, 844×390, 1440px and 200% text, all without horizontal overflow. **Unverified:** physical iPhone/iPad Safari, VoiceOver, installed Home Screen launch and on-screen keyboard behavior.
