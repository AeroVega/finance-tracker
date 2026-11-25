# Next steps

**Updated:** 2026-11-24
**Release target:** v1.0.0 on 2027-01-01, conditional on all release gates. Defer the date rather than weaken a gate.

This is the active priority queue. It grants no permission to merge, deploy or change production configuration. [Current state](CURRENT_STATE.md) owns authorization. The [product definition](PRODUCT_DEFINITION.md) owns the v1.0.0 scope.

## Priorities

1. **Verify the deployed build.** After the Pages workflow runs, confirm the served source stamp, Google configuration and release profile before real records are entered. Record the result in the PR or thread; no per-build owner GO is required.
2. **UX redesign, in slices** ([PR 62](https://github.com/AeroVega/finance-tracker/pull/62) is the first). Remaining slices:
   - Activity: type and category filters, sorting, inline review decisions, grouping by month. In progress on `t3/activity-filters-review`; see [Design § Activity](DESIGN.md#activity).
   - Accounts: per-account detail with balance history and coverage gaps.
   - Home: category breakdown, and period switching for year and lifetime.
   - Planning, once budgets or a baseline projection exist.
   - A physical iPhone and iPad pass: standalone launch, VoiceOver and keyboard.
3. **Historical monthly summaries and the legacy-workbook converter.** Keep them in separate PRs from readiness work. Use invented workbook fixtures in CI. Never commit or upload the private workbook. Missing data stays unavailable, not zero. The migration wizard ([PR 58](https://github.com/AeroVega/finance-tracker/pull/58)) resumes only at the owner's direction.
4. **Backup rehearsal.** Run the owner's 3-month encrypted backup and restore cadence, and watch the capacity triggers recorded in [Current state](CURRENT_STATE.md#acceptance-and-verification).

## Acceptance boundaries

- **Full-snapshot v1** is the only supported format. Do not migrate, overwrite, revive or delete older layouts.
- **Performance:** the reported open and save goal is accepted. The ledger still loads and validates in full, so make no bounded-memory claim. Preserve integrity and financial checks.
- **Provider imports:** only the Wells Fargo path has owner confirmation. Do not extend it to SoFi, Fidelity or other devices.
- **Diagnostics:** reports are bounded and privacy-safe and are Copy/Select only. They do not prove a live provider cause or replace acceptance.
- **Deployment:** green CI or a Pages run does not verify the served SHA. Record each state separately.
- **Data:** invented fixtures only. No real transactions, private workbook, owner Drive data or production credentials in the repository or CI.

## Alpha completion

A merged PR does not complete Alpha. Demonstrate one traceable synthetic journey: supported import, review and correction, financial position and coverage, monthly history, explicit save, independent reopen, and encrypted backup and restore. Show exact reconciliation, provenance and interruption recovery.

Record these separately: implementation on a named commit; automated tests and CI on that commit; physical-device and live synthetic acceptance; deployment and the independently checked served SHA; unresolved limitations and accepted risks. Incorrect totals, data loss and privacy failures block release.

## Verification

For application changes follow [Testing](TESTING.md). For documentation changes run `node scripts/check-docs.mjs` and `git diff --check`. Do not report a check you did not run as a pass.
