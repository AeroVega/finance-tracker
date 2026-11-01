# Transaction Staging and Crash Recovery

**Status:** Protocol core merged in PR #22; durable Drive transaction engine under implementation in PR #23. Synthetic-only until all storage-readiness gates pass.  
**Branch:** `feat/durable-drive-transaction-engine`  
**Scope:** Durable Drive adapter, staged commits, append-only journal events, idempotent immutable object creation, manifest publication, and conservative deterministic recovery. Application lifecycle integration is PR #24.

## Product requirement: session coordination is background behavior

The owner has explicitly decided that session claiming, heartbeats, ownership inspection, reconnect revalidation, stale-session detection, recovery, and orderly release are internal application lifecycle behavior. The normal user must not be asked to manage leases or press heartbeat/recovery buttons.

The application should automatically:

1. Acquire a session after the user has authorized Drive and the intended database has been identified.
2. Verify the claim by reading the marker back before enabling database operations.
3. Maintain the heartbeat while the app is active and online, using a conservative interval.
4. Stop accepting writes immediately when offline, when ownership cannot be verified, or when the app is suspended long enough that the lease may have expired.
5. Revalidate the exact prior session after connectivity returns. Do not silently claim a different session or take over another device's active session.
6. Detect a stale session and attempt only safe, evidence-based recovery. If stale ownership is conclusive and the same one-device operating constraint still applies, recovery may run automatically with a visible status message. If evidence is ambiguous, stop and ask the owner to resolve it.
7. Drain in-flight writes and release the session during an orderly app shutdown/device handoff. Browser shutdown events are best-effort; correctness must not depend on them firing.
8. Keep routine status unobtrusive. Show a small connection/sync state, not session IDs, lease timestamps, or manual controls in the everyday interface.

Manual intervention is reserved for genuinely ambiguous or unsafe conditions: conflicting ownership, duplicate/malformed markers, unknown transaction outcomes, failed verification, authorization problems that require sign-in, or a recovery decision that could discard or overwrite data. Never hide a safety stop, but explain it in ordinary language and offer a clear next action.

The session marker remains best-effort coordination, not a server-enforced lock. The owner accepts single-user, single-active-device operation and will not use two devices simultaneously or edit database files outside Finance Tracker. The app must still fail closed whenever it detects a conflict or cannot verify ownership.

## Transaction invariants

- The previously committed manifest and all objects it references remain untouched until a complete new snapshot has been staged and verified.
- Every logical operation has one UUID v4 transaction ID. A retry of the same operation reuses that ID and its previously allocated Drive file IDs.
- A durable transaction-start journal event must be verified before any staged object is created.
- Journal events are append-only, individually identifiable, sequenced, and hash-linked. Existing events are never rewritten.
- Data objects and commit records are immutable. Objects are named/addressed by raw-byte SHA-256; commit/journal records use RFC 8785 JCS canonicalization before hashing.
- The commit record describes the complete resulting logical path-to-hash map, reusing unchanged object hashes.
- The manifest pointer is published last. A commit is not successful until the manifest, commit record, and every referenced object are read back and verified.
- Every Drive mutation runs inside the app's serialized write queue and under a verified active session. No offline writes or background queueing of financial writes.
- A Drive read/check/update sequence is not atomic. It is accepted only under the explicit one-device operating constraint and best-effort session coordination. If another session is observed, ownership is uncertain, or the expected base revision/commit has changed, refuse publication.
- If a response is lost, inspect the known pre-generated file ID and exact expected content. Never blindly create a second object or replay a transaction from scratch.
- An unknown outcome blocks further writes until recovery resolves it. Do not infer success from an HTTP response or local UI state alone.

## Commit protocol

For an operation based on manifest revision R and commit C:

1. Acquire/verify the background session; require online status and a healthy primary copy.
2. Read and validate the manifest, complete commit history, journal state, and all objects needed for the current committed snapshot.
3. Capture the expected base tuple (databaseId, copyId, revision R, commitId C). Allocate transactionId and all required Drive file IDs using cryptographically secure UUID v4 / Drive-generated IDs.
4. Append and verify a `transaction-started` journal event containing the operation type, base tuple, intended logical paths, and planned immutable file IDs/hashes. No staging starts until this event is durable.
5. For each changed object: compute SHA-256 over exact bytes; append/verify a staging-intent event; create using its pre-generated Drive ID; on HTTP 409 or a lost response, fetch that same ID; verify parent folder, metadata, exact bytes, and hash; then append/verify an object-staged event.
6. Build the complete resulting snapshot map and immutable commit record, including revision R+1, parent C, transactionId, operation type, schema version, committedAt, previous history hash, and record hash. Create and read back the commit record; verify its hash and all references.
7. Re-read the manifest and confirm it still identifies the captured base tuple. Revalidate session ownership immediately before publication. If either differs or cannot be established, do not publish; record a conflict/unknown outcome and preserve staging for recovery.
8. Publish the manifest pointer to the new revision/commit. Read the manifest back with bounded exponential backoff. Verify exact identity, pointer, and complete referenced snapshot. A delayed or failed read-back is an unknown outcome, not a failed commit.
9. Append and verify the terminal `transaction-committed` journal event. If this event cannot be written after publication, recovery must infer the committed outcome from the authoritative manifest and append the missing terminal event later.
10. Report success only after the manifest and complete snapshot verify. Staged objects are retained until the terminal outcome is durable and a complete history scan proves any unreferenced staging objects are safe to clean.

