# Next steps to Alpha

**Updated:** November 14, 2026. See [project status](PROJECT_STATUS.md) for the verified source and merged PRs. Deployment work is deferred until closer to Alpha. This is the active work queue; [the earlier handoff](archive/NEXT_STEPS_2026-11-08.md) is historical.

Alpha must let the owner import and review financial history, correct it, reconcile financial position and recover the saved data. It does not require Beta's charts, budgets, insights or projection interface. Production persistence remains **NO-GO** until the separate controls and authorization gate pass.

## Immediate next actions

1. **Make open/save practical without weakening verification.** Target under 30 seconds per operation for Alpha and under 10 seconds later. Follow the [performance evidence](OPEN_SAVE_PERFORMANCE.md), keeping predicted gains separate from live acceptance. Complete combined focused checks, the benchmark and final exact-source extended gate for the [existing app/store path](PARTITIONED_CANONICAL_STORAGE.md), including recovery, v5 backup/restore and safe refusal of older canonical copies. Record results in [project status](PROJECT_STATUS.md); do not infer speed or memory improvements from the new format. Bounded semantic/history auditing, selective app loading and incremental validation remain later work. Preserve full financial, history and physical verification. Schema evolution does not authorize silent migration or weaker checks.
2. **Build the remaining production controls with invented data.** Implement designated account/database binding, full working-state cleanup and a production-capable path, then validate its privacy, authorization and recovery boundaries. Preserve NO-GO until the non-test gates and explicit owner activation decision pass.
3. **Prepare monthly migration from the synthetic workbook.** The owner is preparing an invented 2023–2026 workbook. Use it to define monthly-summary mapping and exact reconciliation without accessing the private workbook or turning monthly totals into fabricated transactions.
4. **Carry forward scoped acceptance evidence.** PR36 is merged and its description reports completed owner synthetic/device acceptance. Preserve that evidence rather than repeating unchanged checks. Historical acceptance gaps below should be checked against the exact paths and source accepted by the owner.
5. **Revisit deployment near Alpha.** The checklist now targets v5; verify its changed paths on the intended source. Inspect Pages configuration and verify the served SHA when release work resumes. No deployment, settings change or real-data use is authorized by this queue.

These are dependencies and review actions, not automatic permission to merge, deploy, change Google configuration or use real data.

## Four-step application sequence

The steps name deliverables, not reserved GitHub PR numbers. The first is implemented through PR32 and its merged PR34 follow-up. Split later work into reviewable PRs if necessary without expanding the agreed Alpha scope.

### Step 1: canonical workspace

**Verified implementation:** saved synthetic-year browsing by account/month, qualified canonical reports, source evidence, corrections, staged undo/revert, explicit save/reopen, exact local-preview save to a fresh empty synthetic folder, and manually confirmed reciprocal transfer links.

**Exit evidence still needed:**
- [ ] Current deployment and full source SHA confirmed.
- [ ] Unchanged and corrected local previews save to separate fresh synthetic folders and independently reopen with the exact graph and audit history.
- [ ] Existing/nonempty destinations are refused; cancellation preserves the preview. An uncertain save blocks blind retry and resolves through recovery/reopen.
- [ ] Transfer links survive save/reopen, retain reciprocal evidence and leave financial totals unchanged. Ambiguous candidates are not auto-linked.
- [ ] Changed paths work on physical iPhone/iPad Safari; record device, source and scope. Retain accepted unchanged paths as prior evidence.

