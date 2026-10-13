# Galamtor 1.3.5 — QA report

Date: 2026-10-13

## Automated checks

- `npm test`: 71 passed, 0 failed.
- `npm run check`: syntax checks and Firebase asset build passed.
- `npm audit --omit=dev --audit-level=moderate`: 0 production vulnerabilities reported.
- `git diff --check`: passed.
- `npm run pack -- --publish never`: succeeded for ARM64 and Intel, creating DMG and ZIP packages for both architectures.
- The packaged ARM64 app reports version 1.3.5 and includes `pet-companion.js`, `chatgpt-plan.js`, and `jose`.

## Manual checks

- Opened the packaged macOS ARM64 app and its companion studio.
- Changed companion, name, color, accessory and temperament; the preview and selected states updated.
- Played the greeting animation and verified its status message.
- In an isolated development profile, verified random appearance, reset to defaults, Escape dismissal and handoff from the studio to AI chat.
- Inspected the AI settings in an isolated profile: provider choices include Ollama, ChatGPT plan, Gemini and auto; no account was connected and no real OAuth grant or plan request was made.
- Checked the studio's layout, focus state, labels and reduced-motion styling in code.

The first packaged-app run restored the existing browser session because `--user-data-dir` did not redirect Galamtor's separate main-process profile files. I stopped that approach, completed the remaining UI checks in a development run with `GALAMTOR_DEV_PROFILE` set to a temporary directory, and did not intentionally change history or bookmarks. The session file and its recovery copy currently match byte-for-byte.

Windows was not built or manually tested. Every widget style and every browser navigation path were not re-tested in this release. A real ChatGPT account flow was intentionally left for the user to complete so account credentials and consent stay with the account owner.

## Release limitation

The local macOS packages are unsigned and not notarized: no valid Developer ID Application identity is available on this Mac. These packages are for local evaluation. The public site keeps its download on the last published stable release (v1.0.2) until signing and notarization are configured.
