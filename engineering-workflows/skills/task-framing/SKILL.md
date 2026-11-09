---
name: task-framing
description: "Use when a plan or design needs to be questioned, challenged, clarified, or stress-tested through discussion, including grill-me and grill-with-docs, or when preparing a concise handoff."
---

# Task Framing

Restate the problem, intended outcome, constraints, and known context in terms the intended recipient can act on. Identify the decisions and facts that would change the approach; research available facts within the authorized scope before asking for missing decisions.

For a handoff, include the current state, relevant artifacts, completed and remaining work, evidence, risks, and the next action. Separate confirmed facts from assumptions. Keep the result scoped to the user's purpose and avoid exposing unrelated private context.

## Sharpen a request

Identify the problem, the outcome, the audience, and what must remain unchanged. Replace vague goals with observable results where the available evidence allows it. Surface unresolved decisions that change scope or risk; do not manufacture precision where the user has not made a choice.

For a handoff, include the branch or artifact, current state, decisions already made, checks and their results, remaining work, and the next useful action. Link to the actual evidence rather than pasting large logs. Separate assumptions and unverified claims from confirmed facts. Omit credentials and unrelated private context.

## Grill a plan or design

When the user asks to be grilled, interview them until the decisions behind the plan are clear. Treat the decisions as a tree: settle a prerequisite before asking a question that depends on it. Investigate facts in the authorized project context yourself. Ask the user for decisions that only they can make.

Ask a focused question, offer your recommended answer and the reason, then wait for the response. Revisit assumptions when an answer changes a later branch. Use concrete scenarios to expose unclear boundaries or conflicting requirements. Continue until the important branches are resolved, and summarize the decisions and remaining uncertainty. When the user explicitly requests a grilling session, do not begin implementing the plan until the user confirms the shared understanding; authorized documentation updates during a grill-with-docs session can proceed as decisions are settled. When task framing is used for ordinary implementation, follow the user's instruction and proceed on authorized, independent work.

## Grill with documentation

When the user asks to grill against project documentation, also inspect the relevant glossary, domain context, and decision records. Follow the repository's existing structure, which may use `GLOSSARY.md`, `CONTEXT.md`, context maps, or another documented convention. Challenge terms that conflict with those sources and check claims about current behavior against the code.

As the user settles a term or decision, record it in the appropriate existing document when the request and repository rules authorize edits. Create a document only when the project convention calls for it and there is a decision to record. Propose an architectural decision record when the choice is hard to reverse, its rationale is not obvious, and real alternatives were considered. Keep domain definitions separate from implementation details.

## Keep a decision visible

During a grilling session, separate facts established from the repository from choices the user has made. For each open choice, state the question, the recommended option, and the consequence of that option. Ask only questions whose prerequisites are settled, and wait for the user's answer before relying on it.

When the discussion changes an earlier decision, revisit the branches that depended on it. End with the agreed decisions, unresolved questions, and any documentation changes. A handoff should say what another person can do next without inventing a missing decision.
