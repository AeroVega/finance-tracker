# Synthetic Google Drive round-trip prototype

## Confirmed decisions

**User-confirmed (2026-10-21):** Use the owner's existing restricted Drive folder as the private home for the canonical ledger. Parse selected CSVs in the browser, merge reviewed results into the ledger, and store the normalized ledger with import provenance in Drive. Do not archive the original CSV files in Drive. The owner accepts short-lived access tokens and interactive reauthorization.

**Prototype boundary:** This page verifies access to a user-selected folder by creating and reading one temporary invented JSON file. It asks before deleting only that file. It never opens, updates, or deletes the canonical ledger, and it never uploads CSV data.

## Before testing

1. Enable the Google Drive API and Google Picker API in a Google Cloud project.
2. Create a Web application OAuth client. Add the deployed HTTPS origin to Authorized JavaScript origins. For the current GitHub Pages project site, the expected origin is https://aerovega.github.io; verify the live Pages URL before registering it. Add http://localhost only for local development.
3. Configure the OAuth consent screen for the Google account that owns the selected folder. Use the drive.file scope. The browser-only token flow requires the owner to be present and to reconnect after token expiry.
4. Create an API key for Google Picker. Restrict it to the deployed HTTPS origin and the Picker API. The project number is used as the Picker App ID.
5. Do not place the supplied folder ID, access token, API key, OAuth client secret, or financial data in this public repository. The client ID is a public identifier; the probe asks for it in the page and keeps it only in page memory. No client secret is used.

## Run the live synthetic check

1. Serve this page over HTTPS or from http://localhost. Do not open it with a file URL.
2. Enter the OAuth client ID, restricted API key, and numeric Cloud project number.
3. Press Connect Google Drive and grant the requested Drive permission in Google's consent dialog.
4. Press Choose Drive folder and select the existing private folder.
5. Confirm the folder name shown on the page, then press Run synthetic read/write check.
6. The page writes a uniquely named synthetic JSON file under that folder, reads it back, and verifies the contents. It then asks before deleting that file. If deletion is declined or fails, the page identifies the remaining synthetic file.

A PASS confirms the tested account can create, read, and (after explicit confirmation) delete an app-created file in the selected folder. It does not establish conflict safety, backup recovery, production ledger correctness, or cross-device synchronization.

## Offline checks

Run the dependency-free synthetic tests with:

    node --test tests/drive-probe-core.test.mjs

These mock Drive responses and verify request order, parent folder selection, exact synthetic read-back, delete confirmation, and cleanup failure reporting. They do not replace the live check above.

## Primary Google references

- [Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Picker and folder selection](https://developers.google.com/drive/picker/guides/overview)
- [Google Identity Services for web](https://developers.google.com/identity/oauth2/web/guides/overview)
- [Create and populate Drive folders](https://developers.google.com/workspace/drive/api/guides/folder)
