---
name: planning-and-execution
description: "Use when a substantial multi-step engineering request needs its outcome, dependencies, execution, and verification organized, even when the user has not explicitly asked for a plan."
---

# Planning And Execution

Clarify the goal, constraints, acceptance evidence, and current state from the request and local project guidance. Divide work into meaningful, verifiable steps and identify dependencies and irreversible choices. Use the existing repository workflow instead of creating a new framework.

Proceed on authorized reversible work, track decisions when they are consequential, and adapt the plan when evidence changes. If the user explicitly asks for a grilling session, wait for confirmation of the shared understanding before implementing the plan; authorized documentation updates may be made as decisions settle. If the request is review-only, report findings without changing the reviewed code. Keep summaries focused; use available delegation only when authorized and useful. At each boundary verify the actual result, record remaining risks, and respect required approvals before external or destructive actions. Report what was completed and what remains.

## Frame and sequence

State the desired result as something a reviewer can observe. List the constraints, likely touchpoints, existing validation commands, and decisions that require human input. Treat a missing fact differently from a decision: inspect authorized project sources before asking the user to supply a fact.

Break a large task into units that leave the project in a checkable state. Address a risky unknown early, and capture a baseline when it is needed to judge a change. A decision log can record the choice, evidence, and consequence for work that another person must review later; keep private material out of it.

## Verify the result

After each meaningful unit, check the actual artifact or behavior against its acceptance condition. Report a failure or inconclusive check as such. Continue with independent authorized work when a nonblocking question remains open. Stop before an action that needs approval, and present the concrete action and evidence needed for that decision.

## Use evidence to adjust the plan

For a risky step, state the assumption and the observation that would show it is wrong. Capture the starting state before changing it when comparison matters. After the step, inspect the actual result and update the next step if the evidence contradicts the plan.

For work another person will review later, record consequential decisions with the choice, reason, evidence, and result. Keep the record proportional to the task and exclude secrets and unrelated private data. Report completed, blocked, and unverified work separately.
