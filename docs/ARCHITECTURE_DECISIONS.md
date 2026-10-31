# Architecture Decisions and Open Questions

**Status:** Baseline with Google Drive selected as the storage direction; implementation details remain subject to validation  
**Last updated:** 2026-10-31

## Current development status and next milestone

**Current phase:** Google Drive integration prototype plus MVP1 file-import foundation. The canonical ledger/import-run contract and pure synthetic reconciliation reference module were merged in PR #11. Drive Experiments A+B were integrated in PR #16, and PR #17 hardened folder discovery and safe Picker/error fallback. These are prototype capabilities only; no production ledger storage is approved.

**Next milestone:** review PR #19, which consolidates 108 accepted decisions covering database identity, schema/manifest versions, immutable content-addressed storage, commit history, transaction journaling, initialization, migration, backup/restore, and recovery. The next technical task is a synthetic-only Google Drive feasibility spike. Do not implement production persistence until Drive folder visibility, immutable object handling, safe recovery, and especially server-enforced stale-write exclusion are demonstrated. No real ledger reads/writes are authorized.

**Parallel MVP1 work:** implement strict Wells Fargo, SoFi, and Fidelity CSV parsers against the merged canonical contract, using invented fixtures. Add parser-to-reconciliation tests and define report-level correction/reversal/transfer and investment semantics.

**Production storage remains a separate gate:** validate token expiry/revocation, account selection, safe cross-device writes and stale-revision conflicts, interrupted-write recovery, backup/restore, retention/deletion, privacy/security, and sustainable $0 production terms. Until those gates pass, use synthetic data only and do not enable production Drive ledger writes.

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

## ADR-009 — Database identity, immutable storage, and recovery architecture

**Status: Design baseline ready for review in PR #19; production implementation not authorized.** The owner accepted 108 numbered decisions in [Database Identity and Lifecycle](DATABASE_IDENTITY_AND_LIFECYCLE.md). The record defines the manifest, schema versions, physical copy lifecycle, immutable snapshot model, commit and transaction histories, initialization, migration, backup/restore, and recovery behavior.

The selected target model uses immutable content-addressed data objects and complete commit snapshot descriptors. The manifest publishes the current committed snapshot only after all referenced objects and metadata are staged and verified. The transaction journal is append-only, and interrupted operations are resolved by inspection rather than guesswork.

**Critical open feasibility gate:** Google Drive must provide a demonstrably safe server-enforced concurrency/fencing mechanism for stale-write exclusion. The Drive file version can detect changes but is not itself an atomic lock. A read-then-update sequence is insufficient. If a safe mechanism cannot be proven under the $0 and least-privilege constraints, production ledger writes remain blocked or the storage direction must be reconsidered.

Merging PR #19 records this design baseline only. It does not approve production persistence. The next task is a synthetic-only Drive feasibility spike.

## Open decisions and follow-up work

The database identity and lifecycle baseline is recorded in [DATABASE_IDENTITY_AND_LIFECYCLE.md](DATABASE_IDENTITY_AND_LIFECYCLE.md) and PR #19. Remaining work is primarily feasibility and implementation validation, not further product-level identity decisions:

1. Prove server-enforced stale-write exclusion/atomic publication with Google Drive under the existing least-privilege scope; if unavailable, do not enable production writes.
2. Prove complete-enough folder-child enumeration and safe initialization under drive.file.
3. Validate immutable content-addressed objects, pre-generated-ID retries, read-after-write behavior, and cross-copy object lookup.
4. Validate two-device concurrent commits, interrupted operations, journal recovery, backup/restore, and promotion.
5. Verify OAuth expiry/revocation, account selection, current Google terms/quotas, and sustainable $0 production cost.
6. Complete encryption-at-rest and threat-model decisions, device-loss/account-compromise response, and deletion/retention behavior.
7. Finish the canonical ledger schema, provider parsers, report definitions, and historical summary treatment.

These are release gates or implementation tasks. They do not authorize production financial-data storage.

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
