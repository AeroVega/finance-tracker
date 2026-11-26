# Historical monthly summaries

This contract describes the Alpha normalized-history workflow. It does not describe an Excel importer, a completed private-workbook migration, or production authorization.

## Purpose and product boundary

The product definition requires a one-time migration of month-by-month workbook history beginning in 2023. The intended normalized history includes a monthly net-worth snapshot, total income and available income-source breakdown, and total expenses and available primary expense-category breakdown. The source workbook must remain unchanged, with workbook/worksheet and mapping provenance retained. Do not turn monthly aggregates into transaction/activity records.

The Storage workspace accepts explicitly normalized JSON. It does not inspect Excel files, parse formulas, infer workbook structure, or map labels. The owner's actual migration uses [in-app manual entry](#in-app-history-migration) instead of a converter. Use the [invented JSON fixture](../fixtures/historical-monthly-summary.synthetic.json) as the output-contract example.

## Normalized input

The app accepts a plain JSON object containing `format: "finance-tracker-historical-monthly-summaries"`, `version: 1`, `expectedMonthRange`, and `records`. The format/version markers may be omitted for inputs from the earlier normalized validator; an explicitly unsupported value is rejected. The UI accepts files up to 1 MiB; a batch can cover at most 600 months and contain up to 600 records. For programmatic, read-only validation use `validateHistoricalMonthlySummaries` from `scripts/historical-monthly-summary.mjs` or the browser-compatible validator. For app eligibility and conflicts against saved data use `previewHistoricalMonthlySummaries`.

```js
const result = validateHistoricalMonthlySummaries({
  expectedMonthRange: { start: '2023-01', end: '2026-12' },
  records: [{
    month: '2023-01',
    summary: {
      incomeTotal: { amount: '1000.00', currency: 'USD' },
      expenseTotal: { amount: '600.00', currency: 'USD' },
      // Optional; supplied source value only. Never derived here.
      netCashFlow: { amount: '400.00', currency: 'USD' },
      // Separate point-in-time snapshot, not cash flow.
      netWorthSnapshot: { amount: '25000.00', currency: 'USD' }
    },
    breakdowns: {
      incomeSources: {
        complete: false,
        items: [{ label: 'Invented wages', amount: { amount: '1000.00', currency: 'USD' } }]
      },
      expenseCategories: {
        complete: true,
        items: [{ label: 'Invented living', amount: { amount: '600.00', currency: 'USD' } }]
      }
    },
    provenance: {
      workbook: 'invented-history.xlsx',
      worksheet: 'Monthly Summary',
      mapping: 'mapping-v1'
    }
  }]
});
```

The expected month range is mandatory and inclusive. Month labels must be real `YYYY-MM` calendar months. Monetary values use exact decimal strings plus an explicit three-letter uppercase currency code; no binary floating point, exponent notation, rounding, or implicit currency conversion is used. Decimal precision is limited to 18 fractional digits and 30 integer digits for this foundation.

Required summary values are `incomeTotal`, `expenseTotal`, and `netWorthSnapshot`. `netCashFlow` is optional and is never inferred; omitting it or supplying `null` both mean that no cash-flow value was supplied. A missing/null required value is a review finding; a zero amount is a valid supplied value. A present malformed non-null amount is preserved and reported.

Breakdowns are optional. Each supplied breakdown declares `complete: true|false` and an `items` array of labeled money values. Only a declared-complete breakdown is compared with its corresponding monthly total. Partial breakdowns remain preserved and are not expected to sum to the total. A complete breakdown without a usable total, malformed items, or mismatched currency is reported rather than repaired.

Each record may declare `scope` as `{"kind":"aggregate"}`, `{"kind":"unknown"}`, or `{"kind":"accounts","accountIds":[...]}`. Omission means unknown. Use account scope only when the workbook actually makes that association and the account identifiers are explicitly mapped to the destination ledger. Do not invent account detail; aggregates and unknown scope cannot be reconciled as account-scoped detail. The minimum provenance is workbook, worksheet and mapping. Supplied optional `sourceId`, `converterVersion`, `cell`, `range`, `cells`, `ranges` and `snapshotAsOf` are preserved. Cell/range maps use summary or breakdown field names. The snapshot date is an optional calendar date, never inferred from the month.

## Findings and preservation

The result is read-only and includes the original records (deep-cloned), expected range, coverage, and inspectable findings. Findings include invalid months, out-of-range months, missing summary values, malformed values/provenance, exact duplicate summaries, conflicting same-month overlaps, missing expected months, and inconsistent complete breakdown totals. Nothing is filled, interpolated, normalized, dropped, or persisted. An empty record list is valid input but reports every expected month as missing.

Duplicate classification compares summary and breakdown content, not provenance. Identical monthly financial content with differing provenance is reported as a duplicate; differing content for the same month is reported as overlapping summaries. All records remain in the result for review.

