# Provenance and scope

This package contains newly authored, selective syntheses of ideas from the
following public snapshots. No upstream scripts, agents, templates, assets,
model settings, or automated updates are bundled. The text is adapted and
condensed, not a drop-in copy of the source workflows. Preserve the included
MIT notices when distributing this package; their presence is not a security or
legal approval.

| Source | Version | Commit | License |
|---|---|---|---|
| [Matt Pocock skills](https://github.com/mattpocock/skills/tree/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d) | 1.3.2 | `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` | [MIT, Matt Pocock](licenses/matt-pocock-MIT.txt) |
| [Cursor pstack](https://github.com/cursor/plugins/tree/236e5481d05cbadc315b374a5de54971858c27bb/pstack) | 0.15.36 | `236e5481d05cbadc315b374a5de54971858c27bb` | [MIT, Lauren Tan](licenses/pstack-MIT.txt) |

The source inventories below record the upstream scope, not a claim that
every behavior was retained. The sixteen packaged skills are listed in the
README. Their workflows are independent and have no references to upstream
skills or helpers. Cursor-specific orchestration, models and rules; transcript
mining; broad multi-source searches; webhooks; video generation; credential
handling; automatic tracker operations; upstream scripts and installation or
configuration automation are excluded. Data access and mutations remain subject
to the user's scope and the target repository's approval rules. The eight Matt
`in-progress` skills and four frozen `misc` skills are not source inputs.

## Main source influences by consolidated skill

These are thematic influences, not a promise to reproduce every source workflow.
Names refer to the inventories below; `M` means Matt Pocock and `P` means pstack.

| Consolidated skill | Main influences |
|---|---|
| engineering-design | P architect, principle-boundary-discipline, principle-type-system-discipline, principle-model-the-domain; M codebase-design, domain-modeling |
| debugging-and-change-impact | P blast-radius, principle-attack-the-premise, principle-fix-root-causes; M diagnosing-bugs |
| measurement-and-benchmarks | P benchmark-checklist, principle-explain-the-number |
| verification-and-testing | P tdd, principle-prove-it-works, principle-test-behavior-not-implementation; M tdd |
| project-verification | P create-verification-skill, maintain-verification-skill |
| formal-verification | P create-formal-verification-skill, maintain-formal-verification-skill, statechart |
| safe-execution-and-migrations | P principle-make-operations-idempotent, principle-separate-before-serializing-shared-state, principle-sequence-verifiable-units; M implement-spec |
| simplification | P principle-laziness-protocol, principle-subtract-before-you-add, principle-minimize-reader-load; M codebase-design |
| design-exploration | P principle-exhaust-the-design-space, principle-experience-first; M prototype |
| durable-learning | P correct, principle-encode-lessons-in-structure |
| technical-explanation | P how, teach; M teach |
| technical-writing | P technical-writing, unslop; M writing-for-agents |
| planning-and-execution | P figure-it-out, show-me-your-work, principle-never-block-on-the-human; M implement, implement-spec, wayfinder |
| task-framing | P sharpen, ketchup; M handoff, grill-me, grilling, grill-with-docs, domain-modeling |
| typescript-guidance | P typescript-best-practices |
| adversarial-review | P interrogate; M code-review |

The PR-review workflow combines general changed-code review practices with the
Matt Pocock and pstack influences above. Neither pinned upstream inventory
contains a skill named `pr-review`. No personal skills are bundled.

## Released Matt Pocock inventory (27)

`ask-matt`, `diagnosing-bugs`, `grill-with-docs`, `triage`, `improve-codebase-architecture`, `setup-matt-pocock-skills`, `tdd`, `to-spec`, `to-tickets`, `wayfinder`, `implement`, `implement-spec`, `prototype`, `research`, `domain-modeling`, `codebase-design`, `code-review`, `pr`, `retro`, `wizard`, `grill-me`, `grilling`, `handoff`, `teach`, `to-questionnaire`, `wait-what`, `writing-for-agents`

## pstack exposed skill inventory (58)

`architect`, `arena`, `automate-me`, `benchmark-checklist`, `blast-radius`, `bro`, `correct`, `create-formal-verification-skill`, `create-verification-skill`, `figure-it-out`, `how`, `in-your-own-words`, `interrogate`, `ketchup`, `ketchup-video`, `maintain-formal-verification-skill`, `maintain-verification-skill`, `make-bot-ui`, `no-comments`, `poteto-help`, `poteto-mode`, `principle-attack-the-premise`, `principle-boundary-discipline`, `principle-build-the-lever`, `principle-encode-lessons-in-structure`, `principle-exhaust-the-design-space`, `principle-experience-first`, `principle-explain-the-number`, `principle-fix-root-causes`, `principle-foundational-thinking`, `principle-guard-the-context-window`, `principle-laziness-protocol`, `principle-make-operations-idempotent`, `principle-migrate-callers-then-delete-legacy-apis`, `principle-minimize-reader-load`, `principle-model-the-domain`, `principle-never-block-on-the-human`, `principle-outcome-oriented-execution`, `principle-prove-it-works`, `principle-redesign-from-first-principles`, `principle-separate-before-serializing-shared-state`, `principle-sequence-verifiable-units`, `principle-subtract-before-you-add`, `principle-test-behavior-not-implementation`, `principle-type-system-discipline`, `recall`, `reflect`, `setup-pstack`, `sharpen`, `show-me-your-work`, `statechart`, `swarm`, `tdd`, `teach`, `technical-writing`, `typescript-best-practices`, `unslop`, `why`

## Manual update

1. Obtain the public upstream sources in a separate checkout, pin the proposed
   commits, and inspect their licenses, notices, changed instructions, and dependencies.
2. Compare changes against the self-contained skills here. Select and adapt only
   behavior that works within approved tools, data scope, and approval gates;
   document additions, removals, and any new license obligations.
3. Update the source versions and commits above, retain applicable license
   notices, review naming and client support, and run the repository validation
   plus clean-install and representative synthetic workflow checks.
4. Submit changes for normal human review. Do not configure automatic updates.
