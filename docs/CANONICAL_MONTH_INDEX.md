# Canonical monthly index and summaries

**Implemented and verified with invented data only.** This adds account/month
lookup and exact monthly summaries to the existing canonical store and workspace.
Production persistence remains **NO-GO**. No live Drive, real financial records,
merge, or deployment was performed for this change.

## Source and derived data

`js/canonical-month-index.mjs` owns a defensive, fully validated canonical
snapshot. It indexes active activities by account and reporting month, preserves
original activity order for report exclusions, and precomputes exact decimal
income, spending and cash subtotals by currency. The existing canonical report
and this index share `reportActivityContribution`; classification, card cash
exclusion, transfer treatment and refund rules have one implementation.

The index is rebuilt after a changed ledger. The workspace accepts an existing
index only if it is an instance created by this module and its owned snapshot
exactly matches the new ledger. Caller/result mutations cannot poison it. Scope
changes reuse the owned index; they do not revalidate/replay the canonical graph.
Full-month reports add monthly totals. Partial boundary months inspect their
underlying activities. Undated refunds remain excluded in every affected account
period. Refunds with a known posting date stay in that month, including across
year boundaries. Search and review filters still affect rows, not totals.

Every summary remains `complete: false`, includes report qualifications and
separate availability flags, and has no account-balance field. Empty or excluded
activity is not proof of complete zero spending. Dated balances and reconciled
coverage continue through the existing financial-position engines. Monthly
summaries are derived from canonical detail, not imported historical workbook
summaries. No weekly tier is stored.

## Storage and recovery

Explicit canonical saves include an optional, version-1 derived root at
`synthetic/canonical-month-index-v1/root.json`, with groups of at most 64 compact
monthly summaries under `groups/`. Full transaction, source and append-only event
detail stays in the existing canonical layout. Unchanged summary groups keep the
same bytes and are omitted from the transaction's changed objects. Corrections
change their affected summary group and source-bound root. Rebuilding the index
still examines the full ledger; this is not incremental mutation tracking.

The root binds the summaries to a SHA-256 fingerprint over canonical object
paths and exact object contents, not just a revision number. Reopen derives the
summaries from the validated source and compares the complete expected root,
partition inventory and group bytes. A source-hash match alone is insufficient.
Wrong versions, reordered/missing partitions, forged totals with recomputed
hashes, malformed Unicode and non-finite JSON numbers rebuild the derived index.
Transport, storage-hash and ownership failures still propagate from the lifecycle.

Rebuild is local and read-only. Only a later explicit save repairs optional
sidecar bytes. The same transaction protocol commits canonical changes and
summaries together. Failed or uncertain writes retain the existing recovery and
verified-reopen requirements. Optional derived state cannot validate or replace
canonical history. Backups retain its bytes and canonical reopen reconstructs it.
No total-database cap is introduced by this module.

Old records-v1 and fragmented-v3 copies need no migration to open. Their first
explicit save adds the optional summaries. The canonical schema is unchanged.
At the canonical-module level, older readers ignore these noncanonical sidecars
and can leave summaries stale. New readers then rebuild them. This does not mean
an old application can open a newly saved copy: the separate version-2 catalog
root is deliberately rejected by old storage readers. Older backup application
validators also reject unknown sidecar paths rather than silently omitting them.
Use the updated application for opening, saving, backup and restore after a new
catalog write. See [catalog compatibility](SEGMENTED_LOCATOR_CATALOG.md). Existing standalone grouped-v2 refusal
is unchanged.

## What remains whole-ledger

Cold open, canonical validation, event replay, source fingerprinting, persisted
summary verification, save serialization and post-save readback still process the
whole canonical source. An index built during reopen can be adopted by the
workspace, but exact source comparison and defensive copying also have a cost.
The change improves subsequent views in an open session, not cold Drive loads.

The workspace still creates the complete selected row set before pagination;
search over the full saved period therefore visits all selected rows. Returning
all report exclusions also scales with the requested exclusion output. The
summary-only query omits that per-activity output and uses each month's cached
reason representatives. Position and reconciliation calculations retain their
existing whole-ledger behavior. Partial remote canonical reads and incremental
owned-session mutation remain separate work.

## Verification

Focused tests cover exact report parity, partial dates, currency/account scopes,
unknown and pending evidence, inactive decisions, cross-year refunds, decimal
fallback beyond safe integers, source/result mutation, source revisions, bad
partitions and forged hashes, missing/stale caches, explicit repair, legacy
layouts, save/reopen, repeated seeding and synthetic preview counts. Existing
canonical tests inject interruption at every durable write boundary. Independent
review also compared 120 varied reports and 25 workspace views to the canonical
reference and checked detached results.

Run:

```sh
node --test tests/canonical-month-index.test.mjs tests/canonical-packed-storage.test.mjs tests/synthetic-year-seeder.test.mjs tests/synthetic-year-ui.test.mjs tests/canonical-workspace-scale.test.mjs
node tests/benchmark-canonical-month-index.mjs
```

**Verified local CPU benchmark, Node 24.22.1, Linux, three runs per size.** Medians
below are milliseconds. The benchmark checks complete report equality, alternates
measurement order, records all runs and reports min/max. The synopsis omits the
per-activity exclusion list, while the ordinary canonical API builds that list.
Warm month view timing changes the selected month after preparing account metadata.

| Activities | Build index | Adopt workspace index | Canonical full report | Indexed full report | Monthly synopsis | One-shot month view | Warm month view |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1008 | 35.24 | 80.50 | 12.79 | 1.60 | 1.44 | 39.39 | 0.52 |
| 4032 | 138.34 | 282.54 | 44.87 | 1.91 | 1.47 | 100.92 | 0.54 |
| 8064 | 276.02 | 566.96 | 100.26 | 2.60 | 1.69 | 229.05 | 0.52 |

Each workload has four invented accounts, 96 declared months per account and
increasing activity/event history. Summary-only reports visited 384 monthly
buckets at each size and 18, 72 and 144 cached exclusion representatives,
respectively. A separate 1,000-activity valid-month regression proves zero detail
visits for a full-period synopsis after indexing.

The benchmark excludes source hashing, persisted verification, Drive, DOM and
browser memory. The slower setup costs are shown, not hidden in the warm numbers.
Concurrent local work may affect timings. No iPhone/iPad capacity, live-service
latency, production suitability or cold-open improvement follows from these data.
