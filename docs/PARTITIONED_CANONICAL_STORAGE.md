# Partitioned canonical storage

## Scope and status

The synthetic application supports canonical v5 only through the existing paged
store and lifecycle. New copies, saves, reopen, recovery and backup/restore use
v5. Older canonical copies, archives and initialization markers are refused and
preserved. No new migration or older canonical writer path is offered. Existing
v5 copies created by earlier migrations remain supported; their embedded legacy
provenance is audited read-only.

The application still materializes the complete ledger for financial validation
and editing. Coalesced tree updates do not establish bounded whole-ledger memory
or selective cold opening. See [project status](PROJECT_STATUS.md) for dated
verification and publication evidence. Live Drive/device and performance
acceptance remain separate gates. Production persistence remains NO-GO.

Related boundaries are in [the storage foundation](SCALABLE_STORAGE_FOUNDATION.md),
[monthly index contract](CANONICAL_MONTH_INDEX.md),
[segmented catalogs](SEGMENTED_LOCATOR_CATALOG.md) and
[immutable page trees](IMMUTABLE_PAGE_TREE.md).

## Stored source and derived data

Every object is addressed by its exact lowercase SHA-256 hash. The store contract
is `read(hash, {signal, maxBytes}) -> Uint8Array` and
`write(bytes, {signal}) -> hash`. Readers hash owned copies of returned bytes.
Writers check the returned hash and exact readback. Adapters must enforce the
response byte profile before allocating a complete response. A post-read check
cannot undo an oversized transport allocation.

The v5 root is canonical JSON with exactly six fields:

```json
{
  "format": "finance-tracker-partitioned-canonical",
  "version": 5,
  "syntheticOnly": true,
  "source": "<64-character source hash>",
  "derived": "<64-character derived hash>",
  "valueCodec": "compact-json-v1"
}
```

The codec tag requires source and derived version 2. Unknown tags, mixed codec
versions, extra root fields and older root versions are refused. Canonical v4
used untagged source/derived version 1 or tagged version 2, but neither v4 profile
is a current reader or writer path.

Codec 2 may store an exact JSON value inline when it fits 4,096 UTF-8 bytes and
24 nesting levels. Larger values retain paged fallback. Source fields and absent
properties remain exact. Inline handles are deeply frozen, and cursors bind the
specific value. The application uses locator catalog 3, physical root protocol 4
and framed archive 3. The `canonical5-physical4` profile uses canonical
descriptor version 5, physical protocol 4 and `catalog: null`. Source-evidence meaning is unchanged.

It has no per-record, partition or object inventory. The historical v4 root
measurement was 236 bytes regardless of fixture size; it is not a v5 measurement.
The source root contains a metadata value descriptor, a collections-tree hash, and exact decimal-string event and position
event frontiers. Each collections-tree entry contains its identity-field name,
by-ID tree hash, order-tree hash and decimal-string count. The seven current
collection names come from the existing canonical storage contract:

- accounts, imports, observations and activities
- events and reviewDecisions
- optional positionEvents

An absent optional collection remains absent, rather than becoming an empty
array. Collection order, source IDs, import provenance and event order reconstruct
exactly. Known collections cannot hide in metadata. Unknown collection names,
unsupported root/source/derived versions, duplicate identities, wrong frontiers,
and inconsistent order/counts fail validation. Existing extra JSON evidence and
own properties such as `__proto__` remain data. Future collection support requires
an explicit schema implementation, not silently ignoring unfamiliar history.

The order key is the decimal digit count encoded as that many `a` characters,
followed by `:` and the decimal ordinal. For example `a:9` precedes `aa:10`.
There is no fixed-width sequence number that wraps at a chosen frontier. V5
bookkeeping counts and frontiers are exact unsigned integer strings. Existing
source fields retain their original types because the canonical validator and
source roundtrip require that representation.

## Paged values and membership

A record is a value descriptor, not an arbitrarily large JSON object in a leaf.
The value format has three tree-backed forms and one scalar form:

- `{kind: "scalar", value}` for null, booleans, finite numbers and short strings
- `{kind: "array", root, count}` for ordered array membership
- `{kind: "object", root, count}` for ordered object fields
- `{kind: "string", root, count, codeUnits}` for longer strings

Array entries map exact ordinals to child descriptors. Object entries map exact
ordinals to `{key, value}` descriptors, sorted by the property name in JavaScript
UTF-16 order. Long property names are chunked too. Objects reconstruct with own
property definitions, never prototype-changing assignment. Strings split into
at most 1,024 UTF-16 code units per chunk without splitting a surrogate pair.
Malformed Unicode is rejected.

