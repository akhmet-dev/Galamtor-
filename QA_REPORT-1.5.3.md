# QA — Galamtor 1.5.3

The release gates below were run on 14 October 2026 in disposable profiles. All credentials and user records in tests are synthetic. No account sign-in was performed.

| Check | Result |
| --- | --- |
| Unit tests | 127 passed, no failures or skips |
| Syntax and Firebase asset build | Passed |
| Production dependency audit | 0 vulnerabilities |
| Full dependency audit | 8 moderate findings in build-only toolchain; no forced upgrade applied |
| Core Electron UI | 17 runtime checks passed; no renderer exceptions |
| Electron backend | 10 runtime checks passed, including encrypted opt-in, application restart restore, disable/clear, callback validation and storage failures |
| Website/auth in Electron | 14 checks passed; no unexpected page errors |
| Website/auth in WebKit | 14 checks passed; no unexpected page errors |
| Actual CDN Firebase SDK helper | 9 scenarios passed using synthetic Google credentials and desktop acknowledgments |
| Gatekeeper guide | User screenshot loads; instructions and no-bypass copy verified at 390, 768 and 1360 px; no horizontal overflow |
| GitHub release API fallback | Direct ARM64/Intel DMG and ZIP links plus verified SHA-256 remain available with blocked storage and API failure/older metadata |
| macOS ARM64/Intel builds | DMG and ZIP built; app runtime verified on ARM64 and x64 via Rosetta |
| Packaged app QA | Each architecture passed 17 core UI and 10 backend checks; DMGs and ZIPs passed archive integrity checks |

The opt-in persistence test uses the app's real Electron safeStorage service with a disposable profile, writes a synthetic Firebase-shaped fixture, verifies the fixture is absent from the encrypted file and settings, restarts Galamtor, confirms the secure adapter is selected and reads back the fixture, then turns the setting off and verifies the encrypted file is removed. The fixture is not a real account token.

The real SDK tests exercise actual Firebase 13.0.0 credential extraction and the HTTPS/local-window/loopback flow. The Google provider result and desktop confirmation are controlled test fixtures. Actual account completion, refresh-token rotation and Firestore production writes are not certified.

The macOS preview has no Developer ID signature or Apple notarization. A persistent “app is damaged” Gatekeeper warning has no safe automatic bypass in this unsigned preview; users should use the website guide and the web app if checksum verification does not resolve it. Physical Intel hardware and Windows installation are not tested.

## Artifact checksums

```text
7569316382dc36c889043b7f117ef9759e677d839efa41c160b74e68dd6152c8  Galamtor-1.5.3-arm64.dmg
800c0ff6ee106014cf7b8c353c4e22d86ddb1ef54d94ff88ba6e9cb47fb85c3b  Galamtor-1.5.3.dmg
7666c2d5ac188f13318cc9e5678d3c6a041be901632c25f8db33db62ea732f60  Galamtor-1.5.3-arm64-mac.zip
40df9f91c06377561d997c5451c8e9fb9b4544fa23684f347ad178dd6103bf79  Galamtor-1.5.3-mac.zip
```
