# Galamtor 1.5.3 — Secure sign-in choice and macOS warning guide

Google sign-in can now be remembered on this device with an opt-in setting in Workspace → Profile. When enabled, Firebase persistence is encrypted through Electron safeStorage and the operating system's secure storage; when disabled, sign-in stays in memory and stored credentials are removed. The default remains off. If secure storage is unavailable, the browser falls back to memory-only sign-in.

The download page now includes the exact macOS “Galamtor is damaged and can’t be opened” screenshot and a safe recovery guide. It directs users to cancel, verify the official release's SHA-256, and use the web app if the warning remains. It does not advise disabling Gatekeeper or running an automatic bypass. The release is clearly marked as an unsigned preview without Developer ID or Apple notarization. If GitHub's release API is unavailable, the page keeps the verified 1.5.3 Mac downloads and SHA-256 values available from its local fallback.

Fixed the Firebase compat persistence bootstrap so the secure adapter is registered through the same SDK instance as Firebase Compat. Also fixed an early-load date widget initialization error.

No Firebase project, provider, authDomain, Firestore rules, paid service, or production account was changed or used.

## Installation

Unsigned macOS 13+ preview. Quit Galamtor, download the ARM64 or Intel DMG from the official GitHub release, compare its SHA-256 with `SHA256SUMS-1.5.3.txt`, then replace Galamtor in Applications. Existing browser profiles remain in place. Use the screenshot guide on [galamtor.web.app](https://galamtor.web.app) if macOS shows the damaged-app warning. Do not bypass that warning when it persists.

## SHA-256

```text
7569316382dc36c889043b7f117ef9759e677d839efa41c160b74e68dd6152c8  Galamtor-1.5.3-arm64.dmg
800c0ff6ee106014cf7b8c353c4e22d86ddb1ef54d94ff88ba6e9cb47fb85c3b  Galamtor-1.5.3.dmg
7666c2d5ac188f13318cc9e5678d3c6a041be901632c25f8db33db62ea732f60  Galamtor-1.5.3-arm64-mac.zip
40df9f91c06377561d997c5451c8e9fb9b4544fa23684f347ad178dd6103bf79  Galamtor-1.5.3-mac.zip
```

## Verification scope

The exact results and limits are in [QA_REPORT-1.5.3.md](QA_REPORT-1.5.3.md). No real Google account or production browser profile was used. Actual Google/Firebase account completion and token refresh remain unverified.
