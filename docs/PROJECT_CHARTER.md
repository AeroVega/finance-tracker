# Project Charter

**Status:** Draft baseline  
**Last updated:** 2026-11-05  
**1.0.0 target:** 2027-01-01

## North Star
Build a trustworthy personal financial intelligence application that helps one person understand their financial position, understand how they arrived there, anticipate where they may be heading, explore alternatives, and measure progress toward meaningful goals. It should be mobile-first, tablet-friendly, desktop-capable, responsive, explainable, and privacy-first. See the [Second Generation Product Definition](PRODUCT_DEFINITION.md) for the owner-reviewed product direction and [Product Design Open Decisions](PRODUCT_OPEN_DECISIONS.md) for unresolved questions.

## Problem
The current annual spreadsheet workflow is flexible but requires repeated manual entry and makes duplicate prevention, reconciliation, and timely insights difficult. Automation matters, but data correctness and privacy come first.

## Product principles
1. Correctness before convenience.
2. Privacy by design.
3. One source-independent ledger for all ingestion methods.
4. Explainable calculations and documented reporting definitions.
5. Unknown, unavailable, stale, and zero are distinct states.
6. No recurring operating cost; a free trial is not a solution.
7. Incremental delivery: file imports first, API automation later if feasible.
8. Portable data and recoverable backups.

## Historical MVP1 baseline — superseded by the v1.0.0 scope

The outcomes, success criteria, and non-goals below preserve the original file-based MVP1 planning baseline for historical context. They are not the current v1.0.0 release specification. The owner-confirmed minimum coherent v1.0.0 scope is now recorded in [Product Definition §11](PRODUCT_DEFINITION.md#11-delivery-and-release-philosophy) and the [Roadmap](ROADMAP.md). Do not silently expand active PR scopes. PR #25's synthetic-only implementation is merged; its remaining owner-review items and the separate production-authorization gate are documented in the Product Definition and PR #25 acceptance record.

## Historical MVP1 outcomes
- Import supported CSVs from Wells Fargo, SoFi, and Fidelity.
- Normalize provider-specific rows into a common model.
- Prevent duplicates across repeated and overlapping imports.
- Preserve source traceability and report import outcomes.
- Track date coverage and freshness per account.
- Produce useful reports from a consistent ledger.
- Migrate annual summary metrics for 2023–2026 only where the archived source supports them.
- Keep private records outside public source control.

## Historical MVP1 success criteria
- Each supported format has documented parsing behavior and synthetic tests.
- Re-imports and overlapping periods do not duplicate ledger records.
- Reconciliation is explainable and ambiguous rows are reviewable.
- Import coverage and freshness are truthful.
- Private storage, authentication, backup, and recovery have been reviewed and tested.
- Records can be exported in a portable format.
- No recurring charges, trial dependency, or private records in the public repository.

## Historical MVP1 non-goals
- Automatic bank refresh.
- Commercial multi-user product.
- Financial, tax, or investment advice.
- Required paid AI categorization.
- Using GitHub Pages or the public repository as a private database.
- Migrating unsupported transaction-level history from all prior years.

## Constraints and open decisions
The repository is public; recurring cost must be $0; bank passwords will not be stored; unauthorized scraping is prohibited; manual imports remain a permanent fallback. The frontend direction is modular static HTML/CSS/JavaScript on GitHub Pages. Google Drive is the selected private-storage direction, subject to production-readiness validation; authentication configuration, import execution, deployment details, and backup/recovery remain subject to their existing engineering and acceptance gates. The archived `Finances.xlsx` is read-only and must not be modified.
