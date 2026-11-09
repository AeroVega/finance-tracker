---
name: debugging-and-change-impact
description: "Use when something fails, behaves unexpectedly, or regresses, or when assessing what a planned change could break beyond the edited code. Applies to diagnosing bugs, tracing causes, and investigating blast radius."
---

# Debugging And Change Impact

Establish the expected and observed behavior, the conditions that distinguish them, and a reproducible example when feasible. Trace the data and control flow to the earliest incorrect state; distinguish an actual cause from a correlated symptom.

Form competing hypotheses and choose a small observation that would distinguish them. If repeated fixes fail the same way, write down their shared assumption and test it directly. Check callers, contracts, persistence, configuration, and error paths that the change may affect.

Demonstrate the cause and the proposed fix with an appropriate local check. If a safe reproduction is unavailable, report the evidence and uncertainty. Describe affected consumers, remaining risks, and any verification not performed; preserve legitimate defensive handling.

## Investigate the failure

Write down a concrete example: the input, expected result, observed result, and environment. Follow one failing case backward to the first state that differs from the expected state. Do not add a guard at the final symptom until you know whether that state is valid.

For each leading hypothesis, name an observation that would disprove it. Prefer a small reproduction against the real boundary over a large mock that repeats the suspected implementation. If the same approach fails twice, examine the assumption shared by both attempts before trying another variation.

## Trace consequences of a change

Find the fact the safety of the change depends on. For example, a cache eviction may be safe only if callers can reload the removed entry. Trace serialization, persisted data, asynchronous cleanup, and callers in other languages where relevant; a symbol search alone may miss them.

Check the decisive fact with the real code when safe. Report what changed, the evidence for the safety claim, confirmed risks, and questions that remain unproven. Include the smallest useful check a reviewer can repeat.

## Find the first divergence

For an intermittent problem, compare a failing case with a similar successful case. Note what differs in inputs, ordering, environment, and persisted state. Trace back from the observed symptom until the earliest state that violates the expected contract; explain how that state reaches the symptom. Check whether the suspected fix addresses that divergence rather than masking it.

For a change-impact question, name the single assumption that clears the largest risk and say how you checked it. A reference to source code, a reasoned trace, and a run of the actual code provide different levels of evidence. If the decisive assumption cannot be checked, mark it unproven and propose a safe next check.
