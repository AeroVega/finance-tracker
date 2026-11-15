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

## Sequencing rules

- Alpha and Beta are deployable development milestones, not semantic-version releases.
- PR numbers do not prescribe merge order. Sequence by dependency, risk, reviewability, and readiness.
- Use synthetic data for development and acceptance. A separate real-data smoke test is not required; this does not waive non-test production gates.
- Manual file imports remain permanent even if a sustainable authorized direct integration is later available.
- Preserve the $0 recurring-cost constraint, privacy, correctness, and recoverability over schedule or visual polish.
- January 1, 2027 is a target, not permission to weaken acceptance. Defer release if gates are unmet.
