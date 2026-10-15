# Architecture Decisions and Open Questions

**Status:** Baseline; several decisions intentionally remain open  
**Last updated:** 2026-10-15

## ADR-001 — File imports for MVP1
**Status: Accepted.** MVP1 ingests CSV files downloaded by the project owner. MVP2 may add free, authorized direct integrations only after cost, authorization, sustainability, and security are verified. This keeps delivery independent of an unproven API and makes import correctness a first-class capability.

## ADR-002 — Public repository contains no private financial records
**Status: Accepted.** The public repo contains application code, documentation, and deliberately synthetic tests only. Real exports, records, balances, holdings, credentials, and secrets are prohibited. Removing a file in a later commit does not erase prior history.

## ADR-003 — Source-independent canonical ledger
**Status: Accepted as a design principle; schema pending.** File and future API adapters feed one normalized ledger and the same deduplication, review, and reporting pipeline. Preserve source identity, descriptions, identifiers, and import provenance.

## ADR-004 — No recurring operating cost
**Status: Accepted.** No recurring fees for hosting, storage, aggregation, refresh, or AI. A development sandbox or expiring trial does not qualify as free production access.

## ADR-005 — Static modular frontend
**Status: Provisional direction.** Prefer modular static HTML/CSS/JavaScript on GitHub Pages; avoid frameworks/build systems without a documented reason. Static hosting is not private storage, authentication, or a secret store. This decision does not select a backend.

## ADR-006 — Deterministic-first categorization
**Status: Accepted principle.** Use inspectable, editable, reversible rules and route ambiguous records to review. AI is not the default categorizer.

## ADR-007 — Conservative, idempotent overlapping imports
**Status: Accepted.** MVP1 automatically merges only confidently matched records and routes ambiguous candidates to review. Stable provider transaction/activity IDs are preferred when their semantics are understood and are scoped to provider and account. Without stable IDs, use a conservative composite and require uniqueness plus corroborating evidence. Date, amount, and description alone are not sufficient proof of duplication. Identical file retries must be idempotent; new overlapping exports are reconciled row by row rather than replacing date ranges. Preserve source observations, import provenance, and correction/lifecycle history. Never silently discard legitimate-looking rows or overwrite conflicting accepted data. Keep successful pipeline completion (`processed`) distinct from financial settlement and from explicit human sign-off. Persist human review decisions as auditable, scoped events and reuse identity-match approvals as evidence on later imports without treating them as universal duplicate signatures.

## Open decisions required before production implementation
1. **Private storage:** Where does the canonical ledger live without becoming public?
2. **Authentication:** How does the owner securely access records from iPhone/iPad?
3. **Import execution:** Is CSV parsing local in the browser or in a trusted backend? What data crosses the network?
4. **Deployment and cost:** Can any needed backend operate sustainably at $0 recurring cost without a trial?
5. **Backup/recovery:** How are records backed up, restored, and exported, and who controls the backup?
6. **Lifecycle:** How are edits, deletions, corrections, and source changes reconciled?
7. **Privacy boundary:** What enters browser storage, logs, telemetry, and backups?
8. **Historical summaries:** How can 2023–2026 annual summaries be migrated only where supported?
9. **Threat model:** What happens after device loss, credential exposure, a misconfiguration, or provider revocation?

## Candidates, not decisions
Serverless database and Google ecosystem approaches may be evaluated, but none is selected. Compare authentication, isolation, portability, backup/recovery, operational burden, and full recurring cost before prototyping with real records.
