---
name: engineering-design
description: "Use when shaping or changing module responsibilities, interfaces, data structures, types, or domain boundaries, including when an implementation decision would benefit from examining existing callers and constraints."
---

# Engineering Design

Understand the existing behavior, constraints, terminology, and callers before proposing a design. Identify the decisions that would be costly to reverse and the invariants the design must preserve.

Sketch the domain states, responsibilities, public interfaces, and data flow. Put validation at external boundaries while retaining internal checks needed for safety. Use types to express meaningful distinctions when the language supports them. Prefer a cohesive interface that hides implementation complexity; avoid wrappers and abstractions that add no useful boundary.

Compare plausible alternatives when the decision warrants it, including their effects on compatibility, testability, operations, and readers. State assumptions and unresolved tradeoffs. Validate the design with representative scenarios before implementing it; follow the user's requested scope and repository conventions.

## Find the seam

Start with a specific change the design must support. Read the current callers and the data they exchange. Describe which component owns each state transition and which assumptions cross its interface. Use the project's domain terms rather than inventing new names.

Sketch signatures and representative inputs before filling in implementation details. Ask whether a caller needs to understand the implementation to use the interface correctly. If several callers repeat the same sequence, consider whether the responsibility belongs behind one boundary. A one-use abstraction may still be useful when it isolates an unstable dependency or a security boundary.

## Evaluate the design

Walk through a normal case, an invalid input, and a change likely to occur later. Trace who validates data, owns errors, and updates shared state. Compare alternatives by their effect on callers, testability, compatibility, and operational behavior. Name assumptions that need a prototype or a conversation before implementation. Keep local conventions and the user's scope in force.

## Test the interface with a change

Pick one likely change and sketch which files and callers must change under each candidate design. An interface earns its complexity when it hides a decision that callers would otherwise repeat. Keep protocol parsing and framework details at the boundary when possible, and express the resulting data in the domain's terms.

For stateful work, identify which component owns each state value and who may update it. Test the model with an invalid or concurrent transition. Document any assumption that is enforced only by convention, rather than presenting it as a guarantee.
