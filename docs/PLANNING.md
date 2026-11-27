# Planning: budgets and the baseline cash projection

This contract covers the v1.0.0 Planning tab: monthly category budgets and the three-month baseline cash projection. Product rules and their owner decisions are in [Product § 5](PRODUCT_DEFINITION.md#5-planning-and-decision-support). Implementation status is in [Current state](CURRENT_STATE.md). Screen layout is in [Design § Planning](DESIGN.md#planning).

| File | Role |
| --- | --- |
| [planning-contract.mjs](../js/planning-contract.mjs) | Validates stored planning records; selects the targets and exclusions in effect |
| [planning.mjs](../js/planning.mjs) | Appends planning records to a ledger |
| [budget-report.mjs](../js/budget-report.mjs) | Budget read model for one month |
| [cash-projection.mjs](../js/cash-projection.mjs) | Baseline projection read model |
| [planning-page.mjs](../js/planning-page.mjs) | Planning page and Home's budget card |

## Stored records

Planning records are an optional, append-only `planningEvents` collection in the canonical ledger, next to `positionEvents`. Synthetic and production ledgers both accept it, and no ledger version changes. A ledger without the collection is valid.

Every record has `eventId` (UUID v4), `eventType`, `commandId`, `recordedAt` and `appendOnly: true`. Event and command IDs must be unique across the whole ledger, including activity and position history. A ledger transition cannot remove, reorder or rewrite a planning record. A CSV import proposal cannot change the collection.

| `eventType` | Fields | Meaning |
| --- | --- | --- |
| `budget-target` | `categoryId`, `currency`, `effectiveMonth`, `amountText` | Sets one category's monthly target from `effectiveMonth` onward. `amountText` is an exact positive decimal in the currency, or `null` to remove the budget. |
| `projection-exclusion` | `activityId`, `excluded`, `reason` | Leaves one activity out of the projection average (`excluded: true`) or puts it back (`false`). A reason is required. |

Validation rules:

- `categoryId` uses the category slug shape that `categoryIdFromText` produces.
- `effectiveMonth` may not be earlier than the month before the UTC month of `recordedAt`. The page itself only offers the local current month and later months. The one-month allowance covers a user west of UTC on the first day of a month.
- An exclusion names an existing activity. It must change that activity's state: excluding an excluded activity, or restoring one that is not excluded, is refused.

A planning record never changes an activity, a balance, a category or a report total. Saving, reopening and the encrypted backup carry the collection with the rest of the ledger. Forecast snapshots (§ 5.4) are deferred past v1.0.0 and would be a new `eventType`.

## Targets in effect

For a month, each category's target is the latest appended `budget-target` record whose `effectiveMonth` is on or before that month. A change made later therefore applies from its month on, and it replaces a target set in advance for a later month. Earlier months keep their targets. Targets in a different currency from the budget view's currency are ignored. Currencies are never combined.

## Budget report

`buildBudgetReport` covers all accounts for one calendar month.

- **Actual spending** is Home's category figure for that month from [home-period-report.mjs](../js/home-period-report.mjs). That figure follows Home's rule of one source per month, and categories merge by name, ignoring case. Planning and Home therefore never disagree.
- **Remaining** is target minus actual. A negative value is shown as an amount over target in that month only. Nothing carries over in either direction (Q29).
- **Not budgeted** sums every category without a target. It includes the "No category" and "Not broken down" rows.
- **Total line** compares all targets with all spending.
- **Coverage** applies only to months whose source is imported activity. A spending account is checking, savings or credit card. Each spending account must have declared imports reaching, without a hole, from the first of the month to the earlier of month end and today. An account with no import for the month is a gap. So is an account with source rows waiting for review, or with an activity whose date, amount or lifecycle is unknown.
- **Month-end estimate** appears for the current month only. With a coverage gap it is withheld. When each of the three previous months has imported transaction detail and no gap, the estimate is history-shaped: spending so far plus the average spending after the same day of the month in those months. "So far" ends on the latest day that every spending account's coverage reaches. Otherwise the estimate falls back to this month's pace, that is, spending so far times days in the month divided by days elapsed. The fallback appears from day 8 only.
- **Suggested targets** average each category over the three most recent completed months that have spending data, looking back at most 12 months. A category missing from one of those months counts as zero in that month. The suggestion is the average rounded to a whole unit, at least 1. Spending with no category or no breakdown gets no suggestion.

## Cash projection

`buildCashProjection` uses the combined balance of checking and savings accounts. An account closed before the window is left out.

1. **Window.** The three most recent completed calendar months before today's month.
2. **Gate.** Every included account needs a reconciled account-month (`coverageState` is `reconciled`) for each month in the window. Otherwise the result is `blocked` and lists each missing account and month with its coverage state. No exclusion or other input bypasses the gate. Accounts in more than one currency also block the projection.
3. **Start.** The sum of the reconciled closing balances on the last day of the window.
4. **Flows.** Posted or corrected activities in included accounts, dated by posted date. A refund is dated by its posted date only. A transfer whose linked counterpart is also an included account is left out. Card payments, loan payments and transfers to investment accounts stay in as outflows.
5. **Average.** In and out are averaged over the three months, after leaving out excluded activities. The result is rounded half away from zero to cents.
6. **Projection.** Month-end balances for today's month and the next two months: the start plus the average net flow, once per month. Activity already recorded this month is not used.

**Possible one-offs.** A row is suggested for exclusion when its absolute amount is at least a quarter of the average monthly flow in its direction, and its description does not appear in every month of the window. The app never excludes a row on its own.

## Verification

Invented-data tests:

- `tests/planning-records.test.mjs`: record validation, effective targets, immutability and exclusions.
- `tests/planning-persistence.test.mjs`: staging, undo, save and reopen, the encrypted backup, CSV import proposals, and ID collisions.
- `tests/budget-report.test.mjs`: actuals, the Not budgeted row, estimates, coverage gaps and suggestions.
- `tests/cash-projection.test.mjs`: the window, the gate, the start, flows, exclusions and one-off suggestions.

Regenerate this list with `ls tests/planning-*.test.mjs tests/budget-report.test.mjs tests/cash-projection.test.mjs`.
