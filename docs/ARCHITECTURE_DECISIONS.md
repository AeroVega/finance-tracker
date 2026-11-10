# Architecture Decisions and Open Questions

**Status:** Baseline with Google Drive selected as the storage direction; implementation details remain subject to validation
**Status reconciled:** 2026-11-10; accepted decisions retain their original dates

## Current development status and next milestone

**Verified:** the PR19 architecture baseline, PR20 through PR25 synthetic storage/recovery machinery, PR28 canonical imports and PR32/PR34 main workspace are merged. Strict fixture parsers, canonical reporting and synthetic persistence are implemented. [Project status](PROJECT_STATUS.md) records current evidence and deployment limits.

**Open:** complete canonical-workspace acceptance, then financial position/reconciled coverage, January 2023 monthly history and production controls. Follow [the Alpha sequence](NEXT_STEPS.md). PR27 merged its production plan only; production financial-data persistence remains **NO-GO**.

The accepted single-user/single-active-device model remains. Drive's tested stale-`If-Match` update is not a server-enforced lock. Preserve immutable history, serialized operations, ownership/integrity checks and conservative recovery. Synthetic tests and past live observations do not establish production OAuth/configuration, privacy, cost or new device-path acceptance.

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

Merging PR #19 records this design baseline only. It does not approve production persistence. The synthetic feasibility and storage implementation have since merged; production acceptance remains separate.

## Open decisions and follow-up work

The identity/lifecycle baseline is settled. Do not reopen it because an old task list called its implementation future work. Current gaps are:

1. Dated financial-position evidence, balance/holdings/liability schema and reconciled completeness.
2. Distinct monthly-history records, one-time conversion and non-double-counting overlap rules.
3. Production account/database binding and supported owner-file ingestion.
4. Production release/sign-out clearing and actual browser/network/artifact privacy inspection.
5. Current OAuth/configuration, quota/billing and $0-cost evidence; routine backup policy after OAuth verification.
6. Live synthetic acceptance of changed paths, recovery/restore, sequential device handoff and explicit residual-risk/production approval.

The synthetic session, transaction, retention and backup implementations already exist. Their tests and historical evidence remain in their subject guides. The 540-day original-file policy is settled; production activation and deletion-receipt risk review remain open. [Next steps](NEXT_STEPS.md) supplies completion checks and dependencies.

## ADR-010 — Original CSV retention duration

**Status: Accepted; reaffirmed 2026-10-31.** Retain each original CSV import in approved private Drive storage for 540 days (18 months) from the time it is successfully retained. After that period, delete the source file and verify deletion. Eligibility for deletion is not proof that deletion succeeded; deletion failures must remain visible and retryable. Backup copies must preserve the original retention timestamp and must not restart the retention clock or reintroduce an expired original. This decision supersedes the earlier 2026-10-21 preference not to retain original CSV files in Drive. The policy duration is settled; implementation, backup behavior, and deletion verification remain release gates.

## Delivery sequence and schedule

The early MVP1 vertical slice and month-by-month schedule have been superseded by the [Alpha/Beta/v1.0.0 roadmap](ROADMAP.md) and [four-step Alpha plan](NEXT_STEPS.md). January 1, 2027 is the conditional v1.0.0 target, not an Alpha completion promise. Estimates and a dependency-based calendar remain open. Do not lower correctness, privacy or recovery requirements to meet the date.

## Decision discipline
Label claims **Verified**, **User-confirmed**, **Hypothesis**, or **Open**. Use primary-source URLs for provider claims and recheck time-sensitive terms. Change this record when decisions change.

## ADR-011 — Single-user, single-active-device operation

**Status: Accepted by project owner, 2026-10-31.** Finance Tracker is a personal, single-user application. Only one device may actively use the app at a time. Simultaneous use on two devices is unsupported, even if both sessions belong to the same owner. The app must refuse writes when it detects another active session and must provide a clear recovery/handoff path. The owner agrees not to edit Drive data outside the app and to switch devices only after ending the previous session.

The live Drive v3 raw REST experiment returned HTTP 200 and applied an update despite a deliberately stale `If-Match` value. Therefore the tested Drive update path does not provide server-enforced compare-and-swap and must not be used as a lock. Any app-level session marker/lease is best-effort detection, not a server-enforced mutex; simultaneous starts or network partitions may defeat detection. The single-device operating rule is therefore an explicit product constraint, not a technical guarantee supplied by Drive.

Within that constraint, writes must still be serialized in the active app, data objects should be immutable and retry-safe, commit publication must follow verification of all referenced objects, offline writes are prohibited, and interrupted/ambiguous operations must be recovered deterministically before further writes are enabled. This decision does not authorize production storage; implementation and fault-injection validation remain release gates.
