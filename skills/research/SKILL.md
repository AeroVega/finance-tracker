---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

Before applying this skill, read the [Finance Tracker project rules](../README.md#project-rules).

Spin up a **background agent** to do the research, so you keep working while it reads. Start it with a fresh context window.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Use the existing `docs/` conventions when a repository research note is within the requested task. Label claims **Verified**, **User-confirmed**, **Hypothesis**, or **Open**. Keep private context and real financial information out of the public repository. Preparing a note does not authorize committing, pushing, or publishing it.
