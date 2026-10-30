# Finance Tracker — next steps and handoff

**Last updated:** 2026-10-30  
**Current workstream:** documentation synchronized through this PR; next implementation task is stable database identity design  
**Current phase:** Google Drive integration prototype and MVP1 file-import foundation; production financial-data storage is **not approved**.

This is the current pick-up point. PR #17 is complete and merged. Keep the sequence below; do not skip ahead to real ledger reads or writes.

## Completed checkpoints

- [x] PR #11 merged: canonical ledger/import-run contract and pure synthetic reconciliation reference module are on `main`. The full 41-test suite passed on the final reviewed PR head before merge.
- [x] PR #16 merged: Google authorization/configuration and Drive Experiments A+B integration.
- [x] PR #17 merged: typed folder-discovery outcomes, explicit Picker fallback, safe authorization/error handling, and synthetic regression coverage.
- [x] PR #17 final-head Node contract-test workflow passed (run #72).
- [x] PR #17 merge commit: `d2b941cbc10d9c3ca96c8beb7989b82ff3eef83e`.

**Verification note:** PR #17's final-head check is confirmed green. A corresponding workflow run for the merge commit was not found during the 2026-10-30 status review; verify the current `main` workflow before treating post-merge CI as independently confirmed. No new Pages deployment is implied by merging PR #17.

## Next task: stable database identity — design first

A unique folder name, an earlier Picker selection, and a remembered comparison reference are not proof that a folder is the canonical Finance Tracker database. PR #17 deliberately leaves this unresolved.

1. **Write a decision/design proposal before coding.** Compare a small app-owned marker/manifest inside the selected folder with alternatives. Define its schema/version, required fields, identity generation, validation rules, and how the app distinguishes an initialized database from an arbitrary folder.
2. **Keep database identity separate from Google account authorization.** Decide what the manifest proves about the database and what must instead be verified by the active Google authorization. Do not treat a matching database ID as proof that the current account is authorized, or an account identity as the database identity.
3. **Define safe onboarding and recovery states.**
   - First connection: authorize with Google and explicitly select the intended folder with Picker when discovery cannot safely establish identity.
   - One exact-name match: treat it only as a candidate until the app-owned identity mechanism is verified.
   - Zero matches: explain that no accessible match was returned; offer Picker. Never assume the folder is absent and never auto-create a replacement.
   - Multiple matches: stop and ask the owner to select the intended folder.
   - Missing, malformed, unsupported-version, or mismatched marker: stop without modifying files and explain the recovery choice.
4. **Add synthetic tests first.** Cover valid identity, missing/malformed marker, unsupported schema version, wrong database identity, duplicate folder names, rename/missing folder, wrong account/permission, and failed/partial reads. Use invented IDs and data only.
5. **Implement only the marker/identity prototype in a focused branch and PR.** Keep ledger reads/writes out of scope. Use the existing public-config injection and narrow `drive.file` scope; do not add stored tokens, bank credentials, a backend, or recurring-cost dependencies.
6. **Run live synthetic validation after review.** Verify the deployed source SHA. Test normal and safe failure/recovery paths on the target iPhone/iPad browser. Record only outcomes and non-sensitive evidence; never record tokens, API keys, folder IDs, or financial data.

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
- [ ] **Concurrency and correctness:** define single-writer or locking strategy, stale-write detection, versioning, idempotency, and conflict resolution. Never silently overwrite newer data.
- [ ] **Crash/interruption recovery:** specify behavior for partial writes, interrupted operations, duplicate/retried requests, and inconsistent state.
- [ ] **Backup, restore, and portability:** define export/backup format, restore validation, recovery steps, and how the owner can leave the service.
- [ ] **Deletion and retention:** implement and test the approved 540-day (18-month) original-file retention lifecycle, distinguishing deletion eligibility from confirmed deletion and handling backup copies consistently.
- [ ] **Privacy/security review:** document threat model, least-privilege scope, browser token lifetime/storage, data exposure risks, and how errors/logs avoid sensitive data.
- [ ] **Sustainable cost and terms:** recheck current Google API terms/quotas and confirm the full design remains at $0 recurring cost without trials or enabling billing.
- [ ] **Owner acceptance:** review design, test evidence, failure states, and documentation before approving any production-storage implementation.

## Working rules

- Work on focused feature branches and use PRs. Never commit directly to `main`, force-push, rewrite shared history, or merge without explicit owner approval.
- Read `AGENTS.md`, `README.md`, the roadmap, and relevant design docs before each new task.
- Report what was actually tested, CI/deployment status, limitations, and remaining risks. Separate **Verified**, **User-confirmed**, **Hypothesis**, and **Open** claims.
- GitHub Pages is public static hosting, not private storage. Keep the manual CSV import path permanent and keep production financial data out of the repository.
