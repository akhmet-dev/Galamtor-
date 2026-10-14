# Galamtor 1.5.1 — Backend Stability Preview

Google sign-in now starts from an explicit popup button in the external browser, avoiding the cross-origin redirect storage path that can lose results in Safari. Popup blocking/closing, missing SDK, network errors, cancellation and retry have visible recovery paths. Firebase production configuration has not changed.

The helper waits for the desktop app to confirm Firebase authentication before reporting success. Older app receipts are clearly distinguished from confirmation. The loopback validates origin, host, state and bounded request bodies, rejects duplicate dispatch, and expires abandoned requests. Sign-in can be cancelled, credential requests have a deadline, and late results cannot silently replace the accepted account.

Offline cloud writes no longer hold the Workspace UI or logout. Profile-statistics writes coalesce waiting snapshots, show errors, and support manual retry. Failed AdBlock, history, download-history and session writes do not report success; unreadable profile files are preserved instead of overwritten with fallback data.

The existing tab/navigation/bookmark/widget/Lens/companion behavior remains covered by the regression suite. No paid services were added.

## Installation

Unsigned macOS public preview: no Developer ID signing or Apple notarization. Quit Galamtor, use the ARM64 DMG for Apple Silicon or the Intel DMG for x64, and replace Galamtor in Applications. The existing profile is retained. Compare SHA-256 against `SHA256SUMS-1.5.1.txt`. This preview uses manual installation; the update menu checks official GitHub metadata.

## Verification limits

102 logic tests, 17 browser and 8 backend scenarios on both macOS packages, and 12 website/auth scenarios in Electron and WebKit passed. Syntax/assets, archive integrity and the production audit passed. See `QA_REPORT-1.5.1.md` for exact results. Provider failure/success cases use synthetic credentials in disposable profiles. The real Firebase SDK opens Google's empty sign-in form in a fresh WebKit session, but a real-account Google/Firebase sign-in is not certified. Cloud AI, physical Intel hardware and Windows installation are not certified. Intel runtime checks use Rosetta. Development-tool audit findings are excluded from the shipped app.
