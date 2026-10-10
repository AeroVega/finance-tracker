# Project Charter

**Status:** Draft baseline  
**Last updated:** 2026-10-10  
**MVP target:** 2027-01-01

## North Star
Build a trustworthy, low-friction personal finance tracker that combines financial information from multiple institutions into a consistent view of cash flow and financial position. It should work comfortably on iPhone and iPad, reduce manual data entry, and make uncertainty visible rather than hiding it.

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

## MVP1 outcomes
- Import supported CSVs from Wells Fargo, SoFi, and Fidelity.
- Normalize provider-specific rows into a common model.
- Prevent duplicates across repeated and overlapping imports.
- Preserve source traceability and report import outcomes.
- Track date coverage and freshness per account.
- Produce useful reports from a consistent ledger.
- Migrate annual summary metrics for 2023–2026 only where the archived source supports them.
- Keep private records outside public source control.

## Success criteria
- Each supported format has documented parsing behavior and synthetic tests.
- Re-imports and overlapping periods do not duplicate ledger records.
- Reconciliation is explainable and ambiguous rows are reviewable.
- Import coverage and freshness are truthful.
- Private storage, authentication, backup, and recovery have been reviewed and tested.
- Records can be exported in a portable format.
- No recurring charges, trial dependency, or private records in the public repository.

## Non-goals for MVP1
- Automatic bank refresh.
- Commercial multi-user product.
- Financial, tax, or investment advice.
- Required paid AI categorization.
- Using GitHub Pages or the public repository as a private database.
- Migrating unsupported transaction-level history from all prior years.

## Constraints and open decisions
The repository is public; recurring cost must be $0; bank passwords will not be stored; unauthorized scraping is prohibited; manual imports remain a permanent fallback. The frontend direction is modular static HTML/CSS/JavaScript on GitHub Pages, but private storage, authentication, import execution, deployment topology, and backup/recovery remain unselected. The archived `Finances.xlsx` is read-only and must not be modified.
