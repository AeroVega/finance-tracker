# Agent quick start

This is the short entry point. It is a navigation guide, not a substitute for technical contracts.

## Read only what you need

1. [Current project state](CURRENT_STATE.md) — implementation baseline, recent merges, verification, open gates, and authorization.
2. [Contributor and agent rules](../AGENTS.md) — privacy, permissions, branch workflow, and engineering guardrails.
3. [Documentation map](README.md) — locate the single focused contract relevant to the task.
4. Read that contract and inspect the corresponding code/tests. Read historical reports only when their specific evidence is relevant.

Do not read every document or historical PR report before starting work.

## Source-of-truth hierarchy

| Question | Authority |
| --- | --- |
| What is true on current `main`? | [CURRENT_STATE.md](CURRENT_STATE.md), grounded in the named commit and checks |
| What is allowed now? | [AGENTS.md](../AGENTS.md) plus the explicit authorization recorded in CURRENT_STATE.md |
| What behavior/invariant must code preserve? | The focused module or format contract, linked from [the index](README.md) |
| What is the next project-level priority? | [NEXT_STEPS.md](NEXT_STEPS.md) |
| What is the intended product scope? | [PRODUCT_DEFINITION.md](PRODUCT_DEFINITION.md) |
| What is unresolved at product/architecture level? | [PRODUCT_OPEN_DECISIONS.md](PRODUCT_OPEN_DECISIONS.md) and [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) |
| What happened on an earlier revision? | Dated evidence in [PROJECT_STATUS.md](PROJECT_STATUS.md), PR reports, or [the archive](archive/README.md) |

If sources disagree, do not silently combine them. Report the conflict and correct the stale source. Current state never overrides a focused technical invariant; historical reports never override current implementation or permissions.

## Essential terminology

- **Canonical layout version** describes the financial-record representation.
- **Locator catalog version** describes a storage index/root representation; it is not the canonical layout version.
- **Physical root protocol** describes publication/recovery behavior.
- **Framed transport/archive profile** describes backup/restore representation.
- The active application writes canonical v5. Exact supported legacy-read behavior, subsystem versions, and refusal/recovery rules are defined in [PARTITIONED_CANONICAL_STORAGE.md](PARTITIONED_CANONICAL_STORAGE.md) and [STORAGE_TERMINOLOGY.md](STORAGE_TERMINOLOGY.md). Never infer compatibility from a version number alone.

## Evidence vocabulary

- **Implemented:** code exists on the named revision.
- **Verified:** a stated check passed on that exact revision.
- **Owner-accepted:** the owner performed the described acceptance.
- **Deployed:** the deployment workflow completed.
- **Deployed and verified:** the served build identity was independently checked.
- **Open / Unverified:** the evidence does not establish completion.

Hash integrity proves bytes covered by a root; it does not prove completeness or financial correctness of unread records.

## Documentation maintenance

Keep this page short. Put mutable status in CURRENT_STATE.md, priorities in NEXT_STEPS.md, product intent in PRODUCT_DEFINITION.md, and each technical invariant in one focused contract. Keep measured results with their dated evidence. Link rather than duplicate. Archive completed reports only when they retain historical value.