In the original value codec, every array uses paged membership, including import `observationIds` and
`retryAttempts`, review `existingEventIds`, category-rule `existingActivityIds`,
holdings, conflict candidates and reconciliation components. Empty arrays stay
distinct from absent properties. The implementation does not hide one unbounded
record behind a by-ID key.

All stored objects are at most 64 KiB. Tree nodes contain at most 128 entries or
children. Those are per-object limits, not a total database ceiling. Source IDs
and composite index keys fit the tree's finite key profile. The in-memory
converter accepts JSON nesting through 128 levels and rejects cycles, accessors,
sparse arrays, extra array properties, hidden properties, symbols, non-JSON
objects and non-finite numbers before asynchronous writes. It takes an owned
snapshot so caller mutation during a write cannot change later source fields.

The compact extension may inline these arrays only within its stated byte/depth limits.

There is no promise that JavaScript can assemble a string, record or ledger of
arbitrary size. `pageValue` exposes string chunks and membership directly.
`materialize` is a separate convenience with explicit value/string budgets.

## Derived monthly queries

The derived root names its exact source-root hash and three trees:

- effective activities by activity ID, including inactive history projections
- active account/month membership by account ID, report month and source ordinal
- monthly summaries by account ID, month and currency

Refunds use their posting date for reporting, including cross-year refunds.
Undated refunds use a separate account-wide membership range appended to each
selected month. Other activities use their effective date. The reference builder
uses the existing month index and financial helpers, with exact decimal amounts.
It does not derive a balance from spending or cash totals. Summary eligibility
counts use decimal strings. Summaries retain availability and qualification
flags and remain `complete: false`. An unindexed month returns `not-indexed`,
never a fabricated complete zero.

Membership and totals are rebuildable derived data. A matching source hash only
states which source they claim to describe. It does not prove that a row was not
omitted or a total was not forged. The tests recompute all hashes after changing
totals, deleting membership and altering effective amounts, then verify that
these roots cannot gain semantic verification.

## Reader API and verification states

`buildPartitionedCanonicalLedger(ledger, store, {signal})` snapshots and validates
a complete invented ledger, then returns `{rootHash, sourceHash, derivedHash}`.
It does not publish that root or modify the default application format.

`createCanonicalPartitionReader(store, rootHash, {signal})` reads only the top,
source and derived headers. The read-only reader provides:

- `getRecord(collection, id)` and `pageCollection(collection, {limit, cursor})`
- `pageMonthActivities({accountId, month}, {limit, cursor})`
- `getMonthlySummary({accountId, month, currency})`
- `pageValue(handle, {limit, cursor})`, `field(handle, name)` and
  `materialize(handle, {maxValues, maxStringCodeUnits})`
- `fullAudit({maxRecords, maxValues, maxStringCodeUnits, signal})`

All asynchronous methods accept cancellation. Page limits are 1 through 128.
Record, summary and month-detail methods return private root-bound value handles.
Cloned/foreign handles are rejected. Cursors bind the top canonical root and the
query, not just a reusable leaf tree. Cursor and source changes require a new
query. Caller-supplied `trusted` options are rejected.

Query results include the pinned root and verification states:

- `bytes: "visited-hashes-and-shapes"` describes the objects actually read. It
  says nothing about unread membership, financial validity or storage ownership.
- `source: "not-semantically-validated"` remains until a complete source passes
  the existing `validateLedger` oracle.
- `source: "full-ledger-validated"` means that complete reconstructed source
  passed. It is not a storage-transaction or retained-history proof.
- `derived: "not-semantically-validated"` is the cold query default.
- `derived: "semantic-verified"` requires complete source validation, exact
  ordered logical key/value comparison against the complete financial oracle.
  Verification reads every referenced derived page and nested value to verify availability and contents.
- `derived: "invalid"` means the reconstructed source passed but derived content
  differed. Queries keep that warning. An audit does not repair remote bytes.

The reader exposes unverified results for inspecting this format. The application
gates financial presentation on complete semantic and storage verification.
Hash/shape verification alone is insufficient.

`fullAudit` is a reference audit for bounded fixtures. It retains the entire
reconstructed ledger, calls the existing full-ledger validator and retains
complete expected logical entries. It reads some nodes more than once. The default
`maxRecords` is 100,000 across source collections. `maxValues` and
`maxStringCodeUnits`, by default 1,000,000 and 4,000,000, apply to **each value
expansion**, including each record, not to total retained audit memory. These are
operation budgets which callers can set explicitly, not storage capacity claims.
A budget failure during source assembly cannot validate a partial ledger. Only
one audit may run per reader at a time.

