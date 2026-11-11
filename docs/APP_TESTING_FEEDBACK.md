# App testing feedback follow-up

## Scope

**User-confirmed:** the owner deployed PR37 at
`5e9c8966ddda10161f18d5483ff579a8a09e534a` and reported a save taking about three
minutes after two edits to one review item. Posting-status warnings had no
correction control, and the seeder's v3 label conflicted with expectations for
the experimental paged format. The owner requested fixes in the application and
a new commit on PR37.

This follow-up is synthetic-only. It does not deploy the branch, use live Drive,
import the separate workbook, or authorize real financial data. Production
persistence remains **NO-GO**.

## Storage format shown in the app

**Implemented:** the Storage page reports the last verified copy's actual
format. A local preview has no saved format yet. New copies use fragmented v3,
and existing per-record v1 copies remain readable. Release clears the verified
format display. No folder is silently converted.

The seeder and Storage page explain that paged v4 is an experimental module,
not an app storage option. Monthly summaries are available on the active path,
but opening still verifies and loads the complete canonical ledger. Selective
loading, bounded complete semantic verification and migration remain unfinished.
A schema version identifies a file format, not the app release.

The seeder now links to the main workspace for browsing and corrections. Its
preview reports the actual storage-object count instead of a stale fixed count.

## Resolving unknown posting status

**Implemented in the app:** open an unknown activity to select **Posting status**
in its correction editor. Choose Posted, Pending or Unknown. Posted requires an
explicit calendar posting date, and every correction needs an explanation.
The app does not infer a date or mark all invented activities posted.

Stage the correction, inspect its prior and new status/date in the history, and
save explicitly. Original activities and source observations remain unchanged.
Resolve classification and any other review reasons separately. Correcting
posting status alone does not prove account coverage or a balance.

Manual confirmation survives re-import. Conflicting source status goes to
review, and an identity match cannot silently undo the user's correction.
Refunds use the corrected posting period; ordinary activities keep their
effective transaction period. Monthly summaries are rebuilt consistently.
See [the event contract and app workflow](POSTING_STATUS_CORRECTIONS.md).

This adds an event type without changing the physical v3 layout. Builds from
before this change reject a ledger containing the new event. They do not
silently ignore the correction. Existing ledgers without it remain readable.

## Baseline reproduction

**Verified with synthetic HTTP:** the 253-activity invented year contains 48
activities with unknown posting status. Classifying an invented brokerage fee as
spending and assigning its category leaves the posting warning unresolved in the
reported build.

One save of those two edits made 209 simulated HTTP requests: 56 folder lists,
32 metadata reads, 95 media reads, 23 creates, two updates and one generated-ID
batch. Peak read concurrency was four; durable mutations remained serial.
Three runs without injected delay took 289–403 ms. One run with 20 ms added to
every request took 4.31 seconds. These are controlled local measurements, not
live Google timings. They demonstrate request amplification but do not establish
that it alone explains the owner's three-minute observation.

## Reducing save requests

**Implemented on the active app path:** bounded private reuse of exact-ID write
readbacks, shared opening/closing metadata checks and version-checked session
records reduce repeated downloads. Full history, hash, ownership, expiry and
recovery checks remain. Cache entries cannot be supplied as raw caller bytes,
and no financial data is persisted to browser storage.

The same two-edit save now uses 132 requests, down from 209. All 25 durable
mutations remain. Across three alternating baseline/current runs with 20 ms
injected per request, median save time fell from 4.445 to 3.066 seconds. This is
a local proxy, not measured Google performance or a guarantee that a live save
will take that long. The separate 30-save workload retains the same 586 history
entries in both versions. Nothing is pruned.

The [measurement and safety report](ACTIVE_SAVE_REQUESTS.md) records request
breakdowns, ranges, repeatable commands, corruption and recovery checks, and the
remaining full-folder/history costs. Selective loading and the larger storage
integration plan remain unfinished.

## Verification and remaining acceptance

**Verified:** 99 combined posting-status, full synthetic HTTP, workspace UI and
seeder contract checks passed on Node 24.22.1. The HTTP scenario saves and cold
reopens the corrected ledger through the real lifecycle, transaction and catalog
code, then independently verifies the portable archive's retained history.
The old deployed validator accepts the original fixture and rejects the new
event. The final combined CI-equivalent run with `FINANCE_EXTENDED_STORAGE_TESTS=1`
passed **1,507/1,507** tests with no failures, cancellations or skips in 262.288
seconds. Source, test and workflow hashes stayed unchanged throughout the run.
Independent reviews found and cleared cache admission, metadata-bracketing and
session-marker identity defects before this aggregate run.

**Open:** live synthetic save latency, iPhone/iPad interaction and recovery
acceptance for these changes. Local rendered-browser validation could not run in
the execution environment; controller tests are not Safari/device evidence. A successful code
commit or CI run does not prove deployment or live Google behavior.
