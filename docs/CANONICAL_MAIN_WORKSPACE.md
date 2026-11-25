# Canonical main workspace

**Mobile navigation update:** [Focused workspace pages](MOBILE_WORKSPACE_PAGES.md) replaces the single scrolling dashboard with Overview, Activity, Position, Review and Storage. This changes the affected mobile acceptance scope; prior PR32 layout acceptance does not validate the new pages.

## Scope

**Verified November 10, 2026:** [PR32](https://github.com/AeroVega/finance-tracker/pull/32) merged into main, including [PR34](https://github.com/AeroVega/finance-tracker/pull/34), which had merged into its branch. Implementation and acceptance remain separate. See [project status](PROJECT_STATUS.md) for the exact source and deployment result.

**User-confirmed:** implement step 1 of the four-PR plan so the owner can deploy the branch and explore the saved synthetic financial year in the main app. This is a synthetic-only application flow. Production financial-data persistence remains **NO-GO**. This historical milestone authorization is superseded by the current boundary in [CURRENT_STATE.md](CURRENT_STATE.md).

**Implemented:** the main page now opens an existing synthetic canonical copy, browses effective activities by account and month, shows qualified canonical reports, inspects preserved source observations and audit history, stages category, classification and amount corrections, explicitly saves and independently verifies them, and reopens saved records. A separate local preview generates the same invented year without Google access or writes. The owner may explicitly save the exact current preview—including staged corrections, or the untouched original recipe—to a newly selected, empty synthetic Drive folder. This is a fresh-copy operation, never an overwrite or append to an existing copy.

Transfer links are append-only canonical financial events. The effective view exposes the same transfer-group identity and reciprocal counterpart activity on both sides; original activities and source observations remain unchanged. Transfer links do not change income, spending or cash totals.

**Implemented, synthetic-only:** [Posting-status corrections](POSTING_STATUS_CORRECTIONS.md) add an explicit Posted/Pending/Unknown editor with posting-date and rationale validation. They preserve source evidence, use append-only history and require the existing explicit save. Unclassified activities still need classification; confirming posting does not prove complete coverage. Use the updated app after saving these events because older builds refuse them.

The current `DashboardSyntheticStorage`, full-snapshot application/store, canonical financial-event and reporting engines enforce ownership, exact-base checks, durable writes, integrity, append-only history, recovery and financial meaning. There is no automatic migration, automatic save or complete-history assertion. The selected [full-snapshot v1 format](FULL_SNAPSHOT_STORAGE.md) supports fresh synthetic copies; older per-record, grouped, fragmented and partitioned copies are unsupported and are not converted, overwritten or deleted.

## Financial-position follow-up

The separately authorized [financial-position milestone](FINANCIAL_POSITION.md) adds a **Try balances & reconciliation** local scenario, an independent position-as-of date, per-currency known position totals, source/conflict evidence, manual account/balance staging, dated holdings and conflict selection, cash/card and statement-component reconciliation, and explicit zero-balance closure. The position date is independent of the activity month. Balance/closure changes share the same explicit save, uncertainty, reopen, staged undo and revert behavior as activity corrections. The original invented-year recipe and its activity semantics remain unchanged.

The earlier scope and acceptance record below describe the canonical activity milestone. The new position contract supersedes its balance-availability limitation only where dated position evidence exists; old activity-only ledgers still have no invented balances. Provider balance/holdings file importers are outside this milestone. Live synthetic acceptance and physical-device validation remain outstanding.

## Ordinary flow

1. Open the main page, select **Storage**, then choose **Open saved synthetic year**. Select the existing folder used by the synthetic-year tool, with `synthetic` in its name. Do not select a production folder or any folder containing personal financial data. This action never initializes a new empty copy.
2. Open **Activity** and select an account and month. These shared controls scope both rows and reports. Search and **Needs review only** filter displayed rows, not totals. Rows are paginated, 25 at a time.
3. Choose **Review** beside an activity. The detail page shows its current values, source observations and audit history. Raw evidence is available on demand.
4. Choose a correction, enter a reason, and press **Stage correction**. For an outgoing activity already classified as a transfer, the detail panel may show exact-amount incoming candidates in other accounts. Select the matching activity and record why the pair is the same transfer. No pair is linked automatically; the canonical event validates opposite signs, exact same-currency amounts, distinct accounts, transfer classifications and one-to-one linkage. The change remains local. The source activity and source fields remain unchanged; the canonical engine appends an event. A category correction also records the existing engine's prospective rule for later matching imports in that account and currency. Other existing matching purchases are not recategorized. Linked refunds follow their purchase category unless separately categorized.
5. Press **Save changes** once. The page blocks repeated operations and shows elapsed time until the store completes its verified read-back. It does not equate a write response with a verified save.
6. In **Storage**, **Reopen saved** independently loads the selected copy again. Unsaved changes require confirmation and are discarded only after a successful verified load.
7. In **Storage**, **Release session** verifies release and clears the workspace's authorization token. Loaded records and any draft remain read-only in this synthetic tab. Close the tab to clear them. Reconnecting reopens the saved copy rather than silently reapplying a draft.

If the owner has not seeded a copy, **More → Sample data → Load an invented year** demonstrates the same canonical records and correction controls without connecting to Google. **Save this preview to a new folder** then requires a newly created, owner-confirmed empty folder with `synthetic` in its name. The workspace checks the fresh genesis manifest, writes the exact in-memory ledger through the canonical store using the full-snapshot layout, and independently reopens and compares the complete graph. It never modifies an existing copy. If a write outcome is uncertain, the draft remains in memory and blind retry is blocked; recover if offered and reopen to establish what reached Drive. Create new synthetic year provides deterministic pristine seeding.

## Meaning and limits

- Income, spending and cash movement come from the canonical report engine, with exact decimal display. They are labelled known partial totals. Missing eligible data is **Unavailable**, not an invented zero.
- The invented year's known annual income is **$73,739.50** and known spending **$30,381.00**. Transfers and card payments are not counted as income or spending. Refunds use their posting period.
- The 48 investment activities remain unclassified with unknown lifecycle. Their source evidence remains visible; they do not become supported investment records merely because the UI displays them. Changing a classification does not invent posting/lifecycle evidence.
- Cash movement is the engine's checking/savings subtotal excluding transfers. It is not a balance, total bank movement, net worth or financial-position report.
- Declared coverage, import dates and row counts do not prove complete history. Reports remain incomplete. Balance/snapshot records, reconciliation completeness, holdings, valuations, monthly-history migration from January 2023 and production authorization belong to later work.
- This main flow does not ingest user files. The old import workbench was retired; retained parsers and financial import semantics are not an available full-snapshot file-ingestion workflow. The main page preserves unresolved source observations; full-snapshot file ingestion remains outstanding.
- The old raw-CSV/sample page remains a clearly separate [local preview diagnostic](../prototype/local-preview.html), with its existing regression tests. It is no longer the main financial workspace or a source for canonical totals.
- Browsing, filtering and staging do not call Drive. Open, save, reopen, recovery and release retain existing verification and history costs. Elapsed time is feedback, not a performance guarantee. Whole-graph validation/reconstruction and large-device memory limits remain.
- Original-file-retention maintenance is disabled for this workspace. It neither uploads originals nor deletes retained originals. Existing source-row evidence and durable history are preserved.

## Failure and interruption behavior

A failed or uncertain save keeps the local proposal but blocks saving it again. The owner must recover if offered, then reopen verified records to determine what reached storage. Recovery does not automatically replace or retry the draft. A failed reopen leaves the prior view and draft visible but removes write eligibility. Offline, ownership uncertainty and lifecycle transitions invalidate editing until a verified reopen. An unverified release never announces a successful handoff.

The page requests an unload warning during work or while a draft is unsaved. Mobile browsers do not guarantee that warning. Keep the tab open until verification completes and release the session before moving to another device or tool.

## Behavior of the loaded view

**Implemented, synthetic-only.** The workspace keeps one private defensive snapshot reader for the loaded ledger.

- Reports, sorted rows and searchable text are reused only while the account and month stay the same. Search, the review-only filter and pagination do not recalculate reports. Switching account or month replaces the single cached scope. Opening, correcting, saving or a verified reopen replaces the reader.
- Search waits 120 ms after typing stops and respects text composition. Scope changes and completed corrections render immediately. The delay coalesces typing; it is not a performance threshold.
- Initial graph validation, snapshot creation and the account/month report still scale with loaded history. The cache is in memory only, not a persistence format or a multi-period cache.
- The source review count covers every unresolved observation in the selected account and period, and the page labels its ten-item list as a preview. Search does not filter the source queue. Observations with an unknown date stay visible in every month. Resolved observations disappear after a verified reopen. A view never creates financial activities.
- Cancelling an operation reports cancellation. Recovery controls are disabled offline, review controls expose a busy state, and provider error text is never echoed. Closing transaction detail returns keyboard focus to its Review button, or to search if the row is gone. Page and filter status messages are atomic live announcements.

## Acceptance

Accepted behavior is recorded in [Current state](CURRENT_STATE.md) and the [archived owner acceptance checklist](archive/OWNER_ACCEPTANCE_2026-11-24.md). The owner accepted the local synthetic-year exploration, evidence and correction workflow, and mobile workspace experience on the PR32 head. Do not repeat those checks unless a later change affects them. A merge or green CI does not establish live Google latency, physical Safari behavior or deployment; record the exact SHA, device and capability with each result.

Use invented data for these workspace checks:

1. Local preview before authorization shows all four accounts and twelve months. Known annual totals match the recipe in [Synthetic data](SYNTHETIC_DATA.md). Nothing opens Google or writes Drive.
2. The investment account keeps activities and evidence visible, but known reports show *unavailable*, not complete investment totals.
3. Search does not change totals. Changing account or month does. Check narrow portrait, tablet portrait and landscape, and browser Back and Forward.
4. Correct a category and an amount with a reason. The original source stays unchanged and audit evidence is added. Save once, reopen and compare. A repeated click while saving does nothing extra.
5. Cancel authorization, Picker, draft replacement, and release with an unsaved draft. None may show false success, lose work or save unintentionally.
6. Go offline and reconnect. Records stay readable. Edits and saves stay blocked until a verified reopen, and local proposals are not silently retried.
7. Interrupt a save on a disposable copy. The save stays unverified until recovery and reopen. Preserve the uncertain folder; do not delete it or retry blindly.
8. Release successfully, then open on the next device and confirm the exact saved corrections. An unverified release must not report success.
9. From a local preview, save the untouched generated year to a new empty synthetic folder, reopen it and compare the full canonical graph. Repeat after staging corrections and confirm each correction and audit event is present.
10. Link a clearly matching outgoing and incoming transfer pair. The same path and rationale appear from either side, the link survives save and reopen, and income, spending and cash totals do not change. Ambiguous equal-amount candidates are never auto-linked.
11. Stage two corrections. Undo removes only the latest. Revert returns the exact verified baseline, or the original generated year in a local preview. Neither action touches Drive.
