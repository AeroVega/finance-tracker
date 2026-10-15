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

The user has confirmed this convention for the Wells Fargo and SoFi samples:

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
3. Blank optional values and unexpected/malformed rows.
4. Duplicate-looking but potentially legitimate transactions; ensure import does not silently delete them.
5. Cross-account transfers and credit-card payments; validate consolidated reporting semantics.
6. Re-importing the same export; ensure idempotency without discarding legitimate repeated transactions.
7. Raw CSV parsing details (encoding, delimiter, quoting, line endings, BOM, and header variations) using original CSV exports when appropriate.
8. Reconciliation against source balances and known transaction history where trustworthy data is available.

## Known gaps / next steps

- Obtain or test original CSV exports when sanitization is unnecessary to validate raw-file mechanics.
- Inspect samples from the remaining institutions (including Fidelity brokerage and 401(k) exports) before defining their adapters.
- Confirm institution-specific date, amount, balance, and transaction-ID semantics with additional samples.
- Define canonical schema and import-batch/audit model before implementing broad categorization logic.
- Keep sample data sanitized; do not commit account-level transaction data or personally identifying financial details to the repository.