## Recovery protocol

Recovery runs automatically when opening the database and before any new write if the journal contains a nonterminal transaction. It is also run after reconnect/re-authorization. It does not require the user to navigate a maintenance screen.

For each incomplete transaction, inspect the manifest, transaction journal, commit record, and every referenced object:

- **Manifest points to intended commit; full snapshot verifies:** transaction committed. Append the missing committed event if necessary; then resume normal operation.
- **Manifest remains at original base; staged commit is complete and verified:** under the single-active-device model, revalidate session ownership and the exact base tuple. If still valid, automatically resume publication and verify it. If the base changed, session ownership is uncertain, or publication cannot be verified, do not publish.
- **Manifest remains at original base; staging is incomplete but all expected files are known:** record an aborted outcome only when evidence proves publication never occurred and the transaction can safely be abandoned. Preserve diagnostics. Clean only staged objects proven unreferenced by a complete commit-history scan.
- **Manifest points to neither the base nor intended commit, an object is missing/mismatched, history is broken, folder enumeration is incomplete, or evidence conflicts:** mark the copy as needing attention, disable writes, preserve all files, and ask for explicit intervention. Never guess, overwrite, or automatically delete.

Recovery is idempotent: repeating it must produce the same verified outcome and must not create duplicate logical commits or duplicate financial records.

## Journal event minimum

Each immutable event contains:

- format/version, transactionId, eventId (UUID v4), monotonically increasing sequence, eventType, and UTC timestamp;
- operationType and expected base revision/commit where applicable;
- opaque logical paths, pre-generated Drive file IDs, expected raw-byte hashes, and relevant commit IDs;
- previousEventHash and eventHash, with eventHash computed over JCS canonical JSON excluding the eventHash field.

Events contain no amounts, merchant descriptions, account numbers, balances, CSV contents, OAuth credentials, or other financial details. The journal is append-only and retained indefinitely in MVP1.

## Implementation slices

1. **Protocol core (PR #22, merged):** pure deterministic transaction state machine and strict validation, independent of Google APIs; synthetic tests for event sequencing, hashes, idempotency, invalid transitions, and recovery classification.
2. **Drive transaction adapter (PR #23):** complete folder enumeration, pre-generated IDs, immutable object creation/read-back, journal event persistence, commit record persistence, and manifest publication/read-back.
3. **Recovery engine (PR #23):** reconstruct state from durable events and authoritative manifest; resume/finalize only where evidence is conclusive; fail closed otherwise.
4. **Application lifecycle integration (PR #24):** automatically coordinate session acquisition/heartbeat/revalidation/recovery/release; serialize all storage mutations; keep user-facing session controls out of normal UI.
5. **Fault-injection/live synthetic validation (PR #23/24):** inject a lost response after every durable mutation in deterministic tests; rehearse live Drive publication/read-back, browser reload, authorization interruption, and delayed visibility with synthetic data.
6. **Production readiness review (PR #25):** backup/restore, security/privacy, 540-day source retention/deletion, OAuth behavior, current Google terms/quotas, and sustainable $0 operation remain separate gates.

## Acceptance criteria

- [ ] The old committed manifest and all referenced bytes remain unchanged for every failed or interrupted pre-publication transaction.
- [ ] Every stage is recoverable by transaction ID and pre-generated Drive file ID without duplicate objects.
- [ ] A lost response after manifest publication is recognized as committed only after complete read-back verification.
- [ ] A lost final journal response is repaired from the authoritative manifest without creating another commit.
- [ ] Every crash boundary has a deterministic synthetic test, including after transaction start, each object create, commit-record create, manifest publish, manifest read-back, and terminal journal append.
- [ ] Unknown or inconsistent outcomes block all further writes and preserve diagnostic evidence.
- [ ] Session acquisition, heartbeat, reconnect revalidation, recovery, and release happen automatically during normal app lifecycle; manual session management is not part of the ordinary UI.
- [ ] Offline writes are impossible; reconnect requires same-session revalidation before operations resume.
- [ ] All mutations are serialized; no transaction may publish from a stale base revision/commit.
- [ ] No real financial data, account identifiers, Drive folder IDs, credentials, or tokens appear in the public repository or CI artifacts.
- [ ] Production financial-data persistence remains disabled until all separate storage-readiness gates are explicitly passed.
