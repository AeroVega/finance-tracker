# PR36 adversarial review

**Reviewed baseline:** [PR36](https://github.com/AeroVega/finance-tracker/pull/36) at `702861174f6a833df98f2a8e3196ca15e796fb6f`, tree `cf35edaa8028e084dcd014448402eb325ef77455`. This follow-up implements the owner's authorized review improvements. It does not merge, deploy, access live Drive or authorize production persistence.

## Verified findings and corrections

- Closed accounts could hide rejected later source rows that had not become canonical activity. Nonzero holdings on or after closure were also hidden. Both could produce a complete position despite contradictory evidence. Closure now checks these records and preserves incomplete/stale warnings. Future-dated evidence does not alter earlier views.
- Identical corroborating balance evidence changed the selected event ID and invalidated an otherwise unchanged reconciliation or closure. Anchor support now depends on the selected date and exact value while preserving the original reference. Unresolved conflicts and changed values still invalidate support.
- Closure excluded its effective day and chose append order over effective-date order. It now applies on the stated date and uses the latest applicable closure, including when an older closure is entered later.
- Reordered holdings and equivalent exact quantities produced false conflicts. Comparisons now use holding identity, type and exact quantity/value rather than array order or decimal spelling. Real differences still require a recorded selection.
- Optimized activity sessions omitted position-event IDs and command IDs from their indexes. A colliding activity command could publish an invalid graph. The indexes now reserve position identities. Rejection is atomic and later valid editing still works.
- Reconciliation forms offered wrong-date anchors and did not explain missing evidence. Choices now match the required previous and current month ends, with dates, currency and source references shown beside missing-anchor guidance.
- Local form failures could show generic connection advice far from the editor. Position forms now show actionable local feedback and focus errors. Adding/removing editor rows keeps keyboard focus nearby. Switching accounts protects unfinished balance/holdings evidence from accidental reuse. Reconciliation account or month changes ask before clearing unfinished statement evidence; cancellation preserves it.
- Transaction searches rebuilt position controls and repeated full-ledger financial validation. Repeated search, review and pagination now preserve open evidence and typed conflict reasons. A defensive reader caches one position scope and one reconciliation scope, replacing them when the account/date/month changes. New ledger snapshots invalidate both.

Regressions exercise exact values, contradictory evidence, earlier dates, detached cache results, invalid requests, audit-identity collisions, form interaction and cancellation. No storage format or production permission changes were introduced.

## Automated verification

**Verified:** `node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs` passed 1,097/1,097 on Node 24.22.1, with no failures, cancellations or skips. The follow-up adds 23 tests. All changed JavaScript files passed `node --check`; `git diff --check` and 29 changed-document relative links passed.

The suite exercises real financial code and controlled browser/storage adapters. The initial PR head's two Node 26 CI checks passed. CI for the follow-up must be checked on its published commit; these local results do not claim that CI or deployment already ran.

## Performance evidence

**Verified synthetic CPU measurement on Node 24.22.1:** `node tests/benchmark-workspace-position.mjs` uses 3,000 activities, 3,400 activity events, 8 balance events and 4 accounts. It alternates uncached and snapshot-reader modes over five runs, each with five warm repeats, and checks identical outputs.

The combined position and monthly-coverage calculation had a warm median of 175.56 ms without reuse, range 167.50 to 194.66 ms. Cached reads had a warm median of 0.032 ms, range 0.024 to 0.170 ms. Cold medians were 184.98 ms uncached and 286.77 ms including creation of the defensive reader and its first reports. The workspace already needs that reader for activity views. This avoids repeated work; it does not make initial graph loading faster.

These measurements exclude DOM, network, Google and physical devices. They do not establish browser responsiveness or mobile capacity. The UI also skips unchanged position rendering rather than using cached data to rebuild the same controls.

## Remaining acceptance

**Unverified rendered behavior:** Chromium aborted before loading a page with `socket() failed: Operation not permitted`, both normally and during an explicitly permitted escalation attempt. No screenshots or rendered assertions passed. Controller tests are not evidence of actual layout, browser focus behavior or Safari support.

The owner should deploy the reviewed branch themselves, verify its source SHA, then check narrow iPhone and iPad layouts, local form feedback, evidence inspection, search during conflict review, cancelled account/month changes, and the existing synthetic save/reopen/restore/interruption acceptance. Do not repeat live actions blindly after an uncertain save.

Production financial persistence remains **NO-GO**. General provider balance/holdings imports, historical monthly migration and production controls remain outside this review. See [the position contract](../FINANCIAL_POSITION.md) and [Alpha queue](../NEXT_STEPS.md).
