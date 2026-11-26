# Contributor and Agent Instructions

Read [the agent quick start](docs/AGENT_QUICK_START.md) first. It points to the concise [current state](docs/CURRENT_STATE.md), this file, and only the focused contracts needed for the task. Use [the documentation index](docs/README.md) to navigate; do not ingest every document by default.

## Agent workflows
Read [the skills index](engineering-workflows/README.md) when a task needs a defined workflow. Canonical skill files live in `engineering-workflows/skills/`; `.agents/skills/` exposes them for agent discovery. Skills supplement these instructions and never grant permission to merge, deploy, or use real financial data.

## Git workflow and permissions
- Work on a focused branch and submit a pull request into `main`.
- Never push directly to `main`, force-push, or rewrite shared history. Merge only under the [merge policy](docs/GUARDED_CODE.md): the owner has pre-authorized merging a PR that touches no guarded code once every required check passes; for guarded code, prepare and babysit the PR, walk the owner through an agent-assisted review, declare it ready, and leave the merge click to the owner. Any other merge needs explicit owner authorization.
- Do not change production configuration, Google Cloud settings, or the release profile without explicit authorization. The owner's standing GO for real financial data ([CURRENT_STATE.md](docs/CURRENT_STATE.md)) is not re-granted per commit; merging to `main` deploys through the existing Pages workflow.
- Inspect the full diff and report changes, tests, deployment state, limitations, and unresolved risks.
- Current authorization and phase boundaries are in [CURRENT_STATE.md](docs/CURRENT_STATE.md). Recheck it before acting; historical PR descriptions do not grant current permission.

## Standing owner authorization
This section is the authoritative statement of the owner's standing decisions. It lives in a guarded file on purpose: changing it is guarded-code work that only the owner merges. [CURRENT_STATE.md](docs/CURRENT_STATE.md) records the dated history and links here.
- **Real financial data: GO (2026-11-24).** The owner's GO is standing. It is not re-granted per commit or SHA, and no per-build acceptance checklist applies; the pre-GO checklist is archived at [OWNER_ACCEPTANCE_2026-11-24.md](docs/archive/OWNER_ACCEPTANCE_2026-11-24.md). `main` is kept stable by the required CI checks.
- **Merging:** PRs that touch no guarded code merge on passing required checks, with no owner step. Guarded-code PRs are merged only by the owner after an agent-assisted review (see [GUARDED_CODE.md](docs/GUARDED_CODE.md)).
- **Data and access:** real data never enters the repository, CI or logs; agents never touch the owner's real Drive folder or accounts; Synthetic stays the default for development.
- **Safeguards:** the 3-month encrypted backup cadence and the capacity-review triggers recorded in [CURRENT_STATE.md](docs/CURRENT_STATE.md) stay in force.

## Public-repository privacy
This repository is public. Never commit real transaction CSVs, statements, account exports, holdings, balances, financial summaries, account identifiers, passwords, tokens, private keys, database credentials, cookies, or production environment files. Treat logs, screenshots, workflow output, issues, pull requests, branches, and Git history as potentially public.

Deleting a sensitive file in a later commit does not remove earlier copies. If a secret is exposed, stop, notify the owner, and recommend immediate revocation/rotation and history remediation.

Use deliberately synthetic fixtures authored with invented data. Do not copy real exports and merely replace amounts; descriptions and other fields can still identify a person or account. Keep sanitized user-provided samples outside the repository by default.

## Architecture guardrails
- Prefer the modular static HTML/CSS/JavaScript frontend hosted on GitHub Pages. Do not add frameworks or build systems without an explicit decision.
- GitHub Pages is public static hosting, not a private database or secret store. Never put private records or privileged credentials in frontend code or public assets.
- Do not select a backend, database, authentication provider, or financial API without reviewing security, cost, sustainability, backups/recovery, and portability.
- The operating-cost constraint is $0 recurring. Free trials and development sandboxes are not sustainable free production.
- No stored bank passwords or unauthorized scraping.
- File imports are permanent product capability. MVP1 is file imports; MVP2 may investigate free, authorized direct integrations.
- Prefer deterministic, inspectable categorization rules and review over AI as a default categorizer.
- New throw sites use registered codes through `AppError`/`fail`; wrapped native errors retain `cause`. Shared reports use typed allowlisted fields, never raw errors or messages.

