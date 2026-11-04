# PR28 — Financial Tracker Application Implementation

**Status:** Draft reservation only. No product implementation or production-persistence authorization is included in this placeholder.

## Intended workstream

PR28 is reserved for building the actual financial-tracking application: turning the existing canonical import and reconciliation contracts into useful, user-visible functionality.

The expected implementation scope will be refined after the owner completes the PR26 product-definition discussion and the deeper PR27 production-persistence design discussion. Likely areas include:

- Provider-specific CSV parsing and normalization for the supported Wells Fargo, SoFi, and Fidelity export formats.
- Canonical ledger integration, import provenance, duplicate/overlap handling, pending-to-posted matching, and explicit correction/review paths.
- Deterministic categorization and a human-review workflow.
- Trustworthy cash-flow and wealth reporting with documented calculation definitions.
- Synthetic fixtures and regression tests as permanent first-class development capabilities.

This is an initial reservation, not a final implementation specification. The precise sequencing and acceptance criteria must be agreed before substantial coding begins.

## Dependencies and boundaries

- Complete and review PR26's product definition and consequential open decisions.
- Hold the PR27 design discussion and record the decisions that determine whether/how production financial-data persistence can be implemented safely.
- Do not treat PR27's draft or this PR as authorization to store real financial data.
- Preserve the permanent manual CSV import path and the $0 recurring-cost constraint.
- No real financial data, account exports, credentials, tokens, or private identifiers may enter this public repository, CI, or synthetic fixtures.
- Keep synthetic test data usable for routine development, regression, recovery, and acceptance.
- Do not weaken privacy, financial correctness, or recovery guarantees to meet the January 1, 2027 target.

## Reservation-only validation

This PR intentionally contains documentation only. It introduces no application code, schema, migration, production configuration, deployment, or persistence behavior. It is a placeholder to reserve the PR number and establish a clear workstream boundary. The implementation scope and branch contents will be expanded only after the prerequisite discussions.
