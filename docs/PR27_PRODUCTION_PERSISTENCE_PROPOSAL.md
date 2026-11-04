# PR #27 — Production Financial-Data Persistence and Authorization

**Status:** Initial draft — design discussion and owner decisions pending  
**Workstream:** Production persistence authorization and implementation  
**Depends on:** PR #25 merged (synthetic storage foundation); PR #26 product definition (currently a separate open PR and intended product baseline)  
**Authorization state:** NOT APPROVED. This draft, branch, and draft PR do not authorize production financial data or enable production persistence.

## Purpose

Turn the validated synthetic storage foundation into an explicitly reviewed, production-capable persistence path for the owner's real financial data.

PR #25 established and rehearsed the storage, recovery, backup, restore, retention, and Google authorization mechanisms using invented data. PR #26 documents the second-generation product direction and the principles future engineering must respect. PR #27 is the proposed workstream that will define, implement, test, and review the controls required before the owner authorizes production financial-data persistence.

This PR must not silently infer unresolved product or security decisions. The initial proposal is a discussion baseline; consequential choices remain open until explicitly decided and recorded.

## Critical distinction: production authorization does not retire synthetic data

**Synthetic financial data remains a permanent, first-class part of the development and validation process after PR #27 merges.**

Approval to enable production persistence means the application may persist the owner's real financial data under the specific controls approved and implemented in this PR. It does not mean that future development should use real financial records as its routine test data, that synthetic fixtures are obsolete, or that every new feature is automatically safe for production.

- Continue using invented/synthetic accounts, transactions, holdings, liabilities, imports, histories, and scenarios for unit, contract, integration, regression, migration, recovery, and acceptance testing.
- Keep synthetic fixtures deterministic, representative, and broad enough to exercise normal, edge, malformed, ambiguous, interrupted, and adversarial cases.
- Never copy production records into the public repository, test fixtures, CI artifacts, screenshots, issue reports, logs, or development environments.
- Any exceptional use of sanitized production-derived examples would require a separately defined and approved process; it is not implied by this PR.
- New product capabilities described by PR #26 will continue to be developed incrementally after PR #27. Production persistence approval is a foundation milestone, not a declaration that the product is feature-complete or that future changes can skip synthetic validation.
- Production data must not become a substitute for test coverage. The app should be testable without connecting a real financial account or using real financial records.

## Intended outcome

At completion, the application has a production persistence implementation whose behavior is explicit, tested, recoverable, privacy-preserving, and consistent with the approved product and technical contracts. The PR's final merge is the owner's authorization to enable the specific production persistence capability delivered here, subject to the exact scope and acceptance conditions documented in the final PR.

The merge is not a blanket approval for unrelated integrations, paid services, new data-sharing destinations, unsupported multi-device operation, or future product capabilities.

## Existing constraints to preserve unless the owner explicitly changes them

1. **No recurring operating cost.** Do not depend on paid production APIs, expiring trials, or a service whose free tier is temporary or insufficient. Verify actual provider terms, quotas, usage, and billing rather than assuming published free quotas establish project-level cost.
2. **No bank passwords or unauthorized scraping.** Use only authorized file imports and approved provider authentication/storage access.
3. **Permanent manual file-import path.** CSV import remains a supported, viable route even if direct storage/persistence is enabled.
4. **Private financial data stays private.** The public GitHub repository and GitHub Pages deployment must never contain private financial records, account identifiers, tokens, secrets, or production database contents.
5. **No external financial-data recipients.** Preserve the product definition's privacy boundary: financial information is not sent to external AI services, advertising/data brokers, third-party analytics, or unrelated enrichment services.
6. **Google Drive is the selected private-storage direction**, subject to final production verification and the owner's $0 recurring-cost requirement.
7. **One user and one active device.** Preserve the accepted single-active-device operating constraint. Do not imply simultaneous multi-device editing or server-enforced locking.
8. **Offline writes remain prohibited.** Local browser storage remains non-authoritative under the accepted database lifecycle decisions. Offline reading and local analysis are product directions; they do not authorize offline financial writes.
9. **Conservative data integrity.** Preserve exact monetary values, provenance, source dates, canonical dates, conservative duplicate matching, explicit ambiguity handling, append-only corrections, and recoverable commits.
10. **No silent loss or unsupported assumptions.** Missing, unavailable, stale, incomplete, or unknown values are not zero. Uncertain operations fail closed and remain inspectable/recoverable.
11. **Existing retention decisions remain distinct.** Canonical financial-history retention and original imported source-file retention are separate policies. Do not silently change the accepted 540-day original-source retention policy or backup behavior.
12. **Portability remains essential.** The owner must be able to export and restore the financial history in a documented format independent of a particular app generation.

## Proposed scope

