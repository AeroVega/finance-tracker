---
name: design-exploration
description: "Use when an interaction, product feature, or technical approach is uncertain and comparing alternatives, sketches, or a focused prototype would help choose a direction."
---

# Design Exploration

Frame the user need, constraints, success criteria, and decision that the exploration must resolve. Inspect existing patterns first. Generate distinct alternatives only where a meaningful decision remains; make each small enough to compare.

Use sketches or lightweight prototypes when they can answer a concrete question. Compare user experience, accessibility, implementation cost, risk, and fit with existing systems. Record the evidence and the unresolved assumptions, then recommend an option without treating a prototype as production-ready. Avoid creating or publishing external artifacts without the required authorization.

## Make the decision testable

Write the decision as a question that a sketch or prototype can answer. For example, compare whether a user can recover from an interrupted flow, not which screen looks better in isolation. Define constraints, including accessibility and existing design standards.

Explore alternatives that differ in the decision that matters. Keep each prototype narrow and use representative synthetic inputs. Check the common path and at least one failure or recovery path. Record observations rather than treating personal preference as user evidence.

Compare the options against the original criteria and identify what would change the recommendation. Mark throwaway code and unverified assumptions. Do not present a mock or prototype as an implemented, tested feature.

## Compare the same scenario

Give each option the same concrete scenario and success criteria. Include a constraint or failure case, such as a user returning after an interrupted action. Record what each prototype can establish and what it cannot, including missing integration or accessibility evidence.

Keep a prototype small enough to discard. Before using any prototype code in production, separately review its dependencies, error handling, and tests. Recommend an option with the observation that drove the choice and the main unresolved risk.
