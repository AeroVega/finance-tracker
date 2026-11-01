# Finance Tracker — next steps and handoff

**Last updated:** 2026-11-01  
**Current workstream:** Workstream 1 — best-effort single-active-session coordination, branch `feat/single-active-session-coordination`  
**Current phase:** PR #20 is merged. PR #21's best-effort single-active-session coordination implementation and synthetic browser harness have passed owner-operated live tests for acquisition, guarded no-op writes, heartbeat, offline refusal, reconnect revalidation, stale expiry/recovery, and read-back verification. Final-head CI for the latest UI reporting fix is pending. Production financial-data storage is **not approved**.

This is the current pick-up point. PRs #17 and #19 are complete and merged. Workstream 1 is in progress on `feat/single-active-session-coordination`. Keep the sequence below; do not skip ahead to real ledger reads or writes.

## Current task: PR #21 — best-effort single-active-session coordination and live browser validation

Branch: `feat/single-active-session-coordination`  
Base: `main` at PR #20 merge commit `1e4fc1f86948f2892b5ab88a85d6f73d632719b8`.

Scope:
- Detect an existing active session and refuse a second session.
- Require verified ownership before each serialized write.
- Fail closed on incomplete folder enumeration, duplicate/malformed marker records, network errors, future-dated state, or uncertain read-back.
- Refresh and verify a heartbeat while the page is active/online.
- Release explicitly and verify release before device handoff.
- Never take over a stale session automatically; require explicit confirmation and re-read before recovery.
- Test stale sessions, network interruption, browser-crash expiry, lost responses, and orderly handoff using synthetic data only.

The Drive marker adapter, state machine, and browser harness are implemented on the PR #21 branch. The owner confirmed successful live synthetic-folder tests on 2026-11-01: session acquisition and guarded no-op write; automatic heartbeat; offline write refusal; explicit same-session revalidation after reconnect; stale-session detection after heartbeat expiry; explicit stale recovery with verified read-back. The UI now clears old marker status while a fresh inspection is pending, ignores superseded inspection results, and distinguishes an active marker from locally verified ownership. Final-head GitHub Actions run #141 passed 110/110 tests on commit `3bfaff6df0b74033ac504b8dc58a27b7c1b73014`, including the new inspection-freshness regression check. The tested Drive `If-Match` path is not an atomic lock; simultaneous starts and network partitions remain possible. This PR does not integrate session coordination into production ledger reads/writes and does not authorize production persistence.

## Completed checkpoints

- [x] PR #11 merged: canonical ledger/import-run contract and pure synthetic reconciliation reference module are on `main`. The full 41-test suite passed on the final reviewed PR head before merge.
- [x] PR #16 merged: Google authorization/configuration and Drive Experiments A+B integration.
- [x] PR #17 merged: typed folder-discovery outcomes, explicit Picker fallback, safe authorization/error handling, and synthetic regression coverage.
- [x] PR #17 final-head Node contract-test workflow passed (run #72).
- [x] PR #17 merge commit: `d2b941cbc10d9c3ca96c8beb7989b82ff3eef83e`.

**Verification note (confirmed 2026-10-30):** PR #17's final-head Node contract-test workflow passed (run #72), and the owner has now confirmed that the post-merge `main` workflow also succeeded. Both pre-merge and post-merge CI verification are complete. No new Pages deployment is implied by merging PR #17.

## Completed checkpoint: PR #19 merged

