# Galamtor 1.5.0 — QA report

Date: 2026-10-13 (Asia/Almaty). Baseline verified against the public v1.4.0 release and local package. The initial Git working tree was clean. Development and packaged tests use disposable, isolated profiles; production user profiles were not used.

## Automated gates

| Check | Result |
| --- | --- |
| `npm test` | 84 passed, 0 failed |
| `npm run check` | All JavaScript syntax checks and Firebase client asset build passed |
| `npm run test:ui` | 17 named runtime scenarios; real Electron/webviews and IPC; no renderer exceptions |
| `npm run test:web` | 6 website/auth scenarios; no renderer exceptions |
| Packaged ARM64 `test:ui` | Same 17 scenarios passed using `--galamtor-qa`; verified separate userData path |
| Packaged x64 `test:ui` under Rosetta | 17 scenarios passed; physical Intel hardware remains untested |
| `npm audit --omit=dev --audit-level=moderate` | 0 reported production vulnerabilities |
| `git diff --check` | Passed |
| `npm run pack -- --publish never` | ARM64 and x64 DMG/ZIP builds completed |
| Bundle metadata and executable architecture | Both versions are 1.5.0; Mach-O arm64 and x86_64 respectively |
| Packaged module inspection | Bookmark and release modules present; Playwright and electron-builder absent |
| `hdiutil verify` and `unzip -tq` | Both DMG checksums and both ZIP archives valid |

## Runtime coverage

- Main-menu actions, native-menu dispatch, initial disabled states, new/duplicate/private tabs, close and reopen, last-tab automatic home replacement. Private closures are excluded from recovery.
- Actual local fixture documents exercise back/forward/reload, loading/stop, network error and retry while retaining the requested address. Page search covers matches, previous/next and no matches; HTMLComplete saving writes a real file to the test directory. Print dispatch is automated; the native macOS Print dialog was opened and cancelled manually.
- Every initial top favorite and sidebar site button is clicked. Bookmark star double-click, canonical URL mutations, ID-preserving title/URL edits, URL collision rejection, search/no matches, create/delete and bar context editor are covered. A main-process disk-write fault verifies that old data remains and a failure message appears; retry succeeds after restoring disk access.
- All four widget toggles, focus/daily/full modes, wallpaper selection, source-card rotation/opening, official prayer link and currency keyboard interaction are exercised. Currency fixtures cover loading, empty response, stale cached data after failure and successful retry.
- Lens fixtures cover invalid/empty/local image URLs, official handoff, provider no-results page, navigation failure and retry. These are controlled provider states, not a claim about every possible Google response. The real Google picker and results for the publicly hosted Galamtor icon were also verified in a fresh profile, without sign-in or local-image upload.
- Google launch requests are deduplicated, cancellation releases the pending UI, and manual retry launches once. A full app reopen with a seeded obsolete `connecting` state restores a usable login button. Auth-page fixtures cover missing SDK, empty redirect/repeated reload, manual retry, network error and successful callback; callback identity fields are absent and state is cleared. Unit tests cover callback bounds and state validation.
- All five companions, name clearing/typing, colors, accessories, temperament, random/reset/demo and thinking/speaking/idle states are exercised. Reduced motion removes SVG animation. Companion settings survive a full application close/reopen.
- Normal tabs, order, active home and muted state survive reopening; private tabs are absent. Widget visibility, wallpaper and companion preferences are restored. Existing Cmd/Ctrl+K and closed-tab recovery remain functional.
- Website release loading tolerates corrupt or blocked storage and API errors while retaining the official fallback link. Metadata/download URLs are restricted to the official repository; ARM64/Intel labels are visible and internal update files are omitted.

## Manual and visual verification

- Native CUA clicks verified menu opening, bookmark validation/add/search/edit/delete and visible bar/list updates. Physical Cmd+T, Cmd+W, Cmd+Shift+T and Cmd+L behavior was checked. The packaged menu reports 1.5.0. A test-only copy with a distinct bundle identifier avoided conflating QA with the user's running installed app.
- Desktop screenshots reviewed at 1360×900, 1024×768 and the supported minimum 800×600 CSS window size. Bookmark panel scrolls, editor fits, and companion studio stays within the viewport. Studio opens at its header; SVG human skin tones are preserved.
- Website layouts checked at 390, 768 and 1360 pixels, including navigation to downloads and horizontal-overflow assertions.
- Screenshot and JSON artifacts are generated under `dist/qa-1.5.0/`; test scripts are committed for reproduction. Screenshots contain only test data.

## Security and boundaries

- No Developer ID Application identity was available. Signing was explicitly skipped. These packages are unsigned and not notarized; the release and website explain Gatekeeper and manual updates. The unsigned preview does not enter native automatic installation.
- Firebase project ID, auth domain/provider configuration and Firestore rules were not changed. Only Hosting content is updated.
- No password/token is stored by the new features. Account email and malformed callback payload logging were removed; the public callback sends only state and required credential fields. Test credentials are synthetic and are intercepted before any real account service.
- UI automation models secure-storage availability as unavailable to avoid touching the user's OS Keychain. The initial x64 run timed out after opening AI settings; the rerun with this test boundary passed. Native Keychain prompts and real encrypted account sessions are outside UI automation; encrypted credential and plaintext-backend rejection logic is covered by the unit suite.
- No paid service, purchase, subscription or real cloud AI request was made.

## Known limits

- Real-account Google/Firebase OAuth and ChatGPT/Gemini requests are not end-to-end certified; no dedicated account was supplied. Their tested error/retry states use fixtures. Provider behavior and policies can change independently.
- Windows packaging/install is outside this macOS release. The Intel app was run under Rosetta on Apple Silicon; this does not establish behavior on physical Intel hardware.
- An additional full development audit reports 8 moderate transitive findings in the electron-builder logging/download chain (`sprintf-js` advisory GHSA-hp3w-g68c-fv3c). The latest published sprintf-js remains 1.1.3 with no upstream fix available. These development tools are excluded from the app; the production audit passes. No forced builder downgrade was applied.
- PIN lock, the small phishing/ad lists, OS capture protection and third-party services retain the limitations documented in README/privacy. This report does not promise a bug-free browser.

## SHA-256

The distributed `SHA256SUMS-1.5.0.txt` contains:

```text
c78e992d65fa3b3179849b3a3e4307421c1b09f65c0519432bd3351075f2f806  Galamtor-1.5.0-arm64.dmg
ebecd97b685a68d55003d427f04857d0a3e29ed0c480c6f58165b8f820c62e6d  Galamtor-1.5.0.dmg
ea7c1bce4611c08148717774c892a0362f75670ce4f58b5718dad92a13e54b88  Galamtor-1.5.0-arm64-mac.zip
e1d9da38e16c6e93da90237357e118228339257e846bb94bae135fa71eb62003  Galamtor-1.5.0-mac.zip
```