## Financial correctness
- Preserve source descriptions, stable identifiers where available, and import provenance.
- Re-imports and overlapping exports must not silently duplicate transactions.
- Explicitly handle pending-to-posted transitions, corrections, and incomplete history.
- Track import coverage/freshness; never present stale or incomplete data as fully current.
- Internal transfers are not income or spending. Do not double-count credit-card purchases and payments.
- Separate investment contributions, trades, fees, dividends, and market-value changes from ordinary spending.
- Unavailable data is not zero. Never fabricate historical figures.

## Documentation governance
Documentation preserves project knowledge while making current direction unambiguous:
1. Preserve meaningful decisions, rationale, constraints, lessons, and historical evidence.
2. Centralize mutable project direction in [CURRENT_STATE.md](docs/CURRENT_STATE.md). Other documents link to it instead of copying status.
3. Keep implementation truth near code or in focused technical contracts referenced by the code.
4. Separate historical context from current instructions. Archive superseded reports when they retain historical value.
5. Distinguish proposed, experimental, partially implemented, integrated, verified, owner-accepted, and deployed work.
6. Make the current state and permission boundary quick to establish.

When sources conflict, use the newest verified implementation evidence for code behavior, the focused contract for module invariants, CURRENT_STATE.md for current project status, and this file for permissions. Resolve contradictions at their source; do not add another competing summary.

Use **Verified**, **User-confirmed**, **Hypothesis**, and **Open** precisely. Preserve dates and source revisions. Recheck time-sensitive provider terms against primary sources.

## Unslop

- No trailing "-ing" phrases that add no fact ("highlighting...", "ensuring...").
- No vague attributions ("experts believe"). Name the source or delete.
- No AI vocabulary: additionally, crucial, delve, enhance, foster, landscape, pivotal, showcase, testament, underscore, vibrant.
- Say "is" or "has", not "serves as", "stands as", "boasts", "features".
- No "not just X, but Y". State the point.
- Don't force ideas into threes.
- One name per thing. Repeat it.
- No "from X to Y" unless X and Y sit on a real scale.
- No em dashes, en dashes, or hyphens used as dashes, and no parentheses in their place. Use a period or a comma.
- A colon goes before a list or an example, never mid-sentence as a connector.
- Don't bold every proper noun or acronym.
- No bold label and colon that restates its line ("Performance: Performance improved..."). A bold lead-in that ends in a period and adds new detail is fine.
- Sentence case headings.
- No decorative emojis.
- Straight quotes.
- No chatbot phrases ("I hope this helps!", "Let me know if...").
- No praise or agreement openers. Respond directly.
- Cut filler. "In order to" becomes "to". Delete "it is important to note that".
- One hedge at most: "may".
- No generic conclusions. State specific plans or facts.
- No abstract metaphor nouns: substrate, wedge, vector, nexus, primitive, harness, surface, scaffolding, paradigm, ratchet, north star, flywheel. Use the concrete word.
- Say what it does, not how it feels. Name the mechanism or the number. Cut a sentence that could appear unchanged in another project's docs.
- One idea per sentence. Split a sentence the reader has to reread.
- Active voice. Name the actor unless it is unknown or doesn't matter.
- Cut adverbs or use a stronger verb. Give the number.
- Use the plain word: "use", not "utilize" or "leverage".
- No metaphor, aphorism, personified code, or figurative verb where a literal phrase exists.
- Write whole sentences with their articles and verbs. Spell out arrows and abbreviations.

## Technical writing

Write so a tired engineer understands on the first read.

- Cut every word that does no work.
- Use the short, everyday word: "use", not "utilize".
- When a rule makes a sentence worse, fix the sentence another way or leave it alone.
- Write the real symbol, file, flag, or command name, not a synonym or a description of it.
- Don't invent jargon. Use the words a developer would say out loud. Say what a named pattern means the first time.

### Vary the rhythm

- Mix sentence lengths. Split the sentence that carries two thoughts. Keep the long sentence that carries one.
- Have a view in explanation. Keep reference dry.
- Be specific. Not "schema changes can cause issues" but "a column rename fails the build".

### Pick the mode first (Diátaxis)

One document, one mode. Don't mix modes. Split and link instead.

