# Galamtor 1.3.6

## Three companions with their own character
- Redrew Самал, Тұмар and Қыран as distinct original pixel-bot companions.
- Added individual idle motion: Самал's antenna shifts, Тұмар's ears react, and Қыран's wings move.
- The companions now look around while thinking, animate their mouths while speaking, and wave during a greeting.
- The companion picker displays each character's own preview instead of repeating the selected character.
- Kept the existing local customization: name, four color palettes, accessories, temperament, random look and reset.
- Reduced-motion settings disable the new decorative motion. Companion settings remain local to this device.

## Validation
- 72 automated tests pass.
- Syntax checks, Firebase asset build and production dependency audit pass.
- In an isolated development profile, verified the three distinct previews, selection, name/color/accessory/temperament saving, profile restoration after reload, thinking/speaking/happy motion states and dialog dismissal.
- Built ARM64 and Intel DMG/ZIP packages; DMG checksums and ZIP archive integrity verified.
- macOS packages are unsigned and not notarized because no Developer ID Application identity is available. This is a public community preview; macOS may show a Gatekeeper warning on first launch. Download only from the official release and use Finder's Control-click → Open flow if you trust the package. SHA-256 checksums are listed in the release description.

## macOS-та алғаш ашу

Apple Silicon үшін `Galamtor-1.3.6-arm64.dmg`, Intel Mac үшін `Galamtor-1.3.6.dmg` файлын жүктеңіз. DMG ішіндегі Galamtor қолданбасын Applications бумасына көшіріңіз. Қолтаңба болмағандықтан macOS ескерту көрсетуі мүмкін: ресми релизден алған файл екенін тексеріп, Finder-де қолданбаны Control-click (оң жақ батырма) → **Open** → **Open** арқылы ашыңыз. Бұл пәрмен шықпаса, System Settings → Privacy & Security бөліміндегі **Open Anyway** әрекетін қолданыңыз. Бақылау сомаларын төмендегі SHA256 бөлімінен тексеріңіз.

Бұл — 1.3.6 қоғамдық сынақ нұсқасы. Windows жинағы және нақты онлайн AI провайдерлері осы шығарылымның QA сынағына кірмеді.
