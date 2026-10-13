<p align="center">
  <img src="images/Ghostty.icon/Assets/Husk.png" alt="husk" width="128">
</p>

<h1 align="center">husk</h1>

<p align="center">A native Mac terminal for AI coding, built on <a href="https://github.com/ghostty-org/ghostty">Ghostty</a>.</p>

husk is the native replacement for the [Electron version of Husk](https://github.com/antidrift-dev/husk-electron).
It runs on a fork of Ghostty's macOS app: Ghostty's Zig core and Metal renderer, with Husk's tabs, status bar,
themes and settings on top.

## Install

Download the `.dmg` from [Releases](https://github.com/antidrift-dev/husk/releases), open it and drag husk
to Applications. Apple Silicon only. Builds are signed with Developer ID and notarized by Apple.

husk has its own bundle ID (`dev.antidrift.husktty`) and config, so it never reads or changes a Ghostty install.

## What it adds to Ghostty

- **Tabs named after their directory**, with the running process shown and tinted in each tab ("● claude").
  Rename with a double-click, right-click or ⌘R; drag to reorder; right-click → Pop Out to Window.
- **Status bar:** current directory, git repo and branch (click for upstream, ahead/behind, last commit,
  changes and remotes), memory (click for a per-process breakdown), disk and the foreground process.
- **Claude Code and Codex context usage** in the status bar.
- **19 Husk themes** in a Theme menu, applied live.
- **Settings window** (⌘,): theme, font size, ligatures, sidebar, cursor, scrollback, quake hotkey and
  notifications when a command finishes.
- **Profiles and workspaces** in the File menu, using the same JSON as Husk in `~/.husk/`.
- **Optional sidebar** of tabs (View → Show Sidebar). Native top tabs are the default.
- **Hold ⌘Q to quit**, so a stray ⌘Q doesn't close every session.
- **One Window menu entry per window**, not one per tab.

## Config

husk loads, in order: its built-in defaults, the theme picked in the Theme menu, the Settings window values,
and then `~/.config/husktty/config` for your own overrides. That file uses
[Ghostty's config format](https://ghostty.org/docs/config).

## Build

Needs Xcode, Zig 0.15.2 in `.toolchain/` (Ghostty v1.3.1 needs exactly this version) and Xcode's Metal
toolchain (`xcodebuild -downloadComponent MetalToolchain`).

```sh
husk/build.sh            # optimized build, signed, installed to /Applications/husk.app
husk/build.sh notarize   # same, notarized by Apple
husk/build.sh debug      # Debug build
husk/build.sh core       # also rebuild the Zig core (after changing anything outside macos/)
husk/release.sh          # notarized build packaged as a .dmg and .zip for a GitHub release
husk/selftest.sh         # headless smoke test
```

The version is `0.3.<build>`, where `<build>` is the counter in `husk/build-number`, bumped on every build.
Signing uses the Developer ID certificate for Reloop Labs, LLC (`MV45NBJTQP`); notarizing uses the
`notarytool` keychain profile `husk`.

## License

MIT, like Ghostty: see [LICENSE](LICENSE). Bundles the D2Coding font under the
[SIL Open Font License](macos/Sources/Husk/Fonts/D2Coding-OFL.txt). Part of [antidrift](https://github.com/antidrift-dev).
