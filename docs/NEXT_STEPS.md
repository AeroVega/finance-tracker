# Finance Tracker — next steps and handoff

**Last updated:** 2026-10-30  
**Current workstream:** database identity and lifecycle decisions documented in a draft PR; continue design review before implementation  
**Current phase:** Google Drive integration prototype and MVP1 file-import foundation; production financial-data storage is **not approved**.

This is the current pick-up point. PR #17 is complete and merged. Keep the sequence below; do not skip ahead to real ledger reads or writes.

## Completed checkpoints

- [x] PR #11 merged: canonical ledger/import-run contract and pure synthetic reconciliation reference module are on `main`. The full 41-test suite passed on the final reviewed PR head before merge.
- [x] PR #16 merged: Google authorization/configuration and Drive Experiments A+B integration.
- [x] PR #17 merged: typed folder-discovery outcomes, explicit Picker fallback, safe authorization/error handling, and synthetic regression coverage.
- [x] PR #17 final-head Node contract-test workflow passed (run #72).
- [x] PR #17 merge commit: `d2b941cbc10d9c3ca96c8beb7989b82ff3eef83e`.

**Verification note (confirmed 2026-10-30):** PR #17's final-head Node contract-test workflow passed (run #72), and the owner has now confirmed that the post-merge `main` workflow also succeeded. Both pre-merge and post-merge CI verification are complete. No new Pages deployment is implied by merging PR #17.

## Next task: complete database identity and lifecycle design review

The 29 decisions made in the design discussion are recorded in [Database Identity and Lifecycle](DATABASE_IDENTITY_AND_LIFECYCLE.md). This is a documentation-only draft; it does not authorize production implementation. Review the record as a whole, then resolve its explicitly listed open implementation details before proposing an identity-only prototype.

The settled design includes an app-owned JSON manifest, shared logical database identity with per-copy identity, primary/backup roles, guided and emergency promotion, verified snapshots, explicit copy lifecycle, conservative state labels, minimal append-only commit lineage, and quarantine behavior for damaged history.

Before implementation, complete the remaining design work: exact manifest schema and compatibility rules; initialization and invalid-folder behavior; role versus lifecycle/health fields; storage binding; commit-history persistence and durability; snapshot consistency; recoverable promotion/move transitions; restore lineage; and older-versus-divergent classification rules. Keep the manifest's identity role separate from Google authorization and financial-data correctness.

When the design is approved, synthetic tests must precede a focused identity-only prototype. No ledger reads/writes, production data, or real financial information are in scope.

### Historical discovery requirements retained from PR #17

A unique folder name, an earlier Picker selection, and a remembered comparison reference are not proof that a folder is the canonical Finance Tracker database. Safe onboarding and recovery must continue to respect these constraints:

1. **First connection:** authorize with Google and explicitly select the intended folder with Picker when discovery cannot safely establish identity.
2. **One exact-name match:** treat it only as a candidate until the app-owned identity mechanism is verified.
3. **Zero matches:** explain that no accessible match was returned; offer Picker. Never assume the folder is absent and never auto-create a replacement.
4. **Multiple matches:** stop and ask the owner to select the intended folder.
5. **Missing, malformed, unsupported-version, or mismatched marker:** stop without modifying files and explain the recovery choice.

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
