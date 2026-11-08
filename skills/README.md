# Project skills

Selected skills from [Matt Pocock's repository](https://github.com/mattpocock/skills), imported from commit [4ae2317ddb22b046e26455e4f9c9b3aaaf62212d](https://github.com/mattpocock/skills/commit/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d) on November 8, 2026. These are local, editable copies, not an auto-updating plugin.

The requested `unslop` comes from [Cursor's pstack plugin](https://github.com/cursor/plugins/tree/6b0300214a09fd6029cfb7077043125758cd1fd2/pstack/skills/unslop), pinned to commit `6b0300214a09fd6029cfb7077043125758cd1fd2`. It has its own license and attribution.

## Included skills

- [tdd](tdd/SKILL.md): test-first changes to parsing, reconciliation, canonical records, and other behavior. Includes examples and mocking guidance.
- [diagnosing-bugs](diagnosing-bugs/SKILL.md): reproduce a specific failure, narrow it, test a cause, and retain a regression test. Includes an optional human-assisted loop template.
- [code-review](code-review/SKILL.md): review the diff independently against repository standards and the approved specification.
- [pr](pr/SKILL.md): write a concise PR body with evidence, limitations, and rollback risk.
- [research](research/SKILL.md): investigate provider or implementation facts using primary sources.
- [codebase-design](codebase-design/SKILL.md): design testable module interfaces. Includes alternative-design and refactoring references used by TDD.
- [grill-me](grill-me/SKILL.md): interview the user about a plan when they explicitly request an interview.
- [grill-with-docs](grill-with-docs/SKILL.md): an explicitly requested interview that records agreed terms and decisions in existing project documents.
- [unslop](unslop/SKILL.md): edit prose for plain language while preserving facts, evidence, code, and approval boundaries.

Two support skills complete the requested workflows:

- [grilling](grilling/SKILL.md): the interview helper used by `grill-me` and `grill-with-docs`.
- [domain-modeling](domain-modeling/SKILL.md): the documentation helper used by `grill-with-docs`, with glossary and ADR format references.

## Discovery and use

`skills/` is the single source of truth. Each `.agents/skills/<name>` is a relative symlink to its matching directory here. [Codex supports symlinked skill folders](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills). No global skills, plugins, settings, or hooks are installed by this repository.

In Codex CLI or the IDE, use `$tdd`, `$code-review`, or `$grill-me`, or choose a skill with `/skills`. Other hosts can read the linked `SKILL.md` directly. A skill's instruction to load another skill means load its local `SKILL.md`, using a skill tool when the host has one. If skill discovery is unavailable, follow this index from `AGENTS.md`.

`grill-me`, `grill-with-docs`, their two helpers, and `unslop` carry `disable-model-invocation: true` and `allow_implicit_invocation: false`. A request to plan, implement, or review a change does not start an interview. When the user requests an interview skill, load its helpers explicitly. Respect any requested question limit and stop or narrow the interview when asked. `grill-me` interviews without automatically writing documents; `grill-with-docs` adds agreed documentation edits.

Git must preserve symlinks in the checkout. If the host checks them out as plain text, use the canonical paths here; do not create duplicate skill copies. `node --test tests/skills-contract.test.mjs` reports broken discovery links.

## Project rules

Read [AGENTS.md](../AGENTS.md), [README.md](../README.md), and the relevant approved scope before acting. These files remain authoritative. Skill invocation does not authorize a new action or widen the current task.

- Keep the existing static HTML/CSS/JavaScript architecture and Node test runner. Examples are guidance, not a request to add TypeScript, Jest, frameworks, packages, hooks, or a build system.
- Use deliberately invented fixtures and synthetic diagnostics. Never put real financial records, identifiers, credentials, OAuth headers, or tokens in code, reports, logs, screenshots, issues, or PRs. Redacting a real export does not make it an approved fixture. Live Google access, production instrumentation, and production persistence require their own authorization.
- Preserve financial-invariant, recovery, fault-injection, request-budget, and privacy coverage. Interface-focused testing does not justify dropping protocol assertions or deleting tests. A separately authorized refactor must demonstrate replacement coverage before retiring any test.
- Reuse approved requirements and test interfaces. Ask about unresolved choices that affect behavior, risk, scope, or permission; do not repeatedly ask the user to reconfirm settled decisions.
- Use the existing [data model](../docs/DATA_MODEL.md) and [architecture decisions](../docs/ARCHITECTURE_DECISIONS.md). If a glossary or ADR exists for the area, read it too. These skills do not create a parallel glossary, tracker, or decision process automatically.
- Use focused branches and PRs. Committing, pushing, posting a review, merging, deploying, production activation, and live data operations remain subject to the user's authorization. A review or PR-writing request alone does not authorize publication.
- Keep evidence honest: distinguish **Verified**, **User-confirmed**, **Hypothesis**, and **Open**, and distinguish implementation, validation, and deployment. Read the existing CI workflows for current check commands.

## Local adaptations

- Every entry points to these project rules. Existing repository documents replace assumptions about an installed setup skill, tracker document, or mandatory root glossary.
- TDD uses already approved test interfaces without a second approval round. Its examples use JavaScript and `node:test`/`node:assert` syntax. Review remains the place for broader refactoring.
- Debugging uses invented input and sanitized synthetic diagnostics. Temporary instrumentation stays local unless separately authorized. Its shell template collects only safe observations and refuses to run until deliberately adapted.
- Code review accepts the task's approved scope or existing documents as the spec and uses the known GitHub repository. It handles committed PRs separately from staged, unstaged, and untracked work. It does not install `setup-matt-pocock-skills` or post findings automatically.
- Codebase design retains lower-level contract tests where they protect financial correctness or recovery. Alternative interfaces remain proposals, not permission to refactor.
- PR and research guidance retain privacy restrictions and clearly separate evidence from unverified claims. The PR skill's [Humanlayer attribution](pr/CREDITS.md) is retained.
- `grill-me` and `grill-with-docs` include their `grilling` and `domain-modeling` dependencies. They are opt-in, reuse settled decisions, and respect the user's stopping point. Documentation uses existing files first; no root glossary or ADR directory is created automatically. The engineering skills do not start interviews.
- `unslop` retains its original numbered rules and is opt-in. Local instructions preserve exact quotes, code, citations, legal notices, financial definitions, claim labels, and approval boundaries. Its Codex UI metadata is locally supplied.

## Source and maintenance

[upstream.json](upstream.json) records the original source path and SHA-256 of every imported file before local edits. Preserve these records when reviewing local differences. [LICENSE](LICENSE) is the MIT license for the Matt Pocock imports, copyright 2026 Matt Pocock. [unslop/LICENSE](unslop/LICENSE) is the pstack MIT license, copyright 2026 Lauren Tan. Keep both notices with their respective material. This import does not select a license for Finance Tracker itself.

To update, compare the pinned source with the proposed upstream commit, review every changed instruction and bundled script, preserve local safeguards and credits, update the manifest and this index, then run the skill contract tests and the repository's applicable checks. Updates require a reviewed project change; no automatic updater is installed.

These files contain public engineering instructions only. The current Pages workflow uploads the repository root and therefore includes `skills/` as static files if this branch is separately deployed. Nothing here runs in the browser, and no skill-generated report or private data belongs in the deployment. This import does not change or run deployment.
