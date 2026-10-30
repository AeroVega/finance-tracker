# Architecture Decisions and Open Questions

**Status:** Baseline with Google Drive selected as the storage direction; implementation details remain subject to validation  
**Last updated:** 2026-10-30

## Current development status and next milestone

**Current phase:** data-integration prototype. Discovery and initial provider-format research are documented; the Drive synthetic probe has passed its user-confirmed live create/read-back/confirmed-delete check. That probe does not authorize real ledger storage.

**Next milestone (M1): canonical import contract and synthetic fixtures.** Before implementing parsers, define the normalized activity and account fields, source provenance, import-run outcomes, review decisions, coverage/freshness semantics, signed amounts, and conservative duplicate/correction behavior. Then create fully invented fixtures for representative Wells Fargo, SoFi, and Fidelity CSV shapes and acceptance tests for repeat imports, overlapping history, malformed rows, ambiguous matches, and retries.

**Production storage remains a separate gate:** validate token expiry/revocation, safe cross-device writes and stale-revision conflicts, interrupted-write recovery, backup/restore, and sustainable $0 production terms. Until those gates pass, use synthetic data only and do not enable production Drive ledger writes.

## ADR-001 — File imports for MVP1
**Status: Accepted.** MVP1 ingests CSV files downloaded by the project owner. MVP2 may add free, authorized direct integrations only after cost, authorization, sustainability, and security are verified. This keeps delivery independent of an unproven API and makes import correctness a first-class capability.

## ADR-002 — Public repository contains no private financial records
**Status: Accepted.** The public repo contains application code, documentation, and deliberately synthetic tests only. Real exports, records, balances, holdings, credentials, and secrets are prohibited. Removing a file in a later commit does not erase prior history.

## ADR-003 — Source-independent canonical ledger
**Status: Accepted; canonical contract recorded in PR #11 and merged.** File and future API adapters feed one normalized ledger and the same deduplication, review, and reporting pipeline. Preserve source identity, descriptions, identifiers, and import provenance.

## ADR-004 — No recurring operating cost
**Status: Accepted release constraint.** No recurring fees for hosting, storage, aggregation, refresh, or AI. A development sandbox or expiring trial does not qualify as free production access. Production terms and any potential billable conditions must be verified before release.

## ADR-005 — Static modular frontend
**Status: Provisional direction.** Prefer modular static HTML/CSS/JavaScript on GitHub Pages; avoid frameworks/build systems without a documented reason. Static hosting is public and is not private storage or a secret store.

## ADR-006 — Deterministic-first categorization
**Status: Accepted principle.** Use inspectable, editable, reversible rules and route ambiguous records to review. AI is not the default categorizer.

## ADR-007 — Conservative, idempotent overlapping imports
**Status: Accepted.** MVP1 automatically merges only confidently matched records and routes ambiguous candidates to review. Stable provider transaction/activity IDs are preferred when their semantics are understood and are scoped to provider and account. Without stable IDs, use a conservative composite and require uniqueness plus corroborating evidence. Date, amount, and description alone are not sufficient proof of duplication. Identical file retries must be idempotent; new overlapping exports are reconciled row by row rather than replacing date ranges. Preserve source observations, import provenance, and correction/lifecycle history. Never silently discard legitimate-looking rows or overwrite conflicting accepted data. Keep successful pipeline completion (`processed`) distinct from financial settlement and from explicit human sign-off. Persist human review decisions as auditable, scoped events and reuse identity-match approvals as evidence on later imports without treating them as universal duplicate signatures.


## ADR-008 — Google Drive as the private-storage direction
**Status: Selected direction; validation required before production use.** Use the owner's own Google Drive as the intended canonical private data store for cross-device access. Continue down this path unless implementation or primary-source verification reveals a concrete blocker that cannot reasonably be worked around. Do not reopen the choice solely because of hypothetical scaling concerns.

