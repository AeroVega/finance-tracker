# Framed portable backup building block

## Scope and status

**Implemented, synthetic-only:** `js/framed-backup-stream.mjs` supplies a separate
version-3 binary transport for bounded immutable objects and fixed root metadata.
It does not replace or change either existing portable archive reader. Version-2
JSON/base64 archives remain readable through their existing APIs. No application
button, Drive adapter, migration or default storage path uses this module.

This is part of the [approved storage work](SCALABLE_STORAGE_FOUNDATION.md), not
completion of bounded application backup or recovery. Production remains
**NO-GO**. No live Drive access, real records, merge or deployment was performed.

**Verified:** independent encoding/hash tests, interrupted-write tests, stream
cancellation, a real immutable-tree roundtrip and disk-backed growth fixtures.
**Open:** bounded financial/history semantic verification, production destination
adapters, source/session integration and physical Safari capacity measurements.

## API and memory contract

- `encodeFramedBackup({ root, objects, limits, signal, beforeSeal })` returns an
  async iterator of byte chunks. `objects` is an iterable or `ReadableStream` of
  `{ hash, bytes }`. `hash` must equal the lowercase SHA-256 of the exact bytes.
- `createFramedBackupReadableStream(options)` returns those chunks as a
  `ReadableStream` with no queued read-ahead chunks.
- `writeFramedBackup({ sink, ...options })` awaits each write to a
  `WritableStream` or asynchronous `write` sink. Optional `close` and `abort`
  methods are called at their corresponding terminal boundaries.
- `restoreFramedBackup({ source, staging, verifyStructure, limits, signal })`
  consumes an iterable of `Uint8Array` chunks or a `ReadableStream`.

Defaults are 16 KiB per JSON header and 1 MiB per object. Callers can choose
128..65,536 bytes per header and 1..16,777,216 bytes per object. These are finite
operation profiles, not a total database or archive byte limit. Large logical
values and original files need independently specified bounded chunk objects.
This module does not invent an original-file retention or chunk-manifest schema.

The parser keeps one upstream chunk reference, one requested block, bounded
metadata and exact counters. It neither concatenates the complete stream nor
retains an object inventory. SHA-256 through Web Crypto buffers a bounded object.
Copies and read-back can hold a small constant number of such object buffers.
No completed object is added to a growing in-memory array or duplicate set.

A caller can supply a huge chunk containing many frames. The parser consumes it
through a plain view without copying it wholesale, and allocates only the next
bounded block. The upstream chunk remains owned by the source until consumed.
Therefore a claim about total working memory also requires a bounded upstream
chunk/queue policy. A caller that first builds the whole archive in a `Blob`,
buffer or array has not obtained end-to-end bounded memory from this API.

Objects are detached copies before hashing. Buffer and typed-array subclass
`length`, `buffer`, `slice` and `subarray` overrides cannot bypass the bounds or
create aliased hash inputs. Shared buffers are rejected. Adapters must also bound
their transport before allocation, since a returned byte-limit check cannot undo
an already oversized network response.

Counters use `BigInt` and canonical unsigned decimal strings, with no conversion
of archive totals to JavaScript `Number`. There is no configured aggregate byte
or object-count ceiling. The counter text itself must fit the terminal header
budget. Counter storage grows with the number of decimal digits, not with an
object inventory.

Repeated identical content-addressed frames are allowed. Every occurrence is
hashed, counted, committed, written idempotently and read back. This avoids a
growing duplicate-tracking set. The cost is repeated transfer and verification
when a traversal reaches the same object more than once. Removing, inserting or
reordering any frame invalidates the original terminal commitment, including
inserting an otherwise valid duplicate.

## Fixed root metadata

Exactly these six fields are permitted:

```js
{
  databaseId: "synthetic-database",
  sourceCopyId: "synthetic-source-copy",
  revision: "12345678901234567890",
  canonical: { version: 4, sha256: "<64 lowercase hex characters>" },
  catalog: { version: 3, sha256: "<64 lowercase hex characters>" },
  protocol: { version: 3, sha256: "<64 lowercase hex characters>" }
}
```

