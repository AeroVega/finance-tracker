# Next steps

**Updated:** 2026-11-14  
**Current baseline:** [main at `be43951a`](CURRENT_STATE.md)  
**Release target:** 2027-01-01 for v1.0.0, conditional on all release gates.

This file is the active dependency/acceptance queue. It does not grant permission to merge, deploy, change production configuration, or use real financial data. The [current state](CURRENT_STATE.md) is authoritative for implementation and authorization. The [product definition](PRODUCT_DEFINITION.md) owns the detailed v1.0.0 scope.

## Immediate priorities

1. **Validate the latest integrated app.** Recheck synthetic-year initialization and one-change save/reopen on the current main build, using the bounded diagnostics to preserve exact evidence. Confirm physical iPhone/iPad Safari behavior for the changed workspace and diagnostics. Do not infer a provider-side cause from a diagnostic category alone.
2. **Finish the Alpha financial-history path.** Implement and verify the distinct monthly-summary migration from January 2023 using invented workbook fixtures first. Preserve source granularity, provenance, month coverage, and reconciliation results; never convert monthly totals into fabricated transaction rows.
3. **Complete supported owner-file ingestion.** Bring supported Wells Fargo, SoFi, and Fidelity exports through the actual application workflow: strict format recognition, account mapping, user-adjustable declared coverage, observed-date validation, discrepancy resolution, duplicate/re-import safety, and verified persistence. Real files remain gated.
4. **Complete production controls.** Implement and review account/database binding, OAuth lifecycle, privacy boundaries, backup/recovery, portable export/restore, cost/quotas, and safe session cleanup with synthetic data. Production remains NO-GO until every applicable gate and explicit owner activation approval pass.

These are project priorities, not a commitment to a specific PR sequence or delivery date. Sequence by dependency, risk, and reviewability—not PR number.

## Acceptance boundaries

- **Canonical v5:** active application write format. Older canonical v1/v2/v3/v4 copies are refused; do not silently migrate, overwrite, or revive them. Existing v5 migration-origin copies retain read-only provenance verification. See [format contract](PARTITIONED_CANONICAL_STORAGE.md).
- **Storage performance:** coalesced writes and segmented indexes do not mean bounded full-database memory, selective financial loading, or incremental semantic validation. Preserve full integrity and financial checks.
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
