# Galamtor 1.4.0

## Two new original companions
- Added Айару, an anime-inspired star guardian, and Алпамыс, a Kazakh steppe batyr, to the companion studio.
- Both have custom vector portraits, character-specific idle motion, and expressions that follow the companion's thinking, speaking, and greeting states.
- Their clothing responds to the existing color palettes; their hair, cape, plume, and other details keep their own colors and motion.
- Choosing a different companion now updates its default name automatically, while a name you chose yourself stays intact.
- Companion artwork is bundled locally as SVG. It does not make network requests, and reduced-motion preferences still disable its animations.

## Verification
- Automated regression tests, syntax checks, asset build, production dependency audit, and macOS packaging results are recorded in `QA_REPORT-1.4.0.md`.
- The public preview is unsigned and not notarized; macOS may show a first-launch security prompt.
