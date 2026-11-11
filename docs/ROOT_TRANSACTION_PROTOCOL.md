# Root transaction and recovery prototype

## Scope and status

**Implemented, synthetic-only:** `js/root-transaction-protocol.mjs` provides an
isolated root publication protocol with explicit adapters. It has no import in
the default application, no Drive adapter, no browser persistence, no automatic
migration and no deletion operation. The existing application, legacy protocols
and published storage foundation keep their current behavior.

**Verified:** synthetic Node tests exercise state transitions, every durable
mutation's interruption boundaries, ownership loss, exact-base conflicts,
readback, bounded plan pages and verifier lifetime. They do not validate Google
Drive behavior, Safari capacity, financial application semantics or production
readiness. Production remains **NO-GO**.

This implements a small root/manifest protocol. It does not complete a storage
migration, a portable archive integration or a usable application save path.

## Formats and state

All new protocol metadata uses **version 3** and these distinct format names:

- `finance-tracker-root-manifest`
- `finance-tracker-root-intent`
- `finance-tracker-root-object-plan`
- `finance-tracker-root-commit`

Version 3 is the root transaction protocol version. Canonical partitions use
version 4, immutable page trees use version 1, and the framed archive has its own
format version. A framed archive's protocol-version descriptor must identify
these root-protocol bytes as version 3. This module does not yet write that
archive descriptor or integrate an archive restore with a live manifest.

A clean manifest contains database/copy identity, role, an exact decimal
revision, one root hash, one head-commit hash and `pending: null`. It contains no
snapshot-path map, locator inventory or retained-history array.

A pending intent contains:

- The complete small clean base manifest and its exact canonical SHA-256 hash.
- The transaction identity and intended root hash.
- The root and exact decimal count of the paged changed-object plan.
- The identifier of a caller-supplied verification implementation.

The protocol derives the intended commit bytes, commit hash and next manifest
from this intent. The commit embeds the intent. Its base-manifest link retains
the exact previous manifest; the base's head-commit link retains earlier history.
The original root and all old objects stay in the store. Revisions and object
counts use decimal strings, not JavaScript safe-integer counters.

Only three manifest transitions are accepted for an admitted transaction:

1. Exact clean base to the same base with the exact pending intent.
2. Admitted base to the intended root/revision/head commit, with pending retained.
3. Exact published manifest to that same manifest with pending cleared.

A changed root, revision, head, copy, database or intent fails closed. There is
no merge, conflict resolution or automatic transaction replacement.

## Preparation and admission

`prepareRootTransaction` requires an explicit caller-owned preparation store.
That store already contains the proposed object bytes. The function consumes a
stream of distinct `{hash, byteLength}` descriptors in ascending hash order,
checks each object's address and length, and adds bounded plan pages to that
preparation store. It returns the small intent, not an inventory array.

Do not pass the live publication adapter as this preparation store. A caller
must explicitly select preparation storage and manage its retention. The module
does not choose IndexedDB, local storage, a filesystem or a remote service.

**Open integration obligation:** constructing the globally hash-sorted unique
descriptor stream needs an existing sorted inventory or bounded external
sorting. A generic tree walk can produce traversal-order duplicates and cannot
be passed directly. The tests build deliberately synthetic sorted inputs. They
do not prove end-to-end bounded preparation from arbitrary application edits.

Before admitting pending, `transact` copies every plan page to the publication
store and verifies its exact readback. Each write requires ownership and the
unchanged clean base. These pages describe the intended bodies and are inert
preparation evidence. An interruption here leaves the old manifest authoritative;
recovery does not search for or adopt these orphan pages. They are never deleted.

Only after the complete plan is durably readable does the manifest admit its
pointer and exact intent. No proposed data object, retained-base record or
commit is staged before admission. A restart can therefore identify the exact
pending operation and enumerate its required body addresses without the original
caller's in-memory plan.

## Staging, verification and publication

After admission, the protocol streams the named plan. Each object either already
exists at its exact content address or is copied from the explicitly supplied
preparation store. Existing wrong-hash bytes are an error, never an overwrite.
Every new object is read back and compared with the exact proposed bytes.

The protocol then retains the exact clean base manifest as an immutable object,
runs the registered application verifier, and writes the deterministic commit.
It publishes the intended new root while keeping pending attached. Before
clearing pending, it verifies the commit bytes again, reruns the application
verifier and checks the exact published manifest.

The object plan is a staging inventory, **not proof of complete reachability**.
An omitted object can be an intentional reuse of old immutable content, or it
can be a defect. Only the application verifier can distinguish those cases.
Hashes alone do not establish correct accounts, cross-period links, financial
arithmetic, completeness or history admissibility.

## Caller-owned verification contract

`RootTransactionProtocol` requires a construction-time `Map` from stable plan
identifier to executable verifier code. The registry is copied. Mutating the
caller's map later cannot replace the selected implementation. Unknown plan
identifiers stop admission or recovery.

The verifier receives the exact base manifest, intended root, transaction
identity, phase, cancellation signal and a scoped verified `readObject` function.
Its contract is to check:

- Base-root admissibility and the retained-head/history policy, including any
  caller-owned verified checkpoint policy.
- Complete intended-root reachability, including reused content and references
  across groups or periods.
- The application's semantic invariants and validity of the change from base
  to intended root.

The core checks exact base binding, content hashes, plan structure, commit bytes
and publication states. It does **not** traverse all retained history itself or
supply the application's verifier. The synthetic fixture checks an invented
root's dependencies and arithmetic. That fixture is not a canonical-ledger
validator.