## Coalesced v5 saves

The v5 root has exactly `format`, `version: 5`, `syntheticOnly: true`, `source`,
`derived`, and `valueCodec: "compact-json-v1"`. Source and derived stay version 2
with their existing exact fields. No future relation roots are stored. The
registered verifier is `canonical-partitions-v5`. Different valid derived tree shapes
can pass v5 only when every ordered key and fully decoded value matches the full
oracle. Counts, omissions, extra membership and missing nested bytes are checked.
The existing unsupported linked-refund/undefined-field case remains refused.

`updatePartitionedCanonicalLedger` compares the owned complete input with its
verified base. It uses one ordered, unique `updateMany` batch per changed by-ID,
order or derived tree and reuses unchanged record descriptors and roots. Fresh
builds use the same writer with an empty base. Before publication the application
independently audits the final root through prepared/base reads and submits only
new final-reachable data objects absent from the retained locator. This filters
unpublished preparation only. Historical objects and protocol evidence remain.

Initialization marker 2 pins `canonicalProfile: "partitions-v5"`. Older markers
are refused. The shared empty-root sentinel does not authorize changing profiles.
Saves, cold reconnect and restore never convert an older canonical copy. Preserve
unsupported copies and use a fresh empty synthetic folder for new v5 data.

Locator catalog 3 and physical protocol 4 remain unchanged. Locator batches
update all three indexes once and create only the final new-page closure. Full
base/candidate mapping, history, metadata, receipt, ownership, exact-base,
readback and recovery checks remain. Ordinary saves use `PhysicalRootBinding`;
initialization and restore still publish through their separate guarded routes.

This slice reduces tree construction and uploaded paths. It does not provide
selective app loading, bounded whole-database memory or incremental financial
validation. The workspace still supplies a complete ledger; full oracle and
history work, preparation Maps, descriptor arrays and restore inventories remain.
Live Drive/device acceptance and production authorization are separate gates.

## Position and reconciliation remain unimplemented here

`position()` and `reconciliation()` throw an explicit not-implemented error even
after a successful audit. All position source history is preserved and audited,
but this format does not yet have the dependency indexes needed for bounded
position queries.

Reporting month and movement month differ, especially for refunds. Dated
balances and holdings need a latest-date predecessor lookup and the complete set
of same-date candidates. A chosen record alone cannot establish absence of a
contradiction. Undated or unresolved evidence can affect every account period.
Coverage requires opening and closing anchors, movements and contradictory
evidence. Account closure also requires its zero-balance anchor and subsequent
contradiction checks. Spending summaries supply none of those proofs. Future
bounded queries must preserve these dependencies and the current qualification
rules rather than quietly substituting monthly spending for financial position.

## Cost and remaining integration work

The original source-1/derived-1 representation is costly in object count.
Small object/array fields create many tiny content-addressed pages. Identical
pages reuse hashes, but this is not a claim of acceptable Drive request cost.
Record expansion currently verifies each tree and then traverses it again.
Page packing, request grouping and measured bounded caching need review before
production integration; they must not weaken exact hashes or semantic checks.

The test prints actual object counts, stored bytes, fixed-root size, cold header
reads, selected month-page reads, record-descriptor reads, expanded-record reads
and expanded-summary reads at increasing invented sizes. These are in-memory
adapter observations, not Drive latency, mobile memory or application startup
measurements.

**Historical v4 measurements, Node 24.22.1, November 11, 2026:**

| Invented activities | Objects | Stored bytes | Two-row month page reads | Record descriptor reads |
| ---: | ---: | ---: | ---: | ---: |
| 24 | 156 | 308,811 | 5 | 2 |
| 144 | 770 | 1,710,645 | 8 | 3 |
| 576 | 2,951 | 6,753,065 | 8 | 3 |

Every top root was 236 bytes. Opening read three headers. Expanding one source
activity required four additional reads at each size. Fetching and expanding a
monthly summary required nine reads. Every stored object stayed within 64 KiB.
The two-row queries return handles and stay semantically unverified until audit.
These fixtures have one account and twelve report months. The separate membership
fixture exercises 150 retry attempts and holdings, 160 observation and category
rule members, 161 review event members and 131 conflict candidates. They are
small synthetic demonstrations of object bounds, not mobile capacity targets.

**Historical baseline:** the original v4 module did not replace v3 application
loads, version-2 snapshot maps, locator materialization or retained-history
validation. The present integration replaces the active new-copy format and
physical binding. Complete app ledgers, preparation descriptors, metadata
witnesses and semantic history audits still materialize and grow with history.
It is not the completed bounded-memory/selective-loading plan.

