# Immutable ordered page tree

## Scope

**Implemented, synthetic-only:** `js/immutable-page-tree.mjs` adds an independent
content-addressed ordered tree. The existing workspace, save path and locator
catalog do not use it. It is a storage building block for partitioned canonical
records and derived indexes, not completed bounded application loading.

A root is one lowercase SHA-256 hash, 64 ASCII bytes. It addresses either an
empty/ordinary leaf or a branch. It never contains a growing inventory of pages.
No aggregate record, revision or database byte ceiling is imposed. A single key,
value or reference still has to fit the page format.

## Contract

`createImmutablePageTree(store, options)` accepts a store with
`read(hash, {signal, maxBytes}) -> Uint8Array` and an optional
`write(bytes, {signal}) -> hash`. Read-only stores support traversal and lookup.
The adapter must bound transport responses before returning them. The tree
rejects oversized returned bytes before copying or parsing, but cannot prevent an
adapter from allocating them first.

- `build(sortedIterable, {signal})` accepts synchronous or asynchronous `[key,
  value]` pairs and returns a root hash. Keys must be strictly ordered and unique.
  It writes leaves while consuming the iterator, keeping one bounded buffer at
  each branch level rather than retaining the source or a complete page list.
- `get(root, key, {signal})` returns a detached JSON value or `undefined`.
- `set(root, key, value, {signal})` and `delete(root, key, {signal})` return a new
  root. They read and rewrite the changed path. Identical sets and absent deletes
  return the old root without writes.
- `entries(root, {gte, lt, signal})` streams ordered pairs. The lower bound is
  inclusive; the upper bound is exclusive. Omitted bounds are `null`.
- `page(root, {gte, lt, limit, cursor, signal})` returns `{entries, cursor}`.
  The default and maximum result count is 128. It reads one lookahead entry to
  determine whether another page exists. A non-null cursor records the exact
  root, query and last key. A cursor from another root/query is rejected.
- `inspect(root, {signal})` reads the root and returns `{count, min, max, height}`.
- `walk(root, {signal})` streams `{hash, bytes}` for the reachable page closure.
  Bytes are detached from internal and adapter buffers. Traversal is iterative,
  retains an active path rather than a global inventory, and does not deduplicate
  repeated visits. Backup consumers can stream these exact bytes.
- `verify(root, {signal})` exhausts the structural traversal and returns root
  metadata plus `nodes`. Counts, heights and node totals are decimal strings.

The cursor format is `finance-tracker-page-cursor`, version 1, with the fields
`root`, `gte`, `lt` and `after`. Cursors are portable seek positions, not signed
proof of which pages a caller already consumed. Changing a cursor's seek key
cannot mutate a tree or confer source completeness.

Cancellation is cooperative. Operations check the signal around awaited store
calls and iterator steps. An adapter or source iterator that does not settle
cannot be interrupted by this module. Writes completed before cancellation may
remain unreferenced. There is no automatic deletion or publication.

## Bytes, ordering and structure

Defaults are 65,536 encoded bytes, 128 leaf entries and 128 branch references per
node. Options can lower these to at least 1,024 bytes and two entries/references.
Nodes split on both count and actual UTF-8 byte size. Keys use JavaScript UTF-16
code-unit ordering, with no locale, case folding or Unicode normalization.
Unpaired surrogates are rejected. At the default profile, each key's encoded JSON
string is limited to 1,024 bytes. Smaller byte profiles reduce that budget so two
child references can fit in a parent. `tree.limits` exposes the chosen limits.

Values are plain JSON. Nonfinite numbers, bigint values, undefined values, sparse
arrays, accessors, symbols, non-plain objects and cyclic values are rejected.
Encoded JSON nesting is limited to 64 levels, including its page envelope.
Canonical JSON preserves well-formed Unicode and sorts object keys. The reader
rejects duplicate fields, alternate byte encodings and unknown node properties.
Large source records must be split by the caller into independently bounded
values; allowing a large record must not silently raise the node limit.

Each node records its version, kind, exact count, height and inclusive boundary
keys. Branch references carry the child's hash, count, height and range. The
reader checks local order, disjoint ranges, counts, shape and heights. Every
visited child must exactly match its parent's reference. Leaves establish their
counts from actual entries. Full traversal checks global order and the final
entry count. Height decrements and active-path cycle checks prevent traversal
from following a repeated ancestor. SHA-256 verification also rejects a store
that substitutes ancestor bytes under a different child's hash.

