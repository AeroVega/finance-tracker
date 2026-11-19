# Historical monthly summaries

This contract describes the Alpha normalized-history workflow. It does not describe an Excel importer, a completed private-workbook migration, or production authorization.

## Purpose and product boundary

The product definition requires a one-time migration of month-by-month workbook history beginning in 2023. The intended normalized history includes a monthly net-worth snapshot, total income and available income-source breakdown, and total expenses and available primary expense-category breakdown. The source workbook must remain unchanged, with workbook/worksheet and mapping provenance retained. Do not turn monthly aggregates into transaction/activity records.

The Storage workspace accepts explicitly normalized synthetic JSON. It does not inspect Excel files, parse formulas, infer workbook structure, or map labels. The future one-time converter remains a separate purpose-built tool. Use the [invented JSON fixture](../fixtures/historical-monthly-summary.synthetic.json) as its output-contract example.

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

## Review, save, and portability

Preview never writes storage. The app shows all input rows, gaps and findings. Malformed and out-of-range rows are visible but not admitted. For each eligible row select **Accept** or **Exclude** and give a reason. Only one record per month may be accepted in each batch. Accepting a different record for a previously accepted month replaces the effective workbook summary without erasing the old record. Accepted and valid excluded rows and their reasons remain inspectable. An exact replay with the same range, decisions and current accepted records is a no-op. Malformed source inputs are not copied into the ledger; keep the local input file if the rejection must be revisited.

**Stage reviewed summaries** creates only an in-memory change and preserves earlier staged edits. **Save changes** is separate and uses the verified snapshot protocol. Prior to saving, ordinary Undo/Revert can discard staged changes; after saving, later choices append evidence rather than rewriting it. Release clears in-memory history with the rest of the workspace after storage release succeeds. Outstanding save/restore verification follows the existing recovery rules.

The first accepted batch extends the *logical* canonical ledger from version 1 to version 2. Older ledgers and backups with no history are still v1 and remain readable; they are not rewritten merely by opening or saving without history. The v2 ledger contains append-only `historicalSummaryBatches` and `historicalReconciliations`, with separate v1 record schemas. Unsupported ledger versions fail closed; an older app without this change will not open a newly saved v2 ledger. The full-snapshot v1 physical protocol and the portable backup envelopes are unchanged. Their normal hash/readback paths cover the entire logical ledger including historical records and their decision evidence. Plain and encrypted backups preserve the history. A restored copy starts a new physical lineage as before.

## Overlap policy

The Historical months view chooses one effective source for income and expenses. It keeps and labels the workbook summary unless the user confirms complete reconciliation with written reason and evidence for the same month, currency, and explicit account set. Each account needs a processed, full-calendar-month import; overlapping partial imports are not combined to establish coverage in Alpha. Declared coverage, transaction existence, and equal totals are each insufficient. Pending activity, unclassified or ineligible activity, and unresolved review observations prevent the override. Unknown or aggregate workbook scope, incompatible currency, and absent or mismatched accounts retain workbook coverage.

The saved review binds to the selected workbook record, calendar range, account set, currency, covering runs, and the SHA-256 of the canonical transaction evidence. Any change to transaction accounts, imports, source observations, activities, events, or decisions invalidates the prior confirmation conservatively, even if a different month changed. The app falls back to the workbook summary and keeps the original reconciliation evidence. This is a recorded user attestation backed by local checks, not independent proof about unprovided source statements. The app does not sum workbook and transaction totals. Existing transaction-only reports continue to show transaction-only figures, not a combined dashboard. An override changes income/expenses only; the workbook net-worth snapshot and provenance remain separate and available.

## Workbook decisions still open

The actual workbook has not been inspected. A future converter/reconciliation design must establish, from the workbook and owner review:

- Actual workbook/worksheet names, used ranges, formulas, hidden rows/columns, merged cells, date/month encoding, and whether displayed values differ from formulas or cached results.
- Which rows represent months, whether months are contiguous, and how blanks, duplicate month labels, subtotals, annual totals, and formula errors are represented.
- Exact labels and semantics for income sources, expense categories, any subcategories, refunds, transfers, reimbursements, and other adjustments. Examples in the product definition are illustrative, not an approved mapping.
- Which totals and breakdowns are present for each month, whether each breakdown is complete or partial, and whether the source itself contains formulas that reconcile.
- Currency, sign conventions, decimal precision, rounding, negative values, and whether values are formulas, typed numbers, or text.
- Whether net worth is month-end or another as-of date, its components, and whether liabilities/assets are represented consistently.
- How to represent months with missing totals, zero totals, missing worksheets, formula errors, or partially populated rows without silently filling them.
- How provenance will identify workbook version/hash, worksheet, cell/range, converter version, mapping version, and any human-reviewed mapping decisions without publishing private workbook content.

Expense subcategory migration remains undecided until workbook inspection. Do not infer per-account monthly summaries: product decisions explicitly preserve the workbook's actual granularity.

## Verification and limitations

Focused synthetic tests use invented values only. Run:

```sh
node --test tests/historical-monthly-summary.test.mjs tests/historical-workspace-persistence.test.mjs
FINANCE_EXTENDED_STORAGE_TESTS=1 node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

Synthetic acceptance walkthrough: open or create an invented ledger. From Storage, select the invented JSON fixture and preview it. Check January and March, the February gap, zero versus missing, exact totals and provenance. Accept the valid rows with reasons, stage, explicitly save, release and reopen. Return to Storage and check that the two months and decisions persisted. Export a plain or encrypted backup locally and restore it to a different empty synthetic folder, then verify the same history after an independent reopen. The example intentionally has aggregate scope; the workbook amounts must remain the source even if same-month transaction detail exists. Do not use a real workbook or production financial data for acceptance.

Workbook conversion, private-workbook mapping, broader Alpha acceptance, and production authorization remain separate.
