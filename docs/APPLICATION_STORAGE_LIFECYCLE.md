# Application storage lifecycle integration

**Status:** PR #24 implementation in progress. Synthetic-only integration layer; not production persistence authorization.

## Purpose

js/application-storage-lifecycle.mjs composes the PR #21 session coordinator, Drive session adapter, and PR #23 transaction engine behind one application-facing lifecycle boundary. It centralizes rules that callers must not reimplement independently.

## Lifecycle

1. Require an explicitly synthetic test folder. The controller rejects a folder that is not identified as synthetic.
2. After Google authorization and folder selection, acquire and verify the page session.
3. Run transaction recovery before exposing the ready state.
4. Start background heartbeats and observe online/offline/pagehide lifecycle events.
5. Revalidate the exact prior session ID after reconnect; then recover before returning to ready.
6. Route mutations through the coordinator's serialized write queue and the transaction engine's own serialized transaction queue.
7. Release the session after queued writes drain during orderly handoff. A pagehide release is best effort only.

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

The existing dashboard still has no production database initialization or approved financial-ledger persistence path. PR #24 must not connect real CSV imports or real financial data to Drive. The permanent CSV import path remains available locally. Production ledger reads/writes remain disabled pending PR #25 and separate owner authorization.

The controller's injected factories exist to make lifecycle behavior deterministic in tests. They are not runtime configuration for production storage.

## Validation

 tests/application-storage-lifecycle.test.mjs covers synthetic-folder refusal, acquisition and recovery ordering, heartbeat startup, serialized transaction routing, offline refusal, same-session reconnect, recovery-required startup, orderly release, and best-effort pagehide release.

The complete Node contract workflow now runs node --test tests/*.test.mjs on pull requests to main. Passing CI is necessary but does not replace live synthetic Drive interruption/reload rehearsals or iOS Safari lifecycle testing.