Full semantic audit remains required. Exact root/commit/verifier results may be
reused only within one owned verification scope. Opaque scope owners prevent late
results entering a successor, and errors invalidate the scope.

Separately, the physical adapter retains at most 512 private verified-body facts
within a session, using at most 1 MiB of key/metadata storage. Facts are promoted
only after fresh metadata and ownership closure. Each later operation opens a
complete fresh metadata snapshot; reuse requires the exact file, folder, kind,
transaction, size, version and hash binding, and records a new closing witness.
Fact overflow reads actual bytes. Tree traversal and consumers needing bytes
still read them; these facts never substitute for semantic validation, ownership
or pointer-publication guards. Invalidation, release, reconnect or any failed
verification clears reuse. Byte reuse has a separate finite 8 MiB cache.

Every physical body and mapping remains checked, and fresh metadata closure
precedes authority. Neither cache is persisted or caller-mintable. No automatic
repair save, implicit migration or history pruning is introduced.

## Verification

Run `FINANCE_EXTENDED_STORAGE_TESTS=1 node --test tests/canonical-partitions.test.mjs`
with the tree tests for all recorded growth sizes. Ordinary local runs retain
the 24- and 144-activity comparisons; see [test commands](TESTING.md). The
fixtures cover canonical graph conversion, exact source/order roundtrip,
optional position history, corrections/refunds/transfers, different currencies,
missing coverage, inactive review decisions, large memberships and strings,
page/cursor/root mismatches, cancellation, forged rehashed derived data, corrupt
and missing source bytes, unsupported versions/collections, materialization
budgets and defensive ownership. The prior app/default-path suites remain part
of the aggregate regression run.

**Verified:** the original local format tests and independent full-ledger
comparisons establish format behavior. The present integration adds app/controller,
physical interruption and v5 copy/restore tests; its exact-source aggregate and
performance gate remain required. **Open:** bounded semantic cold open,
incremental mutation validation, live Drive acceptance, physical iPhone/iPad
capacity and production review.

## Application compatibility and failure behavior

The workspace and seeder request `partitions-v5`. Canonical v1/v2/v3/v4 roots,
older archives and older initialization markers fail admission without migration
or overwrite. Low-level historical protocol fixtures do not establish application
compatibility. An unsupported source must remain unchanged.

Existing v5 copies originally migrated from canonical v1/v3 remain readable,
editable and backupable after full verification. The archive-only legacy decoder
exists solely to audit their retained provenance. It does not open old folders,
write older formats, restore a standalone legacy archive or create a migration.
Retained evidence must pass its complete audit; unreadable or corrupt provenance
cannot be skipped to admit an otherwise valid v5 root.

Every retained v5 commit validates its ledger and immutable transition. Original
source rows, financial activities and prior events cannot be rewritten. Monthly
summaries must match the independent ordered logical result from the complete source.
Missing/corrupt pages or self-consistently forged derived totals prevent admission.
The app does not repair these by bypassing history checks or replacing immutable
bytes. Preserve the damaged copy and use an independently verified backup;
a source-only repair workflow is not provided.

A linked refund whose original category is absent can produce an own `undefined`
field. The v5 builder refuses this before publishing. It does not coerce the value
to null or alter source evidence. An explicit category correction must be staged
before saving such a projection.

Portable file export uses a writable stream when available. A browser without
that API uses a labeled memory-backed Blob download. This fallback is not a
bounded-memory export. Retained raw original files are not silently omitted:
unsupported out-of-catalog originals block export, preserving the
source and its retention policy.


V5 exports also retain a separately typed `finance-tracker-source-physical-evidence`
version-1 root. Its immutable index binds exact foreign file IDs and metadata to
content hashes, including the selected manifest version, receipt/plan chains and
locator closure. The source is pinned through copy publication. Offline audit
resolves these old IDs only within the retained evidence, with no provider
fallback or authority over the new copy. Duplicate data bodies reuse hashes;
subsequent generations retain prior evidence roots, not recursively embedded
archives. The restored live receipt chain starts fresh. Missing, corrupt or
unreferenced provenance mappings and ancestor-copy-ID reuse are rejected.

The guided import rehearsal verifies framed v5 exports by restoring to a private
in-memory adapter. This reads no source after export and creates no Drive files,
but is deliberately materializing. It is distinct from a saved-file restore to
a fresh physical copy and does not prove that a browser download reached disk.
