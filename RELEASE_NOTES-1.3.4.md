# Galamtor 1.3.4

## Main page and widget fixes
- Fixed the start page content stacking beneath its wallpaper so the clock, greeting, search and quick actions stay visible.
- Restored reliable bookmark-bar clicks and keyboard focus. Command-click opens bookmarks in a new tab; all saved bookmarks can scroll in the bar.
- Made the five widget styles apply to the current currency and prayer cards, with a narrow-window layout.
- Kept widget mode and visibility controls in sync.
- Resume a video wallpaper after switching away and back; canceling the native file picker no longer opens a second picker.
- Added direct start-page actions for closed tabs, history, bookmarks and the command palette.

## Validation
49 automated tests pass; syntax/build checks pass; production dependencies report zero known vulnerabilities. The macOS ARM64 packaged app was launched with an isolated profile and manually checked for bookmark navigation, command-click new tab, history/bookmarks panels, quick actions and Focus-mode visibility.

This package is locally validated, unsigned and not notarized. Public macOS installation and automatic updating need a valid Developer ID Application identity and notarization. Windows was not built or tested locally.
