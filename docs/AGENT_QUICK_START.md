# Agent quick start

Read this page first. It is the navigation layer, not a replacement for detailed contracts.

## Read in this order

1. [Contributor rules](../AGENTS.md) — privacy, permissions, branch workflow and engineering guardrails.
2. [Project status](PROJECT_STATUS.md) — latest dated implementation, review, CI and deployment facts.
3. [Next steps](NEXT_STEPS.md) — current Alpha dependency order and acceptance gates.
4. Read only the contract for the code being changed. Use [the documentation index](README.md) to find it.

Do not read every historical PR report before starting a task.

## Current state (November 11, 2026)

- PR #37 is an open draft against `main`, based on `5e9c8966ddda10161f18d5483ff579a8a09e534a`. Its first storage foundation is active-path work; its paged-storage follow-up is isolated reference/prototype code.
- The application continues to use canonical per-record v1 and fragmented v3. New stores use fragmented v3; standalone grouped v2 is rejected. These canonical layout versions are distinct from locator-catalog version 1/2.
- PR #37's catalog v2, monthly sidecar index and response/backup bounds affect the active synthetic storage path. They do not provide bounded cold loading or remove whole-ledger validation.
- Immutable page trees, canonical v4, framed archives and root transaction protocol are not wired into the application. Do not describe them as current runtime behavior or switch paths without a separate integration plan.
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

- **Canonical layout version** (v1/v2/v3): financial-record representation. Current application policy is v1-readable, fragmented v3 for new stores, standalone grouped v2 rejected.
- **Locator catalog version** (v1/v2): storage index/root format. It is not a canonical layout version.
- **Canonical v4 / root protocol v3 / framed archive v3**: isolated follow-up formats; not active application paths.
- **Implemented** means code exists. **Verified** means the stated check passed on the named revision. **Owner-accepted** means the owner performed the stated acceptance. **Deployed** means a deployment completed and its served SHA was checked. None implies another.
- Hash integrity proves bytes under a root, not completeness or financial correctness of unread records.

## Documentation maintenance

Keep this page short. Put detailed invariants in one focused contract, measurements in the report that produced them, and current state in PROJECT_STATUS.md. Link rather than copy. Date historical evidence and never promote old test counts or acceptance results to current status. Remove superseded instructions from active guides; archive only material with historical value.
