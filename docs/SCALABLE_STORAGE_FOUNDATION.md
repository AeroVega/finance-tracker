# Incremental storage foundation

## Approved scope

**User-confirmed, November 11, 2026:** implement the storage and safety plan and
publish a fresh draft pull request. Storage schema changes are explicitly
authorized when needed, with deliberate compatibility and recovery handling. Preserve exact calculations, transaction
detail, append-only corrections and recovery. Keep a monthly summary tier, with
no stored weekly tier. Work toward connecting the full database using bounded
operations rather than choosing a total database size ceiling.

This milestone uses invented data only. It does not access the owner's workbook
or Drive, merge, deploy, or authorize production use. Production remains
**NO-GO**. The separate owner-created workbook is not an assumed import schema.
The main deployment issue remains deferred until close to Alpha.

## Delivery boundaries

This draft is a foundation, not completion of the full scaling plan. In
particular, an index does not make an incomplete canonical graph safe to pass to
the existing full-ledger validator.

- Immutable catalog generations reuse bounded entry segments. New saves stop
  persisting a complete retained catalog twice. The materialized resolver and
  history checks still require the complete locator inventory.
- Derived monthly summaries are tied to canonical source content. They retain
  transaction detail and use the canonical report arithmetic. A stale or invalid
  derived summary must be rebuilt from verified source records, not treated as
  financial evidence. Cold reopen still validates the complete canonical graph.
- Drive reads enforce finite response limits while bytes arrive. Limits apply
  per transport object or listing page, not to the sum of a database. A larger
  supported legacy object requires an explicit larger finite response profile.
- Direct Drive backup no longer creates and decodes a full portable base64
  archive. It verifies retained history while discarding data payloads, validates
  one complete historical snapshot at a time, then rereads and hashes each object
  for the bounded copy workers. Every admitted copy settles before publication or
  quarantine. Original imports are copied one at a time with their retention
  clocks unchanged.

Format and evidence details:

- [Segmented locator catalogs](SEGMENTED_LOCATOR_CATALOG.md)
- [Drive response bounds](DRIVE_RESPONSE_BOUNDS.md)
- [Canonical monthly index](CANONICAL_MONTH_INDEX.md)

## Backup and recovery limits

The direct Drive copy bounds concurrent payload reads and avoids retaining all
historical data bytes. It still holds catalog entries, commits and journal
metadata. The application validator still needs one complete historical snapshot
in memory. It validates every retained snapshot, which can reread unchanged
objects across revisions. This trades additional reads for lower retained payload
memory and does not establish safe iPhone capacity.

Version-2 portable export and restore remain compatible and still materialize the
whole JSON/base64 archive. A bounded portable file format, staged parsing and
independent interrupted restore are outstanding. No history or original-file
retention policy is shortened to make the measurements smaller.

A destination starts quarantined. Exact source hashes, new physical copy identity,
fresh empty destination, ownership checks, independent destination verification
and an unchanged source manifest remain required. Source changes before the first
destination mutation fail without creating a destination. Failures after copy
preparation preserve quarantine evidence. No automatic destructive retry occurs.

## Compatibility

Legacy catalog version 1 stays readable. A new explicit save can retain its exact
base and append version-2 catalog segments. Older catalog readers refuse the new
root version rather than interpret it as a full catalog. There is no automatic
folder conversion on a read and no history deletion.

Canonical per-record v1 and fragmented v3 remain supported. Standalone grouped v2
remains rejected. The fragment-codec optimization preserves existing bytes.
Derived summaries are separate from financial source records. Readers must not
present a missing month, unresolved evidence or stale coverage as complete.

## Remaining work toward the full plan

1. A separately versioned canonical partition format and validation contract for
   bounded cold open, account/month detail loading, and full-database traversal.
   It must handle cross-period transfers, refunds, corrections and position
   anchors without pretending a partial graph is complete.
2. Incremental changed-group validation and serialization through an owned
   immutable editing session. Current cold validation and several save paths
   still process the complete ledger.
3. Bounded catalog lookup and history verification without materializing every
   retained locator, including a trustworthy rebuild/checkpoint contract.
4. A streamed portable backup format and independent recovery at growing data and
   revision counts, with old archives kept readable.
5. Separate approved production-data boundaries, Google-account and folder
   privacy binding, working-data cleanup, actual OAuth/cost evidence, and live
   synthetic acceptance. An explicit owner decision is required before activation.
6. Physical iPhone/iPad Safari measurements for cold open, warm navigation, small
   corrections, reconnect, export, restore and device handoff.

Existing full-ledger format limits are still compatibility constraints. This
change adds no aggregate database size ceiling and does not claim those old
limits have disappeared. Successful synthetic Node tests do not establish safe
mobile capacity or production readiness.

## Validation record

**Verified synthetic checks:** independent review covered the segmented catalog,
private evidence cache, backup, original retention, streamed transport, monthly
report parity and cache rebuilding. Review found and fixed unfinished retention
intents, changing original inventories, invalid derived-root values and mismatched
physical/logical payload limits. Regressions exercise each case.

The 30-save comparison records catalog uploads of 292,290 versus 7,222 bytes at
save 30, and total folder content of 5,316,264 versus 990,226 bytes. The new path
includes monthly summaries. Warm request counts rise from 167–168 to 209–210;
this is a storage-growth improvement, not a claim of faster saves.

The indexed report benchmark covers 1,008, 4,032 and 8,064 invented activities.
At the largest size, the full-period report median is 100.26 ms through the
canonical reporter and 2.60 ms through the built index. Building and adopting the
index costs additional work, documented in the monthly-index report.

Direct backup growth runs used 5, 20 and 50 revisions with a new 64 KiB invented
payload per revision. They retained 327,920, 1,311,691 and 3,279,241 data bytes.
The lean verifier returned zero retained data-body bytes, validated 6, 21 and 51
complete historical snapshots, and copied all 51, 201 and 501 retained objects
exactly. Source rereads totalled about 1.06, 4.24 and 10.60 MB. These are structural
memory and exactness checks, not heap, Safari or Google latency measurements.

Commands:

```sh
node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
node tests/benchmark-history-reads.mjs --baseline-ref=04aacf31b8aaae31fa73b10408fa22d417c0d943 --saves=30
node tests/benchmark-canonical-month-index.mjs
node tests/benchmark-bounded-backup.mjs --saves=5
node tests/benchmark-bounded-backup.mjs --saves=20
node tests/benchmark-bounded-backup.mjs --saves=50
```

Initial foundation validation on Node 24.22.1 passed **1,217/1,217 tests**, with no
failures, cancellations or skips. Changed JavaScript/module syntax, whitespace
checks and 124 relative documentation file targets passed. An additional focused
transport/backup run passed 56/56 after final fixes.

The [paged storage follow-up](PAGED_STORAGE_MILESTONE.md) records later isolated
format work, active-path byte-ownership fixes and their separate final validation.
The initial 1,217-test count does not cover those subsequent changes.

Live Google, browser rendering and physical-device capacity were not tested.
Remote CI and publication status are separate from these local results. No
merged or deployed state is implied.
