# Owner acceptance

**Current acceptance guide:** 2026-11-14. The exact implementation baseline, CI/deployment evidence, and permission boundary are in [CURRENT_STATE.md](CURRENT_STATE.md). Recheck the current source SHA before attributing any manual observation to a build.

## Outstanding acceptance

- [ ] Verify the deployed application reports the intended full source SHA. A successful Pages workflow alone does not prove which SHA a browser is serving.
- [ ] On physical iPhone and iPad Safari, exercise the current mobile workspace and PR40 diagnostic presentation, including text selection and clipboard behavior. Browser emulation and Node tests are not device acceptance.
- [ ] Using invented data and a fresh empty synthetic Drive folder, recheck current synthetic-year initialization and one-change save/reopen. Preserve the exact bounded diagnostic report and source/build identity if it fails. Do not infer a provider-side cause from a diagnostic label.
- [ ] Verify backup/export and restore on separate fresh synthetic destinations, preserving uncertain or failed destinations rather than reusing them.

## Existing evidence

- PR32's local workspace exploration/evidence/correction experience was owner-accepted for its tested scope.
- PR36's financial-position and reconciled-coverage implementation is merged; its recorded owner synthetic/device acceptance applies to the paths tested at that revision.
- PR37's storage foundation, PR38's mobile/tablet integration, and PR40's diagnostics are merged. Their CI and local tests are not a substitute for current physical-device or live-service acceptance.
- The latest main Node contract workflow passed. A main Pages push attempt failed, followed by successful manual deployment and Pages build/deployment workflows. The served SHA still needs independent confirmation.

## Procedures and boundaries

Use the current [canonical workspace acceptance checks](CANONICAL_MAIN_WORKSPACE.md#validation-and-owner-acceptance), [synthetic financial year procedure](SYNTHETIC_FINANCIAL_YEAR.md), [backup/restore contract](DRIVE_BACKUP_AND_RESTORE.md), [mobile workspace acceptance](MOBILE_WORKSPACE_PAGES.md), and [diagnostic contract](APP_DIAGNOSTICS.md). The interactive [acceptance checklist](../prototype/acceptance.html) is a checklist aid, not an automatic assertion of success.

Record each result as **User-confirmed** with the exact source SHA, device/browser, operation, destination class (synthetic only), outcome, and any report ID. Pass, Fail, and Blocked are distinct outcomes. Do not mark a step Pass when its required source or prerequisite is missing.

## Production boundary

This guide authorizes no deployment, merge, production configuration change, or real-data operation. Use invented fixtures only. Production financial-data persistence remains **NO-GO** pending the separate implementation and review of account/OAuth binding, privacy, cost, backup/recovery, live synthetic acceptance, and explicit owner authorization. A separate real-financial-data smoke test is not required.
