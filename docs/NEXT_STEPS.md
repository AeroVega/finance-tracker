# Finance Tracker — next steps and handoff

**Last updated:** 2026-10-29  
**Current branch/PR:** `hardening/drive-discovery-fallback` / [PR #17](https://github.com/AeroVega/finance-tracker/pull/17)  
**Current phase:** Google Drive integration prototype; production financial-data storage is **not approved**.

This is the pick-up point for the next work session. Keep the sequence below; do not skip ahead to real ledger reads or writes.

## Immediate checkpoint

- [x] Review the latest PR #17 diff and confirm its Node contract-test workflow is green for the final head commit.
- [x] Merge PR #17 only after that check is green.
- [x] Confirm the merge and the resulting `main` test workflow succeeded. Do not infer a successful merge/deployment from a commit alone.
- [x] If a Pages deployment is needed for another experiment, deliberately choose the branch in **Actions → Deploy static site to GitHub Pages → Run workflow**. Pages is one shared public URL, not a staging environment. Verify the deployed footer's full source SHA and restore `main` after the experiment.

## Next implementation: stable database identity

**This is the next design task after PR #17.** A unique folder name and a remembered Picker selection are not proof that a folder is the canonical Finance Tracker database.

1. **Write a short decision/design proposal before coding.** Compare a small app-owned marker/manifest inside the selected folder with alternatives. Define its schema/version, required fields, ownership/identity checks, and how the app distinguishes an initialized database from an arbitrary folder.
2. **Define safe onboarding and recovery states.**
   - First connection: authorize with Google and explicitly select the intended folder with Picker when discovery cannot safely establish identity.
   - One exact-name match: treat it only as a candidate until the marker/manifest is verified.
   - Zero matches: explain that no accessible match was returned; offer Picker. Never assume the folder is absent and never auto-create a replacement.
   - Multiple matches: stop and ask the owner to select the intended folder.
   - Missing, malformed, unsupported-version, or mismatched marker: stop without modifying files and explain the recovery choice.
3. **Add synthetic tests first.** Cover valid identity, missing marker, malformed marker, unsupported schema version, wrong database identity, duplicate folder names, rename/missing folder, and failed/partial reads. No real account data or identifiers in fixtures.
4. **Implement only the marker/identity prototype in a focused branch and PR.** Keep ledger reads/writes out of scope. Use the existing public-config injection and narrow `drive.file` scope; do not add stored tokens, bank credentials, a backend, or recurring-cost dependencies.
5. **Run a live synthetic validation after review.** Verify the source SHA. Test the normal path and safe failure/recovery paths on the target iPhone/iPad browser. Record only outcomes and non-sensitive evidence; never record tokens, API keys, folder IDs, or financial data.

## Remaining storage-readiness gates

These are required before any real ledger data may be stored in Drive. A successful synthetic folder discovery or file round trip does not satisfy them.

- [ ] **Authorization and account handling:** verify account choice is clear; test expiry, revocation, wrong account, denied permissions, reconnect, and `401`/`403` recovery.
- [ ] **Concurrency and correctness:** define single-writer or locking strategy, stale-write detection, versioning, idempotency, and conflict resolution. Never silently overwrite newer data.
- [ ] **Crash/interruption recovery:** specify behavior for partial writes, interrupted operations, duplicate/retried requests, and inconsistent state.
- [ ] **Backup, restore, and portability:** define export/backup format, restore validation, recovery steps, and how the owner can leave the service.
- [ ] **Deletion and retention:** define user-approved deletion versus completed deletion, original-import retention, and recovery implications.
- [ ] **Privacy/security review:** document threat model, least-privilege scope, browser token lifetime/storage, data exposure risks, and how errors/logs avoid sensitive data.
- [ ] **Sustainable cost and terms:** recheck current Google API terms/quotas and confirm the full design remains at **$0 recurring cost** without trials or enabling billing.
- [ ] **Owner acceptance:** review the design, test evidence, failure states, and documentation before approving any production-storage implementation.

## Parallel MVP1 work

The Drive prototype must not block the file-import MVP.

- [ ] Finish owner review/acceptance of the canonical ledger/import-run contract and reconcile the actual current PR/merge status before relying on it.
- [ ] Add strict provider-specific parser tests for verified Wells Fargo, SoFi, and Fidelity formats using invented fixtures.
- [ ] Keep re-import deduplication, pending-to-posted transitions, correction/reversal handling, provenance, partial-import recovery, and coverage/freshness visible in tests.
- [ ] Keep sanitized real samples outside this public repository; never commit statements, exports, account identifiers, balances, tokens, or secrets.

## Working rules

- Work on focused feature branches and use PRs. Never commit directly to `main`, force-push, rewrite shared history, or merge without explicit owner approval.
- Read `AGENTS.md`, `README.md`, the roadmap, and relevant design docs before each new task.
- Report what was actually tested, CI/deployment status, limitations, and remaining risks. Separate **Verified**, **User-confirmed**, **Hypothesis**, and **Open** claims.
- GitHub Pages is public static hosting, not private storage. Keep the manual CSV import path permanent and keep production financial data out of the repository.
