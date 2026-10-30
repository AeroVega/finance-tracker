# Integrating Google Drive Experiments A and B

**Purpose:** Define the smallest coherent change to bring the successful Google sign-in/configuration work from Experiment A and the folder-discovery work from Experiment B together in one reviewed PR to `main`.

**Status:** Experiment A and B integration merged via PR #16 on 2026-10-29 (merge commit `07ee4f012bb94d95bb4b526603f0ddac760bcba5`). PR #15 was closed without merging to avoid duplicating overlapping configuration/deployment changes. No production ledger storage is approved.

## Evidence to carry forward

### Experiment A — familiar authorization and synthetic round trip

User-confirmed live PASS on 2026-10-29 (deployed source commit `872ed80db73a4866ebbdb609c83aece26d9fce00`):
- Google account selection and interactive authorization work with the configured browser OAuth client.
- Public browser configuration is injected during Pages deployment from repository Actions variables; actual values are not printed in workflow logs.
- The restricted browser API key works with the configured Picker/Drive APIs after replacing the rotated key.
- Picker-selected folder supports creating one invented JSON file, reading it back exactly, and deleting it only after explicit confirmation.
- Access token remains in page memory; the probe does not upload CSVs or read/write the ledger.

**Carry forward:** one shared configuration-injection step, the familiar Google authorization UX, the narrow `drive.file` scope, and the tested synthetic round-trip helper/UI as a separate diagnostic path.

### Experiment B — discovery

User-confirmed live PASS on 2026-10-29 (deployed source commit `d29a4eb19bbd3a56aa00376692d2ea2ae6b68ec7`):
- After the owner had previously selected the existing folder in Picker, Drive's exact-name folder query returned one accessible match after reload and fresh authorization.
- The same query returned one match after **Forget saved comparison** cleared the app's session-stored Picker reference. The app did not open Picker for that query and did not change files.
- Automated tests cover zero, one, multiple, paginated, malformed, and HTTP-error responses.

**Important boundary:** clearing the app's session reference did not revoke Google's prior file-specific access grant from Picker. This does not prove a brand-new user can discover an arbitrary existing folder before first selecting/opening it with Picker.

**Carry forward:** the pure discovery helper, minimum metadata query, pagination, and explicit zero/one/multiple outcomes. Keep the standalone "Forget saved comparison" control as an experiment/debugging affordance, not necessarily part of the everyday app UI.

## Recommended combined behavior

1. Load the single generated public Google config; if required values are absent, show a clear setup error without exposing values.
2. Let the owner choose the intended Google account and request only `drive.file`.
3. On an established installation, attempt exact-name discovery for the configured Finance Tracker folder.
4. **Exactly one match:** do not treat name alone as definitive identity. Verify an app-owned marker/manifest or another reviewed identity mechanism before using it as the canonical database folder.
5. **Zero matches:** explain that no accessible match was returned; offer explicit Picker selection. Do not infer that the folder is absent and do not automatically create a replacement.
6. **Multiple matches:** stop and ask the owner to select the intended folder with Picker; never select the first result.
7. Preserve the synthetic create/read-back/confirmed-delete check as a separate diagnostic, clearly labeled synthetic-only. It must never touch ledger data.
8. Keep access tokens in memory only. Do not store Google passwords or refresh/access tokens. Keep public configuration values out of committed source; continue to restrict the API key.
9. Keep the current shared Pages deployment and SHA stamping behavior, and make the workflow inject config exactly once.

## Negative implications: in scope, mitigated, or out of scope?

| Risk | Assessment | Treatment |
|---|---|---|
| First-run discovery may not see an existing folder until Picker grants access | **In scope** | Picker remains the first-run permission/selection path. Test a genuinely fresh test account/folder before claiming first-run discovery works without Picker. |
| Same-name folder or rename can misdirect discovery | **In scope; must mitigate before canonical storage** | Verify a marker/manifest or another stable identity before using the folder. Zero/multiple results stop for user action. |
| Prior file-specific authorization can remain after clearing local app state | **In scope; important to interpret test correctly** | Document the difference between clearing the app's reference and revoking Google access; test revocation separately. |
| Token expiry, revoked consent, wrong account, network/API errors | **In scope** | Clear error states, reauthorization, no silent replacement, and no writes after uncertain discovery. |
| Discovery returns accessible folder metadata | **Manageable and in scope** | Request minimum fields, keep tokens in memory only, avoid logging IDs/listings, and filter by exact name, folder MIME type, and not-trashed. |
| API outages or quota/network failures | **In scope as normal failure handling** | Fail closed with retry/reconnect guidance. Never treat transient errors as a missing database. |
| This test does not validate ledger safety | **Not a defect in discovery; production blocker** | Keep real financial data disabled until conflict handling, stale writes, backup/restore, interrupted-write recovery, and integrity checks are designed and reviewed. |
| Google consent mode, terms, quota/cost may change | **Release gate before broader use** | Recheck current terms and OAuth publishing/verification requirements before adding users or relying on production use. |

### Practical conclusion

The result is useful for this single-user project: after the owner has explicitly selected the existing folder once, the app can find it again by name without persisting its ID in the app's session storage. It does **not** remove the need for Picker during initial onboarding, establish globally unique folder identity, or authorize production ledger storage.

## Historical integration scope — completed by PR #16

The following describes the work proposed before PR #16 and is retained for traceability. It is not a request to repeat or re-port that work. PR #15 and PR #16 were not merged wholesale because their deployment workflow edits overlapped.

The integrated result included:
- Experiment A's public configuration injection (exactly one workflow step), familiar Google account chooser, and tested synthetic round-trip probe.
- Experiment B's discovery helper, pagination, strict zero/one/multiple handling, and automated tests.
- Updated docs recording both user-confirmed live results and their limitations.
- One deployment workflow with SHA stamping and no secret values printed.

Keep both the synthetic probe and discovery UI explicitly prototype-only. The remaining next design task is stable database identity: exact name alone is insufficient. A small app-owned marker/manifest may be appropriate, but its format and recovery behavior must be reviewed before implementing it.

Exclude real ledger reads/writes, automatic replacement-folder creation, broader Drive scopes, stored tokens, multi-user guarantees, and claims of production-ready backup/conflict recovery. Run the full Node suite, manually deploy the integration branch, verify the source SHA, repeat the live checks, and request explicit merge approval only after review.


## Follow-up hardening implementation — PR #17

The focused follow-up hardens the discovery helper and its experiment UI without enabling ledger access:

- **Typed outcomes:** zero matches are `not-found`; multiple matches are `ambiguous`; a unique exact-name match is only a `candidate-found` result and explicitly requires identity verification before it could be used as the canonical database.
- **Explicit Picker fallback:** zero, multiple, invalid, or mismatched results tell the owner to select the intended folder with Picker. The app must not create a replacement folder automatically.
- **Distinct failures:** HTTP 401 requests reauthorization; HTTP 403 reports access denial; other HTTP errors and network/malformed-response failures remain distinct and do not select a folder. Error messages avoid response bodies, tokens, and raw transport details.
- **Regression coverage:** synthetic tests cover the classification contract, missing/ambiguous results, identity-verification requirement, pagination, HTTP 401/403/500, network failures, malformed responses, and required inputs.

**Still open:** this does not implement the app-owned identity marker/manifest. A unique name or Picker comparison reference is not yet sufficient proof of canonical database identity. The production storage gate remains closed.
