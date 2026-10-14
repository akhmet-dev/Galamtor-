# QA — Galamtor 1.5.2

Final release gates passed on 14 October 2026. Results certify the tested scope, not every provider/account condition.

| Check | Result |
| --- | --- |
| Unit tests | 120 passed, no failures/skips |
| Syntax and Firebase asset build | Passed |
| Production dependency audit | 0 vulnerabilities |
| Source Electron core regression | 17 passed |
| Website/auth in Electron and WebKit | 14 passed in each engine, no unexpected page errors |
| Actual CDN Firebase SDK / HTTPS helper / loopback transport | 9 scenarios passed; provider outcomes and acknowledgment are synthetic |
| Final ARM64/Intel packaging and packaged runtime QA | ARM64 and x64 DMG/ZIP built; 17 core + 9 backend scenarios passed on each architecture |
| Archive integrity, source consistency, SHA-256 | Both DMG/ZIP pairs verified; 28 shipped source/asset files match for each architecture; checksums below |

The real-SDK regressions cover the original compat/modular mismatch; both Google tokens, access-only and ID-only results; missing result/retry; cancellation before completion; rejected desktop acknowledgment; cancellation during confirmation; and closing the local window. WebKit's blocked direct fetches are expected negative transport observations; the local-window path must complete successfully, with no unexpected script errors. Local-window layouts are checked at 320, 520 and 800 pixels. Website/auth tests cover HTTP fixture cases independently.

Security tests reject incorrect message origin, source window and nonce, malformed or oversized credentials, wrong/null HTTP origin and Host, duplicate dispatch, and a malformed HTTP target. Only validated Google token fields cross the loopback; no Firebase user token is substituted for a Google OAuth credential. The server binds to loopback, applies no-store/referrer/CSP/frame protections, and requires a fresh session nonce.

All QA uses disposable profiles/contexts. No real account, production browser profile or paid AI service is used. Firebase production project/provider/authDomain and Firestore rules are unchanged.

Desktop authentication uses Firebase in-memory persistence; packaged backend QA asserts the effective SDK persistence type is `NONE`. Unit tests cover pending/failed/cancelled persistence setup before credential exchange. A full app restart requires signing in again; local browser data still persists.

## Limits

Real-account Google/Firebase completion, account refresh, native Keychain integration, live Firestore writes and cloud AI are not certified. The provider smoke ends before account entry. Physical Intel hardware and Windows installation are not tested. The existing cloud sync saves profile statistics, not every browser record across devices.

No Developer ID signature or Apple notarization is provided. The app is an unsigned preview and updates by manual replacement through the official DMG. Existing profiles are retained.

Results: `dist/qa-1.5.2/`, with separate ARM64/x64 runtime and backend JSON, Electron/WebKit website results and `auth-hotfix/real-sdk-local.json`. Google provider smoke opened its empty official form with the real SDK, without account selection. The nine real-SDK transport cases use actual HTTPS and loopback HTTP, with synthetic provider results and desktop acknowledgment. The expected blocked HTTPS fetches are recorded; they are handled by the local-window fallback.

The development audit reports 8 moderate toolchain findings, no high/critical findings. All eight affected tool packages are absent from both application archives; the bundled Firebase SDK has no reported finding in that audit. Production dependency audit: zero reported vulnerabilities. No forced dependency downgrade was applied.

## SHA-256

```text
761c62dd72ed797f4b6dba1f2f94fd84ca5adde8f2f35e5cb2857d58bf53b451  Galamtor-1.5.2-arm64.dmg
0517468ddaa90223ec09f6def0fa4089369702f3182e83bd0f0e41a0aa3dabc2  Galamtor-1.5.2.dmg
53c94847337c0412c7a468471934e1c4470aa64a3d346e343ecbc5c392b1190c  Galamtor-1.5.2-arm64-mac.zip
ffcece790f48fa6e5cfd86e4d5c5986018473b35f3b4ad4e4c79ddcd6f627a96  Galamtor-1.5.2-mac.zip
```
