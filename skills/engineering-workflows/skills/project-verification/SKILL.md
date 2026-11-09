---
name: project-verification
description: "Use when an application or service needs a repeatable way to exercise real user-visible behavior, or when its existing end-to-end verification instructions no longer match the project."
---

# Project Verification

Identify the important user journeys, their observable outcomes, and the environment and test data each requires. Inspect existing project commands before proposing new checks. Favor deterministic, isolated scenarios with synthetic data and explicit setup and cleanup.

For a new verification workflow, document how to prepare the environment, exercise each selected journey, observe success and failure, and repeat the run. For an existing workflow, compare it with current behavior, investigate drift, and update only what evidence supports.

Run checks that are available and authorized. Describe prerequisites, coverage gaps, and any destructive or external actions separately; obtain any required approval before performing them. Do not install tools or change shared environments implicitly.

## Discover the real journey

Inspect how a user reaches the feature, how the application starts, and what indicates it is ready. Identify the project's existing test drivers, required data, authentication, ports, and logs. Record whether an isolated instance can run without touching a shared database or another person's session.

Choose a small journey with a visible outcome. Describe the launch command, readiness check, actions, expected result, and cleanup using commands and selectors that actually exist in the project. Prefer stable labels or identifiers over screen coordinates. Use synthetic data and avoid live services unless the user has authorized them.

## Prove and maintain the procedure

Run the documented procedure once when safe, including cleanup. Check that evidence remains available after cleanup and that cleanup only removes processes and data created by the run. If a step cannot be run, mark it unverified rather than writing a guessed command.

When maintaining an existing procedure, compare its feature list and expected outcomes with the current application. Explain whether a failure reflects application behavior, test setup, or stale instructions. Do not weaken a failing check merely to make it pass.

## Record coverage honestly

Map each selected journey to its entry point, preconditions, actions, expected outcome, and known limitations. A successful check of one entry point does not prove other entry points work. Keep the map small enough to maintain and use the project's own terminology.

When rechecking an existing procedure, distinguish a clean pass from an update to stale instructions and from a blocked run. Report which journeys were actually exercised. If an expected behavior fails, preserve the observation and investigate instead of changing the expectation to match the failure.