Every read hashes a private copy of the exact supplied bytes. Intrinsic typed-array
getters enforce the byte budget and reject shared buffers before copying, hashing
or parsing, even when the adapter shadows ordinary byte properties. Buffer slices
and resizable-buffer views are copied into independently owned fixed storage. Every write hashes
private bytes, gives the adapter a separate buffer, requires the exact returned
hash, and checks exact read-back. Returned values and bytes are detached, and
there is no mutable verification cache or caller-supplied trusted flag. Read-back
establishes the observed stored content, not the provider's crash durability.

## What verification means

**Verified by the synthetic tests:** full traversal establishes the internal
ordered tree structure. It does not establish that an index contains every
canonical source record or that an entry has the correct financial meaning.
An omitted source record can leave a structurally valid tree. Source binding,
index rebuilding and cross-record validation remain the caller's responsibility.

`inspect`, lookup, range queries and changed-path updates verify only the nodes
they visit. Unvisited child references are declarations until their children are
read. Fully exhaust `walk` or call `verify` before claiming complete structural
validation. Breaking out of an iterator early is not a complete verification.

## Resource and update limits

The builder and depth-first traversal retain bounded pages along the current tree
height. They do not retain an array proportional to total records. Each returned
query page has at most 128 bounded values, so its result budget can be larger than
one encoded storage node. The consumer controls how much streamed output it
retains. The benchmark's in-memory store intentionally retains all objects and is
not a measurement of the tree's heap use or a production adapter.

Updates split overflowing paths and remove empty nodes. They collapse unary
roots but do not merge underfilled sibling pages. After many deletions, internal
pages can remain sparse and retain a height established by a larger earlier
version. Rebuilding from the ordered iterator can compact the current tree while
preserving old roots. Rebuilding is explicit and does not delete history.

The root hash is returned only after successful write/read-back. Switching an
application manifest, coordinating concurrent writers, proving source completeness,
copy ownership, retained-history verification and crash recovery are outside this
module. An invalid or interrupted build can leave unreferenced immutable pages.

## Synthetic verification

Run:

```sh
node --test tests/immutable-page-tree.test.mjs
node tests/benchmark-immutable-page-tree.mjs
```

The tests use invented data and an independent Map oracle. They cover streamed
growth, byte and count splitting, Unicode, mixed persistent updates, old roots,
changed-path work, cursor/query mismatches, cancellation, malformed pages,
reference count/range/height contradictions, huge responses, duplicate keys,
nonfinite values, fake hashes, mutated adapter bytes, shadowed byte lengths, Buffer
slice aliases, resizing during digest, exact read-back and archive
closure traversal. No live Drive, application integration, browser or physical
Safari capacity was tested. Production persistence remains **NO-GO**.

**Verified on Node 24.22.1:** the focused suite passed 63/63 tests. The benchmark
records actual adapter operations and bytes, including write read-back. It uses
default limits and streams invented records of about 100 encoded bytes each.

| Records | Reachable nodes | Height | Build writes / bytes | Lookup reads / bytes | Changed-key writes / bytes |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 9 | 1 | 9 / 107,449 | 2 / 14,914 | 2 / 14,912 |
| 10,000 | 80 | 1 | 80 / 1,082,748 | 2 / 25,337 | 2 / 25,335 |
| 50,000 | 396 | 2 | 396 / 5,457,572 | 3 / 33,317 | 3 / 33,315 |

The corresponding changed-key operations make 5, 5 and 7 reads, including
read-back and root collapse checks, totalling 31,145, 62,286 and 67,378 bytes.
A 16-entry range page makes 3, 2 and 3 reads totalling 28,509, 25,337 and 33,317
bytes. Maximum stored node sizes are 13,595, 13,723 and 18,720 bytes. Every root
reference stays 64 bytes. Full verification reads all 9, 80 and 396 nodes, which
is deliberate audit work rather than a bounded lookup. These are deterministic
work counters, not timing, peak-heap, provider-latency or mobile-capacity claims.