[PR #19 — Database identity, lifecycle, storage, and recovery architecture](https://github.com/AeroVega/finance-tracker/pull/19) merged the 108 accepted decisions. It is a documentation-only architecture baseline; it does not authorize production persistence or real financial-data storage.

The design now specifies:
- Logical database identity versus physical copies, primary/backup roles, lifecycle and derived health.
- Single-user, single-active-device operation; simultaneous use on two devices is unsupported, and the app must refuse writes when another active session is detected (best-effort detection, not a server lock).
- Required versioned manifest, UUIDs, timestamps, storage binding, and strict validation.
- Immutable content-addressed objects, complete commit snapshots, hash-chained commit history, and append-only transaction/migration records.
- Staged commits, interruption recovery, explicit initialization, verified backups/restores, copy registration, promotion, retirement, and forward-only MVP1 migrations.
- Conservative integrity gates, no offline writes, and no silent fallback to backups.

**Concurrency decision (owner-confirmed 2026-10-31):** retain Google Drive and adopt single-user, single-active-device operation. Simultaneous use on two devices is explicitly unsupported. The owner will not edit Drive files outside Finance Tracker and will end the active session before switching devices. The app must refuse writes when it detects another active session. The live raw REST probe showed that the tested Drive v3 `files.update` path accepts a deliberately stale `If-Match` value, so do not use it as a lock or spend time on the same two-session race. App-level session detection is best-effort, not a server-enforced mutex; simultaneous starts/network partitions may defeat it. Production writes remain blocked until the app demonstrates safe serialized writes, session-conflict handling, and crash recovery within this explicit operating constraint.

## Completed task: synthetic-only Google Drive feasibility spike ([PR #20](https://github.com/AeroVega/finance-tracker/pull/20))

See [Drive Feasibility Spike](DRIVE_FEASIBILITY_SPIKE.md) for the implemented Phase 1 harness, live test steps, pass/fail interpretation, and evidence log. PR #20's owner-confirmed live synthetic checks are complete. Final-head Node contract tests passed in GitHub Actions run #129 (73/73), and PR #20 merged to `main` at `1e4fc1f86948f2892b5ab88a85d6f73d632719b8`.

The merged PR #20 adds `prototype/drive-feasibility-spike.html`, its browser module, and `tests/drive-feasibility-spike.test.mjs` for the first feasibility gates. It must not read or write a real ledger. Use only a dedicated test folder and synthetic records.

**Live validation update (owner-confirmed 2026-10-31):** complete folder enumeration passed; pre-generated-ID retry returned HTTP 409; exact SHA-256 read-back passed; cleanup was confirmed. The original browser metadata response did not expose an ETag. The raw REST probe returned HTTP 200 despite a deliberately stale `If-Match`; read-back confirmed the probe description was written and Drive version advanced to 4. **The tested conditional-update mechanism failed.** The owner then accepted the single-active-device policy described above; the project is continuing with Google Drive under that explicit operating constraint.

1. **Folder visibility:** prove complete child enumeration, pagination, and safe empty-folder detection under the existing drive.file scope after Picker selection and reauthorization. The harness implements enumeration and fails closed on incomplete results.
2. **Immutable objects:** upload invented bytes, read them back, and verify raw SHA-256. This first iteration covers one isolated object, not the complete snapshot layout.
3. **Idempotent creation:** test pre-generated Drive file IDs, including a deliberately discarded successful response, same-ID retry, expected 409, and read-back verification.
4. **Session coordination:** implement best-effort active-session detection and refuse writes when another session is detected. Simultaneous use on two devices is unsupported by owner decision. Do not claim the session marker is a server-enforced lock; fail closed on ambiguous session state and document that simultaneous starts/network partitions remain a limitation.
5. **Recovery:** implement fault-injection coverage for every staged transaction boundary, including before/after manifest publication and before the final journal event. Recovery must be safe under the single-active-device operating model and must block further writes while an outcome is ambiguous.
6. **Backup/restore:** after session coordination and interruption recovery are validated, implement a synthetic snapshot copy/restore test with new `copyId`, object/hash verification, and preserved lineage.
7. **Cost and terms:** verify current Drive API terms, quotas, OAuth requirements, and the complete $0 recurring-cost path before production.

Record each result as **Verified**, **User-confirmed**, **Hypothesis**, or **Open**. A successful synthetic file round trip does not satisfy the session-coordination or recovery gates.

Phase 1 established folder enumeration, pre-generated-ID retry, exact synthetic-object hashing, and the failure of the tested raw REST stale-`If-Match` path. The owner accepted single-active-device use as the operating constraint. After PR #20 merges, implement and test session-conflict handling, serialized writes, and interruption recovery using synthetic data in a separate PR. Snapshot backup/restore and production storage remain gated until those safeguards, security, authorization, and $0-cost terms pass. No production ledger reads/writes, real financial records, or production storage implementation are in scope for this spike. Original CSV retention is 540 days (18 months) from successful private retention; backup copies must not reset that clock or resurrect expired originals.

### Historical discovery requirements retained from PR #17

A unique folder name, an earlier Picker selection, and a remembered comparison reference are not proof that a folder is the canonical Finance Tracker database. Safe onboarding and recovery must continue to respect these constraints:

1. **First connection:** authorize with Google and explicitly select the intended folder with Picker when discovery cannot safely establish identity.
2. **One exact-name match:** treat it only as a candidate until the app-owned manifest and storage binding are verified.
3. **Zero matches:** explain that no accessible match was returned; offer Picker. Never infer absence or auto-create a replacement.
4. **Multiple matches:** stop and ask the owner to select the intended folder.
5. **Missing, malformed, unsupported-version, or mismatched manifest:** stop without modifying files and explain the recovery path.

## Parallel MVP1 work: provider parsers and reporting semantics

The Drive prototype must not block the permanent file-import path.

- [ ] Add strict provider-specific parser tests for verified Wells Fargo, SoFi, and Fidelity CSV formats using fully invented fixtures.
- [ ] Implement the adapters against the merged canonical contract; preserve source dates, source descriptions, exact monetary values, account mapping, and provenance.
- [ ] Exercise repeat imports and overlapping exports through parser output, including pending-to-posted transitions, ambiguous matches, corrections/reversals, and partial-import recovery.
- [ ] Define and test report-level effective-state calculations for reversals, corrections, and explicit transfer links before reports rely on those events.
- [ ] Define investment reporting treatment for contributions, distributions, trades, dividends, fees, and market-value changes.
- [ ] Keep coverage/freshness explicit; unavailable data must never appear as zero or current.
- [ ] Keep sanitized real samples outside this public repository; never commit statements, exports, account identifiers, balances, tokens, or secrets.

## Remaining storage-readiness gates

These are required before any real ledger data may be stored in Drive. Successful synthetic folder discovery or a synthetic file round trip does not satisfy them.

- [ ] **Authorization and account handling:** verify account choice is clear; test expiry, revocation, wrong account, denied permissions, reconnect, and 401/403 recovery.
- [ ] **Session coordination and correctness:** demonstrate that the app detects an existing active session and refuses writes, serializes operations within the active session, prohibits offline writes, and recovers ambiguous outcomes. Simultaneous two-device use is explicitly unsupported; session detection is best-effort rather than a server-enforced mutex.
- [ ] **Crash/interruption recovery:** implement and test the documented staged-transaction, journal, retry, and ambiguous-outcome recovery behavior.
- [ ] **Backup, restore, and portability:** implement and test verified snapshot backup/restore, export validation, recovery steps, and portability.
- [ ] **Deletion and retention:** implement and test the approved 540-day (18-month) original-file retention lifecycle, distinguishing deletion eligibility from confirmed deletion and handling backup copies consistently.
- [ ] **Privacy/security review:** document threat model, least-privilege scope, browser token lifetime/storage, data exposure risks, and how errors/logs avoid sensitive data.
- [ ] **Sustainable cost and terms:** recheck current Google API terms/quotas and confirm the full design remains at $0 recurring cost without trials or enabling billing.
- [ ] **Owner acceptance:** review feasibility evidence, test results, failure states, and security/cost findings before separately authorizing any production-storage implementation.

## Working rules

- Work on focused feature branches and use PRs. Never commit directly to `main`, force-push, rewrite shared history, or merge without explicit owner approval.
- Read `AGENTS.md`, `README.md`, the roadmap, and relevant design docs before each new task.
- Report what was actually tested, CI/deployment status, limitations, and remaining risks. Separate **Verified**, **User-confirmed**, **Hypothesis**, and **Open** claims.
- GitHub Pages is public static hosting, not private storage. Keep the manual CSV import path permanent and keep production financial data out of the repository.
