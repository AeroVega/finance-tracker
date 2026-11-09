# Engineering Workflows

Sixteen self-contained Markdown skills for engineering design, investigation,
verification, planning, and communication. They are newly written, selective
consolidations informed by Matt Pocock's skills and Cursor pstack; they are not
full ports of either upstream library. See [PROVENANCE.md](PROVENANCE.md) for
sources, exclusions, licensing, and updates.

## Install and use

For Auggie and Codex, add the ai-marketplace using the
[root installation guide](../../README.md#installation), then install the plugin:

```sh
auggie plugin install engineering-workflows@ai-marketplace
codex plugin add engineering-workflows@ai-marketplace
```

For Claude Code, the marketplace setup and plugin installation commands follow
the convention used by other plugins in this repository:

```sh
claude plugin marketplace add https://gh.vantor.com/shared/ai-marketplace.git
claude plugin install engineering-workflows@ai-marketplace
```

These Claude Code instructions and skill discovery have not yet been verified
with this plugin in a clean Claude Code environment.

Invoke a skill by its name using your client's skill interface or request the
behavior in natural language. For example, ask for `blast radius` using
`debugging-and-change-impact`, assess a speedup using
`measurement-and-benchmarks`, or plan a retryable migration with
`safe-execution-and-migrations`. Skill discovery and invocation depend on the
client version and configuration. No tools or packages are bundled; use the
project's own approved tools and synthetic examples for checks.

## Find familiar workflows

Four workflows have prominent homes in the consolidated skills:

| Request | Skill | What to expect |
|---|---|---|
| `unslop` | `technical-writing` | Remove AI writing patterns while preserving meaning and voice. |
| `pr-review` or code review | `adversarial-review` | Review the selected diff, verify findings, and report actionable defects. |
| `grill-me` | `task-framing` | Work through dependent design decisions with a focused interview. |
| `grill-with-docs` | `task-framing` | Interview against project terminology and record resolved decisions where authorized. |

These are trigger phrases for the consolidated skills, not separate skill
names. Existing personal or marketplace skills with those names may also match;
invoke the consolidated skill by name when you want this plugin's workflow.

## Skills

| Skill | Use |
|---|---|
| `engineering-design` | Model boundaries, interfaces, types, and domain state. |
| `debugging-and-change-impact` | Diagnose failures and inspect consequences of changes. |
| `measurement-and-benchmarks` | Assess measurements and performance claims. |
| `verification-and-testing` | Choose checks or use test-driven development. |
| `project-verification` | Create or maintain repeatable project verification. |
| `formal-verification` | Scope and interpret formal models. |
| `safe-execution-and-migrations` | Sequence recoverable multi-step changes. |
| `simplification` | Reduce complexity while preserving behavior. |
| `design-exploration` | Compare alternatives and prototype decisions. |
| `durable-learning` | Address recurring mistakes with proportionate safeguards. |
| `technical-explanation` | Explain code and systems with evidence. |
| `technical-writing` | Write and edit technical material. |
| `planning-and-execution` | Plan and carry out multi-step work. |
| `task-framing` | Clarify a task or prepare a handoff. |
| `typescript-guidance` | Work within a project's TypeScript conventions. |
| `adversarial-review` | Investigate concrete defects and design risks. |

## Boundaries and compatibility

The package supplies portable instructions, not Cursor, Codex, Augment, or
Claude-specific agents, hooks, scripts, or model configuration. It does not
require subagents. The three manifests make the package available to each
marketplace; actual client installation, discovery, and behavior still require
validation on the relevant client versions. Formal verification requires a
suitable project-provided checker and expertise; no checker is included.

Apply the target repository's rules and approved data scope. Available
connectors do not authorize searching, combining, or sharing company data.
Keep restricted material and credentials out of unapproved services. Follow
local approval gates before modifying shared systems, creating or publishing
work, installing dependencies, or carrying out destructive operations. The
upstream MIT licenses are not company security or legal approval.
