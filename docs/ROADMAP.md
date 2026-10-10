# Roadmap

**Status:** Draft planning baseline  
**MVP1 target:** 2027-01-01

This is a plan, not a guarantee that all proposed capabilities are feasible under the security and $0 recurring-cost constraints.

## Phase 0 — Foundation and discovery
- [x] Set North Star, MVP1 file-import path, and $0 recurring-cost constraint.
- [x] Establish public-repository privacy rules.
- [x] Record Fidelity export capabilities confirmed by the project owner.
- [ ] Inspect sanitized sample exports for every supported account type.
- [ ] Document exact schemas, date formats, signs, identifiers, and activity coverage.
- [ ] Define canonical ledger and import-run models.
- [ ] Evaluate private storage, authentication, backup/recovery, and portability.
- [ ] Review and document architecture decisions before production implementation.

## MVP1 — Reliable file-based tracker
Scope:
- Modular static HTML/CSS/JavaScript frontend, subject to architecture review.
- Manual file selection and import.
- Parsers for verified Wells Fargo, SoFi, and Fidelity CSV formats.
- Common normalized ledger and import provenance.
- Idempotent imports, overlap handling, correction and review paths.
- Deterministic categorization with review for ambiguous records.
- Cash-flow and wealth reports with documented definitions.
- Import outcomes, history coverage, and freshness indicators.
- Private storage/authentication only after a suitable architecture is approved.
- Portable export and tested backup/recovery.

Exit criteria:
- Synthetic tests cover each supported format and important edge cases.
- Re-import and overlapping-import tests demonstrate duplicate safety.
- Totals reconcile with explainable rules.
- Incomplete coverage and ambiguous rows are clearly represented.
- Security, deployment, backup, and restore are reviewed and tested.
- No recurring costs, trial dependency, or private data in the repository.

## MVP2 — Direct-import research and possible automation
Investigate free, authorized, sustainable production access for Wells Fargo, SoFi, Fidelity brokerage, and Fidelity workplace 401(k). Verify cost, terms, permissions, history depth, supported activity, refresh limits, revocation, and security. Do not rely on stored passwords, unauthorized scraping, commercial production tiers, or expiring trials.

Any qualifying integration must feed the same normalization and reconciliation pipeline. Keep file imports permanently. If no qualifying API exists, remaining file-based is an acceptable outcome.

## Suggested sequence
1. Inspect sanitized sample exports.
2. Document schemas and author synthetic fixtures.
3. Define ledger semantics, matching, and reconciliation.
4. Evaluate storage, authentication, deployment cost, and backups.
5. Review architecture decisions.
6. Implement tested parsers and normalization.
7. Build persistence and UI within the approved security boundary.
8. Validate end-to-end imports, reconciliation, recovery, and device usability.
9. Release MVP1.
10. Continue API research for MVP2.

Prefer a smaller reliable scope over weakening privacy or correctness to meet a date.
