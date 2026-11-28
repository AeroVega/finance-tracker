# Rules

This contract covers rules that file transactions: their records, their order, how they apply to transactions that need review and to imports, and how they replace the older correction rules. Product rules are in [Product § 4.6](PRODUCT_DEFINITION.md#46-categories). Categories are in [Categories](CATEGORIES.md). The older correction rules are in [Category rule scoping](CATEGORY_RULE_SCOPING.md). Implementation status is in [Current state](CURRENT_STATE.md).

| File | Role |
| --- | --- |
| [rule-catalog.mjs](../js/rule-catalog.mjs) | Validates stored rule records, builds the ordered rule list, and matches one rule against one transaction |
| [rule-records.mjs](../js/rule-records.mjs) | Appends rule records, finds what each rule would file, and builds the filing events |

## What a rule does

A rule has one condition and one action:

- **Condition.** The transaction's source description or normalized description contains `descriptionContains`, ignoring case. When `accountIds` is not empty, the transaction must also be in one of those accounts.
- **Action.** Set the type to `activityKind`, which is `spending`, `income`, `transfer`, or `refund`. When `categoryId` is set, also set the category.

Rules run in order, and the first usable rule that matches wins. A rule is usable when it is turned on and its category, if it has one, has not been deleted. A rule matches only where its type fits the amount: spending needs money out, and income and refunds need money in. Transfers fit either.

## What a rule may change

A rule files only a transaction that still needs a type or a category. That means an active transaction that meets one of these conditions:

- It is unclassified.
- Its category was deleted.
- It is a refund with no category and no linked purchase.

A rule never changes a transaction you filed yourself or one that another rule already filed.

Filing appends ordinary activity events. A type change is a `classification` event that carries the rule's category. A category change alone is a `category-correction` event with `createRule: false`. The evidence holds the rationale `Filed by rule: description contains "<text>".` and the `ruleId`.

## When rules apply

- **Applying from the Rules page.** Saving a rule changes no transaction. The page then shows the transactions the rule would file, and **Apply** files them as one undoable step. **Apply all rules** previews and files every rule's matches the same way.
- **A staged CSV import.** The session files the import's new activities by rule in the same staged step as the import. Older transactions are not touched. The import message says how many transactions rules filed.
- **Editing, turning off, or deleting a rule** changes no transaction it already filed.

## Stored records

Rule records are an optional, append-only `ruleEvents` collection in the canonical ledger, next to `categoryEvents`. Synthetic and production ledgers both accept it, and no ledger version changes. A ledger transition cannot remove, reorder, or rewrite a record. A CSV import proposal cannot change the collection. Every record has `eventId` (UUID v4, unique across the ledger), `eventType`, `commandId` (unique across the ledger), `recordedAt`, and `appendOnly: true`.

| `eventType` | Fields | Meaning |
| --- | --- | --- |
| `rule-definition` | `ruleId`, `descriptionContains`, `accountIds`, `activityKind`, `categoryId`, `counterpartyAccountId`, `enabled`, `deleted` | Creates a rule, or replaces one. With `deleted: true` it restates the rule and removes it. |
| `rule-order` | `ruleIds` | Sets the order. It lists every current rule exactly once. |
| `legacy-rule-retirement` | `ruleEventId`, `activityBoundary` | Stops a correction rule for activities appended after `activityBoundary`. |

Validation refuses these records:

- A `descriptionContains` that is blank, untrimmed, or longer than 100 characters.
- An unknown account, or the same account listed twice.
- An `activityKind` outside the four types, or a `categoryId` that is not a category slug.
- A `counterpartyAccountId` other than `null`. Transfer accounts in rules are later work.
- Any record for a deleted `ruleId`. A deleted rule never returns.
- A `rule-order` that does not list every current rule exactly once.
- A retirement of an event that is not an enabled correction rule, or that is already retired. Its `activityBoundary` must be an integer from 0 to the current activity count.

New rules go after the existing ones until a `rule-order` record moves them.

## Correction rules

A category correction made before this change could create a rule for later imports. That rule matches one exact description in one account, and it is kept in the correction event. The Rules page lists these rules under **Rules from earlier corrections**.

- **Delete** appends a `legacy-rule-retirement` whose `activityBoundary` is the activity count at that moment. The replay in `js/canonical-import.mjs` then stops the rule for activities at or after that position. Activities are append-only and never reordered, so the boundary always points to the same records. Transactions the rule already filed keep their category.
- **Edit** opens the rule editor filled from the correction rule. Saving it creates a new rule and retires the correction rule in one staged step.

The **Make a rule from this decision** checkbox no longer creates a correction rule. After the decision is staged, it opens the rule editor filled from that transaction, so you can widen the description before you save.
