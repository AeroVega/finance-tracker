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