Any descriptor can be `null`, but at least one must exist. This permits isolated
format tests before catalog/protocol integration. It does not permit a complete
database restore to omit roots its application requires. The required verifier
must enforce that profile and the identity/version bindings inside each root.
All non-null roots must be present in the new staging namespace with matching
bytes before that verifier runs. Metadata is snapshotted and frozen.

No descriptor contains a growing object, partition or history inventory. A root
must instead point to an immutable bounded object whose dependencies can be
traversed through paged structures. Archive metadata does not carry live Drive
file IDs or destination identity. Actual retention clocks and historical facts
must remain in their exact committed objects.

## Version-3 wire format

All length fields are unsigned, big-endian 32-bit integers. The eight magic
bytes, in hex, are `46 54 42 53 0d 0a 03 00`. Other versions or reserved-byte
values are rejected.

Every frame begins with a one-byte type and four-byte JSON header length, followed
by that many header bytes. Headers use exact canonical JSON, valid UTF-8, no BOM,
no duplicate keys, no extra fields and no trailing whitespace. Object bodies are
raw bytes, never decoded as text or base64.

1. Type `01`: the fixed root metadata header, with no body. Exactly one, first.
2. Type `02`: header `{ "byteLength": <integer>, "hash": "<sha256>" }`, followed
   by exactly `byteLength` raw bytes. Zero-length objects are allowed.
3. Type `ff`: header `{ "objectCount": "<decimal>", "totalObjectBytes":
   "<decimal>" }`, followed by a 32-byte commitment. Exactly one, last.

EOF must immediately follow the terminal commitment. Empty transport chunks do
not represent bytes and are allowed. Truncation at any boundary, extra bytes,
unsupported types, repeated root frames, malformed UTF-8 and oversized headers
or objects fail. Length limits are checked before allocating the declared block.

The commitment is inspectable. Let `H` be SHA-256, `||` byte concatenation,
`P_i` the exact five prefix bytes and `J_i` the exact header bytes. Define `D_x`
as the UTF-8 bytes of `finance-tracker-framed-backup:v3:<x>` followed by one zero
byte, for `start`, `frame`, `chain` and `end`.

```text
C_0 = H(D_start || magic)
F_i = H(D_frame || P_i || J_i || H(B_i))
C_i = H(D_chain || C_(i-1) || F_i)
T   = H(D_end || C_last || P_terminal || J_terminal)
```

`B_i` is empty for the root frame and is the exact raw body for an object frame.
The terminal frame stores `T`. Its declared counts must also equal independently
accumulated exact counts. This commits to the magic/version, all prefix/header
bytes, bodies, ordering, repetitions, counts and root metadata. Hash-chain inputs
remain bounded because `H(B_i)` is a fixed 32-byte digest.

These are corruption/integrity checks, not encryption, signatures, authenticity
or a trusted backup source. An attacker who can replace the archive can recompute
its hashes. Valid hashes do not establish financial or application correctness.

## Quarantine and application verification

The caller supplies an exclusively owned **new** staging namespace:

```js
{
  async begin({ state, formatVersion, root, signal }) { /* persist incomplete marker */ },
  async write(bytes, { signal }) { /* return exact lowercase content hash */ },
  async read(hash, { signal, maxBytes }) { /* return bounded immutable bytes */ }
}
```

`begin` must establish durable quarantine before returning and reject a reused or
nonempty destination. It must not adopt leftovers from an earlier attempt. An
adapter must preserve immutable bytes, make identical writes idempotent and
exclude objects outside this restore namespace. These are real adapter duties,
not guarantees supplied by a Boolean `quarantined` flag. There is no production
adapter in this milestone.

The module writes one object at a time, checks the returned content ID, then
independently reads and hashes the stored bytes. If a write persisted bytes but
lost its response, restore fails conservatively. No retry, deletion, prior-copy
adoption or publication is attempted. An uncertain `begin` outcome also remains
incomplete. The error reports `restore-incomplete`, the original `cause`, its
phase, confirmed object count and whether staging began. Invalid API arguments
can fail before staging is admitted.

