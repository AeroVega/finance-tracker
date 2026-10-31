# Architecture Decisions and Open Questions

**Status:** Baseline with Google Drive selected as the storage direction; implementation details remain subject to validation  
**Last updated:** 2026-10-31

## Current development status and next milestone

**Current phase:** PR #19's database identity, lifecycle, immutable storage, transaction, migration, and recovery architecture baseline is merged. Workstream 1's synthetic-only Drive feasibility harness is in progress on `feat/drive-feasibility-spike`; no production ledger storage is approved.

**Current milestone:** retain Google Drive as the selected storage direction and validate a single-user, single-active-device write model. The live raw REST probe showed that Drive v3 `files.update` accepted a deliberately stale `If-Match` value; that conditional-update path is rejected. Simultaneous use across devices is explicitly unsupported. The app must refuse writes when it detects another active session, while documenting that Drive does not provide a server-enforced mutex through the tested endpoint. Validate immutable writes, serialized operations, interruption recovery, backup/restore, privacy, and $0 terms before production. No real ledger reads/writes are authorized.

**Parallel MVP1 work:** implement strict Wells Fargo, SoFi, and Fidelity CSV parsers against the merged canonical contract, using invented fixtures. Add parser-to-reconciliation tests and define report-level correction/reversal/transfer and investment semantics.

**Production storage remains a separate gate:** validate token expiry/revocation, account selection, single-active-session behavior, serialized writes, interrupted-write recovery, backup/restore, retention/deletion, privacy/security, and sustainable $0 production terms. Until those gates pass, use synthetic data only and do not enable production Drive ledger writes.

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
- A user-owned cloud location supports sequential device handoff: imports on iPhone can later be viewed on iPad, but simultaneous use is unsupported.
- This direction aligns with the $0 recurring-cost constraint better than relying on a paid production database, but free production use is not considered proven until current terms and configuration are verified.

### Constraints and design requirements
- Use an authorized OAuth flow; never ask for or store the user's Google password.
- Request the narrowest practical Drive permission. Evaluate `drive.file` and a dedicated app-created/user-selected folder; verify its actual behavior before committing to a scope.
- Do not put OAuth client secrets, access tokens, refresh tokens, or financial data in the public repository or static frontend source.
- Parse selected CSVs locally in the browser. Retain each original CSV in private Drive storage for **540 days (18 months)** from successful retention, then delete it and verify deletion. Store normalized records and necessary import provenance in Drive after the user authorizes the action. Do not send financial records or source files to unrelated services.
- Treat browser storage as a cache, not the canonical store. The app is single-user and single-active-device: never support simultaneous use on two devices; refuse writes when another active session is detected. Device changes require an orderly handoff.
- Plan for expiring access tokens, explicit reauthorization, offline/error states, and provider/API revocation.
- Drive file APIs are not a transactional database. The tested browser-origin Drive v3 `files.update` path accepted a deliberately stale `If-Match` value (owner-confirmed 2026-10-31), so do not rely on it for compare-and-swap or stale-writer exclusion. Use a single-active-device operating model, app-level session detection, serialized writes, immutable object creation, verified commit ordering, and deterministic interruption recovery. Session detection is best-effort coordination, not a server-enforced lock; the owner must not use multiple devices simultaneously.
- Provide user-controlled export and a documented backup/restore approach. Verify that backups can actually be restored.
- Never present stale or incompletely synchronized data as fully current.
- The public GitHub repository remains code and synthetic test data only.

### Verification gates before production use
1. Verify the current Google OAuth consent configuration, production publishing requirements, scope policy, token lifetime/renewal behavior, and revocation handling.
2. Verify Drive API terms, quotas, any billing changes, and how the Google Cloud project is configured; do not assume a quota number alone proves $0 lifetime cost.
3. Demonstrate authorized create/read/update/export operations on synthetic records with sequential iPhone-to-iPad handoff; simultaneous use is unsupported.
4. Test session detection and write refusal, serialized operations, interrupted writes, ambiguous outcomes, duplicate imports, restore from backup, and revoked access. Do not treat multi-device concurrent editing as a supported scenario.
5. Review data flow, browser storage, logs, and permissions for privacy leakage.
6. Confirm the complete production path has no recurring cost and does not depend on an expiring trial.

## ADR-009 — Database identity, immutable storage, and recovery architecture

