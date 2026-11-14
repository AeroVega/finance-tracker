# Application storage lifecycle integration

## PR25 synthetic catalog path — 2026-11-03

The dashboard now opts into `catalogProtocol: true` and uses `CatalogTransactionEngine`. Fresh bootstrap writes a real genesis commit and immutable catalog before its manifest. Reads verify the selected logical commit and retained ancestry; pending finalization or a read/auth/integrity failure pauses access until reconnect/recovery. Initialization receives the session guard for each mutation. PR25 requires a fresh empty synthetic folder; PR24-format folders are rejected and are not converted or upgraded. See [the per-copy locator catalog design](DRIVE_LOCATOR_CATALOG_DESIGN.md) and [synthetic storage acceptance record](SYNTHETIC_STORAGE_ACCEPTANCE.md) for live-test requirements.

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

The dashboard now uses this lifecycle for its synthetic sample-data path: after explicit Google authorization and synthetic-folder selection, startup acquires the session, initializes/reuses a synthetic-only manifest, recovers, and reads the saved invented sample snapshot through manifest, metadata, and SHA-256 verification. The sample-data action commits only rows explicitly tagged `syntheticOnly: true`; the dashboard renders the verified read-back. Clear writes an empty synthetic snapshot through the same transaction boundary. CSV imports remain a separate local-only collection and are never passed to the Drive storage API. The real financial ledger has no Drive read/write path. Production ledger reads/writes remain disabled. PR #27 records the production persistence plan only. Production persistence requires separately authorized implementation, acceptance evidence, and explicit owner approval; merging the planning PR does not enable it.

The controller's injected factories exist to make lifecycle behavior deterministic in tests. They are not runtime configuration for production storage.

## Validation

 tests/application-storage-lifecycle.test.mjs covers synthetic-folder refusal, acquisition and recovery ordering, heartbeat startup, serialized transaction routing, offline refusal, same-session reconnect, recovery-required startup, orderly release, and best-effort pagehide release.

The complete Node contract workflow now runs node --test tests/*.test.mjs on pull requests to main. Passing CI is necessary but does not replace live synthetic Drive interruption/reload rehearsals or iOS Safari lifecycle testing.

## PR #24 concurrency regression review

**Verified (local synthetic tests):** release previously set its handoff flag before draining a save, causing the save's next guard to fail. The lifecycle checked recovery only before the drain and could then report release despite the newly unresolved save. Regression tests now cover successful drain, failing drain, and automatic `pagehide` with a failing save. No release success is published for an unresolved outcome.

**Verified (local synthetic tests):** a transaction holding the old shared queue could starve its own heartbeat beyond the 120-second lease. Session-marker operations now serialize separately, and startup renewal begins before recovery. Tests advance a synthetic clock across multiple heartbeat intervals while transactions/recovery remain pending. Offline, stale, or replaced ownership still fails closed; this is not a server-enforced lock.

**Verified (source and supplied screenshots):** the dashboard could retain a transaction error while a later release continuation displayed success. The independent UI success writer is removed; the storage wrapper checks the returned result, current lifecycle identity, released state, and unresolved flag. A missing lifecycle is not a successful release.

**Open:** the initiating event behind the reported spontaneous release has not been established. There is no idle-release timer in the application. `pagehide` can request automatic release, but its status text differed from the supplied screenshot. Do not infer a deliberate click from that screenshot.

The main workspace's Recovery and advanced tools keeps bounded, in-memory shared reports and typed action, lifecycle, request and browser-event breadcrumbs. It does not persist or upload diagnostics, tokens, file IDs, folder names, CSV rows, or financial values. Reload clears the history. Diagnostic observers cannot change storage behavior.

**Open:** these checks do not establish that the live Drive metadata HTTP 404 is fixed. Confirm the browser source commit, retain the sanitized create outcome and exact action (save versus recovery), and use the procedure in `DRIVE_TRANSACTION_ENGINE_TESTING.md`. Real iOS Safari lifecycle and live synthetic Drive tests remain necessary; no live account operations were performed for this patch.


## Dashboard behavior and concurrency safety

The dashboard's synthetic storage lifecycle is the sole Drive-backed dashboard sample-data path. It performs session acquisition, manifest initialization, startup recovery, heartbeat, verified snapshot reads, serialized commits, hash-verified read-back, reload restoration, Clear, and orderly release. Only invented rows explicitly marked `syntheticOnly: true` are eligible for synthetic Drive writes. CSV-imported rows, source-file metadata, and fingerprints remain local and are never included in synthetic snapshots.

Clear does not optimistically remove local CSV imports. It captures the selected synthetic row/source/fingerprint identities and removes only that selection after a verified remote result. A failed remote operation preserves local rows and provenance. Imports remain usable during remote I/O. Duplicate sample/Clear actions and manual Release are gated while a synthetic mutation is in flight; direct handlers also refuse unsafe actions.

The regression suite preserves these concurrency properties:
- Already-admitted writes drain with ownership guards and renewal intact before release.
- Recovery is rechecked after the drain and before release-marker mutation.
- Heartbeat/session-marker operations use a separate serialized queue so long transactions do not starve lease renewal.
- Startup renewal begins after verified acquisition and before initialization/recovery.
- A later asynchronous completion cannot overwrite a newer ownership/recovery error with a success message.
- Missing lifecycle state or an unverified release cannot be reported as success.
- Recovery preflights journal chains and identities, then mutates only the selected exact database/copy pair. Verified foreign histories remain untouched; unidentified, corrupt, or conflicting evidence still blocks recovery.

The initiating event behind an earlier unexpected-release symptom was not established. The historical Drive metadata HTTP 404 root cause was also not definitively established. Successful later acceptance does not prove either historical root cause was resolved; use the action/build/create-outcome diagnostic procedure in [Drive Transaction Engine Testing](DRIVE_TRANSACTION_ENGINE_TESTING.md) if either symptom recurs.

## Live performance observation

The owner-observed synthetic dashboard acceptance recorded approximately 50 seconds for initial recovery, 53–55 seconds for subsequent reconnect/recovery cycles, and approximately 4 seconds for orderly release. Treat these as an historical baseline, not a service-level guarantee. Profile request-level timings separately; do not weaken recovery, ownership, integrity, or read-back checks to reduce latency.