Net-worth snapshots are preserved as their own point-in-time measure. Their change is not cash flow. The module does not derive cash flow, infer transaction coverage, or claim transaction completeness from monthly summary presence.

## Manual monthly input

A file using the same format marker and explicit input version 2 is reserved for normalized manual input. Each record must specify the exact mapping marker `manual-monthly-entry-v1` and a stable, nonempty provenance `sourceId`. January 2023 requires the actual closing net-worth snapshot; later manual months must omit it or set it to null. Income and expenses remain required. This does not alter v1 or unmarked workbook-file requirements.

Manual reviews persist as historical batch v2 inside the existing logical ledger. Older builds that only understand historical batch v1 reject those ledgers and backups. The physical storage format and backup envelope do not change. The Historical months view may show a separate exact-decimal estimate, not an actual snapshot: January's closing anchor plus each subsequent accepted month's manual income minus expenses. The estimate stops at the first gap or source/currency change. It never substitutes transaction totals or accounts for market-value changes.

## In-app history migration

**Owner direction (2026-11-25).** The owner migrates the first-generation workbook into the private database by typing it in, inside the app. There is no converter, no workbook parsing, and no intermediate JSON file. The page is temporary: once every month is saved it is retired in a later PR. The earlier localhost wizard (`tools/manual-history/`, PR 58) is removed.

What the owner confirmed, which this page relies on:

- **Scope.** Each month from January 2023 through the last migrated month has income and expense totals with top-level category breakdowns. The history is complete: no blank, partial or estimated months. Transfers and the Fidelity investment account are out of scope.
- **Categories.** Top-level categories never changed, so they are defined once for the whole migration. **Subcategories are not migrated.** The owner adds each subcategory's amount into its category. This needs no format change: a breakdown item is just a labelled amount.
- **Net worth.** The workbook's net worth is a formula: the previous month plus income minus expenses. Its figure for a month is the balance at midnight on the 1st. Only one value is stored: January 2023's closing balance, computed as the workbook's opening figure (January 1, 2023) plus January income minus expenses. That is the workbook's own formula. `provenance.snapshotAsOf` is `2023-01-31` and `provenance.cells.netWorthSnapshot` records the opening amount and the derivation. Every later month uses the existing cash-flow estimate. No workbook estimate is stored as an observed snapshot.
- **Overlap.** Imported CSVs should replace a migrated month. Every migrated record has `scope: {kind:"accounts"}` with the accounts the owner selects, so the existing overlap policy applies unchanged: a month switches to transaction detail only after a complete reconciliation is recorded for it (More → Historical monthly summaries).

**Flow** (`#migration`, [history-migration-page.mjs](../js/history-migration-page.mjs), model in [history-migration.mjs](../js/history-migration.mjs)):

1. **About the old workbook** is filled in once: workbook name, currency, last month, opening net worth, the accounts the workbook tracked, and the income and expense categories. After the first save, all of it is recovered from the saved records, so a new session resumes without retyping.
2. **One year at a time.** The year grid has one row per month and one column per category, with live totals. Every cell must hold an amount; 0 is a valid amount and a blank cell blocks the year. Amounts accept `$` and thousands separators and keep exact cents.
3. **Net-worth check.** An optional column takes the workbook's figure for the start of each month. The page compares it with the app's closing estimate for the previous month: for January 2023, the opening figure itself. A match confirms that every total up to that month was typed as the workbook has it. These figures stay in the tab and are never stored.
4. **One confirmation per year.** A checkbox and a single note replace per-month Accept/Exclude decisions. Staging submits the year as one v2 batch, accepting every month with that note, through `stageHistoricalSummaries`. It then waits for the workspace's explicit **Save changes**. Re-staging an unchanged saved year is a no-op. Editing a saved year appends a replacement batch and keeps the earlier one.
5. **Progress map.** Every month from January 2023 shows as saved, staged but not saved, typed but not staged, or not entered, plus whether its net-worth check matched. Home's Needs attention list links to the page until every month is saved.

Typed cells that are not staged exist only in this tab. Leaving or releasing the session warns first, like other unsaved work.

**Private database.** History staging used to be refused outside the synthetic class. It now follows the session's data class like any other edit. Staging keeps the private ledger header (`version: 3`, `dataClass: "production"`), which already admits the history collections; only synthetic ledgers move from v1 to the history version.

## Review, save, and portability

Preview never writes storage. The app shows all input rows, gaps and findings. Malformed and out-of-range rows are visible but not admitted. For each eligible row select **Accept** or **Exclude** and give a reason. Only one record per month may be accepted in each batch. Accepting a different record for a previously accepted month replaces the effective workbook summary without erasing the old record. Accepted and valid excluded rows and their reasons remain inspectable. An exact replay with the same range, decisions and current accepted records is a no-op. Malformed source inputs are not copied into the ledger; keep the local input file if the rejection must be revisited.

