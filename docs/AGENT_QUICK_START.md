# Agent quick start

This is the short entry point. It is a navigation guide, not a substitute for technical contracts.

## Read only what you need

1. [Current project state](CURRENT_STATE.md) — implementation baseline, recent merges, verification, open gates, and authorization.
2. [Contributor and agent rules](../AGENTS.md) — privacy, permissions, branch workflow, and engineering guardrails.
3. [Documentation map](README.md) — locate the single focused contract relevant to the task.
4. Read that contract and inspect the corresponding code/tests. Read historical reports only when their specific evidence is relevant.

Do not read every document or historical PR report before starting work. The owner declared the project **GO for real financial data** on merge of PR 61 (see [the GO record](CURRENT_STATE.md#owner-decision-go-for-real-financial-data)). The shipped release profile lists both classes. Agents, tests, CI and public artifacts use invented fixtures only; never access real financial data.

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

- **Full-snapshot v1** is the selected physical application format. A commit envelope binds one entire validated canonical logical ledger; the manifest has published/clean acknowledgement states. Read [the active contract](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md).
- **Canonical ledger** is the financial domain model, not an instruction to retain older canonical persistence layouts.
- Legacy canonical v1–v5, locator catalogs, physical-root and framed-archive versions belong to the earlier storage design. Their retained documentation is historical rationale, not a second supported application route. See [terminology](STORAGE_TERMINOLOGY.md).
- Import remains a product requirement. Portable backup/restore and user-facing recovery are the active next PR; see current state for validation and deployment status. Legacy implementation history is not evidence for this route.

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

For the open/save performance gate, read [performance evidence](OPEN_SAVE_PERFORMANCE.md); synthetic timings are not live acceptance.