The final scope will be refined during the design discussion. Expected areas include:

### 1. Production data boundary and configuration
- Define exactly which data classes may be persisted: canonical financial activities, accounts, balances/snapshots, holdings, liabilities, import metadata, reconciliation decisions, category/rule metadata, and other required supporting records.
- Distinguish authoritative persisted records from local caches, derived reports, projections, and temporary import staging.
- Define the production-versus-synthetic environment boundary and ensure a developer/test workflow cannot accidentally target the production dataset.
- Define safe first-time production initialization and explicit database selection. Never infer or silently initialize a production database from an arbitrary folder.
- Ensure production configuration cannot expose secrets or private identifiers in the static public deployment.

### 2. Identity, authorization, and account access
- Document the exact Google OAuth client, audience/publishing state, scopes, and least-privilege rationale.
- Define token handling, renewal, revocation, denied permissions, wrong-account selection, reconnect, and authorization loss during reads/writes.
- Verify that authorization loss stops Drive-dependent operations and that ambiguous commit outcomes are recovered before writes resume.
- Define account ownership and folder binding without placing sensitive identifiers in public artifacts or logs.
- Re-verify actual Cloud project restrictions, quotas, usage, billing, and current provider terms against the $0 recurring-cost requirement.

### 3. Canonical persistence and import lifecycle
- Connect the accepted canonical ledger and import contracts to the production persistence layer.
- Define the exact durable transaction boundary from selected source file through parsing, validation, duplicate/reconciliation decisions, commit, and user-visible completion.
- Preserve source evidence and provenance without duplicating financial truth.
- Ensure invalid or unsupported rows are explicitly rejected/flagged and safe partial results are clearly represented.
- Preserve valid empty imports as valid outcomes.
- Preserve conservative matching, pending-to-posted relationships, append-only correction/reversal events, and idempotent retries.
- Define when a completed import becomes visible as committed canonical data and how interrupted/ambiguous imports are recovered.

### 4. Privacy, browser storage, and data minimization
- Map every data class to its storage location, lifetime, and access boundary.
- Inspect local browser storage and cache behavior, including device loss/shared-device exposure and sign-out/release behavior.
- Ensure sensitive values do not appear in URLs, console output, analytics, crash reports, notifications, public workflow artifacts, or routine diagnostics.
- Define local cache lifetime and deletion semantics without treating local storage as authoritative.
- Document what the storage provider can see and what the app does not encrypt or protect from a compromised Google account/device. Do not claim end-to-end encryption or protections not actually implemented.

### 5. Recovery, backup, portability, and retention
- Reuse the verified PR #25 mechanisms where appropriate rather than reimplementing a parallel storage protocol.
- Define production backup cadence, retention, verification, restore, and recovery-point expectations.
- Confirm restore preserves logical identity/history while creating a new physical copy identity.
- Define deletion and retention consistency across canonical records, original source files, backups, exports, and local caches.
- Test storage quota exhaustion, provider errors, lost responses, revoked access, interrupted writes, corruption, stale revisions, and recovery.
- Never claim stronger recovery guarantees than tests demonstrate.

### 6. Ongoing development and release safety
- Keep synthetic-only automated tests and acceptance environments available after production persistence is enabled.
- Ensure ordinary feature development, CI, migrations, and regression tests can run without real financial data or production credentials.
- Require synthetic migration fixtures for every schema migration and verify preservation of financial meaning.
- Keep production data out of test logs, artifacts, issue reports, and screenshots.
- Define a safe test/development workflow for the continuing PR26 product roadmap, including reporting, investments, liabilities, budgeting, goals, projections, insights, and future capabilities as they are implemented.
- Do not expand PR #27 into implementing all those product features. It provides the persistence foundation and integration contracts they can use.

## Explicit non-goals

- Implementing the full second-generation product or all capabilities in PR #26.
- Replacing or removing manual CSV import.
- Adding new financial institutions or unauthorized direct bank feeds.
- Introducing paid APIs, recurring hosting, temporary free-tier dependencies, external AI, analytics, or financial-data enrichment.
- Enabling simultaneous multi-device editing or offline writes.
- Treating the use of production data as a routine test strategy.
- Migrating, importing, or deleting real financial data as part of an unreviewed development experiment.
- Silently changing the canonical ledger, database identity/lifecycle, retention, or security contracts.

## Design decisions required before implementation is considered complete

The following are open and must be resolved in discussion and recorded in the relevant authoritative documents. The draft intentionally does not choose answers on the owner's behalf.

