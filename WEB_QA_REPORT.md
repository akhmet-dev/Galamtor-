# Galamtor Web QA — 2026-10-14

Scope: new `/app/` hosted web interface, landing-page entries, browser-local workspace storage, Firebase web auth, encrypted opt-in auth persistence, directory-index preview routing. Desktop version remains 1.5.3; existing desktop binaries are not rebuilt.

## Automated verification

| Check | Result |
| --- | --- |
| `npm run check` / `npm run build:web` | Passed syntax checks and reproducible shared-asset build |
| `npm test` | 149 passed; zero failed/skipped |
| `npm run test:web-app` | 23 interaction suites passed in isolated Chromium (Electron BrowserWindow fallback) |
| `GALAMTOR_QA_WEB_ENGINE=webkit npm run test:web-app` | 23 interaction suites passed in isolated WebKit |
| `npm run test:web` | 16 existing website/auth-helper checks passed in Chromium |
| `GALAMTOR_QA_WEB_ENGINE=webkit npm run test:web` | 16 existing website/auth-helper checks passed in WebKit |
| `npm audit --omit=dev --audit-level=moderate` | Zero production dependency vulnerabilities |

Web-app suites click the actual controls and cover native external popups, home/menu/sidebar, tab creation/close/restore, favorites CRUD/filter/duplicate validation, profile and vibes, command keyboard selection, wallpaper/widget/session/Reduce Motion/pet persistence, JSON import/export, history clearing, Lens validation, currency loading/empty/error/retry, blocked storage, corrupt-state preservation, and safe user-triggered reset. The JSON export is checked while synthetic Google auth is active to exclude session credentials. A failed JSON replacement preserves the previous profile.

Layout was checked at **320, 390, 768, 1360 and 1920 CSS pixels**, including Workspace/settings/menu. No horizontal overflow, renderer exceptions, unexpected loopback requests, iframe, or Electron webview were observed. Mobile pet controls reside in the sidebar to avoid covering widget values. QA uses temporary profiles and synthetic provider/currency responses; no private production profile is loaded.

## Actual SDK/provider checks

Bundled Firebase **13.0.0** initialized in a fresh WebKit context. Real IndexedDB stores a nonexportable AES-GCM key and encrypted synthetic auth data, restores it after reload, and clears auth values when remember is disabled. The web app on the production HTTPS origin was supplied from local candidate assets, while Firebase and Google network helpers remained real. A direct UI click opened `accounts.google.com` with an empty sign-in form. UI cancellation and real-SDK remember on/off succeeded; zero CSP violations/page errors.

Completed Google account login, live refresh-token rotation and live Firestore writes were **not tested**. No account was entered or selected. These paths have synthetic SDK/state-machine tests, including cancellation/late results, sign-out failure/retry and sequential latest-snapshot writes. Physical mobile hardware and separate Chrome/Safari applications were not tested; engine-based interaction/layout tests were used.

## Hosting

Deployment target: existing Firebase project `galamtor-browser-974cc`, `hosting:galamtor` only. Authentication project/provider configuration and Firestore rules remain unchanged. `/app/**` revalidates cached assets to avoid retaining old UI after a deploy.

Deployment verification will be recorded after publication.

## Limits

External website navigation belongs to the user's native browser. The app restores managed link cards, not native browser tabs or cross-origin page content. Desktop AI/AdBlock/native-download/PIP/biometric/banking features are not presented as active web controls. Browser-side encryption protects persisted auth JSON from plaintext storage; same-origin executing code can access it, so it is not equivalent to OS Keychain storage. No paid service, signing claim, or Gatekeeper bypass was added.

Artifacts: `dist/qa-1.5.3/web-app-{chromium,webkit}/` and `dist/qa-web-app/webkit/google-public-signin-result.json` (ignored local QA outputs).
