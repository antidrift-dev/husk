#!/bin/zsh
# Install the latest optimized build into /Applications (refuses while husk is running).
set -e
ROOT=${0:A:h:h}
SRC="$ROOT/macos/build.noindex/ReleaseLocal/husk.app"
DEST=/Applications/husk.app
# Husktty.app is the name from before the rename to husk; remove it so there's only one copy.
OLD=/Applications/Husktty.app
if pgrep -f "/(husk|Husktty)\.app/Contents/MacOS/" >/dev/null; then
  echo "husk is running — quit it first."; exit 1
fi
[[ -d "$SRC" ]] || { echo "No build at $SRC — run husk/build.sh"; exit 1; }
rm -rf "$DEST" "$OLD"
ditto "$SRC" "$DEST"
echo "→ $DEST (v$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$DEST/Contents/Info.plist"))"
