---
name: adversarial-review
description: "Use for a code review, PR review, staged or branch changes, a code diff, or a design when looking for bugs, security issues, broken assumptions, or compatibility risks. Also applies when asked whether changes are ready to merge or to challenge an approach; includes pr-review and adversarial review."
---

# Adversarial Review

Understand the intended behavior and review scope before looking for failure modes. Examine contracts, boundaries, state transitions, error handling, compatibility, and the effects on callers. Test an assumption with a safe local reproduction when practical; do not dismiss an important risk solely because it cannot be reproduced locally.

Report actionable findings with evidence, impact, and uncertainty, distinguishing observed defects from hypotheses. For a review-only request, do not fix or publish changes unless the user asks. When review is part of an authorized implementation task, make fixes within that task's scope and report what changed. Use independent perspectives only when available and authorized; do not require a particular model, client, or parallel-agent framework.

## Establish intent and scope

Read the requested change and surrounding code. Identify the contract the author intended, the inputs it accepts, and the callers or stored data it may affect. When intent is unclear, state the uncertainty before treating a behavior as a defect.

Follow failure paths as well as the normal case. Check authorization boundaries, retries, concurrency, serialization, defaults, and version compatibility when relevant. A search result is a starting point; inspect how the caller actually uses the changed behavior.

## Verify and report

For a suspected defect, name the triggering conditions and trace how they produce the wrong result. Run a small safe reproduction against the real code when practical. If execution is unavailable, distinguish a source-supported risk from a reproduced defect and say what would verify it.

Each finding should identify a location, impact, and concrete correction or next check. Separate findings from questions and identify cleared risks when useful. For a review-only request, do not modify the reviewed change unless the user asks.

## Review a PR or changed code

Identify the requested review target before reading the diff. For staged work, inspect the index. For a branch or PR, establish the base and head, and include relevant working-tree changes only when they are in scope. If the target is ambiguous, ask rather than reviewing a different diff. Read the surrounding code and affected callers, not only the changed lines.

Check correctness and security, then compare the change with the project's documented standards and any authorized issue or specification. Treat those as separate questions: a standards-compliant change can still miss a requirement. If a specification is unavailable, say so instead of claiming the requirements passed. Do not search trackers or other services merely because a connector exists; use the scope the user authorized.

Report high-confidence, actionable findings first. For each, cite the precise location, explain the trigger and consequence, and suggest a concrete correction. Distinguish a reproduced defect from an evidence-backed risk. Avoid reporting style preferences, speculative problems, or checks already enforced by tooling as defects. If no findings meet the threshold, say so and identify any material review limitation. For a review-only request, do not change the code unless the user asks.

## Check the claim behind a finding

Before reporting a suspected defect, follow a concrete input through the changed code and its caller. Record the expected and actual outcome, including the conditions required to reach the failure. Where a safe reproduction is practical, report the command and relevant result. Otherwise cite the source evidence and state what remains uncertain.

Keep independent review questions distinct. A violation of a documented standard is different from a missing requirement or a behavioral bug. Cite the applicable standard or requirement when making that claim. If no specification is available, report that limitation rather than filling it in from the implementation.
