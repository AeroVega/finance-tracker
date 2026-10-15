# Provider Import Specifications

Status: initial observations from sanitized sample exports. These notes document observed formats; they are not a substitute for testing against original exports.

## Project principles

- File import is the MVP 1 foundation and remains a permanent workflow, even if authorized no-cost direct integrations are added later.
- All import paths feed the same provider-independent canonical transaction ledger and validation/review pipeline.
- Keep recurring operating cost at $0; do not rely on scraping, stored bank passwords, paid/trial-only APIs, or expiring API access.
- Preserve user understanding and control. Keep source data auditable; do not silently discard rows or infer uncertain classifications.
- Sanitized `.numbers` workbooks may be used to share realistic examples when sanitization is needed. Use original `.csv` exports when sanitization is not needed.
- Never modify the archived `Finances.xlsx` during this investigation.

## Shared amount convention

The user has confirmed this convention for the Wells Fargo, SoFi, and Fidelity samples:

- Negative amount: money leaves the account.
- Positive amount: money enters the account.

Use this as the canonical ledger convention. Each new institution's export must be checked before assuming it follows the same rule. If a source uses a different convention, its adapter should convert amounts at the boundary and preserve the original source value for auditability.

## Wells Fargo

Sample workbooks supplied:
- `CreditCard.numbers`
- `Checking.numbers`

Observed shared columns:

| Source column | Initial interpretation | Notes |
| --- | --- | --- |
| `DATE` | Transaction date | Observed format: `MM/DD/YYYY`. |
| `DESCRIPTION` | Bank-provided description | Preserve verbatim; derive a normalized merchant separately if useful. |
| `AMOUNT` | Signed amount | Apply the shared sign convention confirmed by the user. |
| `CHECK #` | Optional check number | Blank in the supplied samples; blank optional fields must be accepted. |
| `STATUS` | Transaction status | Sample rows showed `Posted`. |

The two Wells Fargo account types use the same five-column layout in the supplied samples. The actual raw CSV export should still be tested for encoding, delimiter, quoting, line endings, and header behavior.

## SoFi

Sample workbooks supplied:
- `SOFI-Checking•5123-2026-10-14T08_44_47.numbers`
- `SOFI-Savings•3520-2026-10-14T08_45_08.numbers`

Observed shared columns:

| Source column | Initial interpretation | Notes |
| --- | --- | --- |
| `Date` | Transaction date | Observed format: `YYYY-MM-DD`. |
| `Description` | Transaction description | Preserve original text. |
| `Type` | Source transaction classification | Preserve; may inform categorization but should not be treated as a definitive category without rules. |
| `Amount` | Signed amount | Apply the shared sign convention confirmed by the user. |
| `Current balance` | Balance associated with the transaction | Potential reconciliation signal; confirm exact semantics against appropriate original exports before relying on it. |
| `Status` | Transaction status | Sample rows showed `Posted`. |

The supplied SoFi Checking and Savings samples use the same six-column layout. The samples include transaction types such as card purchases, deposits, withdrawals, transfers, and interest. Do not assume these examples exhaust all possible transaction types.

## Fidelity Accounts History export

Sanitized workbook supplied: `Accounts_History 2.numbers`.

This workbook contains an Accounts History-style export spanning both an employer 401(k) account and an individual brokerage account. It is a mixed investment-activity export, not a bank-style cash transaction list.

The observed table has 18 columns:

| Source column | Initial interpretation | Notes |
| --- | --- | --- |
| `Run Date` | Activity/run date | Observed format: `MM/DD/YYYY`. Keep distinct from settlement date. |
| `Account` | Source account name/type | Examples include an employer 401(k) and an individual brokerage account. Do not commit account-specific values from sanitized samples. |
| `Account Number` | Source account identifier | Treat as sensitive; use only for account mapping and never log or commit raw identifiers. |
| `Action` | Activity/event description | Important for interpreting contributions, dividends, reinvestments, market-value changes, and fees. Preserve the original value. |
| `Symbol` | Investment ticker/symbol | May be blank, including for some retirement-plan activities. |
| `Description` | Security or investment description | Preserve the original text. |
| `Type` | Source activity type | Observed value includes `Cash`; blanks are present. Do not assume it is populated for every row. |
| `Exchange Quantity` | Exchange-related quantity | Optional/blank in these samples; semantics need confirmation before use. |
| `Exchange Currency` | Exchange currency | Optional/blank in these samples. |
| `Currency` | Transaction/security currency | Observed value includes `USD`; blanks are present. |
| `Price` | Price per unit | Optional and not meaningful for every action. |
| `Quantity` | Quantity associated with the activity | Optional; can be zero or blank. |
| `Exchange Rate` | Exchange rate | Optional; do not confuse with a transaction amount. |
| `Commission` | Commission amount | Optional. |
| `Fees` | Fee amount | Optional. |
| `Accrued Interest` | Accrued interest amount | Optional. |
| `Amount` | Source activity amount | Observed with both positive and negative values. The user has confirmed Fidelity follows the same convention as Wells Fargo and SoFi: negative amounts mean money leaves the account, and positive amounts mean money enters it. |
| `Settlement Date` | Settlement date | Optional/blank in these samples; preserve separately from `Run Date`. |