**Status: Design baseline merged in PR #19; production implementation not authorized.** The owner accepted 108 numbered decisions in [Database Identity and Lifecycle](DATABASE_IDENTITY_AND_LIFECYCLE.md). The record defines the manifest, schema versions, physical copy lifecycle, immutable snapshot model, commit and transaction histories, initialization, migration, backup/restore, and recovery behavior.

The selected target model uses immutable content-addressed data objects and complete commit snapshot descriptors. The manifest publishes the current committed snapshot only after all referenced objects and metadata are staged and verified. The transaction journal is append-only, and interrupted operations are resolved by inspection rather than guesswork.

**Rejected mechanism:** the live raw REST probe returned HTTP 200 and read-back confirmed Drive applied a description update despite a deliberately stale `If-Match` value. The Drive file version is output-only and is not an atomic lock. The tested `If-Match` route is not a concurrency control and will not be used. **Accepted operating constraint:** Finance Tracker is single-user and single-active-device. Simultaneous use on two devices is unsupported; the app must detect an already-active session where possible and refuse writes in the second session. Session markers are best-effort detection only, not a server-enforced mutex. The owner agrees to use one device at a time. This operating model narrows the concurrency requirement but does not remove the need for serialized writes, idempotency, immutable objects, and crash recovery.

Merging PR #19 records this design baseline only. It does not approve production persistence. The synthetic-only Drive feasibility spike is now underway.

## Open decisions and follow-up work

The database identity and lifecycle baseline is recorded in [DATABASE_IDENTITY_AND_LIFECYCLE.md](DATABASE_IDENTITY_AND_LIFECYCLE.md) and PR #19. The identity/lifecycle baseline is settled. Remaining work is feasibility validation plus separate security, data-model, and release decisions:

1. Implement and test single-active-session detection and write refusal; document that this is best-effort detection rather than a server-enforced lock. Do not use the tested Drive `If-Match` path.
2. Prove complete-enough folder-child enumeration and safe initialization under drive.file.
3. Validate immutable content-addressed objects, pre-generated-ID retries, read-after-write behavior, and cross-copy object lookup.
4. Validate sequential device handoff, same-device tab/session conflict detection, interrupted operations, journal recovery, backup/restore, and promotion. Simultaneous two-device commits are explicitly unsupported.
5. Verify OAuth expiry/revocation, account selection, current Google terms/quotas, and sustainable $0 production cost.
6. Complete encryption-at-rest and threat-model decisions, device-loss/account-compromise response, and implementation of the already-approved 540-day original-file retention/deletion lifecycle.
7. Finish the canonical ledger schema, provider parsers, report definitions, and historical summary treatment.

These are release gates or implementation tasks. The 540-day original CSV retention duration is settled; its private-storage lifecycle and backup consistency still require implementation and validation. None of these items authorizes production financial-data storage.

## ADR-010 — Original CSV retention duration

**Status: Accepted; reaffirmed 2026-10-31.** Retain each original CSV import in approved private Drive storage for 540 days (18 months) from the time it is successfully retained. After that period, delete the source file and verify deletion. Eligibility for deletion is not proof that deletion succeeded; deletion failures must remain visible and retryable. Backup copies must preserve the original retention timestamp and must not restart the retention clock or reintroduce an expired original. This decision supersedes the earlier 2026-10-21 preference not to retain original CSV files in Drive. The policy duration is settled; implementation, backup behavior, and deletion verification remain release gates.

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

## ADR-011 — Single-user, single-active-device operation

**Status: Accepted by project owner, 2026-10-31.** Finance Tracker is a personal, single-user application. Only one device may actively use the app at a time. Simultaneous use on two devices is unsupported, even if both sessions belong to the same owner. The app must refuse writes when it detects another active session and must provide a clear recovery/handoff path. The owner agrees not to edit Drive data outside the app and to switch devices only after ending the previous session.

The live Drive v3 raw REST experiment returned HTTP 200 and applied an update despite a deliberately stale `If-Match` value. Therefore the tested Drive update path does not provide server-enforced compare-and-swap and must not be used as a lock. Any app-level session marker/lease is best-effort detection, not a server-enforced mutex; simultaneous starts or network partitions may defeat detection. The single-device operating rule is therefore an explicit product constraint, not a technical guarantee supplied by Drive.

Within that constraint, writes must still be serialized in the active app, data objects should be immutable and retry-safe, commit publication must follow verification of all referenced objects, offline writes are prohibited, and interrupted/ambiguous operations must be recovered deterministically before further writes are enabled. This decision does not authorize production storage; implementation and fault-injection validation remain release gates.
