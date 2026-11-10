# Data Model and Reconciliation Principles

**Status:** Canonical contract and synthetic implementation are merged. Financial-position and historical-summary models remain Alpha work, as of November 10, 2026. Production persistence remains **NO-GO**.

The [canonical contract](CANONICAL_LEDGER_CONTRACT.md) defines the ledger. [PR28](PR28_CANONICAL_IMPORT.md) implements synthetic provider parsing, reconciliation, reports and durable canonical save/reopen; the [main workspace](CANONICAL_MAIN_WORKSPACE.md) adds ordinary browsing and corrections. The principles below apply to those implementations and their remaining extensions. See [project status](PROJECT_STATUS.md) for evidence and [next steps](NEXT_STEPS.md) for the gaps.

## Logical concepts
- **Institution/source:** provider of a file or response.
- **Account:** checking, savings, credit card, brokerage, or workplace retirement account.
- **Import run:** attempt to process a file/source, with status, timestamp, coverage, and counts.
- **Source record:** original row and identifiers needed to trace a normalized record.
- **Ledger activity:** normalized transaction/activity used in reporting.
- **Categorization rule:** inspectable, editable, reversible rule.
- **Review item:** unresolved or suspicious record needing attention.
- **Balance/holding snapshot:** dated financial-position evidence, distinct from transaction movement. Its full Alpha representation remains open.
- **Historical monthly summary:** workbook-derived monthly aggregates, separate from the canonical activity ledger. Its persistence/migration contract remains open.
- **Report definition:** documented formula and scope for a metric.

## Import requirements
- Validate files before applying changes.
- Report recognized, imported, skipped, duplicate, rejected, and review-needed counts.
- Preserve descriptions, available IDs, and source provenance.
- Record import identity/fingerprint without logging sensitive contents.
- Require explicit account mapping and strict recognition of a known versioned source format; fail safely when either is unresolved.
- Make re-imports idempotent and overlapping ranges safe.
- Record coverage and import timestamp separately from newest transaction date.
- Distinguish parser failure from a valid empty file.
- Preserve source observations across pending-to-posted transitions when identity confidence is high.
- Represent corrections and reversals as append-only events; derive effective reporting state without counting a reversal/correction as a second independent economic event.
- Keep an auditable path for user corrections and rule changes.

## Duplicate matching
Prefer a stable provider transaction ID when its semantics are understood. Without one, use a documented conservative composite match. Amount/date/description alone can collide for legitimate repeated transactions. Treat ambiguous matches as review items rather than silently discarding records. Pending transactions and provider corrections may change dates, descriptions, or IDs, so row hashing alone is insufficient.

## Overlapping-import contract — MVP1

**Policy:** Automatically merge only confidently matched records. Flag ambiguous candidates for review. Never silently discard a potentially legitimate financial event.

### Import-run behavior
- Compute a privacy-safe fingerprint of the file contents for import idempotency; do not log or expose raw contents or sensitive row values.
- If an identical file has already completed successfully for the same account/import context, report the prior result or a no-op instead of applying it again. A filename alone is not an identity.
- For a different file with overlapping history, process each incoming row against existing source records and normalized activity. Do not replace an entire date range just because the new file overlaps it.
- Keep an import-run summary with counts for recognized rows, newly added rows, confidently matched rows, ambiguous matches, rejected rows, and rows requiring review. Keep the import's date coverage separate from its newest transaction date.

### Matching order
1. **Stable source identifier:** Prefer a provider transaction/activity ID when its meaning and stability are understood. Scope it to the provider and account; retain the source identifier and the matching rationale.
2. **Known lifecycle transition:** If a provider changes a pending record to posted, or corrects an existing record, link the new source representation to the existing activity only when provider IDs or strong corroborating evidence support that relationship. Preserve the transition/correction history rather than silently overwriting source data.
3. **Conservative composite match:** If no stable ID exists, compare account, currency, signed amount, appropriate transaction date, normalized description, and source action/type where available. A composite match is eligible for automatic merging only when there is exactly one plausible candidate, the source's semantics are understood, and corroborating context rules out a reasonable collision.
4. **Ambiguous or conflicting candidates:** If there are multiple candidates, conflicting fields, a weak description-only match, or insufficient evidence, create a review item. Do not merge or delete either record automatically.

**Important:** Matching only on date, amount, and description is not sufficient proof. Legitimate repeated purchases, dividends, payroll entries, or other activity can share those fields. Repeated-looking rows within a single file must also be preserved or flagged unless stable identifiers establish duplication.

