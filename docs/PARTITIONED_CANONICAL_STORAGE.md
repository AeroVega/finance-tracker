# Partitioned canonical storage

## Scope and status

**User-confirmed, November 11, 2026:** continue the synthetic storage plan, with
schema changes when needed. **Implemented:** an isolated version-4 canonical
format, reference encoder, paged reader and bounded-fixture audit. Only invented
fixtures were used. No real records, workbook assumptions, live Drive actions,
production activation, merge or deployment are part of this milestone.

The app still reads and writes its existing per-record v1 and fragmented v3
formats. None of its workspace, manifest, commit, transaction, recovery or backup
paths imports the new reader. This is not app-level partial loading and does not
make an incomplete ledger acceptable to the existing validator.

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

The top root is canonical JSON with exactly five fields:

```json
{
  "format": "finance-tracker-partitioned-canonical",
  "version": 4,
  "syntheticOnly": true,
  "source": "<64-character source hash>",
  "derived": "<64-character derived hash>"
}
```

It has no per-record, partition or object inventory. The measured root is 236
bytes regardless of fixture size. The source root contains a metadata value
descriptor, a collections-tree hash, and exact decimal-string event and position
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
There is no fixed-width sequence number that wraps at a chosen frontier. V4
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

Every array uses paged membership, including import `observationIds` and
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
counts use decimal strings in v4. Summaries retain availability and qualification
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
  deterministic derived rebuilding, and reading all referenced derived pages and
  nested values to verify their actual availability and contents.
- `derived: "invalid"` means the reconstructed source passed but derived content
  differed. Queries keep that warning. An audit does not repair remote bytes.

The reader exposes unverified results for inspecting this format. Any eventual
application integration must gate trusted financial presentation on the required
semantic and storage verification. Hash/shape verification alone is insufficient.

`fullAudit` is a reference audit for bounded fixtures. It retains the entire
reconstructed ledger, calls the existing full-ledger validator and retains a
temporary expected derived store. It reads some nodes more than once. The default
`maxRecords` is 100,000 across source collections. `maxValues` and
`maxStringCodeUnits`, by default 1,000,000 and 4,000,000, apply to **each value
expansion**, including each record, not to total retained audit memory. These are
operation budgets which callers can set explicitly, not storage capacity claims.
A budget failure during source assembly cannot validate a partial ledger. Only
one audit may run per reader at a time.

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

The value representation is intentionally simple and costly in object count.
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

**Verified locally, Node 24.22.1, November 11, 2026:**

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

**Open:** v3 application load/save still materializes whole ledgers. Version-2
manifest and commit snapshot maps, locator materialization, retained journal and
commit ancestry, recovery scans and all-history application validation still grow
with database/history size. This module replaces none of those paths. Integrating
only the v4 payload would not resolve them.

Full audit remains the required default for eventual integration. A bounded
streaming semantic audit and a privately owned verified session with incremental
reading/editing must come before considering any separate cold-checkpoint trust
decision. This milestone introduces no checkpoint trust exception, no implicit
migration, no automatic repair save and no history pruning.

## Verification

Run `FINANCE_EXTENDED_STORAGE_TESTS=1 node --test tests/canonical-partitions.test.mjs`
with the tree tests for all recorded growth sizes. Ordinary local runs retain
the 24- and 144-activity comparisons; see [test commands](TESTING.md). The
fixtures cover current and legacy graph conversion, exact source/order roundtrip,
optional position history, corrections/refunds/transfers, different currencies,
missing coverage, inactive review decisions, large memberships and strings,
page/cursor/root mismatches, cancellation, forged rehashed derived data, corrupt
and missing source bytes, unsupported versions/collections, materialization
budgets and defensive ownership. The prior app/default-path suites remain part
of the aggregate regression run.

**Verified:** local synthetic format tests and independent full-ledger comparisons
are evidence for this isolated module. **Open:** bounded semantic cold open,
incremental mutation validation, complete protocol/history integration, live
Drive acceptance, physical iPhone/iPad capacity and production review.
