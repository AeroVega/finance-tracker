# Paged storage and recovery milestone

## Scope and status

**User-confirmed:** the storage plan includes schema changes, monthly summaries
alongside transaction detail, bounded processing without a total database size
ceiling, less work per correction, and stronger recovery and privacy controls.

**Implemented in isolation, not enabled in the application:** this follow-up
adds bounded immutable trees, a canonical v4 reference format and reader, and a
framed portable stream. The root transaction prototype is a separate protocol
experiment. None of these modules replaces the existing workspace, catalog,
transaction engine, or backup buttons. Existing synthetic folders are not
converted when opened.

The [published foundation](SCALABLE_STORAGE_FOUNDATION.md) remains a distinct
milestone. It changes the active synthetic path but does not complete selective
loading. The new modules below have no effect on normal application performance
until the integration gates in this document pass.

The same follow-up also hardens the active storage path. Bytes are privately
copied before asynchronous hashing, queued writes and upload-size admission.
Buffer aliases and resizable backing stores cannot change an admitted payload.
Private caches and exported archives no longer share byte or metadata references
with application validators. Shared backing memory is rejected across realms.
These fixes preserve the existing format and recovery behavior.

Production remains **NO-GO**. No real records, live Drive, archived workbook,
merge, deployment or production activation belongs to this work. The owner's
separate invented workbook has no assumed schema here.

## Components

- [Immutable page tree](IMMUTABLE_PAGE_TREE.md): ordered bounded nodes, streaming
  construction, root-pinned lookup and range iteration, copy-on-write updates,
  full structural verification, and verified-byte traversal. A small root hash
  replaces an ever-growing inventory in this data structure.
- [Partitioned canonical storage](PARTITIONED_CANONICAL_STORAGE.md): an isolated
  v4 reference converter and reader. Source records, append order, nested values,
  effective activities and monthly summaries use paged trees. Full-fixture
  reconstruction through the existing canonical validator is the semantic oracle.
- [Framed backup stream](FRAMED_BACKUP_STREAM.md): bounded raw object frames with
  exact hashes and a terminal commitment. Restore stages and reads back objects,
  requires complete input and a caller-supplied verifier, and never publishes a
  destination itself.
- [Root transaction protocol](ROOT_TRANSACTION_PROTOCOL.md): isolated small-root
  publication and manifest-anchored recovery. Its adapter, ownership and verifier
  requirements must be satisfied before any production integration.

Per-object, page, nesting and requested-expansion limits protect individual
operations. They are not a limit on the sum of a database. This distinction does
not remove the existing fragmented-v3 format's aggregate compatibility limits.

## What verification means

A hash establishes the exact bytes under a trusted root. It does not establish
that a stored index includes every source record, that a summary used the correct
formula, or that all cross-record financial rules hold.

Targeted reads validate the pages they visit. They must not label unread source
content or derived summaries semantically verified. Canonical reader results
carry source and derived verification states. There is no caller-settable
`trusted: true` option and no partial ledger passed to `validateLedger`.

The current reference audit reconstructs a bounded fixture and invokes the full
legacy validator. It also rebuilds derived state for comparison. That is useful
independent parity evidence, but it is not a streaming semantic audit for an
arbitrarily large database. A larger source can still be paged without being
eligible for that materializing reference audit.

**Chosen conservative integration direction:** cold connections perform complete
verification with bounded, resumable working memory. An owned verified session
can then use selective reads and validate subsequent changes by checking their
complete dependency closure. Immediate cold opening from a few pages would need
a separately reviewed semantic-checkpoint trust model. No such model is silently
introduced by a schema version change.

## Compatibility and migration

The v4 converter accepts a complete deliberately synthetic ledger already valid
under the existing model. It writes content-addressed objects to its supplied
store and returns a root. It does not mutate a selected folder, rewrite old
history, or update an application manifest. A caller must use an isolated store
or quarantine because an interrupted build can leave unreachable objects.

Legacy per-record v1 and fragmented v3 application reads remain unchanged.
Grouped-v2 refusal remains unchanged. The active v2 portable archive reader stays
available. The new v3 framed transport is not a reinterpretation of old archives.

An eventual owner-visible migration must create and independently verify a fresh
copy, bind its evidence to the original root/history, preserve the source, and
make old-reader refusal explicit. These modules do not implement that workflow.

## Gates before application adoption

1. Implement bounded physical locator lookup. The test content-addressed stores
   are not a Drive locator catalog and do not resolve that integration problem.
2. Implement resumable source and history audits with bounded scratch state and
   explicit cancellation/cleanup. Do not introduce silent persistent browser
   financial caches to obtain lower memory use.
3. Validate incremental edits from a privately owned verified baseline. Check
   global identity, append history, cross-month refunds, both transfer sides,
   category dependencies and all affected summary memberships atomically.
4. Implement separate position and reconciliation queries. Spending summaries
   cannot prove balances, account closure or coverage. Predecessor evidence,
   complete same-date conflict sets and unresolved/undated evidence are required.
5. Connect the root protocol to real adapter ownership, exact-base/read-back
   checks and recovery. Retain history and abandoned evidence. Do not claim
   Google Drive supplies compare-and-swap when it does not.
6. Integrate streamed traversal, backup and independently verified restore,
   including retained history and original-import retention. A valid frame
   commitment alone is not application or financial validation.
7. Add explicit fresh-copy migration and workspace adoption. Measure complete
   flows and correction costs, including object counts and bytes, before claiming
   faster application loads or saves.
8. Complete privacy/account binding, working-state disposal, OAuth/cost evidence
   and live synthetic/device acceptance. An explicit owner activation decision
   remains necessary before real financial data.

These are outstanding implementation and acceptance gates, not a list of
completed capabilities. Node tests cannot establish iPhone/iPad capacity or live
Google behavior. Deployment work remains deferred until closer to Alpha.

## Validation record

Component documents record their focused tests, adversarial checks and synthetic
growth measurements. Aggregate validation and review apply to an exact revision;
do not reuse the foundation's 1,217-test result as evidence for later edits.

Independent review reproduced and resolved byte-ownership races, a tree response
limit checked too late, shared-buffer detection across realms, mutable validator
metadata, verifier reads surviving their scope, and swallowed falsy JavaScript
rejections. The regressions include each case.

**Verified on Node 24.22.1:** the complete combined suite passed **1,398/1,398**
tests with no failures, cancellations or skips. The focused suites include 63
tree tests, 12 canonical-format tests, 33 framed-stream tests, 52 root-protocol
tests, 20 active-path ownership tests and one cross-module byte-realm regression.
All 18 changed/new JavaScript files passed syntax checks. Whitespace checks and
95 relative documentation file targets passed.

Independent checks additionally exercised 1,400 tree mutations and 1,512
current/range/old-root comparisons, 1,113 archive corruption/chunk/truncation
cases, and 50 root-protocol fault runs across ten durable writes. Component
documents record growth measurements and their limits. These counts describe
the tested isolated modules and active-path fixes, not completed app adoption.

Reproduce the aggregate run with:

```sh
node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

No merge, deployment, live service or real-data validation is implied.
