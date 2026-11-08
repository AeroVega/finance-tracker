---
name: grilling
description: "Opt-in interview helper for grill-me. Use only within an explicitly requested interview, never to block ordinary implementation or review."
disable-model-invocation: true
---

Before applying this skill, read the [Finance Tracker project rules](../README.md#project-rules).

Run the interview the user requested. Carry forward settled decisions and keep the questions within its scope. Respect a requested time or question limit, and stop or narrow the session when asked. Map unresolved decisions as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask a manageable round of unresolved questions, within the user's requested limit: number each question and give your recommended answer. Leave dependent questions for a later round. Then wait for the user's answers before the next round.

Use a short numbered list. For each question, give the choice, your recommendation, and a brief reason. Make it easy to accept the recommendation without hiding a consequential decision in a generic yes.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent with a fresh context window to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session ends when the agreed scope is settled or the user chooses to stop. Summarize decisions and any unresolved questions without inventing agreement. An interview produces a proposal; implementation or other external action still needs the applicable user authorization. Do not make exhaustive interviewing a prerequisite for unrelated authorized work.
