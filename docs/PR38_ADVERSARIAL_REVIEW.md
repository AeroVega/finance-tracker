# PR38 adversarial UI review

## Scope and conclusion

Reviewed PR38 from base `b9e3950b7ec2886150879e51da54db56ebfa0322` to head
`18748601ed90c882dcec1203d0ecc3c110af682a`, including the Apple installation
foundation and mobile/tablet redesign. The owner authorized implementing the
findings in a new commit on the same PR. Tests use invented data only.

Keep the focused-page design. Its main weaknesses were transitions between
records, native anchor scrolling and fixed chrome in a short window. Those are
repairable without replacing the navigation model or financial/storage layer.

## What works well

- Home and Activity answer different questions. Their shared account/month
  scope remains consistent, while Activity search and pagination do not alter
  financial totals or Home's recent records.
- The tablet rail gives account cards and editors more usable width. Labeled
  navigation and a single set of mounted editors work across window resizing.
- The native filter disclosure supports keyboard activation. Unknown balances,
  incomplete coverage and explicit-save/recovery requirements remain visible.
- Whole-row inspection retains an explicit keyboard button and permits text
  selection. The review empty state correctly separates zero unresolved records
  from evidence of complete history.

These conclusions are supported by the synthetic controller and rendered-browser
checks. They are not owner usability acceptance or physical Safari evidence.

## Findings and implemented suggestions

| Priority | Confirmed problem at the reviewed head | Correction |
| --- | --- | --- |
| P1 | At 568×320, 200% root text and a 21px bottom inset, a staged draft leaves **−10.7px** between the fixed header and draft bar. The editor is covered. The header ends at 99.1px and the draft starts at 88.4px. | In windows at most 760px wide and 450px tall, put the header and draft bar in document flow. Keep the primary tabs fixed. Size the tab bar from a 72px base plus its actual growing content, rather than doubling a rem-based minimum. |
| P2 | Reopen the same Home record after typing an explanation and it becomes an empty string. Choosing another record also replaces the editor without consent. | Reuse the mounted editor for the same record. Ask before a different record, Back or copy replacement would discard actual unfinished input. Include unfinished transaction input in the existing page-exit guard. Clean editors do not produce extra confirmation. |
| P2 | A synthetically corrected pending fee classified as spending appears as **spending** in Home, with no indication that its amount is excluded. Unknown posting states show only **Needs review**. | Label pending and unknown status explicitly as excluded in Home and Activity, independently of classification and the review count. Keep exact amounts and the existing reporting rules. |
| P2 | Clicking the already-active Home tab at scroll 0 performs a native anchor jump to scroll **188px**, hiding the header and filter row. The normal route path behaves differently. | Intercept ordinary links to known app routes before the native jump. Preserve per-page scroll on route changes and Back/Forward. Re-selecting the current page goes to its header without adding history. Modified clicks retain browser behavior. |

Baseline code locations:

- [Record buttons and status copy](https://github.com/AeroVega/finance-tracker/blob/18748601ed90c882dcec1203d0ecc3c110af682a/js/canonical-workspace.mjs#L241)
  and [editor reset](https://github.com/AeroVega/finance-tracker/blob/18748601ed90c882dcec1203d0ecc3c110af682a/js/canonical-workspace.mjs#L560).
- [Routing and same-page early return](https://github.com/AeroVega/finance-tracker/blob/18748601ed90c882dcec1203d0ecc3c110af682a/js/workspace-pages.mjs#L24).
- [Tab-height minimum](https://github.com/AeroVega/finance-tracker/blob/18748601ed90c882dcec1203d0ecc3c110af682a/canonical-workspace.css#L8)
  and the mobile fixed header, navigation and draft rules in the same stylesheet.

## Evidence and regression boundaries

Four new controller regressions fail against an isolated checkout of the
reviewed head for the expected reasons: cleared explanation, replaced record,
missing unknown-status label and missing pending-status label. They pass after
the fixes. Additional tests cover clean versus unfinished unload/replacement,
modified links, history length and per-page scroll restoration.

The browser check now includes nine layout cases, including the failing short
200% case. It verifies an actual hit on the editor, reachable in-flow draft
actions, same-record retention, cancelled record replacement, active-tab top,
native Back/Forward and the existing resize/clearance checks. A separate
synthetic posting-correction/classification flow verifies status labels through
the actual app while unavailable totals stay unavailable.

**Verified, November 11, 2026:** all 2,009 extended tests pass on Node 24.22.1
in 318.394 seconds, with no failures, skips or cancellations. The 82 focused
controller/routing tests, nine rendered layouts, separate posting-state flow,
syntax, documentation and diff checks pass. Current validation results are
recorded in [project status](PROJECT_STATUS.md).
Calculations, source/audit evidence, explicit saves and recovery engines were
not changed. No live Drive, merge or deployment operation was performed.

**Unverified:** physical iPhone/iPad Safari, on-screen keyboard behavior,
VoiceOver, iPad window controls and Home Screen launch/tinting. A short Linux
browser viewport is evidence for the layout failure and repair, not proof of
how an iOS keyboard changes its viewports. No OS-specific workaround is claimed.
