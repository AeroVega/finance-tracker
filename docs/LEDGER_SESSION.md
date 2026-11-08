# Owned in-memory ledger sessions

**Implemented:** `createLedgerSessionOwner()` adds an optional cache for financial-event commands and read views. Existing pure canonical functions remain supported. It does not save, claim a storage session, rewrite history, or authorize production data.

## Ownership and boundaries

Create one owner for the application's current ledger. `owner.open(json, storageBinding)` first invalidates the prior session, then parses, deeply freezes and fully validates the supplied JSON. The nonempty binding string must identify the application's current verified lifecycle/copy/base, with a local generation. It is diagnostic binding, not remote authorization or a lock. A session cannot change its binding. Each open has a new owner generation; every method checks its handle is still current.

The integrating application must call `owner.invalidate()` **before** import, review/reversal, account changes, reload/recovery, lifecycle/copy changes, and every save attempt, before awaiting external work. Reopen only from a newly validated result and current binding. A failed or uncertain save must leave the session closed until recovery and verified reopen. Keep the frozen draft separately for the existing warning/recovery UI. Storage ownership, exact-base verification and commit validation remain mandatory and unchanged. A caller that fails to route a boundary through the owner violates this contract; the module does not observe external storage automatically.

`session.snapshot()` returns a deeply frozen ledger, sharing unchanged records and collections with prior snapshots. Retaining an old snapshot is safe but retains memory and does not make it current. `validatedSnapshot()` and `exportJson()` perform full graph validation for boundary/save/export use. `effectiveActivity(id)` and `effectiveActivities()` return detached projected records; modifying them cannot alter the ledger or cached replay. `summarizePeriodsJson(scopesJson)` returns detached reports using the current replay. No Map, Set or mutable index is exposed.

`session.close()` and `owner.invalidate()` are idempotent and release the cache's graph/index references. Old handles reject further operations. Caller-retained snapshots still exist; this is not secure memory erasure. `session.binding()` returns a frozen generation, storage binding and revision record. `session.revision()` returns the current revision.

## Commands and failures

`session.applyBatchJson(batchJson, expectedRevision)` accepts a JSON array of `{command, eventId, recordedAt}` entries. The strings carry no caller getters or callbacks. IDs and clocks remain supplied by the application, just as with pure commands. An expected revision rejects an asynchronously prepared stale proposal. Accepted new events advance revision once per batch; empty or entirely idempotent batches do not advance it.

Commands run in order against private replay and refund indexes. Each uses the existing event builder, history validation, exact-amount/refund checks, idempotency signature and JSON checks. The original immutable graph remains published until every command succeeds. Only then does one replacement event array become visible. No external callback or await runs in the operation; reentrant preparation is rejected. Validation preserves the pure API's replay/refund-before-JSON error precedence.

Every preparation failure rebuilds all mutable indexes from the unchanged published graph. If reconstruction fails, the session closes and discards its references instead of allowing further commands against uncertain state. The original command error is returned. Allocation/process termination cannot be promised recoverable, but no partially prepared ledger is published. Parsing and revision errors occur before cache mutation. No persistence transaction occurs.

## Verification and limits

**Verified locally:** the session-specific tests cover immutable/deep alias boundaries, detached projections/reports, ordered/idempotent commands, failures at the beginning/middle/end of batches, stale revisions and generations, failed replacement, disposed handles, reconstruction failure poisoning, reentrant attempts, refund error precedence, 1,000 seeded pure/session differential commands, and dense one-year graph/projection/report equality.

The repeatable `node --expose-gc tests/benchmark-ledger-session.mjs session 10` and corresponding `pure 10` commands run separate CPU-only invented ten-year fixtures. Their final validated JSON hashes must match. Each reports opening, ten event commands, validated export, retained heap after GC, and whole-process high-water RSS. The latter includes fixture construction and is not the operation's true peak. These benchmarks do not prove a browser/mobile memory reduction or a network/storage speedup. Sessions deliberately retain replay/index state, trading persistent memory for lower repeated-command CPU. Opening, full export and pure fallback still scan the full graph.

**Open:** integration boundary testing, independent review, browser/mobile behavior, owner live acceptance and deployment. This feature does not change the synthetic-only production gate.
