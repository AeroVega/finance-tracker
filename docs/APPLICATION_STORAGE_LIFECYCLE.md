# Application storage lifecycle integration

**Status:** PR #24 implementation integrated on the dashboard using synthetic fixtures only; not production persistence authorization.

## Purpose

js/application-storage-lifecycle.mjs composes the PR #21 session coordinator, Drive session adapter, and PR #23 transaction engine behind one application-facing lifecycle boundary. It centralizes rules that callers must not reimplement independently.

## Lifecycle

1. Require an explicitly synthetic test folder. The controller rejects a folder that is not identified as synthetic.
2. After Google authorization and folder selection, acquire and verify the page session.
3. Start background heartbeats immediately after verified acquisition, before initialization/recovery can consume a lease. Run transaction recovery before exposing the ready state.
4. Observe online/offline/pagehide lifecycle events; renew ownership during long operations.
5. Revalidate the exact prior session ID after reconnect; then recover before returning to ready.
6. Route transactions through the coordinator's serialized write queue and the engine's transaction queue. Session-marker operations have a separate serialized queue so heartbeats are not held behind an entire transaction.
7. Close admission to new writes, let admitted writes finish with ownership guards and renewal intact, then recheck unresolved recovery before releasing. A pagehide release is best effort only; it has the same post-drain safety check.

## Fail-closed behavior

- Offline state pauses writes; there is no offline write queue.
- Active ownership by another page/device blocks acquisition.
- Stale-session takeover requires explicit confirmation and is never automatic.
- Failed heartbeat or ownership verification pauses writes.
- Unresolved transaction recovery blocks normal reads and writes until recovery succeeds.
- Snapshot object reads are accepted only when the manifest reference, Drive metadata, and exact SHA-256 all agree.
- Release is not reported as successful unless the coordinator verifies the released marker by read-back.

## Deliberate boundaries

This PR's controller requires syntheticOnly: true and a folder name containing synthetic. This is an engineering integration harness, not an application production-storage switch.

The dashboard now uses this lifecycle for its synthetic sample-data path: after explicit Google authorization and synthetic-folder selection, startup acquires the session, initializes/reuses a synthetic-only manifest, recovers, and reads the saved invented sample snapshot through manifest, metadata, and SHA-256 verification. The sample-data action commits only rows explicitly tagged `syntheticOnly: true`; the dashboard renders the verified read-back. Clear writes an empty synthetic snapshot through the same transaction boundary. CSV imports remain a separate local-only collection and are never passed to the Drive storage API. The real financial ledger has no Drive read/write path. Production ledger reads/writes remain disabled pending PR #25 and separate owner authorization.

The controller's injected factories exist to make lifecycle behavior deterministic in tests. They are not runtime configuration for production storage.

## Validation

 tests/application-storage-lifecycle.test.mjs covers synthetic-folder refusal, acquisition and recovery ordering, heartbeat startup, serialized transaction routing, offline refusal, same-session reconnect, recovery-required startup, orderly release, and best-effort pagehide release.

The complete Node contract workflow now runs node --test tests/*.test.mjs on pull requests to main. Passing CI is necessary but does not replace live synthetic Drive interruption/reload rehearsals or iOS Safari lifecycle testing.

## PR #24 concurrency regression review

**Verified (local synthetic tests):** release previously set its handoff flag before draining a save, causing the save's next guard to fail. The lifecycle checked recovery only before the drain and could then report release despite the newly unresolved save. Regression tests now cover successful drain, failing drain, and automatic `pagehide` with a failing save. No release success is published for an unresolved outcome.

**Verified (local synthetic tests):** a transaction holding the old shared queue could starve its own heartbeat beyond the 120-second lease. Session-marker operations now serialize separately, and startup renewal begins before recovery. Tests advance a synthetic clock across multiple heartbeat intervals while transactions/recovery remain pending. Offline, stale, or replaced ownership still fails closed; this is not a server-enforced lock.

**Verified (source and supplied screenshots):** the dashboard could retain a transaction error while a later release continuation displayed success. The independent UI success writer is removed; the storage wrapper checks the returned result, current lifecycle identity, released state, and unresolved flag. A missing lifecycle is not a successful release.

**Open:** the initiating event behind the reported spontaneous release has not been established. There is no idle-release timer in the application. `pagehide` can request automatic release, but its status text differed from the supplied screenshot. Do not infer a deliberate click from that screenshot.

The dashboard's expandable diagnostic panel keeps a bounded, in-memory event history (release source, safe state transitions, browser event booleans, and source build). It does not persist or upload diagnostics, tokens, file IDs, folder names, CSV rows, or financial values. Reload clears the history. Diagnostic observers cannot change storage behavior.

**Open:** these checks do not establish that the live Drive metadata HTTP 404 is fixed. Confirm the browser source commit, retain the sanitized create outcome and exact action (save versus recovery), and use the procedure in `DRIVE_TRANSACTION_ENGINE_TESTING.md`. Real iOS Safari lifecycle and live synthetic Drive tests remain necessary; no live account operations were performed for this patch.
