---
name: technical-explanation
description: "Use when explaining how or why a codebase, subsystem, interface, or change works, including onboarding, tracing a request, understanding ownership, or making sense of unfamiliar code."
---

# Technical Explanation

Establish the audience, question, and scope. Inspect relevant code, interfaces, tests, and local documentation permitted by the task. Follow the actual runtime or data flow, using concrete entry points and a small example. Distinguish observed behavior from inference and identify uncertainty.

Explain responsibilities, key transitions, and tradeoffs at the level the reader needs. Cite local evidence where helpful and avoid narrating every line. Investigate historical rationale only within sources the user has authorized; access to a connector alone is not permission to search unrelated records. Do not require parallel agents or a particular model.

## Follow one real path

Find the entry point and trace a representative input through the components that change or use it. Explain where state lives, where boundaries validate input, and where errors become visible. Use real names from the code and point to evidence. If the path crosses a library, distinguish the project's code from behavior supplied by the dependency.

Organize the explanation around the reader's question. An overview can name the parts, then a walkthrough can show the order in which they interact. Mention a surprising constraint or failure mode only when the source supports it. Avoid substituting a list of files for an explanation of behavior.

If asked why the system was designed that way, distinguish documented rationale from an inference. Search only the records authorized for the task and say when the reason cannot be established.

## Make the explanation verifiable

Start with a short answer to the reader's question, then follow one representative request or state change through the relevant components. Explain the reason for each boundary only when supported by a decision record, code comment, or other authorized evidence. Identify what is observed in the code and what is inferred.

For a complex subsystem, group the explanation by responsibilities and connections rather than by a file-by-file tour. Name the important entry points and locations so the reader can follow the same path. If an important behavior depends on an unavailable external system, identify that gap.
