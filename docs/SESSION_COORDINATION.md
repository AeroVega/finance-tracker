# Single-active-session coordination

**Status:** PR #21 implementation baseline; synthetic contract tests only. Not production storage authorization.

## Operating rule

Finance Tracker is single-user and single-active-device. A device must acquire and verify the active session before any storage mutation. A second active session is refused. The owner must explicitly release the session before switching devices.

This is best-effort coordination, not a server-enforced mutex. The tested Drive v3 update path accepted a deliberately stale `If-Match` header, so it cannot be used for atomic compare-and-swap or fencing. Simultaneous starts, a network partition, and a client that continues after losing connectivity can still produce races. This limitation must remain visible in product and release documentation.

## Session record contract

The version-1 session record contains:
- `format` and `version` for strict recognition;
- a random per-page `sessionId`;
- `state`: `active` or `released`;
- `startedAt`, `heartbeatAt`, and `expiresAt` as UTC epoch milliseconds;
- `releasedAt`, null until orderly release.

The storage adapter must read the complete record and distinguish an absent record from an unavailable or malformed result. It must not map network errors, authorization failures, incomplete enumeration, or malformed JSON to "no session."

## Acquisition and write gating

1. Read and validate the current record.
2. If active and within the heartbeat window, refuse acquisition.
3. If stale, do not take over automatically. Require an explicit recovery action, re-read the exact record immediately before replacement, and verify the replacement by read-back.
4. If released or absent, write a new session record and read it back. Only an exact owner match establishes local ownership.
5. Before every mutation, re-read the record and require an exact active `sessionId` match. Serialize mutations within the page.
6. Offline status, read errors, malformed/ambiguous state, changed ownership, failed heartbeat, or failed read-back disables writes.

The re-read-before-write pattern narrows races but is not atomic. It must never be described as preventing every concurrent writer.

## Heartbeats, crashes, and handoff

The active page uses `SessionCoordinator.startHeartbeat()` to refresh `heartbeatAt` and `expiresAt` on a regular cadence (default: one third of the expiry window). A heartbeat first verifies the current owner, then writes and reads back the refreshed record. Going offline or encountering a failed/unverifiable heartbeat immediately disables writes and stops the timer. Browser background suspension may delay timers; every write still performs a fresh ownership read, so an expired lease blocks writes on resume. After a transient interruption, the same page may call `SessionCoordinator.resume()`; it regains ownership only if the exact prior session ID is still active. If the lease has expired, explicit stale-session recovery is required. If another ID owns the marker or the marker is ambiguous, writes remain disabled.

Orderly device handoff is:
1. Stop accepting new writes.
2. Wait for in-flight serialized writes to finish.
3. Write `state: released` and `releasedAt`.
4. Read the record back and verify the same `sessionId` is released.
5. Only then switch devices.

A browser crash cannot reliably execute release. Its record ages into the stale state after the heartbeat window. The next device must use explicit stale-session recovery; the old device must not be assumed dead solely because a heartbeat is late. A browser close/pagehide event is only a best-effort release opportunity, never proof of release.

## Failure behavior

| Condition | Required behavior |
| --- | --- |
| Another fresh active session | Refuse acquisition and all writes from this page |
| Stale heartbeat | Require explicit user-confirmed recovery; no automatic takeover |
| Network interruption or Drive error | Ownership unknown; disable writes |
| Malformed/future-dated/contradictory record | Fail closed; require manual resolution |
| Ownership changes during a heartbeat/write check | Disable writes immediately |
| Release write/read-back fails | Do not claim handoff completed; keep writes disabled |
| Offline | No writes and no local queue |

## Test scope and limitations

`js/session-coordination.mjs` is a storage-adapter-independent state machine. `tests/session-coordination.test.mjs` uses a deterministic in-memory adapter and covers active-session refusal, stale recovery, malformed/future records, network interruptions, ownership loss, offline refusal, local write serialization, orderly release, release failure, and browser-crash staleness.

These tests verify client logic, including lost create/update responses resolved only by exact read-back, not Google Drive's live consistency, multi-device mutual exclusion, background timer behavior on iOS Safari, or production integration. The browser harness `prototype/session-coordination-test.html` exercises the real coordinator and Drive adapter with the existing Google OAuth and Picker configuration. It rejects the canonical `finance-tracker-database` folder by name and requires explicit confirmation that the selected folder is dedicated to synthetic testing. Use it only with a separate synthetic folder. The harness does not read or modify ledger files; its only Drive mutation is the session marker. It intentionally leaves a released marker in place for the next device to reuse. No production manifest, ledger, or CSV data may be accessed.

## Explicit limitations

- No server-enforced lock or fencing token exists.
- A read/check/write/read-back sequence can still race because Drive updates are not atomic compare-and-swap.
- Browser crashes cannot guarantee release.
- Network partitions can hide another session or prevent verification.
- Device clocks may differ; future-dated records are treated as ambiguous.
- Heartbeat timing must be conservative and tuned against iOS Safari background suspension.
- Do not enable production financial-data writes based solely on this prototype.
