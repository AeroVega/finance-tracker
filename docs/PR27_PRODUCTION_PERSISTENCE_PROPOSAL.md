# PR #27 — Production Financial-Data Persistence and Authorization

**Status:** Documentation-only draft; owner decisions recorded; remaining design, implementation, and acceptance work pending

**Workstream:** Production persistence authorization and implementation  
**Depends on:** PR #25's merged synthetic storage foundation and [PR #26's product definition](https://github.com/AeroVega/finance-tracker/pull/26), merged on 2026-11-06.

**Authorization state:** NOT APPROVED. This draft, branch, and draft PR do not authorize production financial data or enable production persistence.

## Purpose

Turn the validated synthetic storage foundation into an explicitly reviewed, production-capable persistence path for the owner's real financial data.

PR #25 established and rehearsed the storage, recovery, backup, restore, retention, and Google authorization mechanisms using invented data. PR #26 documents the second-generation product direction and the principles future engineering must respect. PR #27 is the proposed workstream that will define, implement, test, and review the controls required before the owner authorizes production financial-data persistence.

This PR must not silently infer unresolved product or security decisions. The decision record below distinguishes confirmed choices from recommendations and remaining questions. None of these planning decisions authorizes production activation.

## Decision record, 2026-11-08

Source: owner design discussion. These are planning requirements, not evidence that the application implements or has validated them.

### Data scope follows ready features

**User-confirmed:** Add data classes only when the features that need them are actually ready. The first production inventory must cover the implemented, validated capabilities approved for that release and their required supporting records. Do not add speculative data classes merely because a future feature appears in the product roadmap.

**Open:** Enumerate the exact first-release records and map each one to its ready feature, persistence contract, and synthetic acceptance evidence. Later features add their data requirements through their own design and validation work.

### Grouped storage remains a design direction

**Hypothesis, recommended direction:** Evaluate grouped storage for the ready-feature data scope. This is not a final format, partitioning scheme, or replacement for the accepted immutable-object and transaction contracts. Exact group boundaries remain open.

**Open:** Verify compatibility with the existing storage and schema contracts, integrity checks, session ownership, and interrupted-write recovery before accepting the representation. Preserve backup, restore, and portability behavior. Do not claim a latency or API-use improvement until measured with synthetic data.

### One designated Google account

**User-confirmed:** The app is intended to use the owner's one designated Google account. A workflow for switching between multiple authorized accounts is out of scope for current development. Do not introduce additional authorized accounts or account-switching product work without a new decision.

This does not remove wrong-account rejection, explicit account/database binding, denied-scope handling, expiry, revocation, or reconnect requirements. The app must still stop when it cannot verify authorized access. Reauthorization of the designated account must recover an ambiguous transaction before writes resume. Keep the actual account identifier out of public documentation and diagnostics.

### Working data and tokens stay in memory

**User-confirmed:** Keep working financial data and the access token in memory. Clear them on sign-out or normal orderly release. Retain only the already agreed non-authoritative known-copy inventory and narrowly scoped recovery diagnostics, as defined in the [database lifecycle contract](DATABASE_IDENTITY_AND_LIFECYCLE.md). This does not authorize a persisted local ledger, financial-data cache, refresh token, or offline write queue.

Preserve the existing orderly-release sequence: close admission, drain admitted writes with their guards intact, resolve or report recovery state, and verify release before reporting success. Clearing local working state must not erase the durable recovery evidence or turn an unresolved outcome into a successful release. The current bounded, in-memory dashboard trace described in [application storage lifecycle](APPLICATION_STORAGE_LIFECYCLE.md) is not blanket approval to persist every diagnostic event.

**Open:** Inspect what supported browsers actually retain before and after sign-out, normal release, reload, and abrupt termination. Cover localStorage, sessionStorage, IndexedDB, browser/network caches, and restored page state where applicable. Check that retained inventory and diagnostics contain only the allowed identity/recovery metadata, not financial values, source contents, or tokens. Record observed behavior and untested cases separately.

**User-confirmed risk-documentation requirement:** Describe what abrupt closure or device loss can leave behind. Clearing application references is not proof of a secure browser/OS memory wipe, remote device wipe, or revocation of Google access. Do not promise a perfect wipe. Document the remaining exposure from browser/device access and account compromise, and the supported recovery and access-revocation steps before production acceptance.

### Define routine backup promises after OAuth verification

**User-confirmed:** Define routine backup cadence, tolerable data loss, and backup rotation after production OAuth is verified. Those choices remain open. This sequencing decision does not establish that OAuth has been verified or authorize production activation before the remaining acceptance gates pass.

Preserve existing retention policies and required verified pre-migration backups. Deferring routine backup choices does not waive those safeguards or change the 540-day original-source retention policy.

### OAuth clarification: no blocking configuration change identified

**User-confirmed:** Use "no blocking configuration change identified" as the current planning position. Continue the design discussion rather than assume a settings change or formal Google app review is required. Interactive reauthorization is acceptable; its actual behavior still needs confirmation.

**Verified, official guidance checked 2026-11-08:**