Use [the workspace acceptance procedure](CANONICAL_MAIN_WORKSPACE.md#validation-and-owner-acceptance). Step 1 does not supply balances, a migration engine or production authorization.

### Step 2: financial position and reconciled coverage

**Merged in PR36.** The owner approved the financial-position plan on November 10, 2026. The [implementation contract](FINANCIAL_POSITION.md) adds optional append-only position events through the existing canonical model and storage. PR36's description reports completed owner live synthetic and device acceptance. Preserve that bounded evidence; it does not authorize production activation.

The contract covers dated account balances, investment holdings/values and liability balances with source, effective date, currency, freshness and missingness. Account/month reconciliation requires evidence beyond declared coverage. The scoped choices in [O1/O3 and E2/E3](PRODUCT_OPEN_DECISIONS.md) are recorded without reopening settled transfer/refund/pending rules. Remaining broader investment, reporting and debt questions stay open.

**Engineering acceptance criteria** for the scoped implementation. The checklist below predates the PR36 completion report; retain it as the criteria, not as a claim that acceptance must be repeated:
- [ ] Invented checking, savings, credit-card, investment and liability examples produce exact assets minus liabilities. Purchases/card payments and transfer pairs do not double-count.
- [ ] Dated balances are separate from cash movement. Missing/stale values show their limits; unknown values never become zero or a complete net-worth total.
- [ ] Position values retain source and correction provenance across save, independent reopen and portable restore.
- [ ] Account/month coverage distinguishes declared, observed, incomplete and reconciled-complete states. A missing account, unresolved observation or unexplained balance discrepancy prevents a complete claim.
- [ ] Manual liability updates and account closure preserve history. Investment source rows do not become holdings or valuations without the required evidence.
- [ ] Tests cover empty periods, incomplete history, duplicates, pending/posting, refunds, reversals and contradictory balance evidence.

No live prices, investment performance, payoff modelling or forecast engine is added to this step.

### Step 3: monthly history from January 2023

**Open. Depends on step 2's completeness and source-selection contract.**

Build the distinct historical monthly-summary schema and a one-time Python conversion path against invented workbook fixtures first. Preserve monthly net worth, income and available source breakdowns, expenses and available primary-category breakdowns. Keep monthly aggregates out of transaction lists. Do not assume the workbook contains account-level history or expense subcategories.

**Proposed engineering acceptance criteria**, to verify in the migration review:
- [ ] Every converted value traces to workbook/worksheet and represented month, with mapping/version provenance and a reconciliation report.
- [ ] Monthly totals and available breakdown sums match exactly or produce explicit discrepancies. Missing months, formula errors and ambiguous labels are visible; no silent interpolation or correction.
- [ ] Overlapping transaction detail replaces a monthly summary only after that month is reconciled complete at the applicable scope. Reports never sum both sources for the same activity.
- [ ] Monthly records persist, reopen, export and restore without being converted into invented transactions.
- [ ] Repeating the conversion/import cannot silently duplicate or overwrite accepted history.
- [ ] The owner reviews actual conversion output only after the applicable authorization and privacy gates permit private workbook access. Preserve `Finances.xlsx` unchanged and keep it and all converted real values outside GitHub/CI.

The converter can be prepared with synthetic fixtures before step 4. Actual private-history use is gated; this ordering is not permission to handle real data early. See [the migration requirements](PRODUCT_DEFINITION.md#111-one-time-migration-of-first-generation-excel-history).

### Step 4: production authorization, recovery and privacy

**Open. PR27 merged the plan, not this implementation.**

Inventory only record classes needed by the ready Alpha features. Implement the approved production-capable path and validate it with invented data before any activation. Reuse the storage/recovery machinery, but do not treat its older tests as proof of the new path.

Required gates:
- [ ] Supported owner-file import reaches the canonical workflow through strict format recognition, explicit mapping/coverage, review and verified save. No real files are needed in automated tests.
- [ ] Bind the designated Google account/database; reject wrong accounts/folders and handle denied access, expiry, revocation and reauthorization without blind writes.
- [ ] Working records, rendered state and tokens clear on sign-out/normal release after the safe drain/recovery/release sequence. Test unsaved-change consent, cancellation and failed release. Preserve only permitted inventory/recovery metadata.
- [ ] Actual browser storage/cache/network and deployed assets contain no unauthorized financial data or credentials. Document abrupt-close/device-loss limits rather than promising a secure wipe.
- [ ] Live synthetic save/reopen, interruption, recovery, backup, portable export/restore and sequential device handoff pass for the production-capable path. Retain uncertain copies; never infer deletion from an access-ambiguous error.
- [ ] Review the original-file deletion-receipt limitation and validate the 540-day retention/restore rules. Define routine backup cadence, tolerable loss and rotation after production OAuth verification, as already decided.
- [ ] Inspect actual OAuth configuration, API restrictions, quotas/usage/billing and current terms against the $0 recurring-cost constraint. Resolve capacity/provider-failure behavior.
- [ ] Record owner review of the evidence, accepted residual risks and explicit production activation authorization separately from merge/deployment approval.

A separate real-financial-data smoke test is not required. Fully passing synthetic tests supply the test evidence; they do not waive the non-test gates above. [PR27](PR27_PRODUCTION_PERSISTENCE_PROPOSAL.md) and [security](SECURITY.md) remain authoritative.

## Alpha exit review

Do not call Alpha complete merely because step 1 merged. Review one traceable synthetic end-to-end journey across import, corrections, position/coverage, monthly history, explicit save, independent reopen and restored portable backup. Show correct results and preserved provenance, plus the documented error/recovery cases.

Record implemented capability, automated evidence, owner/device evidence, deployed SHA, remaining limitations and production authorization as separate fields. Incorrect totals, data loss or privacy failures block acceptance. Estimates and an Alpha completion date remain open; the January 1, 2027 target is for v1.0.0 and does not waive these gates.

## Verification for each change

Read `AGENTS.md` and the relevant engineering workflow. Use a focused branch; no direct main pushes, force-pushes, merges or deployments without authorization. For application changes, run the repository's serial full suite and the relevant browser/device checks:

```sh
FINANCE_EXTENDED_STORAGE_TESTS=1 node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

For documentation changes, verify relative paths/anchors, current PR facts, source-supported status and `git diff --check`. Never present not-run or blocked checks as passes. Record material results in [project status](PROJECT_STATUS.md); update this queue when the next action changes.
