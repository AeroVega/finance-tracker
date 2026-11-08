# Explicit financial-command batches

**Verified locally, November 8, 2026:** `applyFinancialEvents` accepts an explicit ordered command array and returns one immutable ledger proposal. `applyFinancialEvent` keeps its existing single-command API. The invented financial-year generator uses the batch API once per account.

## What changes

The complete input ledger is validated once and cloned once. Each command retains its own event, command signature, ID, timestamp, evidence and prior values. Duplicate command retries remain no-ops, and conflicting reuse still fails. The final ledger is fully validated before being returned.

Commands share transient activity, identity and refund indexes. Every new event passes the existing event-history checks and JSON checks before the next command runs. Refund totals use exact decimal arithmetic and are updated for the affected purchase or refund. A command that temporarily violates a refund cap, amount sign or classification fails immediately, even if a later command would repair the state. No partial ledger is returned on failure.

This is a computational API, not a storage transaction. It does not authorize a command group, save automatically, change how Drive writes commit, or relax recovery and ownership checks. Callers must supply the commands they intend to apply. The only application wiring added here is the existing invented-data recipe.

## Preserved output

Independent review compared 10,000 seeded batch/sequential sequences. The 1,684 successful outputs matched exactly, and the remaining error messages matched. Malformed commands/categories, signature reuse, UUID collisions, empty lists and output isolation were also checked. The review found an error-order issue for an omitted legacy category field; event-local JSON/history validation fixed it before acceptance.

The full synthetic generator result matched the pre-batch implementation for 2000, 2025 and 2099. A permanent test pins the default canonical ledger's SHA-256 to the pre-batch recipe at 0899eaa8ebd425bb515a4870a8b0821d0c53afe6, covering all stored records, order, IDs and command signatures rather than totals alone.

Additional tests cover late-bound refund categories, exact large-decimal corrections, multiple refunds, classification changes, every invalid intermediate state followed by an attempted repair, idempotency, duplicate identities and the single-ledger-clone bound.

## Measurements and limits

**Verified preliminary CPU run, Node 24.22.1:** three-call medians for the whole invented-year recipe fell from 2,737 ms to 326 ms after chronological replay was already applied. An explicit group of 100 classifications fell from 608 ms as separate calls to 7.5 ms as one batch. Entire results matched. Run `node tests/benchmark-event-batch.mjs` for reproducible command measurements.

The batch still holds a cloned ledger, indexes and new events in memory. It validates the full input and output graph. Large inputs still need browser/device memory acceptance. This API does not make dense category membership inventories or retained storage history constant-size.

**Open:** full final integrated suites, browser/device acceptance, live storage acceptance and deployment. Production remains **NO-GO**. No real financial data, live Drive actions, push, merge or deployment was used.
