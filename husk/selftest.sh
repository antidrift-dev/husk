#!/bin/zsh
# Headless smoke test (works with the screen locked): opens a window, adds a tab,
# cd /tmp, writes report.json + window.png to the out dir. See HuskSelfTest.swift.
#
#   husk/selftest.sh [path/to/husk.app] [outdir]
ROOT=${0:A:h:h}
APP=${1:-$ROOT/macos/build.noindex/Debug/husk.app}
OUT=${2:-$ROOT/macos/build.noindex/selftest}
rm -rf "$OUT"
caffeinate -u -t 45 &   # Metal needs an awake display
sleep 1
# Don't restore windows from earlier runs. Set via defaults, not argv: Ghostty reads
# command-line args as config and would report them as configuration errors.
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Contents/Info.plist")
defaults write "$BUNDLE_ID" ApplePersistenceIgnoreState -bool YES
HUSKTTY_SELFTEST="$OUT" "$APP/Contents/MacOS/ghostty" >/dev/null 2>&1 &
PID=$!
for i in $(seq 1 45); do [[ -f "$OUT/report.json" ]] && break; sleep 1; done
# The app rewrites the report as later checks finish, then quits on its own.
for i in $(seq 1 20); do kill -0 $PID 2>/dev/null || break; sleep 1; done
kill $PID 2>/dev/null
defaults delete "$BUNDLE_ID" ApplePersistenceIgnoreState 2>/dev/null
cat "$OUT/report.json" 2>/dev/null || { echo "no report"; exit 1; }
echo "\n→ $OUT/window.png"