- Tutorial: learning by doing. Say what the learner will build. Every step produces a visible result, and you say what they should see. Explanation gets one clause and a link.
- How-to: steps to a goal. Solve the reader's problem. Assume competence. Action only. Allow forks. Name the guide by the task.
- Reference: facts for lookup. Only describe. Be dry, complete, and sure. Mirror the structure of the thing described.
- Explanation: understanding and why. One bounded topic. Give context: design decisions, history, constraints, alternatives. Opinion is allowed here and nowhere else.

### Write sentences to the reader

- Talk to the reader as "you", in the present tense.
- Say who does what. Passive is fine only when the actor is unknown or beside the point.
- Write instructions as commands. Put the condition before the instruction and the common case first.
- No buzzwords, no figurative language, no "please", and never "simply", "easy", or "quickly" in a procedure.
- Don't pre-announce, and don't start consecutive sentences with the same phrase.
- Link with words that say where the link goes.
- Headings carry the point, in sentence case. One h1 per page, no skipped levels.
- Numbered lists for sequences, bullets for everything else. Introduce a list with a complete sentence. Keep items parallel.
- Code goes in code font. UI elements go in bold. Use serial commas. Drop "etc.".

### Make statements load one at a time

- One instruction per sentence. One thought per sentence everywhere else.
- Split instructions longer than about 20 words and other sentences longer than about 25.
- Put the warning or condition before the step it guards.
- Keep "the" and "a".
- Give each word one meaning, and pick one word per action.
- Write procedures as direct commands, never as narration and never in the passive.

### Leave no sentence open to two interpretations

- Keep words like "only" and "not" next to the word they change.
- Break up long noun strings.
- Make every "it", "they", and "this" point at one obvious thing. Never use "this" or "which" to point at a whole clause.
- Don't drop verbs, or the small words that show structure, such as "that".
- Repeat the article in a series when it prevents a misread. Say which parts "and" or "or" joins.
- Use periods, not semicolons or em dashes. No slashes, and no "(s)". Make text in parentheses a full grammatical unit.
- Call each thing by one name, everywhere.
- Skip idioms, colloquialisms, Latin abbreviations, and metaphors.

### Voice and repo specifics

- Apply the Unslop rules above to every doc this section touches. The Unslop section owns the slop-pattern catalog: AI vocabulary, filler, hedging, formatting tells.
- When you edit existing prose, compare the result with the original for lost qualifications, changed numbers, missing citations, and changed claims.

PR descriptions and commit messages are writing too. Every layer except Diátaxis applies to them. A PR body is a briefing that a reviewer can read in under a minute. Do not paste swarm logs, SHA lists, or metric tables. Link them.
- Product UI strings are not documentation. Use your product's copy guidelines for those.

Indent code snippets with tabs. Write real paths. Make every count or tree claim true at the commit that lands it, and include the command that regenerates it.

## Engineering and verification
Before changing code, inspect repository structure, nested instructions, relevant contracts, recent changes, current branches/PRs, and applicable workflows. Understand existing behavior before replacing it.

For significant changes:
- Define acceptance criteria and likely regression risks before implementation.
- Make focused changes and inspect the complete diff.
- Run deterministic checks appropriate to the change: syntax, structured-data validation, generated-reference checks, documentation links/anchors, and financial invariants.
- Test changed behavior and adjacent paths, prioritizing parser correctness, duplicate reconciliation, provenance, financial calculations, privacy, and recovery.
- Never equate a green workflow, successful commit, or deployment with complete application acceptance.

### GitHub Pages and mobile
Treat iPhone and iPad as primary platforms. For relevant UI changes, check narrow/wide layouts, portrait/landscape, navigation, safe areas, viewport changes, overflow, touch targets, accessibility, and long/missing content. Desktop screenshots do not establish correct mobile behavior; use physical Safari when possible.

For deployment changes, verify workflow trigger, permissions, artifact contents, publishing configuration, deployed URL/path, workflow result, and served SHA. A commit or push does not prove deployment. Identify any required repository Settings action that code cannot perform.

### Service workers and offline behavior
Do not add service workers, offline modes, install prompts, or offline toggles without an established user need and freshness requirements. If introduced, document and test cache/update behavior, first install, repeat launch, deployment updates, offline startup, stale/missing data, reconnection, and old-client/new-asset compatibility. Never present stale financial information as current.

