# Roadmap

**Last reconciled:** 2026-11-14  
**Target:** v1.0.0 on 2027-01-01, conditional on release readiness.

This document summarizes delivery stages. It does not duplicate detailed feature requirements or act as the live implementation status. See [CURRENT_STATE.md](CURRENT_STATE.md) for what is on `main`, [NEXT_STEPS.md](NEXT_STEPS.md) for active priorities, and [PRODUCT_DEFINITION.md](PRODUCT_DEFINITION.md) for the owner-confirmed product scope.

## Delivery progression

### Alpha — trustworthy financial foundation
Establish reliable source ingestion, historical monthly migration, canonical activity and position records, reconciliation, deterministic categorization, auditable corrections, and dependable private persistence/recovery/portability. Alpha is complete only when the owner can import/migrate history, review and correct it, understand coverage/provenance, reconcile financial position, and trust that the data is preserved and recoverable.

### Beta — visual and analytical experience
Build the user-facing dashboard, navigation, historical reporting, insights, basic category budgets, and the limited baseline projection on top of the trustworthy Alpha foundation. Validate with controlled synthetic datasets and target-device interaction. Beta does not waive data correctness or privacy gates.

### 1.0.0 — integrated first product release
Deliver the minimum coherent replacement for the first-generation workbook, integrating the Alpha foundation and Beta experience. Required scope and deferred capabilities are defined in [PRODUCT_DEFINITION.md](PRODUCT_DEFINITION.md). Release requires functional completeness, correctness, security/privacy, backup/recovery, cost compliance, owner review, and explicit authorization for production financial-data use.

### 2.0.0 — expanded capabilities
Consider deeper investment analysis, advanced planning/projections, expanded automation, additional integrations, and other deferred capabilities through separate product decisions. These are opportunities, not automatic commitments.

## Work in order of use

- Prove the single-user path first: one designated Google account, one private database folder, one active device, explicit verified saves, and a manually rehearsed encrypted backup restore. Use [one acceptance checklist](OWNER_ACCEPTANCE.md) for the exact candidate. No account switching, simultaneous editing, automatic backups or cleanup are necessary for this path.
- Make the common workflow easy to find before adding richer screens: open the tracker and see money in and out, find what needs review, and look at one monthly trend with gaps and estimates labeled. Reuse existing reports and sources. Judge the interface by whether those tasks are clear on the intended devices, not by the number of cards or controls.
- Keep the legacy migration wizard separate from readiness engineering. Resume it only at the owner's direction. Its synthetic completion is not permission to process the private workbook or save real data.
- Compare a representative invented workload against accepted open and save goals before proposing a storage redesign. Retain integrity checks and evidence; do not trade verification for a faster benchmark.

This sequence does not silently remove features from the agreed v1.0 scope. If the agreed scope cannot be completed and accepted by January 1, choose a smaller milestone or explicitly agree which features to defer.

## Sequencing rules

- Alpha and Beta are deployable development milestones, not semantic-version releases.
- PR numbers do not prescribe merge order. Sequence by dependency, risk, reviewability, and readiness.
- Use synthetic data for development and acceptance. A separate real-data smoke test is not required; this does not waive non-test production gates.
- Original CSVs are parsed locally and never uploaded or persisted by the app; approved private persistence retains normalized records and required provenance only. See [ADR-010](ARCHITECTURE_DECISIONS.md#adr-010-local-only-original-csv-files).
- Manual file imports remain permanent even if a sustainable authorized direct integration is later available.
- Preserve the $0 recurring-cost constraint, privacy, correctness, and recoverability over schedule or visual polish.
- January 1, 2027 is a target, not permission to weaken acceptance. Defer release if gates are unmet.
