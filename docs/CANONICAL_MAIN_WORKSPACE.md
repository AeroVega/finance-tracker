# Canonical main workspace

## Scope

**User-confirmed:** implement step 1 of the four-PR plan so the owner can deploy the branch and explore the saved synthetic financial year in the main app. This is a synthetic-only application flow. Production financial-data persistence remains **NO-GO**. Merge, deployment and live Google actions by agents are not authorized.

**Implemented:** the main page now opens an existing synthetic canonical copy, browses effective activities by account and month, shows qualified canonical reports, inspects preserved source observations and audit history, stages category, classification and amount corrections, explicitly saves and independently verifies them, and reopens saved records. A separate local preview generates the same invented year without Google access or writes. Preview changes cannot be saved into a selected copy.

The existing `DashboardSyntheticStorage`, `CanonicalLedgerStore`, canonical financial-event and reporting engines remain responsible for ownership, exact-base checks, durable writes, integrity, append-only history, recovery and financial meaning. There is no new persistence format, migration, automatic save or complete-history assertion. Existing v1, grouped v2 and fragmented v3 copies keep their layout.

## Ordinary flow

1. Open the main page and choose **Open saved synthetic year**. Select the existing folder used by the synthetic-year tool, with `synthetic` in its name. Do not select a production folder or any folder containing personal financial data. This action never initializes a new empty copy.
2. Select an account and month. These controls scope both rows and reports. Search and **Needs review only** filter displayed rows, not totals. Rows are paginated, 25 at a time.
3. Choose **Review** beside an activity. The detail panel shows its current values, source observations and audit history. Raw evidence is available on demand.
4. Choose a correction, enter a reason, and press **Stage correction**. The change remains local. The source activity and source fields remain unchanged; the canonical engine appends an event. A category correction also records the existing engine's prospective rule for later matching imports in that account and currency. Other existing matching purchases are not recategorized. Linked refunds follow their purchase category unless separately categorized.
5. Press **Save changes** once. The page blocks repeated operations and shows elapsed time until the store completes its verified read-back. It does not equate a write response with a verified save.
6. **Reopen saved** independently loads the selected copy again. Unsaved changes require confirmation and are discarded only after a successful verified load.
7. **Release session** verifies release and clears the workspace's authorization token. Loaded records and any draft remain read-only in this synthetic tab. Close the tab to clear them. Reconnecting reopens the saved copy rather than silently reapplying a draft.

If the owner has not seeded a copy, **Preview invented year locally** demonstrates the same canonical records and correction controls without connecting to Google. The existing synthetic-year tool still owns fresh-folder admission and seeding.

## Meaning and limits

- Income, spending and cash movement come from the canonical report engine, with exact decimal display. They are labelled known partial totals. Missing eligible data is **Unavailable**, not an invented zero.
- The invented year's known annual income is **$73,739.50** and known spending **$30,381.00**. Transfers and card payments are not counted as income or spending. Refunds use their posting period.
- The 48 investment activities remain unclassified with unknown lifecycle. Their source evidence remains visible; they do not become supported investment records merely because the UI displays them. Changing a classification does not invent posting/lifecycle evidence.
- Cash movement is the engine's checking/savings subtotal excluding transfers. It is not a balance, total bank movement, net worth or financial-position report.
- Declared coverage, import dates and row counts do not prove complete history. Reports remain incomplete. Balance/snapshot records, reconciliation completeness, holdings, valuations, monthly-history migration from January 2023 and production authorization belong to later work.
- This main flow does not ingest user files. The canonical import workbench retains its bundled invented-fixture, source matching, rejection, reversal and refund-link workflows. The main page shows unresolved source observations and links that advanced workflow; it does not duplicate those controls.
- The old raw-CSV/sample page remains a clearly separate [local preview diagnostic](../prototype/local-preview.html), with its existing regression tests. It is no longer the main financial workspace or a source for canonical totals.
- Browsing, filtering and staging do not call Drive. Open, save, reopen, recovery and release retain existing verification and history costs. Elapsed time is feedback, not a performance guarantee. Whole-graph validation/reconstruction and large-device memory limits remain.
- Original-file-retention maintenance is disabled for this workspace. It neither uploads originals nor deletes retained originals. Existing source-row evidence and durable history are preserved.

## Failure and interruption behavior

A failed or uncertain save keeps the local proposal but blocks saving it again. The owner must recover if offered, then reopen verified records to determine what reached storage. Recovery does not automatically replace or retry the draft. A failed reopen leaves the prior view and draft visible but removes write eligibility. Offline, ownership uncertainty and lifecycle transitions invalidate editing until a verified reopen. An unverified release never announces a successful handoff.

The page requests an unload warning during work or while a draft is unsaved. Mobile browsers do not guarantee that warning. Keep the tab open until verification completes and release the session before moving to another device or tool.

## Pre-acceptance quality pass

**Implemented, synthetic-only:** the workspace now retains a private defensive snapshot reader for the current loaded ledger. Financial reports, sorted rows and searchable text are reused only while the account and month remain the same. Search, review-only filtering and pagination do not recalculate the financial reports. Switching account or month replaces the single cached scope; opening, correcting, saving or verified reopening replaces the reader because the session supplies a new ledger object. Returned views are detached from the cache. The one-shot model API still validates and computes a fresh result.

Search waits 120 ms after typing stops and respects text composition. Scope changes and completed corrections render immediately. This is a small typing-coalescing delay, not a performance acceptance threshold. Initial graph validation, snapshot creation and account/month report calculation still scale with the loaded history. This optimization adds an in-memory defensive snapshot and a single scope cache; it is not a new persistence format or an unlimited multi-period cache.

