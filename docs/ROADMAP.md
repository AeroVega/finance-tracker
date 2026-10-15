# Roadmap

**Status:** Draft planning baseline  
**MVP1 target:** 2027-01-01

This is a plan, not a guarantee that all proposed capabilities are feasible under the security and $0 recurring-cost constraints.

## Phase 0 — Foundation and discovery
- [x] Set North Star, MVP1 file-import path, and $0 recurring-cost constraint.
- [x] Establish public-repository privacy rules.
- [x] Record Fidelity export capabilities confirmed by the project owner.
- [x] Inspect sanitized sample exports for MVP1 account types (Wells Fargo, SoFi, Fidelity).
- [x] Document observed schemas, date formats, confirmed signs, and available identifiers/activity fields; validate raw CSV mechanics when appropriate.
- [ ] Finalize canonical ledger and import-run schema (logical concepts and import contract documented).
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

## Nominal development schedule

These are planning windows, not immovable deadlines. The target remains a usable, trustworthy MVP1 for **January 1, 2027**. Prioritize financial correctness, privacy, and recoverability over visual polish; if a milestone slips, reduce scope or adjust the schedule rather than weakening safeguards.

| Window | Phase | Intended outcomes |
| --- | --- | --- |
| Oct 9–18, 2026 | Requirements and historical baseline | Establish the North Star and constraints; inspect sanitized provider samples; document supported export formats, reporting principles, and the import/reconciliation contract. |
| Oct 19–Nov 1, 2026 | Data-integration prototype | Finalize the canonical ledger/import-run model; create synthetic fixtures; validate raw CSV mechanics where appropriate; investigate feasible ingestion and storage boundaries. Do not use real financial data until the security architecture is approved. |
| Nov 2–15, 2026 | Ledger and categorization | Implement normalization, provenance, conservative matching, human-review decisions, deterministic categorization, and core synthetic tests. |
| Nov 16–29, 2026 | Reporting and historical baseline | Define and implement the first trustworthy cash-flow and wealth reports; migrate only supported annual summary figures from 2023–2026 if feasible, without modifying the archived workbook or inventing missing values. |
| Nov 30–Dec 20, 2026 | Cutover rehearsal | Exercise imports, overlap handling, reconciliation, exception review, export portability, and backup/restore; test the intended iPhone/iPad workflow. |
| Dec 21–31, 2026 | Final validation and release preparation | Fix correctness and security issues, verify recovery and deployment, document known limitations, and decide whether the MVP meets its release criteria. |
| Jan 1, 2027 | Target MVP1 date | Begin using MVP1 only if privacy, correctness, and recovery exit criteria are met; otherwise defer release rather than compromise them. |

### Schedule guardrails

- The dates are nominal and should be re-baselined if discovery reveals a blocking issue, especially around secure private storage and authentication at $0 recurring cost.
- Evaluate the storage/authentication/security architecture before implementing persistence for real records. This is a gating dependency, not a reason to publish private data to a static site.
- Keep MVP1 focused on reliable manual imports and explainable reporting. Direct integrations remain MVP2 research and are not required for the January 1 target.
- Treat UI polish as lower priority than data integrity, privacy, transparent calculations, and tested backup/recovery.
