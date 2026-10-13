# Galamtor 1.4.0 — QA report

Date: 2026-10-13

## Automated checks

- `npm test`: 73 passed, 0 failed.
- `npm run check`: JavaScript syntax checks and Firebase asset build passed.
- `npm audit --omit=dev --audit-level=moderate`: 0 production vulnerabilities reported.
- `git diff --check`: passed before release.
- `npm run pack -- --publish never`: ARM64 and Intel macOS apps, DMGs and ZIPs built successfully.
- Both packaged app bundles report version `1.4.0`.
- `hdiutil verify`: both DMGs have valid checksums. `unzip -tq`: both ZIP archives have no compressed-data errors.
- SHA-256 checksums are recorded in `dist/SHA256SUMS-1.4.0.txt`.

## Manual checks

- Opened the packaged ARM64 app with a fresh profile isolated under `/tmp/galamtor-pet-qa-1.4.0-packaged`.
- Confirmed that all five companion cards render in the packaged app and selecting Айару or Алпамыс updates the live mascot and default name.
- Changed the name, color, accessory and temperament; the chosen name survived a companion switch and settings were saved to the isolated local profile.
- Checked thinking, speaking and greeting states on the new art. Thinking changes body/eye motion, speaking opens the mouth, and greeting animates the character; reduced-motion disables the animation.
- Exercised the studio at 1024×768, 741×600 and 390×844 CSS viewport sizes. The panel stayed inside each viewport and scrolled its settings when needed.
- Escape closed the studio and restored its expanded state; no renderer exceptions occurred during the checks.
- Visually reviewed the packaged studio and the two new vector characters.

## Limits

- Windows packaging, real online AI/provider requests, and OAuth sign-in were not part of this pet-focused verification.
- macOS packages are unsigned and not notarized because no valid Developer ID Application identity is available on this Mac. This release is a public preview; macOS may show a first-launch Gatekeeper warning. The website includes the warning and opening steps.
