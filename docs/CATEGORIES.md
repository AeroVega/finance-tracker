# Categories

This contract covers the category list: built-in categories, the owner's category records, subcategories, and deletion. Product rules are in [Product § 4.6](PRODUCT_DEFINITION.md#46-categories). Rules that assign a category to later imports are in [Category rule scoping](CATEGORY_RULE_SCOPING.md). Implementation status is in [Current state](CURRENT_STATE.md).

| File | Role |
| --- | --- |
| [category-catalog.mjs](../js/category-catalog.mjs) | Validates stored category records and builds the list a ledger shows |
| [category-records.mjs](../js/category-records.mjs) | Appends category records to a ledger |

## Where categories come from

The list for a ledger is built in this order:

1. The built-in categories. There are 17 spending categories and 3 income categories: Paycheck, Interest earned, and Other income.
2. Every category ID the ledger already uses, in activities, activity events, or budget targets, that has no built-in entry. Its label is the ID's words in sentence case, so `pet-care` reads "Pet care". It is an income category when only income classifications use it. Otherwise it is a spending category.
3. The category records, replayed in append order.

A category has an ID, a label, a list (`spending` or `income`), and an optional parent.

## Stored records

Category records are an optional, append-only `categoryEvents` collection in the canonical ledger, next to `planningEvents`. Synthetic and production ledgers both accept it, and no ledger version changes. A ledger without the collection is valid. A ledger transition cannot remove, reorder, or rewrite a record. A CSV import proposal cannot change the collection.

Every record has `eventType: "category-definition"` and these fields:

| Field | Meaning |
| --- | --- |
| `eventId` | UUID v4, unique across the whole ledger |
| `commandId` | Unique across the whole ledger, at most 200 characters |
| `recordedAt` | ISO timestamp |
| `appendOnly` | Always `true` |
| `categoryId` | The category slug, in the shape `categoryIdFromText` produces |
| `label` | The display name, trimmed, 1 to 60 characters |
| `parentId` | A top-level category's ID, or `null` |
| `direction` | `spending` or `income` |
| `deleted` | `true` retires the category |

A record with `deleted: false` creates the category, or replaces its label, parent, and list. A record with `deleted: true` restates the category's current label, parent, and list, so the record reads on its own.

Validation refuses these records:

- A deletion of a category that is not in the list, or that still has subcategories.
- Any record for a deleted ID. A deleted ID never returns.
- A parent that is missing, is itself a subcategory, is the category itself, or is in the other list.
- A category with subcategories that would gain a parent or move to the other list.
- A label that matches another category with the same parent and list, ignoring case.

## Creating a category

The app picks the new ID from the label with `categoryIdFromText`. If a current or deleted category already has that ID, it adds `-2`, `-3`, and so on. A new "Dining" after a deleted "Dining" therefore gets `dining-2`, and the old transactions do not rejoin it.

A category typed into a review decision or a correction is created in the same staged step as the decision. One undo removes both.

## What a category does in reports

- **Subcategory.** Home's spending by category and Planning count a subcategory toward its parent. Budgets are set on top-level spending categories only. Filtering Activity on a parent also shows its subcategories' transactions.
- **Deleted category.** A transaction whose category was deleted reads as "No category". It gets the review reason `deleted-category` and stays in Needs review until it gets a new category. Its history keeps the old category, because activity events are never rewritten. Reports count it under "No category".
- **Budgets.** Deleting a category, or making it a subcategory, appends a `budget-target` record with a `null` amount for the current month in each currency that has a budget. Earlier months keep their targets. The category record and the budget records are one staged step.

## Limits

**Open:** a prospective rule created before its category was deleted still assigns that category to later imports. Those transactions show in Needs review with "Category was deleted". The Rules page, a later change, disables such rules.

Renaming changes only the label. History, rules, and budgets keep the ID.