### Fidelity-specific import cautions

- The workbook has two leading blank rows before the header, followed by transaction/activity rows, blank separators, and explanatory/legal footer text. A parser must identify the actual header and stop at the data boundary rather than treating footer text as transactions.
- Activity includes contributions, changes in market value, recordkeeping/administrative fees, dividends, and reinvestments. Do not classify every row as ordinary cash income or spending.
- Reinvestment activity can produce a negative cash-side amount and a positive dividend amount in separate rows. Preserve the activity rows and model investment income, internal investment movements, and cash flow distinctly to avoid double counting.
- `Change in Market Value` is a wealth/valuation event, not external cash flow. Keep investment activity/transactions separate from holdings and balance snapshots, consistent with the MVP1 model.
- Brokerage and retirement-plan records may share a file but require account-level mapping and activity-aware interpretation.
- The supplied workbook is sanitized. Validate exact raw CSV encoding, delimiter, quoting, blank-line behavior, footer handling, and numeric/date representations against an original export when appropriate.
- The workbook contains sensitive-looking account fields even though this sample was sanitized. Never commit exported financial rows or account identifiers to the repository.

## Canonical transaction and source-data handling

The canonical transaction model should be provider-independent and include, at minimum:

- Account identity and institution/provider.
- Transaction date (and a separate posted date if a source later supplies one).
- Signed amount in a defined currency/precision representation.
- Original description and optional normalized merchant.
- Source transaction type and status when available.
- Import batch/source provenance and any source transaction identifier when available.
- Optional source balance and optional check/reference number where available.
- Review/deduplication state where needed.

Exact field names and types remain an implementation decision. Avoid inventing missing source fields: represent absent optional values as absent/null, not misleading placeholder text. Preserve raw source fields or an equivalent audit record so normalization is reversible and explainable.

## Import, duplicate, and reconciliation rules

- Accept blank optional fields without failing the whole import.
- Validate required headers, row shape, dates, amounts, and status values; report malformed rows clearly.
- Preserve repeated-looking rows on initial import. Identical date/description/amount is not sufficient proof that two rows are duplicates.
- Design deduplication around stable source identifiers when available, with cautious fallback matching and a review path for ambiguity.
- Transfers between a user's own accounts are movements between accounts, not new external income or spending at the overall-portfolio level. Preserve both sides where imported; avoid double-counting them in consolidated cash-flow reporting.
- Credit-card payments require similar care: the checking-account outflow and card-account payment/credit must not be counted as two separate expenses.
- Reconcile imported rows and balances when the source provides enough evidence, but do not assume the SoFi current-balance column's precise calculation until verified.

## Initial test matrix

1. Wells Fargo Checking and Credit Card: header mapping, date parsing, signed amounts, blank check number, posted status.
2. SoFi Checking and Savings: header mapping, ISO date parsing, source type, signed amounts, current balance, posted status.
3. Fidelity Accounts History: header discovery after leading blank rows, footer exclusion, 18-column mapping, run versus settlement dates, account mapping, optional numeric fields, and activity-aware classification.
4. Blank optional values and unexpected/malformed rows.
5. Duplicate-looking but potentially legitimate transactions; ensure import does not silently delete them.
6. Cross-account transfers and credit-card payments; validate consolidated reporting semantics.
7. Re-importing the same export; ensure idempotency without discarding legitimate repeated transactions.
8. Raw CSV parsing details (encoding, delimiter, quoting, line endings, BOM, and header variations) using original CSV exports when appropriate.
9. Reconciliation against source balances and known transaction history where trustworthy data is available.

## Known gaps / next steps

- Obtain or test original CSV exports when sanitization is unnecessary to validate raw-file mechanics.
- Inspect samples from any remaining institutions before defining their adapters; Fidelity Accounts History is now documented as the first investment-activity export.
- Confirm Fidelity activity/action meanings and raw CSV layout; confirm other institutions' date, amount, balance, and transaction-ID semantics with additional samples.
- Define canonical schema and import-batch/audit model before implementing broad categorization logic.
- Keep sample data sanitized; do not commit account-level transaction data or personally identifying financial details to the repository.
