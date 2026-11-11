# Apple web app UI

The main workspace follows the relevant recipes in Joe Bell's
[apple-web-app skill](https://github.com/joe-bell/skills/tree/main/skills/apple-web-app).
The charcoal/cyan design, document scroll root, mounted editors and explicit-save
workflow stay in place.

## Implementation

- Relative manifest identity, scope and start URL support the GitHub Pages
  `/finance-tracker/` path and local subpath previews. Standalone mode has an
  app title, an opaque 180px Apple touch icon and 192px/512px manifest icons.
- The existing brand arrow is the single SVG source for the PNGs. Run
  `node scripts/generate-app-icons.mjs` with `sharp` available to Node to
  regenerate them. These are development tools, not runtime dependencies.
- Safe-area variables feed additive top/side spacing and bottom navigation
  padding. A zero inset keeps the normal control sizes. The mobile header stays
  visible with a solid page-colored background; the tab bar has its own solid
  background for Safari sampling. Theme metadata retains the existing dark theme.
- `js/workspace-chrome.mjs` measures navigation, header and draft heights with
  `ResizeObserver`. Page padding, scroll padding and the draft's bottom offset
  follow those sizes, including when labels wrap or text grows. CSS provides
  fallback space before observation and when the API is unavailable.
- Touch feedback stays on controls. Pinch zoom and body-text selection remain
  enabled. Pagination and segmented navigation wrap on narrow enlarged layouts.

There is no service worker or offline cache. Installation does not persist
unsaved in-memory drafts across termination. Existing save and recovery rules
still apply. Startup images and install prompts are outside this change.

## Repeatable browser checks

With Playwright available to Node and Chromium installed, serve the repository
under a subpath and run the optional browser check. For a checkout at
`/workspace/finance-tracker`:

```sh
python -m http.server 4173 --bind 127.0.0.1 --directory /workspace
```

In a second terminal:

```sh
node scripts/check-apple-ui.cjs
```

`FINANCE_UI_URL` overrides the app URL and must end in `/`. `CHROMIUM_PATH`
overrides `/usr/bin/chromium`. `FINANCE_UI_SCREENSHOTS` optionally names an
existing output directory. The check blocks external HTTPS and uses only the
local invented preview. It never connects to Google or writes financial storage.

## Evidence, November 11, 2026

**Verified, Node 24.22.1:** the complete extended suite passed 1,999/1,999 tests,
with no failures, skips or cancellations, in 335.845 seconds. Syntax checks,
documentation links and `git diff --check` pass. The sandbox blocked existing
child-process tests with `EPERM`; the full passing run used the outer executor.

**Verified, Chromium on Linux:** 320×568, 390×844, 740×390 and 844×390 landscape,
820×1180 and 1440×900, plus 320×700 with a 200% root font size. Checks pass for
all five primary routes, one visible page, no horizontal document overflow,
phone navigation targets of at least 44×44px, unfinished correction continuity,
staged draft/tab clearance and the last footer control above the draft. The
390px and both landscape cases inject nonzero CSS inset variables to check layout
arithmetic. This does not simulate Apple's inset reporting or keyboard.

**Pass, local asset checks:** anonymous subpath requests serve the manifest and
all PNGs. Image inspection confirms opaque RGB PNGs at 180×180, 192×192 and
512×512, with the page's `#09090b` background. Source inspection confirms
`viewport-fit=cover`, no zoom restriction and selectable body text.

**Unverified:** physical iPhone/iPad Safari and Home Screen cold launch,
status/address-bar sampling, icon selection after reinstall, on-screen keyboard,
pinch gestures, VoiceOver and iPad window controls. These require the target
devices. After a separately authorized deployment, check the source SHA,
re-add the Home Screen app, then check portrait/landscape navigation, focused
editors, enlarged text, selection, zoom and the last control with a staged draft.
No deployment or live Drive test was performed for this UI change.
