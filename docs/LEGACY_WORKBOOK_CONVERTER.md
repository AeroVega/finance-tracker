# Legacy workbook converter

This offline tool prepares the normalized JSON accepted by the Finance Tracker Storage history review. It does not open Excel inside the app, submit decisions, contact Drive, use real data in the repository, or migrate an existing ledger. The actual legacy workbook has not been inspected or mapped. The included mapping describes invented data only.

## Verify with invented data

From the repository root, on a local machine with Python 3 and Node.js 22 or newer:

```sh
work="$(mktemp -d)"
python3 fixtures/legacy-workbook-invented.py "$work/invented-legacy.xlsx"
python3 scripts/legacy-workbook-converter.py "$work/invented-legacy.xlsx" \
  --mapping fixtures/legacy-workbook-mapping.synthetic.json \
  --output "$work/invented-normalized.json"
node --test tests/legacy-workbook-converter.test.mjs
```

Omit `--output` for a dry run. Standard output contains a single structured JSON report, not the financial records. Exit status 0 means the output passed the actual app's review admission checks, not that it was accepted by a user. Exit status 2 means conversion or output creation was blocked. On success, use the invented output in **Storage → Historical monthly summaries** and inspect the months, their evidence, and the February gap before staging any decisions.

## Understand the mapping

Start with the [invented mapping](../fixtures/legacy-workbook-mapping.synthetic.json) and the [normalized history contract](HISTORICAL_MONTHLY_SUMMARY.md). The tool recognizes only standard transitional XML workbooks with the explicitly named worksheet and bounded row band. It accepts shared strings and inline strings as literal text; producers that use the formula-result string type without a formula need a separate reviewed copy with standard literal cells. It requires an exact literal header for every mapped column. In mapping v1:

- Set `rows.header`, `rows.first`, and `rows.last` explicitly, excluding subtotals, notes and non-data rows. One row represents one month. Map `month` to saved literal text `YYYY-MM`, not an Excel date serial or a formatted display.
- Supply the first and last expected months even when the range has gaps. Blank mapped rows are skipped; a row with other mapped content but no usable month blocks output. Duplicate months block output so the owner can resolve them.
- Map income, expense, and net-worth snapshot columns and their literal currencies. Map cash flow or an ISO calendar-date snapshot field only if supplied by the workbook. Each amount is an exact saved numeric XML token or a literal normalized decimal string. The converter does not apply display rounding, guess sign conventions, convert currencies, or derive cash flow or net worth.
- Map optional income-source and expense-category groups by explicit columns, labels and currencies. Declare a group complete only if it covers its total. Missing complete-group values block output; missing partial-group values are reported and omitted, not converted to zero. A saved zero is retained. The actual app validates complete-group arithmetic.
- Supply an owner-reviewed workbook label, source identifier, and mapping version under `source`. Optionally bind the mapping to the exact input SHA-256 with `source.workbookSha256`; a mismatch blocks output. Scope can be aggregate or unknown. The converter does not invent account associations.
- Every row carries the supplied workbook label, source identity and mapping version, the converter version, worksheet, month cell, bounding row range, mapped summary cells and bounding breakdown ranges. A supplied snapshot date remains separate from the period. Verify that the mapping actually describes the intended records and labels; successful validation cannot prove the workbook's accounting semantics.

## Owner-local preparation and limits

Before considering a private workbook, locally inspect its headings, layout, month encoding, formulas, hidden and merged cells, date meanings, and amounts. Prepare and review a private mapping separately; do not commit, upload or share a real workbook, mapping, normalized output, or conversion report. The local report may contain the workbook fingerprint, dates and cell references. Treat it as private even though it omits amounts and local paths.

The first converter version does not accept formulas or cached formula results in mapped cells, Excel-calculated cells, ambiguous headers, hidden selected rows or columns, selected merged ranges, protected/unsupported archives, or non-`.xlsx` formats. It ignores unmapped amounts and formulas unless a formula range covers mapped cells. Mapped cells with attached value/cell metadata are not admitted. If mapped source cells contain formulas, independently verify their saved values and meaning in Excel, then prepare a **separate local values-only copy** with the reviewed literals and provenance/mapping notes. Never overwrite the original or assume values visible in a stale cache are correct. Do not use real financial output with the application until separately authorized.

The tool uses Python's standard library, does not extract archive files, and calls the repository's actual JavaScript admission checks locally before writing JSON. Limits are 16 MiB for the input archive, 8 MiB per parsed XML part, 600 mapped rows or expected months, and 1 MiB for the mapping or normalized JSON output. The report lists up to 200 findings with cell or range references when available, and reports any omitted count without ignoring blocked records. Output is explicitly requested, created as a new file only, and never replaces an existing file. Existing production, release, acceptance, and migration boundaries are unchanged.
