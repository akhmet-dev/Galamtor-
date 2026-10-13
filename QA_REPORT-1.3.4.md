# Galamtor 1.3.4 — QA report

Date: 2026-10-13

## Automated checks

- `npm test`: 49 tests passed, 0 failed.
- `npm run check`: JavaScript syntax checks and Firebase asset build passed.
- `npm audit --omit=dev --audit-level=moderate`: 0 production dependency vulnerabilities reported.
- `git diff --check`: passed.
- `npm run pack -- --publish never`: macOS ARM64 and x64 DMG/ZIP packages built successfully.

## Manual checks

The packaged macOS ARM64 app was launched with a clean, isolated profile. I confirmed:

- The app menu reports version 1.3.4.
- The bookmark bar opens a bookmarked site; Command-click opens it in another tab.
- The browser menu and start-page shortcuts open History and Bookmarks, and the panels show the expected records.
- The Focus preset hides the optional homepage widgets while leaving the clock and search available.
- The start page, homepage controls and widget settings open in the packaged app.

The installed 1.3.3 profile was kept separate during this QA run. Windows was not built or manually tested. I did not manually verify every widget-style variant, so those CSS improvements should receive a visual pass on the installed machine after update.

## Release limitation

The local macOS build is unsigned and not notarized: this Mac has no valid Developer ID Application signing identity. The packages are suitable for local evaluation, but should not be advertised as a public stable macOS release or used for automatic updates until signing and notarization are configured. The website download continues to point to the latest published stable release.
