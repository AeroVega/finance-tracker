# Next steps

**Updated:** 2026-11-19
**Current baseline:** [current main and scoped evidence](CURRENT_STATE.md)
**Release target:** 2027-01-01 for v1.0.0, conditional on all release gates.

This file is the active dependency/acceptance queue. It does not grant permission to merge, deploy, change production configuration, or use real financial data. The [current state](CURRENT_STATE.md) is authoritative for implementation and authorization. The [product definition](PRODUCT_DEFINITION.md) owns the detailed v1.0.0 scope.

## Immediate priorities

1. **Supported CSV application workflow.** [PR 53](https://github.com/AeroVega/finance-tracker/pull/53) merged after green CI and owner confirmation of the Wells Fargo workflow. Keep real exports gated and do not extrapolate to every provider or device.
2. **Monthly-summary persistence and review — separate PR.** Verify the [normalized-history workflow](HISTORICAL_MONTHLY_SUMMARY.md) with invented input. Review workbook-derived monthly net worth, income and expense totals without inventing transaction-level detail. Preserve provenance, month coverage and explicit reconciliation. Missing data remains unavailable, not zero.
3. **Purpose-built workbook converter — separate PR.** Build a dedicated converter for the legacy workbook after the monthly-summary contract is settled. Use invented workbook fixtures in CI; do not commit or upload the private workbook. Keep source worksheet/cell provenance and make conversion results inspectable before import.
4. **Remaining production controls.** Review account/database binding, OAuth lifecycle, privacy boundaries, local-only original CSV handling (including backups/restores), cost/quotas and safe session cleanup with synthetic data. Production remains NO-GO until every applicable gate and explicit owner activation approval pass.

The sequence is owner-directed, not a delivery-date commitment. Keep the three financial-history workstreams in distinct PRs so review, rollback and provenance remain clear.

## Acceptance boundaries

- **Full-snapshot v1:** the selected application storage format. Older layouts are unsupported; do not migrate, overwrite, revive or delete their folders. See [format contract](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md).
- **Storage performance:** the reported open/save goal is owner-accepted; the last reported 42-second seed is separate. Full ledger/history loading and validation remain; no bounded-memory or selective-loading claim follows. Preserve integrity and financial checks.
- **Financial position:** PR36 implementation is merged. Its existing owner synthetic/device acceptance is historical evidence for the paths tested; do not reopen unchanged checks without a reason.
- **Diagnostics:** PR40 is merged. Reports are bounded and privacy-safe, with Copy/Select only. They improve evidence; they do not prove a live provider cause or substitute for acceptance.
- **Deployment:** successful CI or Pages workflow is not independent verification of the served SHA. Record each state separately.
- **Data:** use invented fixtures only. No real transactions, private workbook, owner Drive financial data, or production credentials in repository/CI.
- **Production:** NO-GO until the separate security/privacy/OAuth/cost/recovery review, live synthetic acceptance, and explicit owner authorization are complete. A separate real-data smoke test is not required. Use the [owner acceptance and release checklist](OWNER_ACCEPTANCE.md) to record evidence for the exact candidate.

## Alpha completion review

Do not call Alpha complete because a PR merged. Demonstrate one traceable synthetic end-to-end journey across supported import, review/correction, financial position and coverage, monthly history, explicit save, independent reopen, and portable backup/restore. Show exact reconciliation and provenance, plus interruption/recovery behavior.

Record these separately:
- implementation on a named commit;
- automated tests and CI on that commit;
- physical-device and live synthetic acceptance;
- deployment workflow and independently checked served SHA;
- unresolved limitations and accepted residual risks;
- explicit production authorization.

Incorrect totals, data loss, or privacy failures block release. Move the date rather than weakening the standard.

## Verification

For application changes, follow [TESTING.md](TESTING.md) and run the required serial extended suite where applicable:

```sh
FINANCE_EXTENDED_STORAGE_TESTS=1 node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

For documentation changes, run the documentation/link/anchor checks, generated-reference check, and `git diff --check`. Do not report checks that were not run or were blocked as passes.
