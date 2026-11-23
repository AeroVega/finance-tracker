# Google Drive Configuration, Authorization, Quotas, and Cost

**Review snapshot:** 2026-11-22
**Scope:** Public-source and repository-source review. This is not verification of the actual Google Cloud Console project or production authorization. See [the security review record](SECURITY_PRIVACY_OAUTH_COST_RECOVERY_REVIEW.md).

## Actual application request

The inspected `js/dashboard-synthetic-storage.mjs` requests only `https://www.googleapis.com/auth/drive.file` through Google Identity Services token-client authorization. It does not request a refresh token; the access token and expiry are held in the `DashboardSyntheticStorage` instance in page memory. Expiry clears the stored reference and blocks the operation until interactive reauthorization.

The app calls Drive `about.get` with `fields=user(permissionId,emailAddress,me)` to verify the token holder. Current Google method documentation explicitly lists `drive.file` as an accepted scope for `about.get`.

## Scope meaning and limitation

Google classifies `drive.file` as **non-sensitive** and recommends it for most use cases. It grants create access for app-created files and access to existing files that the user opens with the app or shares through Google Picker/the app's file picker. It does **not** grant unrestricted visibility into the user's entire Drive. As a result, listing a selected folder cannot prove that the folder is globally empty or that no inaccessible personal content exists. The product must require explicit user confirmation in Drive and must never describe the app's limited listing as a complete account-wide audit.

The broader `drive` scope is restricted and should not be substituted merely to make folder enumeration easier.

Primary references:
- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Drive about.get method and supported scopes](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get)
- [Drive User resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/User)

## Current OAuth app modes

Google's current guidance now documents **Personal** mode. It is a one-time configuration choice for a new app; an existing External/Internal app cannot be switched to Personal. Personal mode does not require OAuth app verification and is not subject to the 100-user cap or seven-day testing-token expiry. Google documents `client_user_mismatch` for authorization by an account other than the app creator.

If the existing project remains External/Testing, only allowlisted test users can authorize and authorizations expire after seven days. External/Published unverified apps may present an unverified-app warning and user cap; sensitive/restricted scope use has additional verification requirements. Verification exceptions do not remove data-policy obligations.

**Required owner action:** inspect the real Cloud Console project and record whether it is Personal, External or Internal; publish state; test-user list; registered origins/redirects; client ID; enabled APIs; exact OAuth scopes; API key restrictions; and app creator/designated account. Do not change mode as part of this code review. Personal mode is irreversible at project setup and cannot be selected for an existing External/Internal project.

References:
- [Google OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
- [Personal mode setup and behavior](https://support.google.com/cloud/answer/15544987)
- [When OAuth verification is not needed](https://support.google.com/cloud/answer/13464323)
- [Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)

## Quota and cost snapshot (Google documentation checked 2026-11-22)

For Drive API projects subject to the quota model introduced May 1, 2026, Google's current page lists:
- 1,000,000 quota units/minute/project.
- 325,000 quota units/minute/user/project.
- 1 TB/day project egress before the daily threshold.
- A 400,000,000 quota-unit daily billing threshold.
- Method costs include 5 units for `about.get` and ordinary file GET (without media), 100 units for list methods, and 50 units for edit methods.

Google describes standard Drive API use under the threshold as no additional charge. The Workspace standardized-model page says over-threshold charges and quota-increase billing are planned for later in 2026 following at least 90 days' notice; the live Cloud Console project remains the authority for actual assigned quotas and billing.

Projects with Drive API usage between November 2025 and April 2026 retain previously set quotas for at least the documented transition period; projects created on/after May 1, 2026 are subject to the new quotas. **Do not assume the figures above are the actual project's assigned limits.**

References:
- [Drive API usage limits](https://developers.google.com/workspace/drive/api/guides/limits)
- [Google Workspace standardized model](https://developers.google.com/workspace/tools-safety)

## What remains unverified in Cloud Console

- OAuth project mode, publishing status, test-user audience and the actual consent screen.
- Client ID, authorized JavaScript origins, exact scope declarations and API enablement.
- Picker API key restriction to the intended APIs and deployed HTTP referrers.
- Actual per-project/per-user quota assignment, quota usage and any billing configuration.
- Whether any future over-threshold billing terms are effective and whether the project can remain under them.
- Actual Google account and selected database/folder workflow under the deployed build.

## Sustainable-cost constraints

The application must stay within the $0 recurring-cost constraint. Standard Drive API use has no additional charge under the documented threshold, but published pricing alone does not prove project-specific $0 behavior. No billing-dependent behavior, quota increase, paid tier, trial or recurring service may be silently enabled.

Full-snapshot v1 uploads the complete logical ledger for every changed save and retains every physical snapshot. The current storage limits are 8 MiB per snapshot, 16 KiB per envelope/manifest and 10,000 commits; the selected format imposes no aggregate history-byte limit or garbage collection. A dense ledger can exceed 60 MiB after only ten full snapshots. Cold-open and verification traffic scale with retained history. Backup/export, restore, read-back, recovery and retries add exceptional reads/writes and egress. Track actual request units and transferred bytes from live synthetic sessions; simulator request counts and modeled service sums are not a quota/cost forecast.

When offline, authorization expires, quota/rate limits are reached, egress limits are reached or provider calls fail, disable writes and retain unresolved draft/recovery evidence in memory. Use bounded backoff only for eligible read retries; never retry an unknown authority mutation. Explain that the service is unavailable and require explicit reconnect/recovery. Do not switch to paid quota, billing or an unapproved storage provider.

No production financial-data persistence is authorized by this document.
