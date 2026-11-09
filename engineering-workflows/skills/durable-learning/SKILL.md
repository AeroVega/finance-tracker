---
name: durable-learning
description: "Use when mistakes, defects, or corrections recur and a change to code, checks, types, or guidance could prevent the same problem from returning."
---

# Durable Learning

Identify a demonstrated recurring failure, its actual impact, and the conditions that allow it. Find an example and investigate the cause before proposing a new rule.

Consider whether a design change, type, validation, lint, test, documentation, or no additional mechanism best addresses the problem. Prefer the least burdensome safeguard that prevents or detects the meaningful failure without blocking legitimate work. When adding an automated check, demonstrate that it detects a representative failure and permits a valid case. Record the reason and limitations.

## Turn a correction into a check

Find concrete instances of the mistake and group examples with the same cause. A single unusual correction may call for a local fix rather than a new rule. Explain the consequence and the condition that allowed the mistake.

Consider eliminating the invalid state in the design, expressing the constraint in a type, adding a focused check, or documenting a judgment call. Choose the least costly option that addresses the demonstrated failure. A repository-wide rule may need an incremental adoption path if existing code already violates it.

For an automated safeguard, demonstrate a representative bad case that fails and a valid case that passes. Make failures tell the contributor what to change. Note any exceptions and their owner according to project policy; do not silently weaken a check to clear the build.

## Make the safeguard useful

Name a real example of the mistake and where the team corrected it. If the examples come from review history or other connected systems, use only sources authorized for the task. Explain why the chosen safeguard prevents or detects that class of mistake, and whether a legitimate exception is possible.

When a check fails, make its message point to a useful next action. Test the check against both a known failure and a legitimate case. If existing violations block rollout, choose a project-approved incremental approach and report what remains unchecked.