A verifier must throw on failure and return `undefined` on success. Public
`semanticVerified` flags, boolean success results and external trust tokens are
not accepted. This is an explicit trusted-code contract, not a sandbox that can
prove an arbitrary callback is correct. A no-op callback would violate the
contract; integrating reviewed domain verification remains outstanding.

The supplied read capability permits one bounded read at a time. All admitted
reads settle before the verifier scope ends, including when the verifier throws.
Any read failure poisons verification even if callback code catches it. Returning
with an outstanding read fails after that read settles. Concurrent reads fail,
and saved capabilities cannot perform reads after scope closure. These checks
prevent a callback from completing publication while its admitted checks are
still in flight. The callback remains responsible for its own CPU and retained
memory bounds.

Verification runs before publication, before finalization and on a repeated
`transact` that observes its already-completed exact result. A clean `recover`
returns `idle` metadata only. It does not certify an opened database as safe to
use or render.

## Explicit adapter and ownership contract

The adapter is scoped to one physical synthetic copy and supplies four methods:

```js
readManifest({maxBytes, signal})
writeManifest(bytes, {beforeMutation, signal})
readObject(hash, {maxBytes, signal})
writeObject(hash, bytes, {beforeMutation, signal})
```

Reads return `Uint8Array` bytes. Only `code: 'object-not-found'` means an object
is absent. Authorization errors, timeouts and uncertain reads must retain their
errors rather than masquerade as absence. Manifest JSON must use canonical
encoding; unsupported versions and unexpected fields fail closed.

`writeObject` must perform immutable create-or-exact-existing behavior. The
adapter must bound bytes while receiving them, before allocation. The protocol
uses intrinsic typed-array byte lengths and detached copies, including for Node
Buffers and decorated typed-array inputs, but cannot undo oversized allocations
made inside an adapter.

Every durable mutation runs the injected `assertWritable` function and rereads
the exact expected manifest. The adapter must also invoke its supplied
`beforeMutation` immediately before **each** actual mutation attempt. Adapters
may not schedule late retries after returning. Every attempt must settle before
the adapter promise settles. The protocol rejects an adapter that omits its
callback even when the intended bytes appear.

`assertWritable` must establish online state and the correct database/copy/session
ownership, and reject stale, lost or uncertain ownership. Existing
`SessionCoordinator.assertCanWrite` can inform a future adapter, but this module
does not attach one or infer ownership.

**Limitation:** exact read-before-write and session checks are best-effort
single-writer coordination. Another writer can race between the check and write.
There is no server-enforced compare-and-swap guarantee. The protocol does not
make concurrent devices safe. Adapter reads must observe completed writes; stale
or eventually consistent reads require an explicit future adapter design.

## Recovery and retries

`recover` starts with the authoritative manifest. If no pending intent exists,
it returns `idle` without reading any object inventory. If pending exists, only
that intent's plan, bound objects and verifier-selected root/history references
are read. Folder-wide listing and journal discovery do not exist in the API.

- Missing staged bodies leave pending in place and report the exact missing
  address. Explicitly supplying the original preparation store can replay them.
- Missing or corrupt authoritative plan pages stop recovery. The protocol does
  not guess missing descriptors from folder contents.
- A staged but unpublished root can be verified and published.
- A published root with pending attached is verified and finalized without a
  second financial revision.
- A missing published commit stops finalization. The protocol does not fabricate
  missing commit evidence merely because a manifest names its hash.
- A lost successful write response resolves through one exact readback, without
  another write. Failed readback returns `mutation-unresolved`; no internal retry
  occurs. `details.outcome` distinguishes `unknown` from `not-observed`, but
  `not-observed` is not a license to repeat an unexamined external operation.
- Explicit retry rereads the authoritative manifest first and proceeds only
  from the exact base, admitted state, published state or completed state.
  Anything else is a conflict. A transaction already completed and superseded
  by later work is a conflict, not an invitation to replay it.
- Cancellation stops further mutations, preserves all evidence and drains
  admitted verifier reads. A write already made before cancellation can require
  explicit retry/recovery.

No automatic abort, pending-intent abandonment, garbage collection, history
pruning or orphan adoption is implemented. A permanent verification failure can
leave the copy blocked with pending attached. An explicit, independently reviewed
operator repair/abandonment protocol is future work.

## Bounds and measurements

Object and plan-page bodies are at most 64 KiB. A plan page has at most 128
entries. Manifests are at most 16 KiB. These are per-body limits, not an aggregate
database capacity decision. Larger logical records require chunking through the
separately versioned canonical format.

Preparation and recovery retain one plan page and bounded object bodies at a
time, with constant-size manifest metadata. A plan is a backward-linked chain;
its strictly decreasing cumulative count and cross-page ordered hashes validate
termination and reject duplicate descriptors without a full inventory set.

Recovery work grows with the pending transaction's plan and with the caller's
verification policy. A retry streams that plan again. There is no durable
verification cursor, constant-time claim or measured device-memory capacity.
Future adapter integration still needs a bounded content-address locator; this
protocol does not solve physical Drive lookup by itself.

## Verification commands

```sh
node --check js/root-transaction-protocol.mjs
node --test tests/root-transaction-protocol.test.mjs
```

The focused suite covers exact root publication, retained history across eight
commits, no-scan idle recovery, complete pre-admission plans, missing/corrupt
content, version/shape rejection, target/base/head substitution, callback scopes
and all durable-mutation fault points. It includes 701 planned synthetic objects
split into six pages, without growing the clean manifest into a snapshot map.

Aggregate repository tests, independent review, browser tests, live services,
mobile measurements, publication and deployment must be reported separately.