The source review count covers every unresolved observation in the selected account and period. The page explicitly labels its ten-item preview as a preview of that count. Search does not filter the source queue. Unknown-date observations stay visible in any selected month rather than disappearing; resolved observations disappear after verified reopening. Resolution remains in the advanced import workbench, and a view never creates financial activities.

Cancellation now reports cancellation rather than leaving an operation-in-progress message. Recovery controls are disabled offline, dynamic review controls expose their busy state, arbitrary provider error text is not echoed, and closing transaction detail returns keyboard focus to its visible Review button (or search if the row is no longer displayed). Page and filter status messages are atomic live announcements.

No canonical engine, ledger contract, monetary calculation, audit record, session protocol, storage format, deployment workflow or production permission changes are part of this pass. The existing v1/v2/v3 save/reopen tests remain required. Physical Safari, live Google behavior and mobile memory capacity remain owner acceptance work.

### Automated evidence for the quality pass

**Verified:** the deterministic scale fixture contains 3,000 activities across four accounts and USD/EUR, 3,400 events including 400 amount corrections, and 320 unresolved observations. Tests assert independently expected exact totals, compare scoped reports with the canonical engine, exercise repeated filtering and pagination, reject corrupt input, isolate caller/result mutations, and verify that resolved observations disappear without adding activities.

The controller regressions cover cancelled actions, failed and uncertain saves, repeated actions while pending, draft preservation, search after corrections, recovery followed by verified reopening, offline control gating, safe errors, focus restoration and accessible status markup. The small simulated DOM does not establish Safari compatibility.

A separate local Chromium run exercised the real page and canonical engines with an invented in-memory storage service. It passed at 1440×1000, 820×1180, 1180×820, 390×844 and 320×740. Search preserved totals; staged corrections survived a deliberately lost save response, recovery and verified reopen; repeated actions made one write; no page errors or horizontal document overflow occurred. This did not contact Google or test a physical device.

### Measured model cost

**Verified locally on Node 24.22.1:** four interleaved baseline/current runs of the fixture above, after the full test suites finished. The baseline is PR32 commit `ef1c85157ef80d8ccf0c3b79514bf97b28516457`. Values below are median milliseconds. The script measures model work, not DOM rendering, Drive, physical Safari or whole-app latency. Fixture construction is excluded.

| Operation | Baseline | Snapshot reader | Reduction |
| --- | ---: | ---: | ---: |
| Search within the loaded scope | 225.36 | 8.92 | 96.0% |
| Next page within the same search | 223.15 | 4.97 | 97.8% |
| Change month | 212.85 | 104.04 | 51.1% |
| Change account | 187.22 | 86.73 | 53.7% |

Cold opening is a tradeoff. Creating the defensive reader and its first scope took a combined median **287.28 ms**, compared with **226.76 ms** for the original one-shot first view. The snapshot adds memory and setup cost so later presentation changes can avoid financial reconstruction. This pass does not claim faster startup, constant-time history loading or lower Drive latency. The single-scope cache bounds retained report copies, but total memory still grows with loaded history.

Reproduce with `node tests/benchmark-canonical-workspace-view.mjs --baseline-ref ef1c85157ef80d8ccf0c3b79514bf97b28516457`. There is no wall-clock pass/fail threshold.

**Verified automated validation:** final full suites on Node 24.22.1 and 26.13.0 each passed **1,025/1,025**, with zero failures, cancellations or skips. The 63 focused workspace model/session/controller/scale tests passed separately on Node 24.22.1. Syntax checks passed for all 149 JavaScript modules under `js`, `prototype` and `tests`; changed-document links and `git diff --check` passed. Independent standards and specification reviews found no remaining blocker.

## Validation and owner acceptance

**Open:** the new main-app flow has not been accepted on physical iPad/iPhone Safari or live Drive. PR30's nine owner-reported iPad passes apply to the PR30 tested commit only, not this change. Partial iPhone testing does not establish complete iPhone coverage.

Before calling the new workflow accepted, deploy the feature branch yourself through **Actions → Deploy static site to GitHub Pages → Run workflow**, select `feature/canonical-main-workspace`, and verify the source SHA shown in the page matches the reviewed branch head. This replaces the repository's single shared Pages deployment. No deployment is performed by this implementation work.

Run these checks with invented data only:

1. Local preview before authorization: all four accounts and twelve months appear, known annual totals match the values above, and nothing opens Google or writes Drive.
2. Open an existing v2 synthetic year, inspect all accounts and a month, then repeat with an existing v3 copy. No reseed or format conversion occurs.
3. Select the investment account: activities and evidence remain visible but known reports show unavailable, not complete investment totals.
4. Search, page and change account/month. Confirm search does not change totals, while account/month does. Check narrow portrait, tablet portrait/landscape and browser Back/Forward navigation.
5. Correct a category and an amount with a reason. Inspect unchanged original source and added audit evidence, save once, reopen and compare. Try a repeated click while saving.
6. Cancel authorization or Picker, cancel draft replacement, and cancel release with an unsaved draft. Confirm no false success, loss or unintended save.
7. Go offline and reconnect. Confirm records remain readable, edits/saves stay blocked until verified reopen, and local proposals are not silently retried.
8. Use a disposable copy for interruption/recovery. An uncertain save must remain unverified until recovered and reopened. Preserve any uncertain folder; do not delete or repeatedly retry it.
9. Release successfully, then open on the next device. Confirm the exact saved corrections. Unverified release must block any success claim.

Automated and local-browser results for the final commit are recorded in the PR handoff separately from these open owner observations. No automated CI result establishes live Google latency, physical Safari behavior, production readiness or deployment.
