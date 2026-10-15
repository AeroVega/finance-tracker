# Data Model and Reconciliation Principles

**Status:** Conceptual baseline; schema not yet implemented

The canonical model will be designed after sanitized exports are inspected. These are design requirements, not a final schema.

## Logical concepts
- **Institution/source:** provider of a file or response.
- **Account:** checking, savings, credit card, brokerage, or workplace retirement account.
- **Import run:** attempt to process a file/source, with status, timestamp, coverage, and counts.
- **Source record:** original row and identifiers needed to trace a normalized record.
- **Ledger activity:** normalized transaction/activity used in reporting.
- **Categorization rule:** inspectable, editable, reversible rule.
- **Review item:** unresolved or suspicious record needing attention.
- **Holding snapshot:** point-in-time positions and cash, distinct from transactions.
- **Report definition:** documented formula and scope for a metric.

## Import requirements
- Validate files before applying changes.
- Report recognized, imported, skipped, duplicate, rejected, and review-needed counts.
- Preserve descriptions, available IDs, and source provenance.
- Record import identity/fingerprint without logging sensitive contents.
- Make re-imports idempotent and overlapping ranges safe.
- Record coverage and import timestamp separately from newest transaction date.
- Distinguish parser failure from a valid empty file.
- Define behavior for corrections, reversals, and pending-to-posted transitions; do not silently overwrite.
- Keep an auditable path for user corrections and rule changes.

## Duplicate matching
Prefer a stable provider transaction ID when its semantics are understood. Without one, use a documented conservative composite match. Amount/date/description alone can collide for legitimate repeated transactions. Treat ambiguous matches as review items rather than silently discarding records. Pending transactions and provider corrections may change dates, descriptions, or IDs, so row hashing alone is insufficient.

## Financial semantics
- Internal transfers are neither income nor spending when both sides are known.
- Credit-card purchases are spending; paying the card is a transfer/liability payment, not a second expense.
- Refunds and chargebacks follow documented reporting conventions.
- Investment contributions/withdrawals are transfers into/out of investment accounts, not ordinary market returns.
- Trades, dividends, interest, fees, distributions, and market-value changes remain distinguishable.
- Net-worth changes are not equivalent to cash flow.
- Holdings snapshots are not purchase histories.
- Missing/unknown/unavailable is not zero.

## Reporting questions to resolve
Define income, spending, net cash flow, savings rate, balances, net worth, and investment performance before implementation. Explicitly decide transfer/card-payment treatment, savings-rate denominator and investment contribution treatment, trade-date versus settlement-date basis, and pending activity representation.

## Historical annual summaries
Potential migration scope is annual summaries for 2023–2026 only where the archived workbook supports the figures and methodology. Candidate metrics: annual income, expenses, net cash flow, comparable savings rate, supported ending balance/net worth, and methodology notes. Do not edit the archived `Finances.xlsx`; do not migrate transaction history just because it exists; do not fabricate figures or treat unavailable values as zero. Mark unsupported or non-comparable metrics explicitly.

## Synthetic test scenarios
Same file twice; overlapping exports; legitimate same-day duplicate-shaped transactions; pending-to-posted changes; refunds; internal transfers; card purchase/payment; brokerage deposit, trade, dividend, fee, and distribution; 401(k) contribution and employer match; holdings changes without transactions; missing dates; malformed amounts; unsupported rows; valid empty files; and older-period imports after newer transactions already exist.
