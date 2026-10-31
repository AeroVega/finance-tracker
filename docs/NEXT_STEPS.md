# Finance Tracker — next steps and handoff

**Last updated:** 2026-10-31  
**Current workstream:** Workstream 1 — synthetic-only Google Drive feasibility spike, branch `feat/drive-feasibility-spike`  
**Current phase:** Feasibility implementation and live validation; production financial-data storage is **not approved**.

This is the current pick-up point. PRs #17 and #19 are complete and merged. Workstream 1 is in progress on `feat/drive-feasibility-spike`. Keep the sequence below; do not skip ahead to real ledger reads or writes.

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
- Required versioned manifest, UUIDs, timestamps, storage binding, and strict validation.
- Immutable content-addressed objects, complete commit snapshots, hash-chained commit history, and append-only transaction/migration records.
- Staged commits, interruption recovery, explicit initialization, verified backups/restores, copy registration, promotion, retirement, and forward-only MVP1 migrations.
- Conservative integrity gates, no offline writes, and no silent fallback to backups.

**Critical unresolved feasibility gate:** Google Drive concurrency. The design requires server-enforced stale-write exclusion. A client-side read-version-then-update sequence is not sufficient. The Drive file version is useful for detecting changes, but the current API review has not established a compare-and-swap contract for manifest publication. If a safe writer/fencing mechanism cannot be demonstrated, production ledger writes remain blocked or the storage architecture must be reconsidered.

## Active task: synthetic-only Google Drive feasibility spike ([PR #20, draft](https://github.com/AeroVega/finance-tracker/pull/20))

See [Drive Feasibility Spike](DRIVE_FEASIBILITY_SPIKE.md) for the implemented Phase 1 harness, live test steps, pass/fail interpretation, and evidence log. PR #20 is intentionally a draft pending CI review and live validation.

The active branch `feat/drive-feasibility-spike` adds `prototype/drive-feasibility-spike.html`, its browser module, and `tests/drive-feasibility-spike.test.mjs` for the first feasibility gates. It must not read or write a real ledger. Use only a dedicated test folder and synthetic records.

**Live validation update (owner-confirmed 2026-10-31):** complete folder enumeration passed (including an empty listing and subsequent listing with two synthetic children); pre-generated-ID retry returned the expected HTTP 409; exact SHA-256 read-back passed; cleanup was confirmed to leave no child items. The original browser ETag probe did not expose an ETag, so no two-session conditional write was attempted. A raw REST stale-`If-Match` probe has now been added to the harness; its live result remains open.

1. **Folder visibility:** prove complete child enumeration, pagination, and safe empty-folder detection under the existing drive.file scope after Picker selection and reauthorization. The harness implements enumeration and fails closed on incomplete results.
2. **Immutable objects:** upload invented bytes, read them back, and verify raw SHA-256. This first iteration covers one isolated object, not the complete snapshot layout.
3. **Idempotent creation:** test pre-generated Drive file IDs, including a deliberately discarded successful response, same-ID retry, expected 409, and read-back verification.
4. **Concurrency:** first run the new raw REST stale-`If-Match` probe against a verified synthetic race-test file. HTTP 412 indicates the stale precondition was enforced; a successful update indicates the header was ignored; browser/CORS failure is inconclusive. If the raw probe returns 412, proceed to simultaneous conditional updates from two browser sessions and require repeatable one-success/one-412 outcomes. A version comparison alone is not a pass.
5. **Recovery:** after the concurrency gate, implement fault-injection coverage for every staged transaction boundary, including before/after manifest publication and before the final journal event.
6. **Backup/restore:** after the concurrency gate, implement a synthetic snapshot copy/restore test with new `copyId`, object/hash verification, and preserved lineage.
7. **Cost and terms:** verify current Drive API terms, quotas, OAuth requirements, and the complete $0 recurring-cost path before production.

Record each result as **Verified**, **User-confirmed**, **Hypothesis**, or **Open**. A successful synthetic file round trip does not satisfy the concurrency or recovery gate.

Phase 1 is limited to folder enumeration, pre-generated-ID retry, exact synthetic-object hashing, and the two-session ETag/If-Match concurrency probe. Staged recovery and snapshot backup/restore follow only if concurrency is viable. No production ledger reads/writes, real financial records, or production storage implementation are in scope for this spike. Original CSV retention is 540 days (18 months) from successful private retention; backup copies must not reset that clock or resurrect expired originals.

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
- [ ] **Concurrency and correctness:** demonstrate that the documented server-enforced stale-write exclusion, versioning, idempotency, and conflict handling work under two-device races. Never silently overwrite newer data.
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
