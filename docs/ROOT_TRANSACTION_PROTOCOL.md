# Root transactions and recovery

The application uses physical root protocol 4. The unused protocol-3 runtime
and its dedicated test suite have been removed after transferring relevant
boundary cases to the active physical suite. The prototype had no application
caller or Drive adapter. Its removal changes neither application saves nor
supported legacy-copy and archive decoding.

The [historical protocol-3 contract](https://github.com/AeroVega/finance-tracker/blob/89a29b612747cc56cefeefd4bbb6bf2a818a939a/docs/ROOT_TRANSACTION_PROTOCOL.md)
retains the earlier formats, rationale and synthetic evidence. Those prototype
instructions are not the current application protocol. Production remains
**NO-GO**.

## Protocol-4 application companion

**Verified in synthetic application/HTTP tests:** `js/physical-root-binding.mjs`,
`js/paged-application-storage.mjs` and `js/physical-drive-adapter.mjs` implement the
explicit paged canonical application path. Physical manifests,
portable logical commits, copy-local intents, plans and receipts use protocol 4:
`finance-tracker-physical-root-manifest`, `finance-tracker-portable-root-commit`,
`finance-tracker-copy-root-intent`, `finance-tracker-copy-object-plan` and
`finance-tracker-copy-root-receipt`.
The selected physical manifest binds one copy/folder and catalog 3. Existing
legacy copies keep their legacy path; opening a copy does not silently migrate it.

Publication follows exact clean → admitted → ready → published → clean states.
Bounded plan pages admit fixed physical IDs before publication. All planned
bodies are staged durably before admission, including deterministic logical
commit and retained base-manifest evidence. Recovery reconstructs the binding
from stored evidence without the original in-memory preparation. Missing ready
or completed evidence is refused, not rewritten. Interrupted pre-admission
staging can leave unreachable objects; evidence is not deleted and uncertain IDs
are not automatically replaced. Recovery accepts only the exact old or new
logical result after full verification.

Immutable creates require fresh ownership at the adapter's final pre-mutation
boundary. Every authoritative pointer update additionally checks the exact
selected manifest. Manifest reads validate pinned ID, folder, name, kind,
explicit non-trash state, size and version. Fresh complete metadata brackets
check every visited immutable binding before accepting verification or publishing.
These guards are not provider compare-and-swap and do not eliminate races after
the final provider check.

Private byte reuse is limited to 8 MiB. Physical body facts have independent
512-entry/1-MiB budgets and become reusable only after successful fresh closure.
Every new operation opens fresh metadata; a fact hit must match the exact
file/folder/type/transaction/size/version/hash binding and register a new closing
witness. Failure, cancellation or session invalidation clears facts. Overflow
falls back to real bounded reads. Facts cannot provide bytes, semantic validity,
ownership or publication authority. Generated evidence and semantic consumers
still read actual bytes. These are cache budgets, not database-size ceilings.

**Remaining limits:** complete catalog/history checks, canonical source and
derived audits, full-ledger materialization and metadata maps remain. Immutable
bodies are bounded to 64 KiB, manifests to 16 KiB and plan pages to 32 entries;
no aggregate database ceiling is imposed. Synthetic recovery tests do not prove
live-provider behavior, mobile capacity or production readiness. Publication,
deployment and production approval remain separate gates.

## Focused verification

```sh
node --check js/physical-root-binding.mjs
node --test --test-concurrency=1 tests/physical-root-binding.test.mjs tests/paged-physical-locators.test.mjs
```

The physical suite covers exact publication states, durable-mutation
interruptions, fixed-ID recovery, semantic verification, ownership loss,
no-search restart, streamed plan preparation, byte ownership and verifier
lifetimes. Generic archive decoding retains its separate format tests.
Repository-wide checks, live synthetic acceptance and deployment are separate
verification gates.
