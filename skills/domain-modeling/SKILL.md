---
name: domain-modeling
description: "Helper for explicitly requested domain documentation, including grill-with-docs. Record agreed terms and decisions in existing project documents."
disable-model-invocation: true
---

Before applying this skill, read the [Finance Tracker project rules](../README.md#project-rules).

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* `GLOSSARY.md` for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## Project documentation

Use `docs/DATA_MODEL.md` for existing financial terminology and `docs/ARCHITECTURE_DECISIONS.md` plus the relevant subject or implementation-scope document for decisions. Read those sources before proposing edits. If a separate glossary or ADR already exists for this area, follow it.

Update existing documents rather than creating a competing root glossary, map, or ADR directory. Creating a new document or reorganizing decisions requires that scope to be agreed first. The bundled format references are optional structures, not a requirement to migrate the project's documentation.

This helper runs within an explicitly requested documentation task or `grill-with-docs` session. Summarize agreed terms, decisions, and their destination before editing. Record only what the user settled, preserve unresolved questions, and keep implementation and production authorization separate. Use the project's claim labels and invented examples only.

## During the session

### Challenge against the existing model

When the user uses a term that conflicts with the existing language in the data model or glossary, call it out immediately. "The existing model defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Capture agreed terms

Within the requested documentation scope, record each resolved term in the existing appropriate document. Use [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md) only when a separate glossary is warranted and approved. Keep definitions distinct from implementation plans and unresolved proposals.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).
