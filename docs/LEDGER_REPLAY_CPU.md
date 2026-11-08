# Chronological ledger replay

**Verified locally, November 8, 2026:** Validation and projection now share an operation-local chronological replay. They still validate every ledger record, event and reference. No stored format, financial policy, audit history, storage protocol or production gate changed.

## Design

The previous validator replayed every earlier event for each event's prior-value check. Projection then scanned the full event list again for each activity. A single classification history therefore incurred quadratic event visits even when it only changed one activity.

The new validator checks each event against the current indexed state, then applies it once. Reports and effective-activity views consume that same validated result. Import reconciliation and run refresh also reuse one projection per operation. Nothing is cached across calls, stored on the ledger or trusted after the input changes.

A refund's category remains a reference to its original purchase until a later category assignment overrides it. This preserves later purchase-category corrections and prefix-specific history checks. The replay retains all refund dependency edges for cycle checking, even if a later category assignment overrides the displayed category. Dependency checks are invalidated for affected ancestors when a link is added.

Prospective category rules use an index of immutable rule fields and a membership Set. Key fields have a fixed order and preserve the previous canonical JSON equality, including legacy structured source actions and reordered saved JSON. Existing activity membership stays explicit. Old full-ledger memberships and newer scoped memberships both remain readable without rewriting.

Financial arithmetic is unchanged. Projections return independent values, and accepted activities with omitted optional category fields retain that shape.

## Verification

- The 92 existing canonical/category focused tests passed after the change.
- Six additional regression tests compare a separate scan/recursive reference, exercise prefix prior values, exact decimal corrections, prospective backdated imports, linked refund overrides, cycles, independent output objects and changed input between calls.
- Operation-count tests require linear event-type reads for validation, projection and summary, including one activity with a long event history.
- Independent review compared 63,846 generated projections and 5,000 validation cases, including 1,784 accepted ledgers. All matched after fixing one omitted-category-field compatibility issue.
- A reproducible benchmark compares entire outputs against an optional baseline module. Its multi-year fixture combines separately generated invented financial years across the same four accounts, with original source observations, classifications, corrections, transfers, refunds and unknown investment lifecycle exclusions.

Run `node --test tests/canonical-event-replay.test.mjs` and `node tests/benchmark-ledger-replay.mjs /path/to/baseline/js/canonical-import.mjs`. The baseline module must retain access to its matching dependencies. Without an argument the benchmark measures only the new implementation.

**Verified preliminary measurement:** On Node 24.22.1 with 1,000 activities and 6,000 classification events, three-call medians were validation 349 to 19 ms, projection 407 to 30 ms, summary 469 to 24 ms, and one classification 781 to 75 ms. Each result matched the baseline. These are invented in-memory CPU measurements, not browser, device, Drive or end-to-end guarantees.

## Remaining costs and limits

Every public operation still validates the complete graph. Mutating operations still clone it. Repeating hundreds of commands therefore repeats that linear work. A separate batch API can address this only if each intermediate command retains the same financial constraints and ordered audit output.

Category replay still visits matching peers per rule. Dense same-key memberships still cost memory and bytes, and the existing chunk cap remains unchanged. Deep refund dependency graphs also require work proportional to their affected dependencies. No claimed speedup removes these limits.

**Open:** Full integrated suites, browser/device memory and CPU measurements, and any deployment or live acceptance. Production remains **NO-GO**. No real financial data, live Drive use, push, merge or deployment was used for this change.
