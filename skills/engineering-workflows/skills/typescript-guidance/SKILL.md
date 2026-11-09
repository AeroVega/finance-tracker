---
name: typescript-guidance
description: "Use when designing, writing, reviewing, or debugging TypeScript code, types, interfaces, or runtime boundaries, including input validation and modeling valid states."
---

# Typescript Guidance

Inspect the project's TypeScript configuration, patterns, and public contracts before changing code. Model meaningful states with appropriate types and narrow unions safely. Validate untrusted input at boundaries; avoid using assertions or broad types to conceal uncertainty.

Prefer clear, maintainable types and exhaustive handling where it matters. Derive types from authoritative schemas when the project supports that pattern. Preserve runtime behavior and compatibility, and run the project's applicable type checks and tests. Do not impose new libraries or conventions without a demonstrated need.

## Model the data

Use a discriminated union when variants have different required fields. Narrow on the discriminant before accessing variant-specific fields. If adding a variant should require every switch to change, use the project's exhaustiveness pattern.

Treat data from a network, file, or user as unknown until runtime validation establishes its shape. Prefer the project's existing schema and derive types from it when available. A type assertion changes what the compiler believes; it does not validate the value at runtime. Use a type guard only when its checks actually prove its claim.

Choose the simplest type that supports the operations callers need. Introduce branded or nonempty types when they prevent a concrete mistake, not by default. Preserve public contracts and follow the project's compiler settings and test commands.

## Make the compiler check the contract

When a value has variants with different fields, use the project's discriminant pattern so narrowing follows the actual state. Where exhaustive handling matters, use the existing `never` check or equivalent and verify that adding a variant produces a useful error.

At an input boundary, test both accepted and rejected examples against the runtime parser. A type assertion or a type guard that does not check the claimed condition cannot establish safety. Derive types from the project's authoritative schema where that avoids a second independently maintained definition.
