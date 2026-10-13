# Galamtor 1.3.6 — QA report

Date: 2026-10-13

## Automated checks

- `npm test`: 72 passed, 0 failed.
- `npm run check`: syntax checks and Firebase asset build passed.
- `npm audit --omit=dev --audit-level=moderate`: 0 production vulnerabilities reported.
- `git diff --check`: passed.
- `npm run pack -- --publish never`: succeeded; ARM64 and Intel DMG/ZIP packages built.
- Confirmed both packaged app bundles report version `1.3.6`.
- `hdiutil verify`: both DMGs have valid checksums; `unzip -tq`: both ZIP archives contain no compressed-data errors.
- SHA-256 checksums recorded in `dist/SHA256SUMS-1.3.6.txt`.
- Installed the ARM64 app bundle as `/Applications/Galamtor.app`; preserved 1.3.5 in `dist/rollback/Galamtor-1.3.5.app`. The already-running 1.3.5 process was left open; restart Galamtor to load 1.3.6.

## Manual checks

- Started a development build with a temporary, isolated browser profile.
- Opened and closed the companion studio; verified its `aria-expanded` state and Escape dismissal.
- Verified three distinct catalog portraits (Самал, Тұмар, Қыран) and each character's own preview on selection.
- Changed the name, color, accessory and temperament; confirmed the normalized profile was stored locally and restored after reload.
- Checked thinking, speaking and happy animation names in the rendered UI; speaking opens the mouth, while Қыран's wing waves during speech and greetings.
- Captured and visually inspected the studio layout. The panel stays inside the viewport at 1365×768, 1024×768 and 741×600; reduced-motion mode disables SVG animation.
- The test profile is isolated under `/tmp/galamtor-pet-qa-1.3.6`; no user's normal Galamtor profile data was used for these checks.

## Limits

- Windows packaging and real online AI/provider requests were not part of this pet-focused verification.
- macOS packages are unsigned and not notarized because no valid Developer ID Application identity is available on this Mac. This release is distributed as an explicitly labeled public preview; first launch may require a Gatekeeper override. The website includes the warning and manual opening steps.
