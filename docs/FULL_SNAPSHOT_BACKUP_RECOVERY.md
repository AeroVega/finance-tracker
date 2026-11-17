# Full-snapshot backup and recovery

## Acceptance contract

This work uses synthetic data only. It adds no second storage writer and no draft persistence. The owner approved on-demand backup of the last verified saved logical database, optional password encryption, fresh-folder-only restore with independent verification, and automatic safe recovery with explicit retry. Physical save revisions are not portable backup content.

## Recovery state table

| Evidence after a failed write | Outcome | Safe next action |
| --- | --- | --- |
| The exact attempted authority and complete logical candidate independently verify | Saved | Clear only that matching draft; do not repeat the save |
| Original authority is unchanged, no authority publication was dispatched, and local mutations have settled | Not saved | Retain draft and offer explicit retry |
| An authority request was dispatched but its result is unknown, even if an immediate read still shows the old base | Unverifiable | Keep draft and block retry; a late remote write may still arrive |
| A different valid authority or logical database is found | Different | Keep draft and block retry; explicit reopen may discard it only after confirmation |
| Ownership, folder, transport, authentication or content validation cannot be established | Unverifiable | Keep draft; explain reconnect/recovery requirement |
| The app was reloaded and has no attempted-save evidence | No attempt context | Verify stored data without claiming whether the lost draft was saved |

Recovery is single-flight and must not race an outstanding local mutation. It may finalize an already published valid transaction, never resubmit a candidate automatically. A transport promise ending does not prove an uncertain server request can no longer commit. Ordinary successful saves do not run recovery, backup or a full-history reopen.

## Backup and restore

A fresh verified full-history read supplies the last saved ledger without replacing staged edits. Explicitly excluding staged changes is required when a draft is dirty. The portable file preserves the complete logical ledger and its financial history, source records, provenance and relationships; it excludes physical Drive revision history, ownership state and credentials. A plaintext checksum detects accidental corruption, not malicious replacement.

Optional encryption uses AES-256-GCM with a fresh random 96-bit IV, a 128-bit authentication tag and canonical envelope-header additional authenticated data. PBKDF2-HMAC-SHA-256 derives the key with a fresh random 128-bit salt and a fixed 600,000 iterations. Unsupported KDF parameters are rejected before derivation. These choices follow the parameter guidance in Mozilla’s [AesGcmParams](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams) and [Pbkdf2Params](https://developer.mozilla.org/en-US/docs/Web/API/Pbkdf2Params) references. The iteration count is this format’s fixed profile, not a claim of universally acceptable device performance.

The password is not persisted or logged; forgotten passwords cannot be recovered. JavaScript cannot promise password memory zeroization. Apple-device KDF latency and memory capacity have not been measured. The codec holds a bounded archive in memory rather than streaming it. Tests include real Web Crypto encryption/decryption and a deterministic interoperability check that independently derives and decrypts an export with Node’s classic crypto API. That check is not a published cryptographic known-answer vector or independent validation of the underlying cryptographic implementation.

Logical domain fields accepted by the ledger validator are preserved, including optional extensions. The codec adds no Drive identifiers or credentials, but does not scrub arbitrary secrets someone might have placed in a ledger’s free-text or extension fields. The encrypted envelope authenticates its contents under the password-derived key; it does not certify an external sender’s identity.

Decode and validate the complete file before destination selection. Restore uses the existing empty-folder initialization and writer. Success requires release, a fresh application/adapter instance, full open, exact logical equality and recomputed-report equality. A partial destination is never deleted or blindly reinitialized. Source backup bytes and source database are not modified.

## Verification gates

Write failing tests before each implementation slice. Inject faults before and after each mutation boundary and assert that each fault fired. Cover delayed writes, corrupt data, token expiry, offline transitions, repeated clicks/recovery, cancellation, missing attempt context, encrypted/plaintext backups, invalid files and fresh-instance restore. Preserve normal open/save request counts; measure special operations separately. Independent review, full extended suite and exact-head CI precede one bounded live synthetic check. Simulator results do not certify Google or physical Apple Safari behavior. No deployment, merge or real-data authorization follows from these tests.

## Initial automated performance comparison

The cleanup baseline and candidate used identical invented provider profiles. Stable seed/save/release/reopen remained 100/80/7/35 requests; version-settling remained 107/84/10/40. Peak reads remained 2 and writes 1. Modeled service time for the slow profile was unchanged (save 27.095 s, reopen 11.430 s). Modeled service sums are not wall-clock latency, and local CPU runs were contended, so they are not live speedup claims. Special backup/restore/recovery paths run additional verification by design.

The existing application does not independently bind OAuth tokens to a Google account ID. Recovery holds the same lifecycle, folder and ownership capability and fails closed on authorization loss; full account/database binding remains a separate production gate. The simulator cannot prove remote finality of an unknown dispatched PATCH. After app closure, in-memory attempt evidence is gone; a later open can verify stored records but cannot prove the outcome of the lost draft. These are explicit limitations, not implied safety guarantees.

One representative synthetic special-operation run (slow profile assumptions, no wall-clock delay) used 16 requests for plaintext export and 16 for encrypted export; local file validation used zero. Restore plus fresh-instance verification used 148 requests, and a save with an accepted pending publication/lost response plus automatic recovery used 110. Modeled service sums were 4.189 s per export, 47.298 s for restore and 32.672 s for the save/recovery case. These are simulator cost illustrations, not elapsed live time. Local CPU times, including fixed KDF cost, varied under concurrent tests and do not establish mobile acceptance.

## Candidate verification (2026-11-17)

The retained extended Node suite passed 915/915, with zero failures, cancellations or skips. Independent codec, recovery-outcome and restore review found no remaining blockers after correcting and regressing expired authorization during final restore verification and changed-destination refusal. Crypto compatibility was checked independently through Node's classic PBKDF2/AES-GCM APIs in addition to Web Crypto round trips. Exact-head remote CI and the bounded live synthetic check remain separate gates. No Apple Safari, OS download completion, mobile KDF/memory, or live provider acceptance is claimed.
