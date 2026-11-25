# Agent quick start

Read this page, then only the contract your task touches. Do not read every document or historical report before starting.

## Reading order

1. [Current state](CURRENT_STATE.md): baseline, evidence, open gates and what is authorized now.
2. [AGENTS.md](../AGENTS.md): privacy, Git permissions and engineering rules.
3. [Documentation map](README.md): find the one focused contract for the task.
4. That contract, plus the code and tests it names.

The owner declared the project **GO for real financial data** when PR 61 merged (see [the GO record](CURRENT_STATE.md#owner-decision-go-for-real-financial-data)). Agents, tests, CI and public artifacts still use invented fixtures only. Never access real financial data.

## Where to look

| Question | Authority |
| --- | --- |
| What is true on `main` now? | [CURRENT_STATE.md](CURRENT_STATE.md) |
| What is allowed? | [AGENTS.md](../AGENTS.md) plus the authorization recorded in CURRENT_STATE.md |
| What must this code preserve? | The focused contract linked from the [documentation map](README.md) |
| What is the next priority? | [NEXT_STEPS.md](NEXT_STEPS.md) |
| What is in scope for v1.0.0? | [PRODUCT_DEFINITION.md](PRODUCT_DEFINITION.md) |
| What is undecided? | [PRODUCT_OPEN_DECISIONS.md](PRODUCT_OPEN_DECISIONS.md) and [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) |
| What happened earlier? | [PROJECT_STATUS.md](PROJECT_STATUS.md) and the [archive](archive/README.md) |

If sources disagree, report the conflict and correct the stale source. Current state never overrides a focused technical invariant. Historical reports never override current code or permissions.

## Terms

- **Full-snapshot v1** is the only supported application storage format. A commit envelope binds one complete validated ledger. Read the [contract](FULL_SNAPSHOT_STORAGE.md).
- **Canonical ledger** is the financial domain model: accounts, imports, observations, activities and append-only events. It is not a storage layout.
- Older storage versions (canonical v1–v5, locator catalogs, framed archives) are retired. See [storage terminology](STORAGE_TERMINOLOGY.md) and [retired designs](archive/RETIRED_STORAGE_DESIGNS.md).
- File import is permanent product capability.

## Evidence vocabulary

- **Implemented:** code exists on the named revision.
- **Verified:** a stated check passed on that exact revision.
- **User-confirmed / Owner-accepted:** the owner reported or performed the described acceptance.
- **Deployed:** the deployment workflow completed.
- **Deployed and verified:** someone independently checked the served build.
- **Open / Unverified:** the evidence does not establish completion.

A hash proves the bytes it covers, not the completeness or financial correctness of records nobody read.

## Maintaining the docs

Put mutable status in CURRENT_STATE.md, priorities in NEXT_STEPS.md, product intent in PRODUCT_DEFINITION.md, and each invariant in one focused contract. Keep measurements next to their dated evidence. Link instead of copying. Move a superseded report to the archive when it still has historical value; otherwise delete it. Git history keeps the original.
