---
name: simplification
description: "Use when the user wants existing code simplified, refactored, made easier to follow, or stripped of unnecessary complexity while preserving its behavior and contracts."
---

# Simplification

Identify the behavior to preserve, current callers, and evidence that a layer or abstraction is unnecessary. Look for hidden state, redundant indirection, duplicate logic, and code that forces readers to hold unnecessary context.

Choose the smallest coherent change that reduces the burden without removing useful boundaries, compatibility, or defensive behavior. Confirm deletion candidates are unused before removing them. Verify affected observable behavior with appropriate checks and explain tradeoffs or remaining uncertainty.

## Find the cost to the reader

Trace a representative request through the affected code. Count the decisions and layers a reader must follow to answer a practical question, such as where a value is validated or who changes a state. Look for duplicated sources of truth, wrappers with no independent purpose, and mutable state whose lifetime is broader than needed.

Before removing a layer, identify its callers and the protection it provides. A wrapper may isolate a vendor API, enforce authorization, or preserve compatibility. Compare the proposed result with the existing contract and keep any boundary that earns its cost.

Make one coherent simplification at a time. Run checks that cover the observable behavior and inspect the resulting diff for accidental scope expansion. Explain what became simpler and any tradeoff.

## Verify the simpler shape

Look for state that can be derived instead of kept in sync and for a pass-through layer that does not hide a meaningful decision. Prefer a local value to broader mutable state when the lifetime permits. Do not collapse a boundary that isolates an external system or protects an invariant.

Explain the reader's question before and after the change, such as where an input is validated. Verify the same behavior through public interfaces; a change that merely shortens the diff while making the flow harder to trace is not an improvement.