**Stage reviewed summaries** creates only an in-memory change and preserves earlier staged edits. **Save changes** is separate and uses the verified snapshot protocol. Prior to saving, ordinary Undo/Revert can discard staged changes; after saving, later choices append evidence rather than rewriting it. Release clears in-memory history with the rest of the workspace after storage release succeeds. Outstanding save/restore verification follows the existing recovery rules.

The first accepted batch extends the *logical* canonical ledger from version 1 to version 2. Older ledgers and backups with no history are still v1 and remain readable; they are not rewritten merely by opening or saving without history. The v2 ledger contains append-only `historicalSummaryBatches` and `historicalReconciliations`, with separately versioned record schemas. Unsupported ledger versions fail closed; an older app without this change will not open a newly saved v2 ledger. The full-snapshot v1 physical protocol and the portable backup envelopes are unchanged. Their normal hash/readback paths cover the entire logical ledger including historical records and their decision evidence. Plain and encrypted backups preserve the history. A restored copy starts a new physical lineage as before.

## Overlap policy

The Historical months view chooses one effective source for income and expenses. It keeps and labels the workbook summary unless the user confirms complete reconciliation with written reason and evidence for the same month, currency, and explicit account set. Each account needs a processed, full-calendar-month import; overlapping partial imports are not combined to establish coverage in Alpha. Declared coverage, transaction existence, and equal totals are each insufficient. Pending activity, unclassified or ineligible activity, and unresolved review observations prevent the override. Unknown or aggregate workbook scope, incompatible currency, and absent or mismatched accounts retain workbook coverage.

The saved review binds to the selected workbook record, calendar range, account set, currency, covering runs, and the SHA-256 of the canonical transaction evidence. Any change to transaction accounts, imports, source observations, activities, events, or decisions invalidates the prior confirmation conservatively, even if a different month changed. The app falls back to the workbook summary and keeps the original reconciliation evidence. This is a recorded user attestation backed by local checks, not independent proof about unprovided source statements. The app does not sum workbook and transaction totals. Existing transaction-only reports continue to show transaction-only figures, not a combined dashboard. An override changes income/expenses only; the workbook net-worth snapshot and provenance remain separate and available.

## Workbook decisions still open

**Superseded for the owner's migration (2026-11-25).** The owner types the figures in instead of using a converter, and answered the questions that matter for that: see [In-app history migration](#in-app-history-migration). The list below is kept for any future converter. A converter design would still need to establish, from the workbook and owner review:

- Actual workbook/worksheet names, used ranges, formulas, hidden rows/columns, merged cells, date/month encoding, and whether displayed values differ from formulas or cached results.
- Which rows represent months, whether months are contiguous, and how blanks, duplicate month labels, subtotals, annual totals, and formula errors are represented.
- Exact labels and semantics for income sources, expense categories, any subcategories, refunds, transfers, reimbursements, and other adjustments. Examples in the product definition are illustrative, not an approved mapping.
- Which totals and breakdowns are present for each month, whether each breakdown is complete or partial, and whether the source itself contains formulas that reconcile.
- Currency, sign conventions, decimal precision, rounding, negative values, and whether values are formulas, typed numbers, or text.
- Whether net worth is month-end or another as-of date, its components, and whether liabilities/assets are represented consistently.
- How to represent months with missing totals, zero totals, missing worksheets, formula errors, or partially populated rows without silently filling them.
- How provenance will identify workbook version/hash, worksheet, cell/range, converter version, mapping version, and any human-reviewed mapping decisions without publishing private workbook content.

**Expense subcategories are not migrated** (owner decision, 2026-11-25): they changed over time and are beyond the history the migration is meant to capture. Do not infer per-account monthly summaries: product decisions explicitly preserve the workbook's actual granularity.

## Verification and limitations

Focused synthetic tests use invented values only. Run:

```sh
node --test tests/historical-monthly-summary.test.mjs tests/historical-workspace-persistence.test.mjs tests/history-migration.test.mjs
FINANCE_EXTENDED_STORAGE_TESTS=1 node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

Synthetic acceptance walkthrough: open or create an invented ledger. From Storage, select the invented JSON fixture and preview it. Check January and March, the February gap, zero versus missing, exact totals and provenance. Accept the valid rows with reasons, stage, explicitly save, release and reopen. Return to Storage and check that the two months and decisions persisted. Export a plain or encrypted backup locally and restore it to a different empty synthetic folder, then verify the same history after an independent reopen. The example intentionally has aggregate scope; the workbook amounts must remain the source even if same-month transaction detail exists. Do not use a real workbook or production financial data for acceptance.

Workbook conversion, private-workbook mapping, broader Alpha acceptance, and production authorization remain separate.
