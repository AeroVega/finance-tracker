# Financial position and reconciled coverage

**Status:** Synthetic-only implementation under the owner's November 10, 2026 approval of the financial-position plan. Production persistence remains **NO-GO**. Merge, deployment, live Drive tests and real-data activation require separate authorization.

## Scope and sources

This milestone adds dated balances, dated holdings evidence, explicit balance-conflict decisions, account closure evidence and account/month reconciliation to the existing canonical workspace. It uses the existing canonical ledger, verified store, transaction/recovery machinery and portable backup. It does not add a database, external pricing, performance calculations, debt forecasts or historical-workbook migration.

Transaction imports remain evidence of activity. The supported Fidelity history CSV is not a holdings or account-valuation export. A trade price, quantity, dividend, contribution or running sum of transactions must not become an invented market value. The existing CSV parser does not gain an unsupported balance/holdings importer in this milestone.

Every balance has an account, effective date, exact amount, account currency, basis and source reference. Statements, provider evidence and explicit manual records remain distinguishable. References in the bundled fixture are deliberately invented. Agents must not substitute actual account identifiers or financial records in code, tests, screenshots or public PR material.

## Point-in-time rules

- Select the latest applicable balance date at or before the requested as-of date. Future snapshots cannot affect an earlier view. Do not roll a stale balance forward by adding transactions.
- Preserve all competing same-date evidence. A differing amount requires an explicit selection and reason. A resolution names the full candidate set and the chosen record. New contradictory evidence reopens the conflict rather than inheriting an old choice silently. Corroborating evidence with the same selected date and exact value does not revoke existing reconciliation or closure references.
- Show the selected balance's effective date, source, basis and freshness. The initial warning threshold is more than 35 calendar days. A value exactly 35 days old is not stale. No live-current claim follows from a dated value.
- Missing and unresolved balances remain unavailable. Known assets, liabilities and net worth are labeled subtotals for the selected account scope. Withhold complete totals when that scope is not fully supported. Separate currencies; no implicit exchange rate or cross-currency total.
- Checking, savings, brokerage and retirement balances are assets. Credit cards, mortgages and auto loans are liabilities. Debt balances represent amounts owed, not negative asset entries or invented payment components. Unsupported account types remain visible and block complete claims.
- Investment account balances count once. Holdings are dated supporting evidence, never an additional asset total. Unsupported holdings and mismatches remain visible. No source trade row is promoted to a holding.
- Account closure is explicit and append-only. Closure needs a zero balance anchor and source evidence. It applies on its effective date, preserves account identity and prior balances, and remains incomplete when later activity, unresolved source evidence or nonzero holdings contradict it. Missing imports never imply closure.

## Reconciliation is a calculated result

Declared import windows, observed activity dates and reconciled-complete coverage answer different questions. A dated balance alone does not establish complete activity history.

For each account/month the model checks declared coverage, unresolved observations, posting/date/money support, opening and closing balance anchors, balance conflicts, reconciliation evidence and exact movement discrepancy. Invalid or unknown source dates cannot be silently filtered out to make a month complete. Pending items remain visible and do not enter finalized movement.

Bank and credit-card reconciliation uses the effective canonical amounts, including transfers and card payments. Movement uses a known posting date, falling back to the source effective date for other posted activity; refunds require their posting date. This prevents a January pending item or refund that posts in February from entering January movement. It does not use the spending report subtotal. Card activity signs invert when checking the amount owed. Manual corrections affect the rollforward while preserving original source evidence.

The workspace supports manual account creation, dated holdings entry, holdings-conflict selection, cash/card reconciliation and investment/loan statement components. These are explicit synthetic inputs, not provider file importers. Complete and partial holdings sets remain distinct. Same-date holdings conflicts require an append-only holdings-resolution with a reason and the exact candidate set.

Investment and loan statements may use explicitly evidenced statement components rather than inferring market changes or a principal/interest split from cash movement. A component needs its own statement reference. An optional explicit full-month statement declaration can supply declared coverage for a manual investment or loan statement without fabricating a CSV import. It must match the selected calendar month exactly. It does not bypass anchor, discrepancy, posting or unresolved-evidence checks. An unsupported or missing method stays incomplete.

