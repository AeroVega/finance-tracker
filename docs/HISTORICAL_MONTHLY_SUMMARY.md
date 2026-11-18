# Historical monthly-summary validation

**Status:** Read-only validation foundation; not a migration, persistence, or UI implementation.

## Purpose and product boundary

The product definition requires a one-time migration of month-by-month workbook history beginning in 2023. The intended normalized history includes a monthly net-worth snapshot, total income and available income-source breakdown, and total expenses and available primary expense-category breakdown. The source workbook must remain unchanged, with workbook/worksheet and mapping provenance retained. Do not turn monthly aggregates into transaction/activity records.

This module accepts only explicitly normalized synthetic records. It does not inspect Excel files, parse formulas, infer workbook structure, map labels, create canonical ledger entries, write storage, or make import decisions. The future one-time converter is a purpose-built Python script after the actual workbook has been inspected.

## API

Import `validateHistoricalMonthlySummaries` from `scripts/historical-monthly-summary.mjs`.

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

Required summary values are `incomeTotal`, `expenseTotal`, and `netWorthSnapshot`. `netCashFlow` is optional and is never inferred. A missing/null required value is a review finding; a zero amount is a valid supplied value. A present malformed amount is preserved and reported.

Breakdowns are optional. Each supplied breakdown declares `complete: true|false` and an `items` array of labeled money values. Only a declared-complete breakdown is compared with its corresponding monthly total. Partial breakdowns remain preserved and are not expected to sum to the total. A complete breakdown without a usable total, malformed items, or mismatched currency is reported rather than repaired.

## Findings and preservation

The result is read-only and includes the original records (deep-cloned), expected range, coverage, and inspectable findings. Findings include invalid months, out-of-range months, missing summary values, malformed values/provenance, exact duplicate summaries, conflicting same-month overlaps, missing expected months, and inconsistent complete breakdown totals. Nothing is filled, interpolated, normalized, dropped, or persisted. An empty record list is valid input but reports every expected month as missing.

Duplicate classification compares summary and breakdown content, not provenance. Identical monthly financial content with differing provenance is reported as a duplicate; differing content for the same month is reported as overlapping summaries. All records remain in the result for review.

Net-worth snapshots are preserved as their own point-in-time measure. Their change is not cash flow. The module does not derive cash flow, infer transaction coverage, or claim transaction completeness from monthly summary presence.

## Overlap policy (documented, not implemented)

When workbook summaries overlap transaction detail, transaction detail may replace a workbook summary for a month only after that month has been reconciled complete under the future reconciliation contract. Until then, retain and label the workbook summary. Never add both sources for the same economic activity. This validator does not inspect canonical transactions or decide replacement.

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
node --test tests/historical-monthly-summary.test.mjs
node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

This is a validation foundation only. It does not complete historical migration, Alpha, workbook conversion, canonical persistence, UI, report integration, transaction reconciliation, or owner acceptance.