Only after exact terminal validation, EOF and root read-back does the required
`verifyStructure` callback receive:

```js
{ root, store: { read }, signal, limits, objectCount, totalObjectBytes }
```

The callback must independently validate the complete required source graph,
indexes, retained history, identities, retention facts and application invariants
for its declared format profile. It must use bounded traversal/scratch storage,
await each read and release processed payloads. The supplied read scope admits
only one read at a time, enforces each requested byte limit, rechecks hashes and
has no write or publication method. Failed reads remain failures even if the
callback catches them. A callback must return `true` only after its actual checks
finish. A flag, a source-root hash match or a no-op callback is not semantic
verification. The library cannot inspect arbitrary callback code to prove its
correctness or bound objects that the callback deliberately retains.

Success returns `state: "verified-quarantined"`, `formatVerified: true` and
`structureVerification: "callback-completed"`. The latter records which boundary
ran, not a library proof of application semantics. The persisted marker remains
incomplete. There is no `publishable`, `complete`, active manifest or mutation of
the destination lifecycle. A saved read scope cannot perform new reads after
verification ends.

The current canonical-v4 full audit still materializes a full synthetic graph.
It is not a bounded semantic verifier for a growing production archive. The real
tree test validates all semantics of its small invented catalog schema and exact
ordered entries; it does not substitute for future finance/history verification.

## Cancellation and future integration

`AbortSignal` checks run between chunks, frames, digest completions, writes and
verification steps. Consumer early return closes the object source. Cancellation
propagates to a `ReadableStream` reader and releases its lock. Generic async
iterators must cooperate by settling pending `next`/`return` operations; no
JavaScript wrapper can forcibly stop arbitrary non-settling producer code.

An admitted destination/sink write is awaited before abort or rejection. The
same applies if the semantic callback throws with one read still running. There
is no continuing background batch after a reported incomplete result. Broken
adapters that never settle their operations can therefore prevent cancellation
from finishing. This is deliberate draining, not permission to abandon a write
whose outcome is unknown.

The integration boundary must preserve existing source and recovery safeguards:

- Hold the source session gate, pin roots and verify the permitted backup source.
- Check unchanged source state before the first destination mutation. This
  transport does not own that session or source adapter.
- Use `beforeSeal` to recheck the exact pinned source before emitting a terminal
  commitment. A failed check leaves the export unsealed.
- Require fresh destination ownership, a new physical copy identity, independent
  application/history verification and the proper recovery protocol before any
  separate publication operation. Recheck relevant source state before publishing
  a live copy. A portable file alone cannot prove the present state of its source.
- Preserve incomplete namespaces as evidence. A future explicit resume design
  must bind source, destination, progress and ownership. This module has no resume,
  automatic adoption, retention shortening or garbage collection.

## Evidence

**Verified, November 11, 2026:** 33 focused tests cover an independent Node encoder
and SHA-256 oracle, arbitrary chunk boundaries, large single chunks, body and root
tampering, missing/reordered/inserted frames, valid repeated content, invalid
Unicode and numeric counters, strict EOF, bounds, mutable/decorated typed arrays,
backpressure, cancellation/draining, uncertain writes, quarantine preservation,
mandatory semantic checks and exact real-tree restoration.

The disk-backed benchmark used 32, 256 and 2,048 distinct invented objects. It
does not retain an archive or JavaScript object inventory. Exact restored object
bytes were 507,954, 4,177,970 and 33,538,098. Corresponding stream sizes were
511,446, 4,203,640 and 33,741,178 bytes. At every size, the largest parser block and
write were 16,384 bytes, peak admitted writes were one and quarantine remained
incomplete. These are structural bounds and exact-content checks, not measured
JavaScript heap peaks or evidence of safe iPhone capacity. Filesystem cleanup is
limited to the benchmark's own disposable synthetic directory.

```sh
node --test tests/framed-backup-stream.test.mjs
node tests/benchmark-framed-backup.mjs
node --check js/framed-backup-stream.mjs
```

The full repository test run and draft PR status are reported separately.
