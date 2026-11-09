---
name: formal-verification
description: "Use when a stateful system, concurrency, protocol, or critical invariant calls for a formal model or proof, or when an existing model needs to be checked against changed code."
---

# Formal Verification

Identify the system boundary, actors, state variables, transitions, assumptions, and invariants that justify formal verification. Select a small representative model and state which production behavior it abstracts away. Use project-approved tools only when already available or explicitly authorized.

For an existing model, compare its assumptions and transitions with the current implementation and investigate drift. Run the project's documented checker when practical. For failures, trace the counterexample step by step and distinguish a model error from a real system defect. A passing model proves only the properties under its stated assumptions.

Report the properties checked, tool and bounds where applicable, counterexamples, limitations, and checks not run. Diagrams may summarize the model but do not replace verification.

## Choose a property

Start with a promise whose violation matters, such as two workers never claiming the same job or a retry never applying the same payment twice. State the property and the harm of a violation in plain language. Map the model's states and atomic steps to the corresponding code and identify assumptions about ordering, failures, and bounds.

Choose a checker that can answer the question and that the project can run. A model of event ordering and a proof about implementation code establish different things. Do not claim that a passing model proves the implementation correct unless the link is itself established.

## Check that the check can fail

Where safe, practical, and authorized, introduce a scratch defect such as a removed guard or reordered transition and verify that the property catches it. Use an isolated copy when a review must leave the working tree untouched or existing changes could be disturbed. Restore only the scratch change and rerun the check. If isolation or a safe check is unavailable, report that the check's sensitivity is unverified. If the current code violates the property, report the counterexample; do not weaken the property to obtain a pass.

Translate a counterexample into the project's terms as an ordered sequence. Record the checked property, model or code revision, tool version, bounds, assumptions, result, and files that require rechecking after a change.

## Distinguish drift from a defect

When code changes after the model was last checked, compare the changed transitions and assumptions with the implementation. If the model describes current behavior and a property fails, report a possible defect with the counterexample. If the model no longer describes an intentional change, update the model only within the authorized scope and rerun the property.

Classify the result as in sync, updated, a property violation, or blocked. Record the code revision, what the model omits, the tool version and bounds, and a repeatable command when one is available. A missing checker or an unrun model is a limitation, not a passing result.
