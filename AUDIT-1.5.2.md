# Google sign-in audit — 1.5.2

Baseline: clean 1.5.1 source at `62d8c4e`; public GitHub release and installed app also 1.5.1. No user profile was used for QA. Firebase production configuration, provider, authDomain and Firestore rules are unchanged.

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | A successful Firebase compat popup returns `result.credential`, while the modular `GoogleAuthProvider.credentialFromResult(result)` needs `_tokenResponse`. The helper threw its own `auth/invalid-credential` before contacting the app. | Read the compat credential first and validate the Google provider and bounded token fields. Distinguish a missing result from a provider rejection. |
| P1 | Safari/WebKit blocks HTTPS helper fetches to HTTP loopback as mixed content, including cancellation. Previous website fixtures ran from HTTP and missed this boundary. | Explicitly open a nonce-protected local window. Validate message origin, exact opener/source and nonce; transfer tokens only in memory through `postMessage`, then use same-origin loopback JSON. Require the desktop Firebase acknowledgment before confirming. |
| P1 | Closing or failing the local confirmation window could leave the helper loading. | Detect closure, enforce setup/confirmation deadlines, preserve explicit retry and cancellation, and explain cancellation after an already completed sign-in. |
| P1 | Desktop Firebase used default disk persistence, which includes an unencrypted refresh token. | Use Firebase in-memory persistence and await its setup before any credential exchange. Failed/cancelled setup cannot dispatch authentication. Sign-in must be repeated after a full restart; the profile explains this. |

Evidence: the actual Firebase 13.0.0 SDK returns null for the old extractor given a genuine SDK OAuthCredential in a compat-shaped result. A realistic compat fixture made the pre-fix WebKit regression fail. New tests cover the actual CDN SDK with real HTTPS-to-local-window transport; only provider outcomes and desktop acknowledgment are controlled fixtures. Desktop tests separately exercise actual trusted IPC and main-process confirmation in disposable profiles.

The local server binds only to `127.0.0.1`, requires the exact Host header and a fresh nonce, refuses unapproved/null origins, bounds bodies/tokens, and protects local documents with no-store, no-referrer and frame/CSP restrictions. Account data and tokens are excluded from URLs, diagnostic output and reports. No paid service was added.

Primary references: [Firebase Google sign-in (compat and modular examples)](https://firebase.google.com/docs/auth/web/google-signin), [WebKit's loopback mixed-content issue](https://bugs.webkit.org/show_bug.cgi?id=171934). Implementation was verified locally; real-account completion remains a separate unperformed check.

See [QA_REPORT-1.5.2.md](QA_REPORT-1.5.2.md) for release gates and limitations.