## Coding principles

### Consolidate decisions

Do not repeat the same choice in several places. Put it behind one source of truth and pass the result as a simple flag.

### Minimize the diff

Make the smallest change that solves the problem. Fewer lines beat "elegant" boilerplate.

### Make operations idempotent

- Design every state-changing operation to converge to the correct state however many times it runs and wherever the previous run stopped.
- Derive each step from the state that exists, not from what the previous run meant to do. Read the current state, compare it to the goal, and apply only the difference.
- Anything a run leaves behind (a lock, a temporary file, a half-written record, a claimed job) must be recognizable as stale by the next run, by evidence that holds wherever the previous run could have stopped. Write to a temporary path and rename it into place.

The test: what happens if this runs twice? What if the previous run crashed at every possible point? If the answer depends on what was left behind, add a reconciliation step.

### Minimize reader load

- Reader load is the work a reader must do to understand code. It has two independent axes: layers to trace between the question and the answer, and hidden or mutable state to hold in their head. Guard both.
- Collapse layers that only forward: wrappers with one caller, adapters with no second implementation, pass-through methods. Inline them.
- Shrink state scope: returns over mutations, locals over fields, fields over module state, module state over globals. Derive instead of sync.
- Name an invariant once at the boundary, not in every consumer.

The test: can a new reader answer "where does X come from?" and "what can change X?" in under 30 seconds? If not, cut layers or cut state.

### Outcome-oriented execution

Optimize for the intended, verifiable end state rather than preserving smooth intermediate states.

Why? Keeping every intermediate step fully stable often creates temporary compatibility code that becomes long-lived debt. Converge on the target architecture and prove correctness at explicit verification boundaries.

- Core rule:
	- Prioritize end-state integrity over transitional stability
	- Intermediate breakage is acceptable when it is planned, scoped, and reversible

- Guardrails:
	- Use this for planned rewrites and migrations with explicit phase boundaries
	- Declare where temporary breakage is acceptable
	- Keep high-signal checks for actively touched areas while migrating
	- Require full static and runtime verification at plan completion

### Subtract before you add

When evolving a system, remove complexity first, then build. Default to subtraction. Make simplification a continual investment. Leave the design slightly simpler and more capable behind the same or smaller surface than you found it.

- Sequence removal before construction
- Cut before you polish (get to the minimum before investing in quality)
- Design for observed usage, not speculative edge cases
- No speculative validators, parsers, or guards beyond what the spec demands
- Simplify prompts (remove redundant instructions, excessive templates)
- When a reference has no novel content, delete it rather than leaving a stub

### Redesign from first principles

When integrating a change, don't bolt it onto the existing design. Redesign as if the requirement had been a foundational assumption from the start.

- Read all affected files and understand the current design
- Ask: "if we were writing this from scratch with this new requirement, what would we build?"
- Propagate the change through every reference: types, docs, examples, rationale sections
- Think about the whole redesign, then deliver it incrementally

This is the method for preserving option value when integrating changes into an existing design.

### Migrate callers then delete legacy APIs

Update tests to assert the new contract, and delete tests that only protect pre-refactor implementation details. This applies when no external users depend on backward compatibility, the project can absorb coordinated breaking changes, and the new API is part of a simplification or refactor initiative.

### Boundary discipline

Validate, narrow types, and handle errors where data crosses a system boundary (CLI args, config files, external APIs, network). Inside, trust the types: no re-validation and no redundant nil checks. Parse raw data into domain types at the boundary, and keep transport and framework types out of the public surface. Business logic lives in pure functions with no framework dependencies. The shell that calls them is thin.

Two tests. Is this data crossing a boundary right now? If not, the validation is redundant. Can this be a pure function the shell just calls? If yes, extract it.

## TDD bug fixing

When fixing a bug with a clear, cheap test path, make the broken behavior executable before changing production code. The goal is a focused regression test that fails before the fix and passes after it.

Do not force a test when it would be impractical. If the available test would require broad harness setup, brittle mocks, slow end-to-end infrastructure, production-only state, vague reproduction steps, or large unrelated fixture churn, skip adding a new test and use the closest useful verification instead.

### Workflow

