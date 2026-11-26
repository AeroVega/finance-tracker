---
name: verification-and-testing
description: "Use when implementing or fixing behavior calls for tests or other verification, when investigating a regression, or when the user requests test-driven development, a failing test, or proof a change works."
---

# Verification And Testing

Derive observable behaviors and failure cases from the request and existing contracts. Select the cheapest check that gives credible evidence, using integration or end-to-end checks when a unit test would miss the behavior.

For a bug fix, follow the TDD bug fixing section of AGENTS.md. For review, diagnosis, or planning alone, use only safe checks within that scope and report a proposed fix without applying it. Test public behavior and outcomes rather than incidental implementation details. Include boundary and error cases where they matter.

Run the actual changed artifact when practical. Report the commands or observations, results, and untested assumptions; do not claim a passing proxy proves an unexercised workflow.

## Choose the boundary

List the user-visible behavior and the interface through which a caller observes it. Pick tests at boundaries that can detect a broken contract while surviving an internal refactor. Include an independent expected result, such as a worked example or specified value. A test that calculates its expectation with the same algorithm as the implementation can pass when both are wrong.

Use a real collaborator when it is cheap and safe. Replace an external dependency with a controlled substitute when the real boundary is unavailable, expensive, or unsafe. Record what the substitute cannot prove. Avoid asserting private calls when the public outcome is what matters.

## Work in slices

When using TDD, choose one behavior, write one test, and confirm it fails for the expected reason. Implement enough to pass, then repeat with the next behavior. Do not mistake a setup error or a missing import for the intended red result. Refactor after the behavior is covered and rerun the relevant checks.

Check boundary values, error handling, and relevant side effects when they change the outcome. Report what ran and what remains unverified.

## Check the check

If a refactor changes internals but leaves the contract intact, a behavior test should not fail solely because private calls changed.

For each claimed result, identify which boundary was exercised and which dependencies were real or substituted. A mocked service can verify a client's response to a controlled error; it cannot prove the real service and client integrate correctly. Report that gap when it matters.
