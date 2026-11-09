---
name: safe-execution-and-migrations
description: "Use when changing an API, schema, data, deployment, shared state, or other multi-step process where compatibility, interruptions, retries, or recovery affect the work."
---

# Safe Execution And Migrations

Identify the desired end state, current consumers, compatibility requirements, shared state, and rollback or recovery options. Sequence work into reviewable units with observable checks; retain intermediate compatibility where consumers or staged rollout require it.

Design repeated operations to converge safely after retries or partial completion. Avoid concurrent writes to shared state when work can be separated; otherwise use the repository's established coordination. Verify each stage before advancing and preserve data and external contracts.

Separate reversible local preparation from destructive, publishing, deployment, or shared-system changes. Follow the project's approval gates and report incomplete stages and recovery steps. Do not delete a legacy interface until its consumers and removal authorization are established.

## Sequence the change

Inventory producers and consumers before changing a shared format or API. For each stage, state its preconditions, the observable result, and how to stop or recover if it fails. When consumers cannot all move at once, keep a compatible transition until they have migrated and the owner approves removal.

For retryable work, consider interruption before and after each external write. Identify an idempotency key, existing state to inspect, or another way to tell completed work from work that still needs doing. A retry must not repeat a charge, notification, or destructive action by accident.

Give concurrent workers separate resources where possible. If one shared writer is required, use the project's established locking or queueing mechanism and check its failure behavior. Verify each stage before the next. Name any steps that cannot be rolled back and obtain the applicable approval before executing them.

## Check partial completion

Walk through a failure immediately before and after each durable write. For each point, identify what a retry will observe, whether it can distinguish completed work, and whether it could repeat an external effect. Where an idempotency key is used, state its scope and how long it remains valid.

Check the migration against old and new readers and writers for every stage that can exist during rollout. Record the point after which rollback requires a forward repair or data restoration. Do not assume a dry run is side-effect free; check what the project's command actually does before using it.
