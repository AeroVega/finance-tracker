# Owned preparation readers

The canonical save path can overlap up to four fixed-ID existence/exact-body
probes before staging a group, but only when both its physical adapter and its
preparation reader are internally recognized implementations.

`owned-preparation-reader.mjs` constructs a reader from copied, reachable prepared
bytes. Its private registry maps exact reader functions to the underlying pure
hash reader. No API registers an arbitrary callback or accepts a trusted flag.
The factory has no storage fallback or caller callback. Missing hashes fail;
input/output mutations cannot change retained bytes. Shared buffers are refused
through the existing byte-ownership helper. Each object remains limited to 64 KiB.

Recognition certifies behavior, not byte correctness, physical absence, ownership,
or publication authority. Existing hash, descriptor, deterministic commit/base
bytes, metadata, version, scope, closure, recovery and publication checks remain.
The reader ignores options just as the previous canonical prepared-map hit did;
physical bounds and cancellation remain enforced by the surrounding engine.

Internal binding preserves exact registered functions. Typed adaptation captures
only the pure hash reader; its internal queries are owned plain data records.
Accessor hash fields are refused without calling their getter. A proxy supplied
as a query can still execute its reflection trap; the concurrent stage therefore
calls the resolved hash reader directly with its already-owned string, not the
typed wrapper. Arbitrary callback wrappers, proxies and externally bound copies
do not inherit recognition. A custom `.bind` may return a genuine registered
reader, but cannot register a different callback by doing so.

Unrecognized preparation callbacks retain the original serial existence-probe
path, including callback occurrence. In particular, if callback A creates object
B, the later B probe observes it and does not invoke callback B. This fixes the
compatibility defect in the earlier rejected general prefetch experiment.

For the recognized path, all probes in a group settle before any group write.
Occupied bodies are fully validated. Missing bodies come only from that group's
actual read results, not a cached absence token. Preparation bytes are copied and
all writes retain fixed IDs, live guards and exact readback. Writes drain before
the next group or failure; authoritative manifest transitions remain serial.

## Memory and scope

Snapshotting reachable prepared bytes temporarily adds one copy of those bytes
during a save, plus at most four probed bodies (up to 256 KiB). Existing ledger,
history, preparation and inventory memory remains. This is not bounded whole-
database loading or a new database-size ceiling. Registry keys are weak, so it
must not extend readers' lifetime after the transaction's ordinary references end.

No real-data use, publication, deployment or production readiness follows from
this optimization. Synthetic full-suite validation and exact-source benchmark
results must be recorded separately before adoption.

The preparation callback's base-store capability still expires when the callback
settles. The returned owned prepared-byte reader is a different capability: it
retains copied newly prepared bytes, never base-store authority. An unprepared
base hash therefore fails with `object-not-found` even while the callback is
active; an escaped callback base reader fails with `verification-scope-closed`.
Neither failure may issue provider requests after the callback has settled.
