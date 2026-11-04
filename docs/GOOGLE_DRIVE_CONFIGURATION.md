# Google Drive Configuration, Authorization, Quotas, and Cost

**Review snapshot:** 2026-11-03
**Scope:** Prototype/synthetic storage configuration context. This is not production authorization or a substitute for inspecting the actual Google Cloud project.

## OAuth scope and token lifecycle

The reviewed prototype requests `https://www.googleapis.com/auth/drive.file`. Google's scope documentation classifies `drive.file` as non-sensitive and limits access to files created by the app or opened/shared with it through Picker. This is preferable to the broader restricted `drive` scope.

The checked browser flow uses Google Identity Services token-client authorization and keeps the access token in page memory. It does not persist a refresh token. Expired tokens require interactive reauthorization. Do not introduce stored bank passwords or long-lived browser refresh-token storage as a shortcut.

Google's OAuth help, checked on 2026-11-03, states that apps in Testing are limited to listed test users and user authorizations expire after seven days. A personal-use app with fewer than 100 users may qualify for an exception from verification, but that does not remove the obligation to comply with Google's API Services User Data Policy. Confirm the actual publishing status, audience, listed testers, scopes, and exception applicability in Cloud Console before relying on them.

## Quotas and cost snapshot

Official Google documentation was checked on 2026-11-03:

- The Drive limits page listed 1,000,000 quota units per minute per project, 325,000 per minute per user/project, and a 1 TB/day project egress limit.
- It stated standard Drive API use was available at no additional cost.
- It described a 400,000,000 quota-unit daily billing threshold and said charges above it were planned for later in 2026, with further billing details to be shared after at least 90 days' notice.

References:
- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Manage app audience](https://support.google.com/cloud/answer/15549945?hl=en)
- [When verification is not needed](https://support.google.com/cloud/answer/13464323?hl=en)
- [Drive API usage limits](https://developers.google.com/workspace/drive/api/guides/limits)
- [Google Workspace standardized model](https://developers.google.com/workspace/tools-safety)

## What has not been verified

The code review did not inspect the actual Cloud Console project settings. The following remain owner-verification items:

- OAuth publishing status, audience, approved test users, and declared scopes.
- API restrictions and HTTP-referrer restrictions on keys.
- Actual assigned quotas, observed usage, and project billing configuration.
- Whether the project remains below any applicable billing threshold and can sustain the hard $0 recurring-cost requirement.
- Current provider terms and any subsequent changes to quota/billing policy.

Owner-reported live tests confirmed that an unapproved account was denied while the app was in Testing mode, an approved account could reconnect, and actual Drive authorization revocation caused retained-history verification to fail closed until reauthorization and recovery. These results do not establish the complete Cloud project configuration.

## Cost and safety rules

The project's $0 recurring operating cost is a hard constraint. Published standard-use pricing and quota documentation alone do not prove the actual project will remain free. Do not silently enable billing-dependent behavior, assume future over-threshold terms, or rely on an expiring trial.

Keep the app on the least-privilege scope that supports the approved workflow. Never commit API keys, OAuth client secrets, tokens, account identifiers, private folder/file IDs, or financial contents to this public repository. Public client configuration is not a client secret, but still requires appropriate restrictions and review.

No production financial-data persistence is authorized by this document.
