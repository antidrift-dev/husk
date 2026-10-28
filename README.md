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
- **Same-folder warning:** "+1 session here (ctx: 84k)" in the status bar when another Claude Code or Codex
  session is running in the same folder, in any terminal. Hover to see which.
- **Window labels:** Window → Label Window… (or double-click the title) names a window, shown as
  "husk v0.3.N (label)" and in the Window menu. New tabs and tabs dragged in take the window's label.
- **Recent directories:** a new tab or window (⌘T, ⌘N, ⌘⇧N) offers the folders you've recently worked in;
  ⌘1–9 or a click goes there, Escape stays put. Turn it off with "Don't show again" or in Settings.
- **Specs drawer:** View → Show Specs slides up a list of the project's spec files, a heading per subfolder.
  ⌘⇧S then P does the same once it's turned on in Settings → Features (off by default).
  Add a specs folder with the folder+ button; click a spec to open it in the app you pick the first time
  (change it in Settings → Features). Escape closes it. Each tab has its own.
- **19 Husk themes** in a Theme menu, applied live.
- **Settings window** (⌘,): the common settings on Appearance, Terminal, Windows and Features tabs (font,
  opacity, padding, Option as Alt, clipboard, restoring windows, …), and an **All Settings** tab with every
  Ghostty option that works on macOS, searchable, each with the right control and Ghostty's own description.
  No config file needed; changes apply right away.
- **Profiles and workspaces** in the File menu, using the same JSON as Husk in `~/.husk/`.
- **Optional sidebar** of tabs (View → Show Sidebar). Native top tabs are the default.
- **Press ⌘Q three times to quit**, so a stray ⌘Q doesn't close every session.
- **One Window menu entry per window**, not one per tab.

## Config

husk loads, in order: its built-in defaults, the theme picked in the Theme menu, the Settings window values,
and then `~/.config/husktty/config` for your own overrides. That file uses
[Ghostty's config format](https://ghostty.org/docs/config).

## Build

Needs Xcode, Zig 0.17.0 in `.toolchain/` (Ghostty v1.4.0 needs this version) and Xcode's Metal
toolchain (`xcodebuild -downloadComponent MetalToolchain`).

```sh
husk/build.sh            # optimized build, signed, installed to /Applications/husk.app
husk/build.sh notarize   # same, notarized by Apple
husk/build.sh debug      # Debug build
husk/build.sh core       # also rebuild the Zig core (after changing anything outside macos/)
husk/release.sh          # notarized build packaged as a .dmg and .zip for a GitHub release
husk/selftest.sh         # headless smoke test
husk/gen-settings-schema.sh  # after merging a new Ghostty: regenerate the All Settings list from Config.zig
```

The version is `0.3.<build>`, where `<build>` is the counter in `husk/build-number`, bumped on every build.
Signing uses the Developer ID certificate for Reloop Labs, LLC (`MV45NBJTQP`); notarizing uses the
`notarytool` keychain profile `husk`.

## License

MIT, like Ghostty: see [LICENSE](LICENSE). Bundles the D2Coding font under the
[SIL Open Font License](macos/Sources/Husk/Fonts/D2Coding-OFL.txt). Part of [antidrift](https://github.com/antidrift-dev).
