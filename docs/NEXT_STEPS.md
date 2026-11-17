# Next steps

**Updated:** 2026-11-17
**Current baseline:** [current main and scoped evidence](CURRENT_STATE.md)
**Release target:** 2027-01-01 for v1.0.0, conditional on all release gates.

This file is the active dependency/acceptance queue. It does not grant permission to merge, deploy, change production configuration, or use real financial data. The [current state](CURRENT_STATE.md) is authoritative for implementation and authorization. The [product definition](PRODUCT_DEFINITION.md) owns the detailed v1.0.0 scope.

## Immediate priorities

- **Cleanup is merged in PR47.** Current main and evidence are recorded in [current state](CURRENT_STATE.md).

1. **Active next PR: recovery and backup/restore.** Strengthen user-facing recovery and implement portable backup/restore for the selected full-snapshot format. The protocol recovery engine already exists and must retain full ancestry audit, pending-publication resolution, explicit uncertainty and verified-reopen requirements. Use the upgraded simulator extensively for interruption, corruption, authorization, uncertain-write and fresh-restore/reopen scenarios before asking the owner to deploy and test. Do not fold this implementation into the cleanup PR.
2. **Keep acceptance scoped to evidence.** The reported 11-second open and 25-second persisted save are accepted. The last reported seed was 42 seconds; seed performance is separate and does not reopen that gate. Test changed behavior and regressions without inferring universal sub-30-second operations or Alpha completeness.
3. **Finish the Alpha financial-history path.** Implement and verify the distinct monthly-summary migration from January 2023 using invented workbook fixtures first. Preserve source granularity, provenance, month coverage and reconciliation results; never convert monthly totals into fabricated transaction rows.
4. **Complete supported owner-file ingestion.** Bring supported Wells Fargo, SoFi and Fidelity exports through the actual application workflow: strict format recognition, account mapping, user-adjustable declared coverage, observed-date validation, discrepancy resolution, duplicate/re-import safety and verified persistence. Real files remain gated.
5. **Complete remaining production controls.** Implement and review account/database binding, OAuth lifecycle, privacy boundaries, cost/quotas and safe session cleanup with synthetic data. Production remains NO-GO until every applicable gate and explicit owner activation approval pass.

The next-PR sequence above is owner-directed, not a delivery-date commitment. Later work remains ordered by dependency, risk and reviewability.

## Acceptance boundaries

- **Full-snapshot v1:** the selected application storage format. Older layouts are unsupported; do not migrate, overwrite, revive or delete their folders. See [format contract](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md).
- **Storage performance:** the reported open/save goal is owner-accepted; the last reported 42-second seed is separate. Full ledger/history loading and validation remain; no bounded-memory or selective-loading claim follows. Preserve integrity and financial checks.
- **Financial position:** PR36 implementation is merged. Its existing owner synthetic/device acceptance is historical evidence for the paths tested; do not reopen unchanged checks without a reason.
- **Diagnostics:** PR40 is merged. Reports are bounded and privacy-safe, with Copy/Select only. They improve evidence; they do not prove a live provider cause or substitute for acceptance.
- **Deployment:** successful CI or Pages workflow is not independent verification of the served SHA. Record each state separately.
- **Data:** use invented fixtures only. No real transactions, private workbook, owner Drive financial data, or production credentials in repository/CI.
- **Production:** NO-GO until the separate security/privacy/OAuth/cost/recovery review, live synthetic acceptance, and explicit owner authorization are complete. A separate real-data smoke test is not required.

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