A reconciliation event is a request supported by evidence, not a trusted `complete` flag. Reports recompute the result after new imports, corrections, decisions and balance evidence. A previously reconciled month can become incomplete without rewriting or deleting its prior audit event.

## Compatible records and recovery

The version-1 ledger gains an optional `positionEvents` collection. Old six-collection ledgers remain readable and keep their exact graph, including the absence of this property. The collection is added only when needed. New immutable records carry an event ID, command ID, timestamp, account ID and event type.

The records are indexed in both supported per-record v1 and fragmented v3 layouts. They cannot be hidden in index metadata, rewritten or removed on later saves. Deprecated standalone grouped v2 remains refused. Existing old app versions cannot safely read the new collection; they must refuse it rather than discard it. Keep a reviewed compatible app version for reopening an upgraded copy.

Workspace position changes are staged. Explicit save uses the same verified storage path as activity corrections. Undo can remove a staged change before saving, and reverting restores the exact loaded baseline. Persisted changes need additional events. A lost save response blocks blind retry and editing until recovery/verified reopen resolves the outcome. Portable export and restore preserve position events and validate their history with the other canonical records.

## Adversarial review follow-up

The [PR36 review](PR36_ADVERSARIAL_REVIEW.md) records reproduced financial and audit-integrity defects, corrections, editor improvements, scoped CPU measurements and the remaining rendered/device acceptance limits. Position reports reuse a defensive snapshot during search and pagination without changing financial scope or losing unfinished conflict decisions.

## Invented scenario and acceptance

`createSyntheticFinancialPosition()` supplies six invented USD accounts as of January 31, 2025:

| Measure | Exact amount |
| --- | ---: |
| Checking | 2,200.00 |
| Savings | 2,500.00 |
| Brokerage account total | 5,000.00 |
| Credit card owed | 300.00 |
| Mortgage owed | 99,000.00 |
| Auto loan owed | 8,000.00 |
| Assets | 9,700.00 |
| Liabilities | 107,300.00 |
| Net worth | -97,600.00 |

The brokerage holdings support its 5,000.00 total. They are not added again. January checking, savings and card activity reconcile against December 31 and January 31 statements. Investment and loan activity coverage is intentionally incomplete; their dated balances do not prove full history.

**Verified adversarial follow-up on Node 24.22.1:** The serial suite passed 1,097/1,097 tests with no failures or skips, including manual account/holdings/component entry, no-CSV reconciliation and the review regressions:

```sh
node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

Changed JavaScript modules passed `node --check`; `git diff --check` and changed-document relative file links passed. Independent review reproduced and verified fixes for cross-month observations, missing monetary evidence, refund/posting dates and contradicted closures. These checks use synthetic records and controlled in-memory storage, not live Google.

**Unverified:** Actual rendered browser/device behavior and live synthetic Drive flows. Local Chromium could not create its required socket in this environment; the provided browser could not reach the local server. Node 26 verification is delegated to the repository CI and must be checked on the published head.

Owner acceptance should cover:

1. Open the invented position preview without Google access. Select January 31, 2025 and inspect dates, sources, amounts and January coverage.
2. Move the as-of date before the first balance and beyond the freshness threshold. Confirm missing and stale labels. Change account scope without letting transaction search change totals.
3. Stage conflicting same-date balance evidence. Confirm the conflict withholds the affected amount until an explicit reasoned selection. Inspect all original evidence after resolution.
4. Add an invented mortgage or auto-loan account and stage a dated balance. Enter a complete or partial holdings set, then correct and resolve same-date conflicting holdings. Stage statement components using separate evidence references and an explicit full-month declaration. Confirm a discrepancy or unresolved source still prevents completeness. Undo these changes and revert a mixed activity/position draft. No operation should write before explicit save.
5. Save to a newly chosen empty synthetic folder, independently reopen and compare position, source evidence and audit history. Export/restore into another fresh synthetic copy and compare again. These live actions are owner-run only.
6. Interrupt a synthetic save, recover and independently reopen before retrying. Retain uncertain copies and record the actual outcome.
7. Check narrow iPhone and iPad Safari layouts, keyboard focus, long evidence, repeated actions and cancellation. Record device and source SHA. Emulated desktop-browser checks do not replace physical Safari evidence.

No automated in-memory test proves live Google behavior, actual device behavior or production authorization. The full Alpha exit still requires the other steps in [next steps](NEXT_STEPS.md).
