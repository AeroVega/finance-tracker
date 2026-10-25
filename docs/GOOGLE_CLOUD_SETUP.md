# Google Cloud setup for the Finance Tracker Drive probe

This guide creates the three values needed by the synthetic Drive probe: a web OAuth client ID, a restricted browser API key, and the Cloud project number. It does not configure production ledger storage.

## Before you start

Use a Google account that owns or can access the private Drive folder. Keep this project for the Finance Tracker prototype. Do not put the folder ID, credentials, access tokens, or financial records in this public repository.

The probe is currently in draft PR #9 and is not deployed. Before a live check, confirm the actual GitHub Pages URL in the repository's **Settings → Pages**. The expected project-site URL is `https://aerovega.github.io/finance-tracker/`; its web origin is `https://aerovega.github.io`.

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

## 7. Run the synthetic check

After the probe is served from the authorized site:

1. Enter the OAuth client ID, restricted API key, and project number in the page.
2. Choose **Connect Google Drive** and authorize the `drive.file` request with the test-user account.
3. Choose **Choose Drive folder** and select the intended private folder.
4. Confirm the folder name, then run the synthetic read/write check.
5. The probe creates one invented JSON file, reads it back, compares its contents, then asks before deleting that temporary file. It never opens or changes the canonical ledger and never uploads a CSV.

If deletion is declined or fails, remove only the clearly named `finance-tracker-drive-probe-…json` test file from the selected folder.

PR #9 is still a draft and Pages does not deploy this branch. A live test must wait until the probe is served from the authorized HTTPS origin, or be run locally with localhost added to the OAuth origin and API-key website restrictions.

## Cost note

Google's [Drive API usage-limits page](https://developers.google.com/workspace/drive/api/guides/limits) currently says standard Drive API use is available at no additional cost. Google also says charges for use above quota limits are planned for later in 2026. This personal synthetic check should use ordinary API requests; do not request a quota increase or enable billing just for the probe. Recheck Google's current terms and limits before production.

*Setup guidance checked 2026-10-21.*