1. Understand the bug. Identify the intended behavior, current behavior, affected path, and smallest observable reproduction.
2. Choose the narrowest executable check. Prefer the closest unit, component, integration, or regression test already used for that codepath. If no practical test path is obvious, do not create one from scratch just to satisfy the workflow.
3. Write the failing test first. Add the smallest focused test that would have caught the bug. The test should encode intended behavior, not mirror the current implementation.
4. Run the new test before fixing. Confirm it fails for the intended reason. If it passes or fails for an unrelated reason, correct the test or reproduction before editing the implementation.
5. Fix the bug. Make the smallest production change that satisfies the intended behavior while preserving nearby contracts.
6. Rerun the regression test. Confirm the test now passes.

### If a failing test is impractical

Use the closest executable regression check instead: a targeted script, manual reproduction command, browser automation, snapshot comparison, log assertion, or focused integration check.

Prefer no new test over a bad test. A bad test is one that mostly tests mocks, encodes current implementation details, depends on timing or unrelated global state, needs expensive infrastructure for a small fix, or would be deleted immediately after proving the fix.

### Guardrails

- Do not change tests merely to match a wrong implementation.
- Do not weaken existing assertions unless the expected behavior has genuinely changed and the reason is clear.
- Keep the regression test focused on the bug. Avoid broad fixture churn or unrelated coverage expansion.
- If the bug is flaky, make the test deterministic where possible and document the signal being locked down.
- If the bug exposes a broader class of failures, first land the focused regression path, then consider additional sibling coverage.

### Final response

Report the evidence, not just the outcome:

- Name the failing-before test or executable check and the failure it produced.
- Name the passing-after test run and any nearby validation performed.
- If failing-before evidence could not be demonstrated, state why and describe the closest regression check used instead

## Behaviors

### Experience first

When implementation convenience conflicts with user delight, choose delight.

- Every feature, control, and option must be justified
- Ship less, ship better (polished experience with three features beats rough one with ten)
- Prototype before committing (design decisions are cheaper in throwaway HTML than production code)
- Get the details right (transitions, alignment, spacing, feedback, error states)
- Tighten the core loop (every feature should serve the central workflow or get out of the way)

The user is whoever consumes the work. For a UI that is the end user. For a library or an internal API it is the colleague who imports it. The engineer who maintains the code next is a user too. Weigh their experience the same way, and explain impact from their perspective.

Foundations should serve the experience. Foundational thinking governs the sequence of work. This principle governs the target.

### Foundational thinking

Apply before writing logic: choosing core types and data structures, sequencing scaffold-vs-feature work, asking what concurrent actors share. Get the data structures right so downstream code becomes obvious. Define core types early, trace every access pattern, and choose structures that match the dominant paths. DRY the structure, not every line.

Before sharing state between actors, ask what happens if another actor modifies it concurrently. If the answer is not "nothing", isolate.

Scaffold first. Whatever helps every later phase (CI, tests, shared types) goes first, after removing dead code. Keep commits small and single-purpose.

### Encode lessons in structure

If the lesson needs judgment and cannot be encoded, make the instruction more prominent and add an example of the failure mode. Apply when you catch yourself writing the same instruction a second time, or notice a recurring correction. Encode the rule as a lint, metadata flag, runtime check, or script instead of more text.

- Corollary: If the fix is structural, only use the structural fix. The instruction is the symptom.

### Never block on the human

The human supervises asynchronously. Agents must stay unblocked. Make reasonable decisions, proceed, and let the human course-correct after the fact. Since code changes are reversible and reviewable, a wrong decision usually costs less than blocking.

- Proceed, then present. Do the work, show the result. Don't ask "should I do X?" Do X, explain why.
- Make the system self-healing. When you notice a problem, log it and fix it in the next round.
- Irreversible actions (force-push, delete production data, send external messages) still require confirmation.
- Reversible actions (write code, edit notes, split tasks) should proceed without blocking.
- Product direction comes from the human. Execution should not block.

## Definition of done
Report what changed and why; checks actually run and results; branch/PR and deployment status; known limitations; and remaining work. Distinguish **implemented**, **validated**, **owner-accepted**, and **deployed and verified**. Mark unmet criteria as outstanding. See [CURRENT_STATE.md](docs/CURRENT_STATE.md) for current project-specific boundaries.