1. **Production data inventory:** Which exact record classes are durable and authoritative in the first production release?
2. **Storage representation:** Which objects and metadata are stored in Drive, how are they partitioned, and which values remain device-local or derived?
3. **Import transaction semantics:** What precisely constitutes a committed import, especially for safe partial results and ambiguous rows?
4. **Account and database initialization:** What explicit owner action binds the app to the production database, and how is wrong-folder/account selection prevented?
5. **OAuth configuration:** Exact scopes, test/publishing status, token lifecycle, account-switching behavior, and least-privilege acceptance.
6. **Local data protection:** Cache lifetime, browser/device exposure, clearing/sign-out behavior, and recovery after device loss.
7. **Backup and retention:** Production backup schedule, retention, deletion propagation, and restore expectations, reconciled with the existing 540-day original-file policy and canonical-history policy.
8. **Cost verification:** Evidence that real usage fits the $0 recurring-cost requirement, including quota and billing safeguards.
9. **Production activation semantics:** Which exact capability becomes enabled by merging this PR, what must be configured, and what user-visible indication distinguishes production from synthetic mode?
10. **Migration and rollback:** How the first production schema is initialized and how future migrations preserve data; what recovery path exists if a release must be rolled back.
11. **Acceptance evidence:** The exact live tests and evidence required before the owner approves merge.
12. **Operational limitations:** What limitations remain acceptable and must be clearly communicated.

## Proposed validation and acceptance

The final acceptance matrix should include, at minimum:

- Full automated contract and regression suite using synthetic-only fixtures.
- Import idempotency, overlapping history, ambiguous duplicate-shaped transactions, pending-to-posted updates, invalid rows, valid empty files, partial-result handling, and exact monetary-value preservation.
- Full persistence/reopen/reconnect and retained-history verification using synthetic datasets.
- Fault injection across every durable write/publication/recovery boundary, including authorization loss and ambiguous provider responses.
- Backup, quarantine, portable export, restore, and retention consistency using invented data.
- Wrong-account, unapproved account, revoked access, denied scope, token expiry/renewal, and reauthorization behavior.
- Browser storage inspection, network inspection, and deployed-artifact inspection for leakage of financial data, tokens, identifiers, or secrets.
- iPhone and iPad Safari lifecycle tests, including termination/reopen, stale-session recovery, and explicit single-active-device handoff.
- Storage capacity/quota exhaustion and provider failure behavior.
- Production configuration and cost review against actual Cloud project settings and current provider terms.
- A documented, owner-observed end-to-end acceptance rehearsal using synthetic financial records in the production-capable code path.
- A clear confirmation that production data is not required to run CI or continue ordinary feature development.

**Real financial data must not be used in automated tests, public fixtures, or routine acceptance rehearsals.** The final owner acceptance plan must say whether any narrowly scoped first-use smoke test with real data is necessary; if so, define its minimum data, privacy handling, cleanup, and evidence requirements before performing it.

## Proposed merge/authorization rule

This PR remains a draft until the design discussion is complete, the consequential decisions are recorded, implementation and automated validation are complete, live synthetic acceptance has passed, actual provider/cost/security checks are documented, and the owner has reviewed the residual risks.

**Merging the final, owner-approved PR #27 is the explicit authorization to enable the production financial-data persistence capability described in that merged implementation.** The authorization is limited to that documented capability and its stated constraints; it does not authorize unrelated integrations or future features.

After merge, synthetic data remains mandatory and first-class for ongoing development, automated tests, migrations, regression coverage, and feature acceptance. The app must remain testable without real financial records. Future PRs implementing additional PR #26 capabilities must continue to demonstrate behavior with synthetic data and must not assume that production persistence approval waives their own review or acceptance requirements.

## Relationship to authoritative project documents

- [Second Generation Product Definition](PRODUCT_DEFINITION.md) — product intent and principles (currently introduced in PR #26; reconcile this proposal after PR #26 merges).
- [Product Design Open Decisions](PRODUCT_OPEN_DECISIONS.md) — unresolved product-level questions (currently introduced in PR #26).
- [Security and Privacy Requirements](SECURITY.md) — existing security/privacy baseline.
- [Database Identity and Lifecycle ADR](DATABASE_IDENTITY_AND_LIFECYCLE.md) — accepted database identity, immutable storage, transaction, recovery, migration, and single-device contracts.
- [Data Model and Reconciliation Principles](DATA_MODEL.md) — canonical financial data and import semantics.
- [Architecture Decisions](ARCHITECTURE_DECISIONS.md) — $0 cost, file-import, Drive direction, and existing workstream constraints.
- [Synthetic Storage Acceptance](SYNTHETIC_STORAGE_ACCEPTANCE.md) — owner-reported synthetic storage-readiness evidence and CI results.

Where this proposal conflicts with an accepted contract, identify the conflict and seek an explicit owner decision. Do not silently override existing decisions.

## Change log

- **Initial draft:** reserves the production persistence and authorization workstream for PR #27. No implementation or production authorization is included in this initial commit.
