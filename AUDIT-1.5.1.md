# Backend audit — 1.5.1

Baseline: clean `codex/global-update-1.5.0` at `62a772d`; local/public version 1.5.0. User profile excluded from QA. No AGENTS.md found in the repository or its ancestors. Work continues on `codex/backend-stability-1.5.1`.

| Priority | Finding | Change |
| --- | --- | --- |
| P1 | External auth page uses `web.app` with a different Firebase `authDomain`. The reported empty redirect result is consistent with Safari's documented cross-origin storage restrictions. | Explicit user-gesture popup; no automatic redirect. Production project, authDomain and Google provider remain unchanged. |
| P1 | Loopback replied success before the app accepted the Firebase credential. | Correlated request ID + trusted-frame acknowledgment. Rejection/cancellation/timeout cannot return success. Legacy app receipts are labelled as receipts, not confirmed sign-in. |
| P1 | Credential sign-in had no bounded lifetime after the chooser returned; cancelled late credentials could still connect. | Auth session controller, chooser/credential deadlines, generation checks and restoration of the last accepted session after late results. |
| P1 | Awaiting an offline Firestore write delayed profile rendering after sign-in. | Immediate authentication UI; independent bounded write queue, coalesced snapshots, visible error and tested manual retry. |
| P2 | AdBlock changed live state before a failed settings write; download-history and menu history clearing could display false success. | Commit settings before changing live state; check mutation results in each affected UI. |
| P2 | Session-save failure was ignored; an unreadable primary could be replaced using fallback data. | One visible warning with recovery, and atomic storage rejects unexpected primary-read errors. |
| P2 | Auth listeners could outlive a closed/crashed main window. | Close the loopback and pending acknowledgment when the main window closes or its renderer exits. |

Backend map: `index.js` owns trusted-frame IPC, session/history/bookmark/download/settings persistence and browser sessions; `profile-storage.js` owns atomic JSON writes/recovery; `auth-server.js` owns bounded loopback HTTP and strict state/origin/host checks; `auth-session.js` owns credential lifecycle; `public/auth-page.js` owns the external popup/helper UI; `public/async-operations.js` owns deadlines and profile-write coalescing. Existing tab/navigation/Lens/widget/companion controllers remain covered by the runtime regression suite.

No confirmed P0 was found within the inspected scope. This audit does not certify every possible browser operation or provider condition. Cloud synchronization currently writes profile statistics; it does not claim cross-device synchronization of all local browser data.

Primary reference: [Firebase redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices), especially the cross-origin storage explanation and popup alternative. The diagnosis is an inference from the reported behavior and observed configuration, not a captured production OAuth trace.

Release validation and limitations: [QA_REPORT-1.5.1.md](QA_REPORT-1.5.1.md).
