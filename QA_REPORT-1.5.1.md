# QA — Galamtor 1.5.1

Final release gates passed on 14 October 2026. This report covers the inspected and tested scope, not a claim that every browser/provider condition is bug-free.

| Check | Result |
| --- | --- |
| `npm test` | 102 passed, 0 failed/skipped |
| Syntax and Firebase asset build | Passed; final renderer syntax checked after wording change |
| `npm audit --omit=dev --audit-level=moderate` | 0 reported production vulnerabilities |
| ARM64 packaged Electron regression | 17 scenarios passed; no renderer exceptions |
| ARM64 packaged backend | 8 scenarios passed; actual loopback HTTP + IPC |
| Intel/x64 packaged Electron regression under Rosetta | 17 scenarios passed; no renderer exceptions |
| Intel/x64 packaged backend under Rosetta | 8 scenarios passed; actual loopback HTTP + IPC |
| Website/auth in Electron | 12 scenarios passed; no page errors |
| Website/auth in WebKit | Same 12 scenarios passed; no page errors |
| Real Firebase 13.0.0/Google popup smoke | Google's empty sign-in form opened in a fresh WebKit context; no account entered/selected |
| Final macOS packaging | ARM64 + x64 DMG/ZIP produced; explicit unsigned preview |
| Archive integrity | Both DMGs verified by hdiutil; both ZIPs verified by unzip |
| Packaged/source consistency | 25 source/asset files match for each architecture; version 1.5.1 and unsigned-preview metadata match |

Backend cases use the actual app main process and trusted preload bridge: origin/state/empty-credential rejection, Firebase rejection, positive acknowledgment while Firestore is offline, cloud retry, logout, cancellation during credential exchange with a late result, failed settings/history/download/session writes, and denial of a second untrusted window's IPC. Only the provider and file-failure boundaries are controlled fixtures.

Core regression covers tabs, back/forward/reload/stop/retry, duplicate/close/restore, current-page save/print dispatch, menus/sidebar, bookmark create/open/edit/collision/delete and disk failure, widget controls, Lens no-result/error/retry, companions and reduced motion, app reopen/session persistence and private-tab exclusion, and preview update checks. Native desktop layouts: 800, 1024 and 1360 pixels. Website: 390, 768 and 1360; auth helper: 320, 390 and 800. Representative screenshots were inspected.

Results and screenshots are in `dist/qa-1.5.1/`. ARM evidence: `runtime-arm64.json`, `backend-arm64.json`; x64: `runtime-results.json`, `backend-results.json`; web evidence is separated into `electron/` and `webkit/`. The packaged runner asserts its disposable userData path and uses `--galamtor-qa`. No production browser profile, real account credential, or paid AI call is used. Credentials in failure/success cases are synthetic; the external helper uses Firebase in-memory persistence. Production Firebase project/provider/authDomain and Firestore rules were not changed.

The full development audit reports 8 moderate toolchain findings, with no high/critical findings. All eight affected tool packages are absent from both shipped app archives. No forced builder downgrade was applied. The bundled Firebase SDK is included in the full dependency audit; it has no reported finding in that audit.

## Limits

Real-account Google/Firebase completion, account token refresh, native Keychain integration, live Firestore writes and paid/cloud AI are not certified. The real-provider smoke ends before account entry. Physical Intel hardware and Windows installation are not tested. Sign-in and cloud-write error boundaries use deterministic fixtures. Cloud synchronization currently saves profile statistics, not all local browser data across devices.

No Developer ID signing identity is available. These macOS packages are unsigned and not Apple-notarized. Install by replacing the app through the matching DMG; update checks offer official manual installation. Existing profiles are retained.

## SHA-256

```text
3a912292f748f3f8d704119502e03cf21be15bea8d57c6831ac92cdb9c78c0ea  Galamtor-1.5.1-arm64.dmg
8a740e2a21bb2773af6965c7562532c30c4eb5146e634e481e15cc0898133063  Galamtor-1.5.1.dmg
3a234a389e16af8580a2998e03f3bfcfa5c6d53762035364a7ec982edd7f24d1  Galamtor-1.5.1-arm64-mac.zip
7a7dd56906b50aaac1cd703d1370cde9cbcc1fc24d3298671c7ba8e13cb1a32e  Galamtor-1.5.1-mac.zip
```
