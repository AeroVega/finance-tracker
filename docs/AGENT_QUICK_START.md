# Agent quick start

Read this page first. It is the navigation layer, not a replacement for detailed contracts.

## Read in this order

1. [Contributor rules](../AGENTS.md) — privacy, permissions, branch workflow and engineering guardrails.
2. [Project status](PROJECT_STATUS.md) — latest dated implementation, review, CI and deployment facts.
3. [Next steps](NEXT_STEPS.md) — current Alpha dependency order and acceptance gates.
4. Read only the contract for the code being changed. Use [the documentation index](README.md) to find it, and [the storage terminology glossary](STORAGE_TERMINOLOGY.md) when version names or verification states are ambiguous. Historical PR reports live in [the archive](archive/README.md).

Do not read every historical PR report before starting a task.

## Current state (November 11, 2026)

- PR #37 is an open draft against `main`. Check its head and [project status](PROJECT_STATUS.md) for publication, validation and deployment evidence.
- The local v5 slice uses the existing paged store and lifecycle. New synthetic copies and explicit v1/v3 fresh-copy migration output use canonical v5. Existing v4 copies keep their profile and writer; no v4-to-v5 migration exists. Standalone grouped v2 is rejected.
- Canonical v5 keeps compact source/derived version 2, locator catalog 3 and physical root protocol 4. Framed transport 3 uses the explicit `canonical5-physical4` profile. See [the glossary](STORAGE_TERMINOLOGY.md) for version meanings.
- Canonical and locator changes are coalesced, with only final-reachable new pages prepared for upload. Full financial and retained-history/physical checks, whole-ledger workspace cloning/materialization and preparation memory remain. Bounded whole-database memory, selective app loading and incremental semantic validation are unfinished; see [project status](PROJECT_STATUS.md) for the performance gate.
- Financial position and reconciled coverage were merged in PR36. Historical monthly-summary migration, supported owner-file ingestion and production controls remain open.
- Production financial-data persistence is **NO-GO**. Use invented fixtures only. No real records, private workbook, live owner Drive operations, production activation, merge or deployment are authorized by the PR37 storage scope.

## Source-of-truth rules

| Question | Authoritative source |
| --- | --- |
| What is implemented and verified now? | [Project status](PROJECT_STATUS.md), with commit/PR and evidence scope |
| What should be done next? | [Next steps](NEXT_STEPS.md) |
| What behavior must a module preserve? | Its focused contract linked from [the index](README.md) |
| What did the owner authorize? | [AGENTS.md](../AGENTS.md) and the dated scope document |
| What was true on an earlier date? | Historical/acceptance report, only for that revision |

If sources disagree, prefer the newest dated evidence for status, the focused contract for technical behavior, and AGENTS.md for permissions. Flag the contradiction and correct the stale summary; do not silently combine incompatible claims.

## Vocabulary and evidence

- **Canonical layout version**: financial-record representation. The [format contract](PARTITIONED_CANONICAL_STORAGE.md) defines new-copy defaults and supported profiles. Opening an existing copy does not migrate it.
- **Locator catalog version**: physical storage index/root format, separate from canonical layout.
- **Root protocol and archive versions**: publication/recovery and portability formats. Canonical v4/v5 use physical protocol 4 and framed transport 3 with distinct explicit archive profiles. Older formats retain their separate interpretation.
- **Implemented** means code exists. **Verified** means the stated check passed on the named revision. **Owner-accepted** means the owner performed the stated acceptance. **Deployed** means a deployment completed and its served SHA was checked. None implies another.
- Hash integrity proves bytes under a root, not completeness or financial correctness of unread records.

## Documentation maintenance

Keep this page short. Put detailed invariants in one focused contract, measurements in the report that produced them, and current state in PROJECT_STATUS.md. Link rather than copy. Date historical evidence and never promote old test counts or acceptance results to current status. Remove superseded instructions from active guides; archive only material with historical value.
