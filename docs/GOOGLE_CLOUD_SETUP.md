# Google Cloud setup for the Finance Tracker Drive probe

This guide configures the synthetic Drive probe with a web OAuth client ID, a restricted browser API key, and the Cloud project number. The app no longer asks you to paste configuration values into the page. It does not configure production ledger storage.

## Before you start

Use a Google account that owns or can access the private Drive folder. Keep this project for the Finance Tracker prototype. Do not put the folder ID, credentials, access tokens, or financial records in this public repository.

The probe is published at `https://aerovega.github.io/finance-tracker/prototype/drive-probe.html` when the GitHub Pages deployment from `main` is current. Confirm **Settings → Pages** and the latest Actions deployment before relying on that URL. The web origin is `https://aerovega.github.io`.

## 1. Create a Cloud project

1. Sign in to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project, for example **Finance Tracker Prototype**, or select a project you already own.
3. Keep using this same project for APIs, OAuth, the API key, and the Picker App ID.

## 2. Enable the APIs

In **APIs & Services → Library**, enable:

- **Google Drive API**
- **Google Picker API**

## 3. Configure the OAuth consent screen

Open **Google Auth Platform**. If prompted, choose **Get started**.

1. Under **Branding**, use a clear app name such as **Finance Tracker Prototype** and select your support email.
2. Under **Audience**, choose **External** for a personal Google account. Add the Google account that owns the Drive folder to **Test users**. Keep the app in **Testing** for this prototype.
3. Under **Data Access**, add only this Drive scope:

   `https://www.googleapis.com/auth/drive.file`

This scope lets the app create files and work with files the user selects or opens through Google Picker. Do not choose the broader full-Drive scope. Google categorizes `drive.file` as non-sensitive and recommends using it with Picker. See [Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## 4. Create the OAuth web client ID

In **Google Auth Platform → Clients**, create a client with application type **Web application**.

Under **Authorized JavaScript origins**, add the site origin only (no path):

```
https://aerovega.github.io
```

Confirm this matches the address shown under the repository's **Settings → Pages** before using the deployed probe. For local development, add `http://localhost` and the specific localhost port origin used by the development server.

This browser token flow does not use a redirect URI or a client secret. Copy the client ID, which usually ends in `.apps.googleusercontent.com`. Never place a client secret in browser code.

## 5. Create and restrict the browser API key

In **APIs & Services → Credentials**, choose **Create credentials → API key**. Edit its restrictions:

**Application restrictions → Websites**

Add both:

```
https://aerovega.github.io/*
https://docs.google.com/*
```

The Picker dialog is hosted on `docs.google.com`, so that referrer must be allowed. Add the localhost referrer only while testing locally.

**API restrictions → Restrict key**

Allow only:

- **Google Picker API**
- **Google Drive API**

Google documents these restrictions in its [web Picker setup guide](https://developers.google.com/workspace/drive/picker/guides/web-picker). The API key is visible to browser users by design, so keep these restrictions enabled. Do not commit the key to the repository.

## 6. Find the Cloud project number

Open **IAM & Admin → Settings** in the same project and copy the numeric **Project number**. Do not use the project ID. The probe passes this number to Google Picker as its App ID.

## 7. Configure the deployed app

In the public repository's **Settings → Secrets and variables → Actions → Variables**, add these two repository variables:

- `GOOGLE_OAUTH_CLIENT_ID`: the Web application client ID from step 4.
- `GOOGLE_PICKER_API_KEY`: the restricted browser API key from step 5.

These are public browser configuration values, not secrets. The OAuth client ID is a public identifier; the API key is intentionally visible to browser users and must remain restricted to the allowed website referrers and APIs. Do not put a client secret or access token in repository variables or browser code.

The Picker project number is already configured as `863907870950` for this prototype. The Pages workflow injects the two repository variables into the deployed artifact; it does not commit them into Git. After adding or changing the variables, run **Actions → Deploy static site to GitHub Pages → Run workflow**, select the branch you intend to test, and confirm the page footer SHA matches that branch's source commit.

## 8. Run the synthetic check

After the probe is served from the authorized site:

1. Choose **Continue with Google** and select the account that owns the private folder.
2. Review and authorize the `drive.file` request in Google's dialog.
3. Choose **Choose Drive folder** and select the intended private folder.
4. Confirm the folder name, then run the synthetic read/write check.
5. The probe creates one invented JSON file, reads it back, compares its contents, then asks before deleting that temporary file. It never opens or changes the canonical ledger and never uploads a CSV.

If deletion is declined or fails, remove only the clearly named `finance-tracker-drive-probe-…json` test file from the selected folder.

## Recorded live test result

**User-confirmed PASS (2026-10-24, user's local date):** The probe was run from the deployed GitHub Pages site on an iPad. The owner authorized with the configured test-user account, selected the intended private folder `finance-tracker-database`, observed the invented JSON file in that folder, saw the exact read-back PASS, and approved deletion. The page reported the temporary file was deleted. The owner then rotated the restricted API key, removed the old key, updated their private note, and reran the probe successfully.

This establishes the tested create/read-back/confirmed-delete path only. It does not validate cross-device synchronization, conflict safety, recovery, or production ledger storage. No real financial data was used. Do not add credentials or folder IDs to this repository.

## Latest live validation (2026-10-29)

The owner reran the deployed experiment branch at source commit `872ed80db73a4866ebbdb609c83aece26d9fce00` and confirmed a complete PASS: Google authorization succeeded, Picker selected `finance-tracker-database`, Drive write/read-back matched, and the temporary synthetic file was deleted. The initial Picker “API developer key is invalid” error was traced to the repository variable still containing the previously rotated key; replacing it with the current restricted key resolved the issue.

The Actions log confirmed both public configuration values were injected without logging their values. This remains user-confirmed live evidence for the synthetic test only. It does not authorize real financial-data storage or prove conflict safety, recovery, cross-device synchronization, token expiry/revocation handling, or production cost/terms. Never record the key, access token, or folder ID in repository files.

## Cost note

Google's [Drive API usage-limits page](https://developers.google.com/workspace/drive/api/guides/limits) currently says standard Drive API use is available at no additional cost. Google also says charges for use above quota limits are planned for later in 2026. This personal synthetic check should use ordinary API requests; do not request a quota increase or enable billing just for the probe. Recheck Google's current terms and limits before production.

*Setup guidance checked 2026-10-21; deployment-variable instructions added 2026-10-29.*
