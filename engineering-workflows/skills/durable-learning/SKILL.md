---
name: durable-learning
description: "Use when mistakes, defects, or corrections recur and a change to code, checks, types, or guidance could prevent the same problem from returning."
---

# Durable Learning

Start from a recurring failure with real instances. Find at least two examples with the same cause and name the condition that let the mistake through. A single unusual correction gets a local fix, not a new rule.

Pick the least costly safeguard from the "Encode lessons in structure" section of AGENTS.md. Record why the safeguard prevents or detects the failure and what it cannot catch.

## Prove the safeguard works

For an automated check, show that it fails on a representative bad case and passes on a valid case. Make the failure message name the next action for the contributor.

Do not weaken a check to clear the build. Record any exception and its owner under the project policy. If existing code already violates a new rule, roll it out in steps the project approves and report the cases still unchecked.
