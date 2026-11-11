# Drive response bounds

**Implemented, synthetic-only:** Drive transaction, session, folder enumeration and
folder discovery reads share a streamed response reader. These changes do not
activate production persistence, impose a total database-size ceiling, authorize
history deletion, or establish supported iPhone, iPad or desktop capacity.

## What is bounded

The transport counts the actual bytes returned by the response stream. It rejects
an excessive Content-Length before reading, but never trusts an absent, malformed
or understated header. Crossing a limit cancels the reader before retaining the
oversized chunk. Tiny chunks are coalesced into bounded blocks so a server cannot
create one retained buffer per byte. JSON decoding rejects invalid UTF-8.

Default byte limits apply independently to each response:

| Response kind | Limit |
| --- | ---: |
| Generated IDs | 32 KiB |
| Session marker | 64 KiB |
| File metadata | 256 KiB |
| Journal event | 1 MiB |
| Folder listing page | 4 MiB |
| Locator catalog segment | 64 KiB |
| Manifest or commit record | 16 MiB |
| Legacy catalog, data or snapshot object, other stored object | 32 MiB |

Stored-format rules can be stricter than transport limits. For example, a canonical
fragment still needs to satisfy its own format contract after transport admission.
Catalog segment schema bounds remain separate too. A caller supplies the expected
kind; unknown kinds use the finite stored-object fallback.

Listings enforce the requested count per page and reject repeated pagination
tokens. They continue through all distinct pages. There is no aggregate page,
file-count or database-byte admission limit here.

HTTP error bodies and unused mutation responses are cancelled without parsing.
Diagnostics retain HTTP status and fixed error codes, never server body excerpts,
JSON parser snippets or raw fetch exception messages. An unreadable create
response does not prove the write failed. The adapter still checks the same
preallocated file ID, typed metadata and exact bytes before reporting success.
No replacement ID is generated for that ambiguous outcome.

New immutable files and manifest publications must fit their configured response
limit before the adapter issues their durable write. This avoids creating a file
that the same adapter cannot read back. This is not a forecast of every later
journal, manifest or backup allocation in a transaction.

## Existing copies and recovery

Oversize is a failed verification, never an empty database, missing journal or
permission to delete evidence. Recovery stays blocked and preserves the stored
copy. A preexisting file larger than the defaults can be inspected and recovered
with a reviewed, explicit larger finite profile. For example, an engineering
caller can construct GoogleDriveTransactionAdapter with:

```js
responseLimits: { 'data-object': 64 * 1024 * 1024 }
```

The constructor accepts positive safe-integer byte limits for known response
kinds only. It freezes an independent copy of those settings. There is no Infinity,
automatic unbounded retry or weakened hash, location, journal or ancestry check.
The ordinary application does not expose an end-user limit editor. Review the
individual object's expected size and the available device memory before using a
larger profile. Keep the original copy until exact reopen and recovery succeed.
Session and folder-listing adapters also accept responseLimits.

This does not guarantee that every historically unbounded copy fits in a browser.
A response cap limits retained payload bytes for that response, not total process
memory. The bounded blocks and final byte result overlap briefly. JSON strings,
parsed objects, hashes, concurrent readers, catalog maps and retained history add
memory beyond that cap. A producer may also allocate an oversized incoming chunk
before the reader can cancel it. Full history verification and archive operations
still need their own capacity measurements and design.

## Evidence

**Verified locally:** tests/drive-response-transport.test.mjs uses real Response
and ReadableStream objects with invented HTTP adapters. It covers exact limits,
missing and false lengths, one oversized chunk, tiny chunks, failed cancellation,
invalid UTF-8/JSON, no-stream refusal, error-body privacy, each active response
route, list pagination and session refusal. Recovery tests preserve a saved
object larger than 128 KiB under a deliberately tight profile, reopen it under a
larger finite profile, and still reject corruption. An oversized manifest blocks
recovery before any mutation. An oversized successful create response resolves
through exact-ID read-back with one durable create.

The existing Drive adapter tests remain required. No test contacts Google Drive
or uses real records. Physical Safari streaming behavior, live Google response
handling and device capacity remain **Open**. Local passing tests are not evidence
of deployment or production readiness.

The physical `snapshot-object` and logical `data-object` labels refer to the same
bytes. A profile override for either sets both. If both overrides are supplied,
the stricter value applies. Canonical transaction planning checks this effective
budget before writing a journal, and the feasibility uploader checks its content
before allocating an ID. Read-back and recovery use the same budget.