### Merge and review behavior
- A confident match means the incoming row is another representation of an existing activity, not a second financial event. Attach the new source observation/import provenance to the existing canonical activity rather than adding a duplicate.
- Preserve raw source fields and a traceable link to each import. Keep source corrections and pending/posted changes auditable.
- Never overwrite a previously accepted field without recording why and where the replacement value came from. When sources conflict and precedence is not defined, route to review.
- Review items should show the candidate records, the fields that agree/disagree, the source/import context, and safe actions such as confirm same activity, keep as separate activities, or resolve a correction. User decisions should be auditable and reversible where practical.
- **Processing state and human sign-off are separate concepts.** Mark a record/activity `processed` only when it has completed the defined import pipeline successfully; do not use that word to imply financial settlement or human approval. Automated processing normally requires no human-review marker.
- When a person explicitly approves a review decision, persist an auditable review-decision event linked to the affected source records and canonical activity. Capture the decision/scope (for example, identity match versus categorization), decision outcome, reviewer, timestamp, and rationale/evidence where appropriate. Do not collapse this into an unqualified boolean that could confuse different kinds of approval.
- Human-approved identity decisions are valuable evidence for later overlapping imports and should be reused when the same source records/identities recur. They are not a universal duplicate signature: scope the decision to the specific records or a well-defined matching rule, and never infer that all transactions with similar descriptions/amounts are identical. Absence of a human-review event means only that no such explicit sign-off was recorded; it does not mean the record is unprocessed or invalid.
- Keep source-record fingerprints/signatures as matching evidence, not proof of identity. Preserve distinct legitimate transactions even when their normalized signatures collide; a review sign-off must not erase multiplicity or source provenance.
- Applying an import should be atomic where the chosen storage technology supports it; if processing fails, report partial progress explicitly and make retry safe.
- Provide a recovery path for mistaken matches or merges. Do not rely on destructive date-range replacement as the normal workflow.

### Required synthetic tests
- Import the exact same file twice: the second run is a no-op/idempotent.
- Import a new file with overlapping history and stable source IDs: matching rows are not duplicated.
- Import overlapping history without IDs where one candidate has strong corroboration: merge only if unique and unambiguous.
- Two legitimate transactions share date, amount, and description: preserve both or flag the match; never silently collapse them.
- One incoming row has two plausible existing candidates: create a review item.
- A pending transaction becomes posted or a provider corrects a field: link only with sufficient evidence and preserve history.
- The same source ID appears under conflicting account/amount details: flag a conflict instead of blindly merging.
- Retry after a failed or interrupted import: no duplicate side effects.
- A user resolves an ambiguous match as same activity or separate activities: persist the decision and make subsequent imports consistent with it.

## Financial semantics
- Internal transfers are neither income nor spending when both sides are known.
- Credit-card purchases are spending; paying the card is a transfer/liability payment, not a second expense.
- Refunds and chargebacks follow documented reporting conventions.
- Investment contributions/withdrawals are transfers into/out of investment accounts, not ordinary market returns.
- Trades, dividends, interest, fees, distributions, and market-value changes remain distinguishable.
- Net-worth changes are not equivalent to cash flow.
- Holdings snapshots are not purchase histories.
- Missing/unknown/unavailable is not zero.

## Reporting definitions and remaining contracts

The [product definition](PRODUCT_DEFINITION.md#44-financial-activity-and-reporting-semantics) settles the main meanings: posted activity for finalized reporting, pending excluded, refunds reduce posting-month spending, internal transfers/card settlements are not new spending, and net worth is assets minus liabilities. Existing canonical reports implement a bounded subset with explicit exclusions.

Step 2 must define dated balance evidence, compatible holdings/liability representation and reconciled completeness. Remaining financial edge cases stay in [the decision register](PRODUCT_OPEN_DECISIONS.md). Cash movement cannot stand in for account balances; missing investment lifecycle/valuation evidence cannot be manufactured from visible source rows.

## Historical monthly summaries

**User-confirmed:** preserve monthly history beginning in January 2023, superseding the early annual-only proposal. Follow [Product Definition §11.1](PRODUCT_DEFINITION.md#111-one-time-migration-of-first-generation-excel-history).

Use a distinct monthly-summary record type for net-worth snapshots, income totals and available source breakdowns, expense totals and available primary-category breakdowns. Retain represented month, source workbook/worksheet, mapping and reconciliation provenance. Do not fabricate transactions or account-level detail. Expense subcategories remain subject to source inspection.

A one-time Python converter must report missing months, formula errors, ambiguous labels and mismatched totals without silently filling or correcting them. Preserve the original `Finances.xlsx` unchanged. Keep real source/output records outside this public repository and do not inspect or import them before the applicable authorization and privacy gates.

When a summary overlaps transaction detail, use the detail only when that month is reconciled complete at the applicable scope. Otherwise retain the summary with its coverage label. Never add both sources for the same activity. Completeness and source-selection evidence belong to step 2; synthetic schema/converter/persistence checks belong to step 3. Neither is implemented merely because the policy is documented.

## Synthetic test scenarios
Same file twice; overlapping exports; legitimate same-day duplicate-shaped transactions; pending-to-posted changes; refunds; internal transfers; card purchase/payment; brokerage deposit, trade, dividend, fee, and distribution; 401(k) contribution and employer match; holdings changes without transactions; missing dates; malformed amounts; unsupported rows; valid empty files; and older-period imports after newer transactions already exist.
