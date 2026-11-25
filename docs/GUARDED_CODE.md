# Guarded code

**Merge policy.** A PR that touches no guarded area is gated by the required CI checks alone; the owner has given standing authorization for it to merge once every required check passes, with no owner step and no fresh acceptance. Anything outside this rule still needs explicit owner authorization to merge. A PR that touches guarded code is merged only by the owner (step 4 below). The owner's standing GO for real financial data ([current state](CURRENT_STATE.md#owner-decision-go-for-real-financial-data)) is not re-granted per SHA and is recorded in [AGENTS.md](../AGENTS.md#standing-owner-authorization).

Changes to the paths in the [guarded-code policy](../.github/guarded-code.json) need more than routine review. Keep these areas stable on `main`; change them in focused PRs and verify the affected safeguards before the owner merges. Guarding code is not permission to deploy, use private files, or put real financial data in the repository or CI.

## What the check does

**Guarded code checks** runs on every PR to `main`, without path filters. If the PR touches no guarded area, it reports that and leaves the regular checks alone. Otherwise, its run summary lists the relevant manual checks and exact commits and it runs the selected invented-data suites in addition to the regular contract workflow. A failed detector, missing test, or failing selected test fails the job.

The detector compares the PR head to its merge base and checks its paths against the current target's policy. Rename and deletion both include the old path. Shared components can trigger several areas; editing the guard itself, workflow configuration, or shared test helpers triggers every baseline group. A PR policy edit cannot drop tests from the current target's policy for that run. For the initial bootstrap only, use the proposed detector and policy and independently review the PR that introduces them. Existing baseline-policy removal or an invalid proposed policy is not a clean result. The workflow tests the proposed merge checkout but uses the base revision's detector once it exists; it runs on an unprivileged `pull_request` event with read-only contents and without persisted checkout credentials. It does not dispatch a deployment or use provider credentials.

The map is deliberately finite. If a change moves a safeguard to a new file, extend the map in the same PR. Reviewers must still flag dependent code, release configuration, or provider-side changes that are outside the map. Do not use repository content, issue text, or generated reports as proof that a human performed a manual check.

To inspect a local PR plan with both revisions fetched:

```sh
node scripts/check-guarded-code.mjs "$(git rev-parse origin/main)" "$(git rev-parse HEAD)"
```

To run the selected suites locally, append `--run` from a checkout that contains both revisions. Use a clean checkout so the tested revision corresponds to the executed files.

## Owner and reviewer checklist

1. Verify the PR changes are intentionally scoped. Read the automated check summary and compare the guard policy and workflow against the trusted main revision before trusting a green check on guard or CI edits.
2. Perform the area checks listed in the job summary that apply to each affected safeguard. Explain any manual check that does not apply. Use invented data, test accounts and dedicated synthetic folders; never include raw finance data, credentials, account identifiers, backup material, or tokens in public results.
3. Record the tested environment and device, steps/outcome, scope and remaining limitations, and note which head was reviewed. This is not a per-SHA approval process: after later pushes, re-review only what changed in guarded areas or invalidates earlier evidence. Where live acceptance is not possible, report the missing evidence rather than claiming the test passed.
4. **Owner merges guarded changes (single-owner project).** The owner is the only user and collaborator, and independent human approval is not required (decided 2026-11-23). Agents may prepare and babysit a guarded PR through CI and review, and may declare it ready, but only the owner clicks merge. Before declaring ready, the agent walks the owner through the guarded changes interactively, file by file, explaining each edit and what it changes in behavior or permissions, flagging risks and gaps, and answering the owner's questions. The walkthrough covers the complete diff against `main`, with particular attention to `.github/`, the guard policy, `js/release-profile.mjs` and the tests that pin them, and states which safeguards the change affects and what evidence covers each. Both parties are expected to give the change the scrutiny its area needs; the owner is not expected to read the raw diff unaided. A green check alone is not a review, and an agent's review is supplemental evidence, not approval. The merge is the owner's authorization act.

Typical evidence covers wrong-account and wrong-folder refusal with no writes, expiry and reconnect, release/ownership/privacy behavior, interrupted saves and verified recovery, restoration of an encrypted backup to a fresh empty folder, and workload/quota evidence for changes to limits. See the [privacy and session contract](PRIVACY_SESSION.md), the [backup and recovery contract](FULL_SNAPSHOT_BACKUP_RECOVERY.md), and the [storage readiness assessment](archive/RETIRED_STORAGE_DESIGNS.md).

## GitHub enforcement

Adding the workflow alone does **not** make it required. After this workflow is present on `main`, the repository owner can make **Guarded code checks** a required GitHub Actions check in the main branch protection rule or ruleset, while keeping the existing checks. Enable **Require branches to be up to date before merging** when making this check required. Otherwise, a passing result can remain eligible after `main` advances, even though it used an older target policy and tested a different merge revision. Verify the check on an ordinary PR and on a PR retargeted to `main`. Confirm how stacking, bypass and deployment rules are configured. Require PR-based changes. Required approvals stay at zero for this single-owner project, because GitHub does not let a PR author approve their own PR; the owner review in step 4 replaces them.

The check cannot authenticate manual test evidence or protect its own workflow against a PR that replaces the workflow logic. Because a PR can edit the workflow that produces its own required check, the owner's diff review of `.github/` changes is the control for that case. Where supported, a trusted workflow from a separately protected source would be stronger. Do not make the detector a bypass for the owner review. No settings, reviewer assignments, or deployment changes are made by the workflow.
