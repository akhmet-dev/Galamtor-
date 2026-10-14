# Security audit — Galamtor 1.5.3

The desktop's Google sign-in persistence is off by default. When opted in, Firebase Auth persistence keys are accepted only through validated, bounded IPC and encrypted as a whole with Electron safeStorage before atomic disk writes. No plaintext fallback is allowed; the volatile adapter keeps sessions in memory when encryption is unavailable. Turning the option off migrates the SDK session to memory and removes the encrypted store. The QA profile used only synthetic values and verified that the file contained no fixture token and could be read after restarting the app.

The persistence adapter is registered through the Firebase Compat auth provider's initialization path, so Auth and Firestore keep one SDK instance. The renderer cannot select arbitrary file paths or call Electron safeStorage directly. The IPC handlers require the trusted main-frame sender. The existing loopback OAuth receiver still accepts bounded Google token fields only, verifies origin, host and one-time state, and keeps token material out of logs and URLs.

The macOS screenshot guide distinguishes the “app is damaged” alert from the separate unidentified-developer warning. It recommends verifying the official download against SHA-256, avoids Gatekeeper bypass commands, and points to the web app if the damaged-app warning remains. The macOS package is unsigned and not notarized because Developer ID credentials are unavailable.

`npm audit --omit=dev --audit-level=moderate` reported zero production dependency vulnerabilities. The full dependency audit reports eight moderate findings in build-only transitive packages (`sprintf-js`, `roarr`, `global-agent`, `@electron/get`, and `electron-builder` chain); no automatic or forced dependency downgrade was applied. These tools are excluded from shipped application files.

Firebase project/provider/authDomain and Firestore rules are unchanged. No paid service or real account was used in QA. Real-account Firebase completion and refresh-token rotation are outside the tested scope.
