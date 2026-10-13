# Galamtor 1.5.0 audit

Date: 2026-10-13 (Asia/Almaty). Baseline: local package and public GitHub release v1.4.0. Working tree was clean; no applicable AGENTS.md was found in the repository or its parent directories. Existing profiles are excluded from QA.

## Structure

| Surface | Implementation | Persistence / boundary |
| --- | --- | --- |
| Start page, sidebar, browser menu | index.html, renderer.js, browser-controls.js, style.css | Local appearance preferences; shared action dispatcher and native menu |
| Tabs, navigation, recovery, search | renderer.js, index.js, browser-state.js, url-utils.js | Atomic session.json; private tabs excluded; lazy background restoration; Cmd/Ctrl+K and Shift+Cmd/Ctrl+T already exist |
| Bookmarks / top favorites | renderer.js, preload.js, index.js | Atomic bookmarks.json; validation in browser-state.js |
| Clock, exchange, prayer, source widgets | renderer.js, index.html | LocalStorage visibility/layout; exchange API, official prayer link, curated source links |
| Galamtor Lens | renderer.js, lens-utils.js | Official Google Lens handoff; only public HTTPS image URLs sent directly; local images use Google's own picker |
| Google sign-in | public/auth.html, public/auth-flow.js, renderer.js, index.js, auth-utils.js | Explicit redirect request, CSRF state, loopback callback; existing Firebase production configuration |
| Companion studio | pet-companion.js, renderer.js, style.css | Validated local profile; five bundled SVG companions; OS reduced-motion styles |
| Website, downloads, updates | public/, firebase.json, electron-updater | GitHub release metadata and assets; Firebase Hosting; unsigned public preview |

## Priorities established by source audit

No confirmed P0 defect at baseline. This is a scoped audit, not a guarantee that none exist.

| Priority | Finding | Release action |
| --- | --- | --- |
| P1 | No bookmark title/URL editing; delete panel claims success without checking disk write | Add accessible add/edit form, checked mutations, errors and retry; refresh all bookmark surfaces |
| P1 | Default bookmark URLs and saved URLs differ by canonical slash; rapid async toggles can race | Canonicalize mutations, keep stable IDs, reject URL collisions, serialize UI mutation attempts |
| P1 | Redirect state can be confused with an earlier attempt; reloading the same login URL can start another chooser | Keep failed attempts manual, prioritize a new explicit state, handle unavailable browser storage |
| P1 | Successful sign-in writes the account email to renderer diagnostics | Remove identity logging and unnecessary callback identity fields |
| P1 | Unsigned macOS preview uses the native auto-install path intended for signed apps | Check release metadata and offer manual official release download for this preview |
| P2 | Clickable currency div has no keyboard interaction or loading/error feedback | Keyboard-operable refresh button with checked result and busy feedback |
| P2 | Bookmark rows are pointer-only divs; narrow menus and panels need QA | Semantic buttons, focus restoration, responsive layouts and runtime verification |

## Scope decisions

Keep the existing tab search, shortcuts and session recovery rather than duplicate them. Add bookmark search and complete editing because these close concrete gaps. Lens remains an honest handoff to Google, not a fabricated local recognition API. No paid service, production profile, Firebase auth domain/provider or Firestore rule changes are required. Release is conditional on regression, runtime, build and production dependency checks; external provider limitations are recorded separately.

## Final disposition

The listed P1/P2 issues are addressed and regression-tested in 1.5.0. Runtime QA additionally found and fixed Electron 44 page-find session semantics, a workspace opening-frame/closing race, missing auth-SDK recovery, and companion name clearing/skin-tone/focus issues. Page-find API behavior was checked against the [official Electron webview documentation](https://www.electronjs.org/docs/latest/api/webview-tag#webviewfindinpagetext-options).

The release gates and provider/platform limitations are recorded in QA_REPORT-1.5.0.md. Build-only QA tooling is excluded from the app, and no authenticated production profile was needed for verification.
