# Galamtor 1.3.3

Fixed start-page content stacking above the wallpaper: clock, tagline and quick actions previously existed in the DOM but were visually covered. Bookmark bar now excludes native dragging and uses keyboard-accessible buttons; Cmd/Ctrl and middle click open a new tab. Removed the fifteen-bookmark rendering limit. Widget styles now target current markup and wrap cards. Additional widget controls start expanded. Fixed canceled native wallpaper picker opening another dialog, and resuming a previously paused video wallpaper. Added start-page shortcuts to history, bookmarks, commands and reopen closed tab.

Validation: 49 existing Node tests passed; renderer syntax check passed. In an isolated Electron profile, native mouse click on eGov bookmark navigated to egov.kz/kk. Commands shortcut opened the command palette. Focus preset hid currency/prayer/sources and retained clock. Restart preserved Focus. Screenshot before/after confirmed clock and quick actions are now visible above wallpaper. macOS packaging completed without Developer ID signing.

Limits: not an exhaustive browser/security audit; Google authentication, Lens, every widget style and every external website were not revalidated in this patch. Public auto-update publishing is separate from local installation.
