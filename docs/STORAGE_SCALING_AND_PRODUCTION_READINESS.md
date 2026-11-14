# Storage scaling and production readiness

This is the historical November 11 audit based on `04aacf31` and its local
follow-up, before the paged v5 application. Recommendations and commands below
refer to that checkpoint, not current v5 support. Use [current test commands](TESTING.md)
and the [v5 contract](PARTITIONED_CANONICAL_STORAGE.md) for current work. Removed
benchmarks require their historical checkout; these measurements are retained as
evidence, not current regression budgets.

## Status and scope

**Verified November 11, 2026:** this audit starts from main
[`04aacf31b8aaae31fa73b10408fa22d417c0d943`](https://github.com/AeroVega/finance-tracker/commit/04aacf31b8aaae31fa73b10408fa22d417c0d943).
[PR36](https://github.com/AeroVega/finance-tracker/pull/36) is merged. Its description
reports completed owner synthetic and device acceptance. The baseline local Node
24.22.1 suite passed 1,120 tests without failures or skips.

**Production remains NO-GO.** This work uses invented records only. It does not
access the private workbook or Drive, change production permissions, migrate real
data, delete history, publish a branch, merge or deploy. Deployment is deferred
until closer to Alpha. The existing [PR27 requirements](PR27_PRODUCTION_PERSISTENCE_PROPOSAL.md)
and [security contract](SECURITY.md) remain in force. A future real Drive destination
is not authorization to send private financial data there now.

The subsequent owner-authorized implementation is tracked in
[the incremental storage foundation](SCALABLE_STORAGE_FOUNDATION.md). The audit
measurements below describe the pre-implementation baseline, not the new format.

## Historical recommendation

Keep the canonical financial model and fragmented-v3 representation for the next
bounded milestone. Preserve exact decimal values, source evidence, append-only
corrections, explicit reconciliation and verified read-back. Replacing JSON with
a single SQLite file or compressing everything does not solve the measured
catalog/history growth or whole-ledger memory cost.

The next substantial storage change should address catalog generations, bounded
reads and recovery capacity before promising many years of mobile use. A small
codec improvement is useful, but it does not fix those limits.

## What the audited fragmented format did well

- Groups of up to 64 records avoid a Drive file for every record. Immutable
  content-addressed objects let unchanged groups reuse existing bytes.
- Fragmented-v3 supports large imports and rule membership records while capping
  each physical object. Version-1 stores remain readable; standalone grouped-v2
  stays rejected.
- Exact UTF-8, canonical base64/JSON, inventory and hash checks detect malformed
  or substituted data. Base64 is an encoding, not encryption.
- Ownership checks, exact-base checks, immutable journals and independent
  read-back protect interrupted saves. Uncertain outcomes require recovery.
- Private session evidence avoids many repeated downloads but still requires
  fresh file versions and full integrity checks. Reconnect and backup retain
  stronger full-read boundaries.

These are useful guarantees to retain. They are not a promise of unlimited
capacity or server-enforced exclusive access.

## Measured limits

### Save history consumes more than the current records

**Verified with invented HTTP adapters, Node 24.22.1:** one activity followed by
append-only classification corrections, an exact same-session reopen after every
save and final portable verification. The repaired benchmark explicitly uses
fragmented-v3 on both sides of any comparison.

| Saves | Folder files | Catalog files | All folder content bytes | Currently catalogued object bytes | Last save requests | Reopen requests |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30 | 553 | 61 | 5,316,264 | 705,416 | 167 | 10 |
| 80 | 1,453 | 161 | 34,180,300 | 2,749,553 | 208 | 14 |

The larger catalog count matters. Each save writes a full staged catalog and a
full finalized catalog. Each includes the accumulated entries, and previous
catalog files remain in the directory. With a roughly fixed number of additions
per save, total catalog bytes grow approximately with the square of save count.
Folder enumeration also visits those old files. An additional 100-save probe
reached 52,337,335 folder content bytes and 201 catalogs for one activity.

These counts exclude Google metadata, OAuth, browser CORS, retries and periodic
heartbeats. Reopen retains the same lifecycle's verified-byte cache; it is not a
cold reconnect. They do not measure live Google latency. Historical commands
for the audit follow-up based on `04aacf31`:

```sh
node tests/benchmark-history-reads.mjs --saves=30
node tests/benchmark-history-reads.mjs --saves=80
```

The previous benchmark selected removed `chunks-v2`, so it could no longer run
against the audited main revision. The audit follow-up repaired it and prevents a silent comparison
between different storage layouts. The historical request counts in older
performance documents remain historical, not current-v3 budgets.

Source: [catalog copying](../js/drive-locator-catalog.mjs),
[staged and finalized catalog writes](../js/catalog-transaction-engine.mjs),
[benchmark](../tests/benchmark-history-reads.mjs).

### Fragment limits do not bound total memory

**Verified on the changed local code, Node 24.22.1:** serial fresh-process adapter
measurements with exact saved/reopened ledgers and snapshot validation. These are
one run per size, not a timing comparison with earlier machines or commits.

| Invented years | Activities | Physical objects | Physical bytes | Save plus read-back ms | Reopen ms | Peak process RSS MiB |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2,340 | 156 | 8,512,785 | 776 | 327 | 320 |
| 5 | 11,700 | 761 | 42,599,395 | 3,957 | 1,693 | 759 |
| 10 | 23,400 | 1,518 | 85,327,632 | 7,569 | 3,635 | 1,096 |

The ten-year root inventory is 88,211 bytes, below its 128 KiB limit. The complete
graph still consumed over 1 GiB of peak process RSS in this fixture. That includes
runtime, fixtures, multiple ledger representations, temporary bytes and final
validation. It is not an iPhone memory measurement. The 768 MiB JavaScript heap
limit does not cap total process RSS.

The current 128 KiB physical, 16 MiB logical-object and 128 MiB aggregate logical
limits prevent certain malformed inputs. They are not validated safe-device
capacities. Grouping by record count also means a large import or rule membership
can produce many fragments within one group. Retained padding avoids dropping
history but does not reclaim space after a group shrinks.

The historical audit ran `node tests/benchmark-fragmented-storage.mjs` serially. The fixture has 2,340
activities per year and does not model every possible household or investment
history. More years, more accounts, long descriptions, many corrections and
holdings snapshots should be varied independently.

### Reads and backup need their own capacity limits

**Verified from source:** [Drive reads](../js/drive-transaction-engine.mjs) call
`response.arrayBuffer()` before fragment validation. Metadata sometimes includes
size, but it is not an enforced download bound. Catalogs, manifests, journals and
archive inventories lack an end-to-end admission budget. A malformed or oversized
remote file can exhaust memory before later rejection. No destructive OOM test
was attempted.

[History verification](../js/catalog-storage.mjs) still inspects and hashes all
retained objects, journals and ancestry. Its 16 MiB cache caps only cached byte
evidence, not the verification result or browser memory.
[Backup](../js/catalog-backup.mjs) validates every historical snapshot, retains
objects in memory and constructs a base64 archive. Restore builds another decoded
object map. A readable current ledger is insufficient if backup or restore cannot
complete at the same supported capacity.

## Safe preparatory changes in this branch

### Fragment reconstruction

Indexed byte loops replace iterator/callback conversion in the fragment codec.
The format, stored bytes and all canonical rejection checks stay unchanged. New
tests compare base64 output with an independent Buffer oracle and cover Unicode,
fragment boundaries, padding, malformed encodings and retained empty fragments.

**Verified, five alternating runs after warmup, Node 24.22.1:** reconstructing
8,758,548 bytes of invented logical JSON took a median 774.9 ms on baseline main
and 196.5 ms with the change, a 74.6% reduction in this codec operation. Baseline
range was 738.9–809.9 ms; changed range was 161.3–218.1 ms. Complete physical and
logical outputs matched on every run. Encoding ranges overlap, so this audit does
not claim an encoding speedup. No end-to-end Drive or device improvement is proven.

Historical codec comparison command for the audit follow-up, not the current checkout:

```sh
node tests/benchmark-fragment-codec.mjs --baseline-ref=04aacf31b8aaae31fa73b10408fa22d417c0d943
```

### Verified-release token cleanup

The shared `DashboardSyntheticStorage.release()` now clears its access token and
expiry only after release is verified. Previously the main workspace cleared its
token in an outer wrapper, while callers of the shared class could retain a usable
token after release. Failure, unresolved recovery and a newer lifecycle preserve
the credentials needed for recovery. An older release completion cannot erase a
replacement token or renewed authorization lifetime.

This is local token disposal, not revocation of Google's grant or a secure memory
wipe. The current synthetic ledger/draft retention behavior is unchanged. Full
working-data cleanup remains production work.

## Prioritized next implementation

1. **Bound downloads and admitted work.** Add per-kind byte and count limits for
   manifests, catalogs, journals, data objects and archives. Reject excessive
   declared sizes early, then enforce a streamed byte cap even when Content-Length
   is absent or false. Cover error bodies and listings too. Forecast aggregate
   save, history and backup cost before durable mutation. Keep already-admitted
   recovery possible; a new cap must not strand an existing valid copy.
2. **Stop copying the full catalog on every save.** Design a versioned segmented
   immutable catalog with a small root and bounded checkpoints. Reuse unchanged
   segments and preserve every history/recovery reference. Consider commit deltas
   plus periodic verified snapshots separately. Do not delete older catalogs or
   financial history as an ad hoc optimization. Migration needs a verified backup,
   a fresh destination, old-reader refusal where needed and failure injection at
   every durable boundary.
3. **Reduce whole-ledger work.** Track changed groups through an owned immutable
   session so one edit does not reserialize every record. Build account/month/year
   report indexes as derived data. Partial reads need a new explicit validation
   contract; do not feed incomplete graphs to today's full-ledger validator.
   Cross-year transfers/refunds, opening balance anchors, holdings selection,
   corrections and missing coverage must still resolve correctly.
4. **Make backup practical at the supported capacity.** Evaluate bounded/staged
   archive processing and exact verification without retaining every encoded and
   decoded representation at once. Test backup, independent restore and interrupted
   restore with long save histories, not only a large current snapshot.
5. **Set capacity from device evidence.** Measure cold open, warm save, small edit,
   full reconnect, backup and restore on iPhone/iPad Safari. Record wall time,
   failures, request/byte counts and memory where measurable. Choose a supported
   record/history budget and a visible refusal/recovery path before GO.

Compression may reduce bytes later, but adds decompression bounds and portability
work. A single SQLite/IndexedDB replacement adds synchronization or local-retention
decisions and does not by itself remove Drive's whole-file and recovery costs.
Neither is the next fix supported by these measurements.

## Production gates still open

- **Production-capable data boundary:** the current canonical and storage engines
  intentionally require `syntheticOnly`. Inventory the ready feature records,
  implement a separate approved production path and keep synthetic test tools
  unable to select it. Do not replace the flag globally.
- **Designated account/database:** verify the authenticated Google account, granted
  scope, designated database/copy and intended folder privacy. Current folder
  admission verifies type and synthetic name, not the designated account or
  sharing permissions. Revalidate on reauthorization; session ownership is not
  Google-account ownership. Keep private identifiers out of public configuration.
- **Working-state cleanup:** after consent and verified drain/release, clear loaded
  ledgers, baselines, staged history, report caches, form contents and rendered
  financial data. Test cancellation, failure, page restoration and reference
  retention. Preserve recovery metadata and explain abrupt-close/device-loss
  limits instead of promising a secure wipe.
- **Browser and distribution privacy:** inspect actual storage, caches, network
  requests, diagnostics and the final production artifact. Use an explicit
  artifact allowlist when production release work resumes; today the workflow
  uploads the repository root with development prototypes.
- **Actual OAuth/cost evidence:** inspect audience/status, requested and granted
  scopes, API restrictions, quotas, usage, billing and current terms. Preserve the
  current planning position, "no blocking configuration change identified".
  Formal Google app verification must not be assumed necessary merely because
  actual configuration review is unfinished.
- **Recovery acceptance for the new path:** live invented-data expiry, denial,
  revocation, reauthorization, save/reopen, interruption, portable restore and
  sequential device handoff. Existing crash-injection tests are strong evidence
  for their tested path, not automatic acceptance of a future production path.
- **Retention/backup choices:** verify the original-file deletion-receipt limit
  and 540-day source retention/restore rules. Define routine backup cadence,
  tolerable loss and rotation after OAuth verification, as already decided.
- **Owner decision:** review residual risks and evidence, then record explicit
  production activation authorization separately from publication/merge/deploy.
  No separate real-data smoke test is required by the existing decision.

The synthetic 2023–2026 workbook can support the importer while these controls are
built. Its monthly summaries must remain separate from transaction detail, with
exact reconciliation, workbook/worksheet/month provenance, visible missing or
ambiguous values and idempotent import. A later real conversion must preserve the
original workbook and use only the approved private destination.

## Verification and release record

Baseline full suite: 1,120/1,120 on Node 24.22.1. Final changed application/test
suite: **1,128/1,128**, with no failures, cancellations or skips, using
`node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs`.
Independent focused recovery, history and backup tests passed 88/88. The fragment
codec and shared-release changes received separate code review. Changed module
syntax, relative documentation file targets and `git diff --check` passed.

Live Google, browser/device capacity and the production-capable path were not
tested here. No remote branch or PR has been published and nothing was merged or
deployed by this work. Nothing in this report lifts NO-GO.
