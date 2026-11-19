# Guarded code

Changes to the paths in the [guarded-code policy](../.github/guarded-code.json) need more than routine review. Keep these areas stable on `main`; change them in focused PRs and verify the affected safeguards before authorizing merge. Guarding code is not permission to deploy, use private files, or activate real financial data. The separate [production authorization gate](SECURITY.md) still applies.

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
3. Record the full PR head SHA, tested environment and device, steps/outcome, scope and remaining limitations. A later head requires fresh review; reuse a result only after explicitly verifying it still applies. Where live acceptance is not possible, report the missing evidence rather than claiming the test passed.
4. An independent reviewer checks the evidence and approves before a guarded change merges. A PR author does not self-approve. If nobody independent can verify the change, leave it open. An unattended green robot check alone is not approval.

Typical evidence covers wrong-account and wrong-folder refusal with no writes, expiry and reconnect, release/ownership/privacy behavior, interrupted saves and verified recovery, restoration of an encrypted backup to a fresh empty folder, and workload/quota evidence for changes to limits. See the [privacy and session contract](PRIVACY_SESSION.md), the [backup and recovery contract](FULL_SNAPSHOT_BACKUP_RECOVERY.md), and the [storage readiness assessment](STORAGE_SCALING_AND_PRODUCTION_READINESS.md).

## GitHub enforcement

Adding the workflow alone does **not** make it required. After this workflow is present on `main`, the repository owner can make **Guarded code checks** a required GitHub Actions check in the main branch protection rule or ruleset, while keeping the existing checks. Verify the chosen check on an ordinary PR and first confirm how stacking, bypass and deployment rules are configured. Require PR-based changes and, where appropriate, independent approvals and dismissal of stale approvals after new commits. If using code-owner approval, the owner must select real independent reviewers and configure the rule; this PR assigns no reviewers or permissions.

The check cannot authenticate manual test evidence or protect its own workflow against a PR that replaces the workflow logic. Before relying on the gate for real-data use, independently protect the check and review policy themselves. A branch rule requiring independent approval is the minimum; where supported, prefer requiring a trusted workflow from a separately protected source. Do not make the detector a bypass for manual approval. No settings, reviewer assignments, or deployment changes are made by the workflow.
