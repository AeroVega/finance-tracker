# Financial Data Sources and Import Research

**Status:** Preliminary research baseline  
**Last reviewed:** 2026-10-10

## MVP1 strategy
Use owner-downloaded CSV exports. Direct institution connections are not a dependency for MVP1. User-provided sanitized samples should remain outside this public repository; commit only deliberately authored synthetic fixtures.

## Wells Fargo
**Public-documentation finding:** Online banking help describes downloadable activity and CSV exports. Available history can differ by account/activity type; credit-card history may be more limited than deposit-account history.

Source: https://www.wellsfargo.com/help/online-banking/activity-faqs/

**Still to verify:** Actual date-range limits per account, columns, identifiers, pending/posted behavior, and whether descriptions or identifiers change across exports.

## SoFi
**Public-documentation finding:** Support documents exporting checking and savings activity as CSV with selectable date ranges.

Source: https://support.sofi.com/hc/en-us/articles/can-i-export-my-checking-and-savings-transactions

**Still to verify:** Separate schemas, signs/date conventions, transfer representation, stable IDs, and overlap behavior.

## Fidelity brokerage
**User-confirmed:** The owner can export brokerage transactions for any selected 365-day period within five years and can export brokerage holdings to CSV.

**Still to verify from sanitized samples:** Column types, transaction IDs, trade/settlement dates, transfers/contributions, dividends, fees, corporate actions, quantity/price/value fields, and activity coverage.

Public documentation reviewed:
- https://www.fidelity.com/webxpress/help/topics/learn_portfolio_positions.shtml
- https://www.fidelity.com/customer-service/account

## Fidelity workplace 401(k)
**User-confirmed:** The owner can export 401(k) transactions for any selected 365-day period within five years and can export 401(k) holdings.

**Still to verify:** Contribution types, employer match, fees, distributions, exchanges, dates, fund identifiers, units, prices, and value representation. Do not assume its schema matches brokerage exports.

## Preliminary API/provider research
No free, authorized, sustainable direct API route has been verified for all target institutions. This describes current evidence, not proof that no qualifying route exists.

- Plaid docs and Transactions product: https://plaid.com/docs/ and https://plaid.com/products/transactions/ — verify current production pricing; a trial is not sufficient.
- Teller pricing and docs: https://teller.io/pricing/ and https://teller.io/docs/ — distinguish sandbox from commercial production.
- Akoya: https://akoya.com/ — permissioned APIs do not by themselves establish free self-service production access.
- Fidelity workplace API example: https://workplacexchange.fidelity.com/public/wpx/docs/wi-balances — partner-facing documentation is not proof of consumer API access.
- CFPB Section 1033 materials: https://www.consumerfinance.gov/compliance/compliance-resources/other-applicable-requirements/personal-financial-data-rights/ and https://www.consumerfinance.gov/personal-financial-data-rights/ — regulatory status may evolve; do not assume it guarantees a usable free API by January 2027.

Recheck current official terms before making implementation decisions.

## Sample-export checklist
For each account/export type, record the account type (no account number), export date and selected date range, file encoding/delimiter/header, column names and value shapes, date/sign conventions, activity types included/omitted, stable identifier behavior, overlap behavior, pending/correction behavior, and reconciliation method.

## Design implications
Treat each institution/account type as a potentially distinct parser. Preserve descriptions and provenance, use stable identifiers when available, document conservative matching when not, track coverage per account/import, and distinguish missing history from a transaction that did not occur. Never commit raw sample exports.
