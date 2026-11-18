# Account and session privacy

## Scope

Synthetic-only implementation. No production activation, Google scope expansion,
account switching workflow, background sign-in, or automatic folder creation.
A passing simulation is not live Google/iPhone acceptance.

## Designated account

Every new token is checked against Drive `about.get` using
`fields=user(permissionId,emailAddress,me)`. The existing `drive.file` scope
[supports this endpoint](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get).
The token holder's permission ID binds the session, not the selected folder's
owner or a display name. Google documents the
[User fields](https://developers.google.com/workspace/drive/api/reference/rest/v3/User).
Missing identity or expiry fails closed.

Before Picker, the user confirms the returned email. First use explicitly
asks to designate that account for this browser. Only a SHA-256 account
fingerprint is stored in localStorage; no email, access token, or financial
records are stored there. The fingerprint is an identifier, not encryption,
a secret, or protection against guessing or same-origin script compromise.
Subsequent grants must match it and the active session identity. Recovery
refresh verifies the same identity without opening Picker or replacing a draft.

There is no in-app reset or account switch. Clearing site storage or using a new
browser/device requires explicit designation again. This browser-local pin
cannot enforce a cross-device account policy: the user must designate the same
account on every device. Storage unavailable or conflicting designation blocks
connection rather than silently falling back to an unpinned account.

## Folder selection and failures

New authorization and Picker selection remain candidates until identity,
folder metadata, explicit folder confirmation and storage-format preflight
succeed. Cancellation and admission failures retain the old token, folder and
lifecycle. Changing folders requires verified release of the previous session,
using its existing credentials. An uncertain release stops the change.

After old-session release, the admitted new selection becomes the active
binding before its lifecycle starts. A failed new start remains selected and
non-ready for diagnosis/recovery; it is not reported as a successful switch,
and the old session is not falsely resurrected. The old draft remains in
memory, but cannot write through an unrelated lifecycle. Failed or cancelled
selection never initializes an unconfirmed folder.

## Privacy close and residuals

Normal verified release clears application references to loaded financial
records, drafts, baselines, backup previews, rendered records, and access tokens.
Unsaved changes require explicit discard confirmation. An unresolved save or
incomplete restore verification blocks normal close so the only recovery
evidence is not silently destroyed. Failed release preserves that evidence
and does not announce a successful privacy close.

Account designation and existing allowlisted diagnostics remain. This change
does not introduce a financial inventory cache. Downloads, browser history,
Google login cookies, OS snapshots, extensions, developer tools, abrupt shutdown
and lost-device state are outside this clearing guarantee. JavaScript cannot
promise secure erasure of strings or browser/process memory. Local token
clearing is not revocation of the Google grant or sign-out from Google itself.

## Acceptance still needed

Use invented fixtures with the deployed candidate: confirm the intended account,
reject another account on connect and recovery refresh, cancel Picker with an
unsaved draft, test failed folder admission/release, verify successful release
removes visible records on physical iPhone/iPad Safari, and verify browser-local
designation survives reload. No real financial data is authorized.

## Unavailable actions and reconnect recovery

Storage actions remain visible when unavailable. Disabled controls have adjacent
explanations rather than relying on hover text or disappearing. Their click
handlers still enforce the same state, online, ownership and verification
requirements. Contextual record panels and navigation disclosures remain
contextual; visibility alone never grants permission to write.

When an existing session reconnects, a failed lease revalidation now publishes
its lifecycle state before returning the error. A conclusively stale lease
exposes explicit stopped-session recovery; an unknown owner or failed
authorization does not. Recovery still requires confirmation that all earlier
tabs/devices stopped, rechecks the marker before takeover, and verifies the
saved copy. Expiry alone never triggers automatic takeover or draft discard.
