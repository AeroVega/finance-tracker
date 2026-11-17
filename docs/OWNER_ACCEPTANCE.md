# Owner acceptance

**Current acceptance guide:** 2026-11-17. The exact implementation baseline, CI/deployment evidence, and permission boundary are in [CURRENT_STATE.md](CURRENT_STATE.md). Recheck the current source SHA before attributing any manual observation to a build.

## Outstanding acceptance

- [ ] Verify the deployed application reports the intended full source SHA. A successful Pages workflow alone does not prove which SHA a browser is serving.
- [ ] On physical iPhone and iPad Safari, exercise the current mobile workspace and PR40 diagnostic presentation, including text selection and clipboard behavior. Browser emulation and Node tests are not device acceptance.
- [ ] Validate any behavior changed by cleanup on the exact post-cleanup build. The owner already accepted the reported synthetic open/save/persistence on `86d1f2b`; do not treat that as untested, or as coverage of unrelated device/history cases. Preserve bounded diagnostics if a new failure occurs.
- [ ] Implement portable full-snapshot backup/export and restore, then verify them on separate fresh synthetic destinations. These are not available in the current UI; preserve uncertain or failed destinations.

## Existing evidence

- PR32's local workspace exploration/evidence/correction experience was owner-accepted for its tested scope.
- PR36's financial-position and reconciled-coverage implementation is merged; its recorded owner synthetic/device acceptance applies to the paths tested at that revision.
- PR37's storage foundation, PR38's mobile/tablet integration, and PR40's diagnostics are merged. Their CI and local tests are not a substitute for current physical-device or live-service acceptance.
- On `86d1f2b`, the owner reported an 11-second open and 25-second save with persistence confirmed, and declared the performance goal accomplished. This is scoped user acceptance, not production approval. Exact CI/deployment evidence belongs in [current state](CURRENT_STATE.md).

## Procedures and boundaries

Use the current [canonical workspace acceptance checks](CANONICAL_MAIN_WORKSPACE.md#validation-and-owner-acceptance), [synthetic financial year procedure](SYNTHETIC_FINANCIAL_YEAR.md), [full-snapshot contract](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md), [mobile workspace acceptance](MOBILE_WORKSPACE_PAGES.md), and [diagnostic contract](APP_DIAGNOSTICS.md). Use the [main workspace](../index.html#storage) for current synthetic creation, correction, save, independent reopen and release. The old interactive acceptance harness was retired with obsolete-format tooling; this written guide remains the acceptance checklist.

Record each result as **User-confirmed** with the exact source SHA, device/browser, operation, destination class (synthetic only), outcome, and any report ID. Pass, Fail, and Blocked are distinct outcomes. Do not mark a step Pass when its required source or prerequisite is missing.

## Production boundary

This guide authorizes no deployment, merge, production configuration change, or real-data operation. Use invented fixtures only. Production financial-data persistence remains **NO-GO** pending the separate implementation and review of account/OAuth binding, privacy, cost, backup/recovery, live synthetic acceptance, and explicit owner authorization. A separate real-financial-data smoke test is not required.