### Rationale
- The owner directly controls the Drive account and can access stored files outside the app.
- A browser-based app can potentially use an authorized Google OAuth flow and Drive API without introducing a separately operated database backend.
- A user-owned cloud location supports the requirement that imports on iPhone can later be viewed on iPad.
- This direction aligns with the $0 recurring-cost constraint better than relying on a paid production database, but free production use is not considered proven until current terms and configuration are verified.

### Constraints and design requirements
- Use an authorized OAuth flow; never ask for or store the user's Google password.
- Request the narrowest practical Drive permission. Evaluate `drive.file` and a dedicated app-created/user-selected folder; verify its actual behavior before committing to a scope.
- Do not put OAuth client secrets, access tokens, refresh tokens, or financial data in the public repository or static frontend source.
- Prefer parsing selected CSVs locally in the browser. Only send normalized records and necessary metadata to Drive after the user authorizes the action.
- Treat browser storage as a cache, not the canonical cross-device store.
- Plan for expiring access tokens, explicit reauthorization, offline/error states, and provider/API revocation.
- Drive file APIs are not a transactional database. Specify conflict detection, version/revision checks where supported, safe write ordering, recovery from interrupted writes, and a non-destructive conflict path before enabling real writes.
- Provide user-controlled export and a documented backup/restore approach. Verify that backups can actually be restored.
- Never present stale or incompletely synchronized data as fully current.
- The public GitHub repository remains code and synthetic test data only.

### Verification gates before production use
1. Verify the current Google OAuth consent configuration, production publishing requirements, scope policy, token lifetime/renewal behavior, and revocation handling.
2. Verify Drive API terms, quotas, any billing changes, and how the Google Cloud project is configured; do not assume a quota number alone proves $0 lifetime cost.
3. Demonstrate authorized create/read/update/export operations on synthetic records from iPhone and iPad.
4. Test interrupted writes, stale revisions, concurrent edits, duplicate imports, restore from backup, and revoked access.
5. Review data flow, browser storage, logs, and permissions for privacy leakage.
6. Confirm the complete production path has no recurring cost and does not depend on an expiring trial.

## Open decisions and follow-up work
1. Exact Drive file/folder layout and manifest format.
2. Exact OAuth scope and whether folder selection is needed.
3. File revision/conflict algorithm and recovery behavior.
4. Encryption-at-rest expectations beyond provider-managed storage, including whether client-side encryption is necessary and feasible.
5. Backup cadence, destination, retention, and restore UX.
6. Local cache and raw CSV retention/deletion policy.
7. Final canonical ledger schema and report definitions.
8. Historical summary migration from the archived workbook, only where methodology and supported figures are clear.
9. Incident response for device loss, account compromise, provider revocation, or accidental deletion.

These open items are implementation/verification tasks, not reasons to pause independent CSV parsing and analysis work.

## MVP1 vertical-slice sequence
1. Upload one sanitized/synthetic CSV.
2. Parse and validate rows into the canonical transaction model.
3. Produce a clear import summary and surface malformed or ambiguous rows.
4. Calculate defined income, expense, and net-cash-flow totals.
5. Show a small dashboard and inspectable transaction list.
6. Prove repeated imports do not double-count.
7. Add private persistence only behind the reviewed storage boundary.

## Nominal schedule
Planning target: **MVP1 by 2027-01-01**. This is a target, not a promise; privacy, financial correctness, and recovery take precedence over the date.

- **October 2026 — Foundation:** finish sample-schema discovery, import/reconciliation contract, storage/security architecture, and review PRs.
- **November 2026 — Working vertical slice:** implement tested parsers, normalization, import summary, core calculations, and basic dashboard using synthetic/sanitized test inputs.
- **December 2026 — Persistence and hardening:** implement the approved private-storage path, cross-device behavior, backups/restore, usability, reconciliation, and release checks.
- **By 2027-01-01 — MVP1 target:** release only if the exit criteria and privacy/cost gates are satisfied; otherwise reduce scope or move the date rather than weaken safeguards.

## Decision discipline
Label claims **Verified**, **User-confirmed**, **Hypothesis**, or **Open**. Use primary-source URLs for provider claims and recheck time-sensitive terms. Change this record when decisions change.
