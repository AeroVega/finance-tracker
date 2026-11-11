# Segmented locator catalogs

## Scope and compatibility

**User-confirmed, November 11, 2026:** stop rewriting retained catalogs on every
save, keep history, and permit storage schema version changes. The implementation
and tests use invented records and in-memory or invented HTTP adapters. Production
persistence remains **NO-GO**. No live Drive actions, merge or deployment occurred.

**Implemented:** new explicit catalog writes use locator catalog version 2. The
manifest and logical commit formats remain version 2. Existing catalog version 1
is readable without a migration write. The first save with new bindings points to
the exact unchanged version-1 catalog as its base, then appends segments. No old
catalog, object or journal is deleted or rewritten.

Old builds only understand a version-1 catalog map. They reject the new root
version. After an explicit save, use the updated build or restore into a fresh
copy through the supported recovery workflow. Do not point the manifest back to
an older generation to make an old build open it.

## Stored format and publication

A version-2 root contains `databaseId`, `copyId`, `generation`,
`parentCatalogHash`, `entryCount`, `segmentCount`, `segmentTip` and `legacyCatalog`.
The tip and optional legacy base are exact `{fileId, sha256}` pointers. The root
contains no locator entries and no growing list of segment pointers. Its encoded
size is limited to 16 KiB.

Each immutable `finance-tracker-locator-segment` version-1 object contains the
same database/copy identity, its generation, an absolute sequence number, the
previous segment's exact pointer and a map of new entries. Segments contain at
most 128 entries and 64 KiB of encoded bytes. One large addition batch can create
as many segments as needed. These are per-object limits, not a total database or
history ceiling. A locator too large for one segment fails safely.

A save reuses the old segment tip and writes only new segments plus one root.
Existing identities cannot be rebound to another physical ID, hash or journal
binding. Identical additions reuse the current root without a new generation.
The root preserves the exact previous catalog hash. Previous root files remain
untouched. As with version 1, the current manifest anchors the selected root;
opening does not recursively validate every abandoned root generation.

The public lookup API still returns a version-1-shaped materialized entries map.
That representation is not the persisted version-2 root. Private provenance binds
it to the exact stored pointer and content fingerprint. A changed, cloned or
wrong-pointer materialized map cannot silently extend a segmented prefix.

The one-new-object transaction now has 16 durable writes instead of 14. Each
previous catalog write becomes a segment followed by a root. The financial
manifest publication still follows verified staged objects, journals, commit,
segment and root. The second segment/root pair includes the publication intent
and terminal journals before the catalog-only manifest update clears the pending
marker. Revisions, ownership checks and exact-base manifest checks are unchanged.

## Verification and reusable session bytes

Opening traverses the segment chain iteratively. It checks exact bytes, Drive
folder/kind/hash bindings, database/copy identity, consecutive segment numbers,
ordered generations, counts, repeated segment IDs, duplicate logical identities
and physical-ID collisions. It then verifies complete retained history through
the existing commit/journal verifier. Segments cannot masquerade as retained
protocol objects.

The session history verifier may reuse segment bytes only after a successful
complete verification downloaded and checked them. Upload payloads and public
lookup objects do not populate that cache. A fresh metadata batch checks the
exact bindings and Drive versions before reuse. Reused bytes are copied and
hashed again. A second fresh metadata batch must still match before verification
can succeed. Newly cached bytes receive the same closing version check. Bad
metadata, a missing segment, a changed version or corrupt bytes fails closed.

Segment evidence shares the existing 16 MiB/20,000-entry payload budget with
retained-object evidence. Exceeding the budget causes uncached reads, not data
loss or a database-size refusal. Scope changes, offline/release/error transitions,
explicit reconnect and clear-during-read races use the existing invalidation
rules. Public `readCatalog`, standalone history verification and backup paths do
not reuse session evidence. The current root is always fetched from Drive.

Google folder listings are not atomic and the session marker is not a
server-enforced lock. These changes do not claim otherwise.

## Failure behavior

**Verified with synthetic fault injection:** page loss at all 16 transaction
writes, warm-cache interruptions at all 16 writes, and repeated interruption of
recovery repairs resolve to the prior or intended whole state. A multi-segment
write interrupted before root/manifest publication leaves the original manifest
authoritative. Unpublished segments and roots remain evidence, not instructions
to delete or automatically adopt files.

Tests cover old-format reads and explicit upgrades, new root/segment bytes,
folder and kind mismatches, missing segments, wrong copy/sequence/generation,
declared counts, cross-segment duplicate identity and file IDs, altered
materialized prefixes, shared cache limits, changed segment versions, closing
version brackets and invalidation. No test skips exact historical payload hashes
or journal/commit ancestry.

## Growth measurements

**Verified locally on Node 24.22.1:** `node --test tests/catalog-segments.test.mjs`
measures actual segment/root upload content. Appending one invented binding to
10, 100 and 1,000 retained bindings writes 883, 887 and 892 bytes. Serializing the
corresponding complete legacy catalogs would write 2,398, 20,401 and 203,104 bytes.
Small increases come from decimal counts and invented ID lengths. This isolates
catalog content bytes, not provider metadata, latency or mobile memory.

The integrated synthetic HTTP comparison uses the same 30 one-activity,
fragmented-v3 checkpoints and verifies exact reopen after every save:

`node tests/benchmark-history-reads.mjs --baseline-ref=04aacf31b8aaae31fa73b10408fa22d417c0d943 --saves=30`

The current run also includes the monthly index/summary and transport changes in
this draft. It is not an isolated timing comparison of segmentation alone.
At save 30, catalog write content falls from 292,290 to 7,222 bytes. Total folder
content after 30 saves falls from 5,316,264 to 990,226 bytes, with no pruning.
The baseline retains 490 protocol objects; the new path retains 586 because its
monthly summary/index files add verified objects.

The tradeoff is additional requests. Baseline saves 2–30 use 167–168 requests;
the new path settles at 209–210 after the first two saves. Same-session reopen
uses 12 requests instead of 10. The extra segment writes and fresh metadata
brackets cost requests even while avoiding history-sized upload content. The
counts include the real application/session adapters against invented HTTP,
not Google latency, quota behavior, CORS or physical-device measurements.
Inspection reads in the benchmark run outside the measured save/reopen phase.

## Remaining limits

Full catalog materialization, fingerprints, resolver construction, journal
verification and commit ancestry still scale with retained history. Warm cached
segments are parsed and checked again; this change does not create a persistent
bounded lookup tree or an incremental history proof. Cold reconnect downloads
all referenced catalog segments. Folder pagination grows with retained files.
Once session evidence no longer fits, more payloads are downloaded again.

`verifyCatalogHistory(..., {retainDataObjects:false})` drops each verified data
payload after its bounded worker completes while retaining protocol metadata for
ancestry checks. It does not cap catalog/commit/journal memory or the application
validator's largest complete snapshot. Portable JSON/base64 export still needs a
separate streamed format. These limits remain work, not a claimed scalable
production database.
