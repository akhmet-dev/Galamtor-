# Galamtor 1.5.2 — Google Sign-in Repair Preview

Fixes the auth helper discarding Google credentials returned by Firebase's compat SDK and incorrectly displaying `auth/invalid-credential`. Compat and modular result formats are tested using the real Firebase SDK. A missing credential now has a separate diagnostic from a genuine Firebase rejection.

Safari users can finish sign-in through an explicit local Galamtor window when the browser blocks HTTPS-to-loopback fetch. The Google token travels only in memory, with origin/source/nonce checks; no credential is placed in a URL or diagnostic log. The helper confirms success only after the desktop Firebase acknowledgment. Closing the window, rejection, cancellation and timeout recover visibly.

Firebase project/provider/authDomain and Firestore rules are unchanged. No paid services or production-profile QA were used.

Desktop Firebase credentials now stay in memory, replacing its default plaintext disk persistence. Credential exchange waits for that setup and fails visibly if it cannot complete. After fully quitting and reopening Galamtor, sign in to Google again. Local tabs, bookmarks, widgets and companion settings remain persisted.

## Installation

Unsigned macOS preview, without Developer ID signing or Apple notarization. Quit Galamtor and replace the app in Applications using the Apple Silicon ARM64 or Intel DMG. Existing profiles are retained. Verify against `SHA256SUMS-1.5.2.txt`. The preview update menu uses official downloads for manual installation.

After installing, close the old sync page, start Google sign-in again in Galamtor, and select your account. If Safari offers “Galamtor-да кіруді аяқтау”, click it and allow that site's popup. The local window must confirm the sign-in; otherwise follow the visible error/retry instructions. Do not send account passwords or tokens to anyone for testing.

## Verification scope

120 logic tests; 17 browser and 9 backend scenarios on both macOS packages; 14 website/auth scenarios in Electron and WebKit; and 9 actual-SDK/HTTPS/loopback cases passed. Syntax, asset build, archive integrity and production audit passed. See `QA_REPORT-1.5.2.md` for details. Real Google/Firebase account completion, token refresh and live Firestore writes are not certified. The actual provider smoke opens Google's empty form; real-SDK transport tests use synthetic Google tokens. Intel runtime checks use Rosetta; physical Intel hardware and Windows installation are untested. These packages are unsigned and not notarized.