- Google lists personal-use apps with fewer than 100 users as an exception to mandatory OAuth verification. The exception does not waive Google's API Services User Data Policy. It is policy guidance, not confirmation that this project's current configuration qualifies. See [when verification is not needed](https://support.google.com/cloud/answer/13464323?hl=en).
- Google classifies `drive.file` as a recommended non-sensitive scope with per-file access. That classification alone does not establish a blanket exemption from every verification requirement. See [Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
- If the project is configured as Testing and requests Drive access, Google's documented rule is that test-user authorizations expire seven days after consent. The basic-identity-only exception does not cover `drive.file`. This is distinct from the access token's short lifetime; Google's browser token model obtains a new token through a user-driven flow when one expires. See [app audience and publishing status](https://support.google.com/cloud/answer/15549945?hl=en) and [the browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

**Open:** Confirm the actual audience, publishing status, requested/granted scopes, applicable verification exceptions, and expiry, reauthorization, revocation, and recovery behavior. This clarification does not record a Cloud Console inspection, a seven-day expiry observation, Google verification, or a production-readiness pass. It changes no settings, scopes, tokens, or permissions.

The earlier backup deferral remains in force. Routine cadence, tolerable data loss, and rotation are still undecided; this clarification does not claim its OAuth condition has been met. Distinguish verification of the app's actual OAuth configuration and behavior from Google's formal app-review process. Do not assume the latter is mandatory, or use its absence alone to halt the design discussion. Production acceptance and explicit owner authorization remain required.

### No separate real-data smoke-test prerequisite

**User-confirmed:** Fully passing synthetic tests may provide the test evidence for starting production use. A separate smoke test with real financial data is not required as an acceptance prerequisite.

This does not authorize real-data use now. Production OAuth verification, live synthetic acceptance, security/privacy and cost review, documented residual risks, final owner review, and the explicit production authorization rule below remain required. Automated tests and routine acceptance continue to use invented financial records.

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

The final scope will follow the recorded decisions and be refined during the remaining design discussion. Expected areas include:

### 1. Production data boundary and configuration
- Define exactly which data classes may be persisted for ready features and their required supporting records. Canonical activities, accounts, balances/snapshots, holdings, liabilities, import metadata, reconciliation decisions, and category/rule metadata are candidate classes only when their features are ready; this list is not advance approval for them all.
- Distinguish authoritative persisted records from local caches, derived reports, projections, and temporary import staging.
- Define the production-versus-synthetic environment boundary and ensure a developer/test workflow cannot accidentally target the production dataset.
- Define safe first-time production initialization and explicit database selection. Never infer or silently initialize a production database from an arbitrary folder.
- Ensure production configuration cannot expose secrets or private identifiers in the static public deployment.

### 2. Identity, authorization, and account access
- Document the exact Google OAuth client, audience/publishing state, scopes, and least-privilege rationale.
- Define token handling, renewal, revocation, denied permissions, wrong-account selection, reconnect, and authorization loss during reads/writes.
- Verify that authorization loss stops Drive-dependent operations and that ambiguous commit outcomes are recovered before writes resume.
- Define account ownership and folder binding without placing sensitive identifiers in public artifacts or logs.
- Use the one designated Google account. Switching between multiple authorized accounts is outside the current scope; wrong-account rejection and safe reauthorization remain required.
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
- Apply the approved in-memory working-data/token policy and clear-on-sign-out/normal-release requirement. Allow only the agreed local inventory and recovery diagnostics; verify their actual retention and clearing semantics without treating local storage as authoritative.
- Document what the storage provider can see and what the app does not encrypt or protect from a compromised Google account/device. Do not claim end-to-end encryption or protections not actually implemented.

### 5. Recovery, backup, portability, and retention
- Reuse the verified PR #25 mechanisms where appropriate rather than reimplementing a parallel storage protocol.
- After production OAuth is verified, define routine backup cadence, tolerable data loss, and rotation. Preserve existing retention and required verified pre-migration backups; complete backup verification, restore, and recovery-point acceptance before production activation.
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
- Building a workflow for switching between multiple authorized Google accounts.
- Treating the use of production data as a routine test strategy.
- Migrating, importing, or deleting real financial data as part of an unreviewed development experiment.
- Silently changing the canonical ledger, database identity/lifecycle, retention, or security contracts.

## Design decisions required before implementation is considered complete

The decision record above settles the scope principle, single-account operating model, local-data policy, and when to define routine backup promises. The remaining details below are open and must be resolved and recorded in the relevant authoritative documents. Recommendations are not confirmed implementation choices.

1. **Production data inventory:** Which exact record classes support the ready features in the first production release, and which are durable and authoritative?
2. **Storage representation:** How should the proposed grouped storage represent those records while preserving compatibility, integrity, ownership checks, and recovery? Exact objects, metadata, and partition boundaries remain open.
3. **Import transaction semantics:** What precisely constitutes a committed import, especially for safe partial results and ambiguous rows?
4. **Account and database initialization:** What explicit owner action binds the app to the production database, and how is wrong-folder/account selection prevented?
5. **OAuth configuration:** Exact scopes, test/publishing status, token lifecycle, designated-account binding, wrong-account rejection, and least-privilege acceptance. A multiple-authorized-account switching workflow is out of scope.
6. **Local data protection:** Implementation and browser evidence for in-memory working data/tokens, sign-out and normal-release clearing, the agreed inventory/diagnostics, and documented exposure after abrupt closure or device loss. The policy is confirmed; its behavior is not yet verified.
7. **Backup and retention:** Define routine cadence, tolerable data loss, and rotation after production OAuth verification. Resolve deletion propagation and restore expectations while preserving existing retention and verified pre-migration backup requirements, including the 540-day original-file policy and canonical-history policy.
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
- Designated-account binding and rejection of other accounts, without adding an authorized-account switching workflow.
- Browser storage inspection, network inspection, and deployed-artifact inspection for leakage of financial data, tokens, identifiers, or secrets.
- Sign-out, normal release, reload, and abrupt-termination checks for working data and tokens, with an inventory of permitted retained metadata and explicit limits on wiping and device-loss protection.
- Synthetic compatibility, integrity, ownership, interrupted-write recovery, backup, and restore tests for any grouped representation before it is accepted.
- iPhone and iPad Safari lifecycle tests, including termination/reopen, stale-session recovery, and explicit single-active-device handoff.
- Storage capacity/quota exhaustion and provider failure behavior.
- Production configuration and cost review against actual Cloud project settings and current provider terms.
- A documented, owner-observed end-to-end acceptance rehearsal using synthetic financial records in the production-capable code path.
- A clear confirmation that production data is not required to run CI or continue ordinary feature development.

**Real financial data must not be used in automated tests, public fixtures, or routine acceptance rehearsals.** The owner does not require a separate real-financial-data smoke test before production acceptance. Fully passing synthetic tests supply the test evidence; production OAuth, live synthetic acceptance, security/privacy, cost, residual-risk, final owner review, and explicit authorization gates still apply. This decision is not permission to import or use real data now.

## Proposed merge/authorization rule

This PR remains a draft until the design discussion is complete, the consequential decisions are recorded, implementation and automated validation are complete, live synthetic acceptance has passed, actual provider/cost/security checks are documented, and the owner has reviewed the residual risks.

**Merging the final, owner-approved PR #27 is the explicit authorization to enable the production financial-data persistence capability described in that merged implementation.** The authorization is limited to that documented capability and its stated constraints; it does not authorize unrelated integrations or future features.

After merge, synthetic data remains mandatory and first-class for ongoing development, automated tests, migrations, regression coverage, and feature acceptance. The app must remain testable without real financial records. Future PRs implementing additional PR #26 capabilities must continue to demonstrate behavior with synthetic data and must not assume that production persistence approval waives their own review or acceptance requirements.

## Relationship to authoritative project documents

- [Second-generation product definition](https://github.com/AeroVega/finance-tracker/blob/890219128ccbb912749bee54ad82bb47b503d2a4/docs/PRODUCT_DEFINITION.md) records the product intent and principles merged in PR #26. Reconcile this proposal with that baseline before implementation acceptance.
- [Product design open decisions](https://github.com/AeroVega/finance-tracker/blob/890219128ccbb912749bee54ad82bb47b503d2a4/docs/PRODUCT_OPEN_DECISIONS.md) records the product-level questions at the PR #26 merge. The merge-commit links work while this draft branch is still being reconciled with `main`.
- [Security and Privacy Requirements](SECURITY.md) — existing security/privacy baseline.
- [Database Identity and Lifecycle ADR](DATABASE_IDENTITY_AND_LIFECYCLE.md) — accepted database identity, immutable storage, transaction, recovery, migration, and single-device contracts.
- [Data Model and Reconciliation Principles](DATA_MODEL.md) — canonical financial data and import semantics.
- [Architecture Decisions](ARCHITECTURE_DECISIONS.md) — $0 cost, file-import, Drive direction, and existing workstream constraints.
- [Synthetic Storage Acceptance](SYNTHETIC_STORAGE_ACCEPTANCE.md) — owner-reported synthetic storage-readiness evidence and CI results.

Where this proposal conflicts with an accepted contract, identify the conflict and seek an explicit owner decision. Do not silently override existing decisions.

## Change log

- **2026-11-08, OAuth clarification:** Recorded the owner's non-blocking planning position against current official Google guidance. Actual project configuration, exception applicability, and token/authorization behavior remain unverified. Preserved the earlier backup deferral and all production gates.
- **2026-11-08:** Recorded the owner-confirmed ready-feature data scope, one designated Google account, in-memory working-data/token policy with sign-out/normal-release clearing, decision to define routine backup promises after OAuth verification, and acceptance without a separate real-data smoke-test prerequisite. Kept grouped storage as a recommended direction pending compatibility and recovery evidence. Browser retention verification and wiping/device-loss limits remain acceptance work. Documentation only; no production authorization or implementation.
- **Initial draft:** reserves the production persistence and authorization workstream for PR #27. No implementation or production authorization is included in this initial commit.
