# Galamtor 1.5.0 — Public Preview

Bookmarks can now be added, searched by title/URL and edited from the panel or by right-clicking the favorites bar. Changes keep the bookmark's identity, canonicalize addresses and reject collisions. Failed disk writes show a recoverable error instead of a success message; rapid star clicks cannot race each other.

Google sign-in no longer restores a stuck pending spinner after reopening the app. An abandoned or empty redirect stays manual, a new request replaces an old one, and sign-in can be cancelled. The chooser opens after the callback server is ready. Missing SDK/network/storage conditions show recovery guidance. Account identities and callback payloads are excluded from diagnostics; Firebase production configuration is unchanged.

The exchange widget now refreshes with Enter/Space as well as a click, displays loading/empty/error states, and retains the source date. Wallpaper presets are keyboard buttons. Page search works with Electron 44; closing the workspace before its opening animation cannot reopen it. Companion name editing supports clearing the field, the studio opens at its header, human skin tones are preserved, and OS reduced-motion preferences remain respected.

Existing tab search (Cmd/Ctrl+K), closed-tab recovery (Cmd/Ctrl+Shift+T), lazy session restoration, widget preferences and companion customization were regression-tested across full app restarts. Private tabs stay out of saved sessions and history.

Unsigned macOS previews check official GitHub release metadata and offer manual installation. Native automatic installation is disabled for this preview. The website tolerates blocked/corrupt storage, validates official download links, and describes the update steps.

## Verification

84 automated logic tests, 17 Electron runtime scenarios and 6 website/auth scenarios pass. Syntax/asset checks and the production dependency audit pass (0 reported production vulnerabilities). macOS ARM64 and Intel DMG/ZIP packages and their SHA-256 checksums are supplied. See `QA_REPORT-1.5.0.md` for evidence and limits.

## Install or update

This is an unsigned public preview, without Developer ID signing or Apple notarization. Quit Galamtor, download the DMG matching Apple Silicon (arm64) or Intel (x64), and replace Galamtor in Applications. Your profile is retained. macOS may require opening the verified official download through Privacy & Security's Open Anyway option. Check SHA-256 against the supplied checksum file.

Real-account Google/Firebase OAuth, paid/cloud AI requests and Windows installation are not certified by this release's QA. Provider edge cases use deterministic fixtures; the actual Google Lens picker and public-image results were also checked. The Intel app passed its runtime scenarios under Rosetta; physical Intel hardware is not tested. Build tooling has 8 moderate transitive audit findings with no upstream sprintf-js fix available; those tools are excluded from the shipped app.
