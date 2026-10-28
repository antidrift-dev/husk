#!/bin/zsh
# Production release: a notarized build packaged like the Electron Husk mac releases,
# husk-<version>-b<build>-arm64.dmg and .zip, in macos/build.noindex/release/.
#
#   husk/release.sh
#
# Then commit husk/build-number and publish the files as a GitHub release (appcast.xml is what the
# in-app updater reads, from releases/latest/download/appcast.xml, so it goes on every release):
#   gh release create v<version> --title "husk v<version>" --notes "…" macos/build.noindex/release/husk-* macos/build.noindex/release/appcast.xml
#
# (the build number is bumped by build.sh, so it's left uncommitted until the release ships).
set -e
ROOT=${0:A:h:h}
cd "$ROOT"

SIGN_ID="Developer ID Application: Reloop Labs, LLC (MV45NBJTQP)"

husk/build.sh notarize

APP="$ROOT/macos/build.noindex/ReleaseLocal/husk.app"
VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")
BUILD=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist")
NAME=husk-$VERSION-b$BUILD-arm64
OUT="$ROOT/macos/build.noindex/release"
rm -rf "$OUT"
mkdir -p "$OUT"

# zip: the stapled app on its own
ditto -c -k --keepParent "$APP" "$OUT/$NAME.zip"

# dmg: the app plus an Applications link to drag it onto. The dmg is signed and notarized
# too, so Gatekeeper accepts it before it's even opened.
STAGE="$OUT/dmg"
mkdir "$STAGE"
ditto "$APP" "$STAGE/husk.app"
ln -s /Applications "$STAGE/Applications"
diskutil image create from --format UDZO --volumeName "husk $VERSION" "$STAGE" "$OUT/$NAME.dmg"
rm -rf "$STAGE"
codesign --timestamp --sign "$SIGN_ID" "$OUT/$NAME.dmg"
xcrun notarytool submit "$OUT/$NAME.dmg" --keychain-profile husk --wait
xcrun stapler staple "$OUT/$NAME.dmg"
spctl -a -t open --context context:primary-signature -vv "$OUT/$NAME.dmg"

# appcast: Sparkle reads this to offer the update. generate_appcast signs the zip with the EdDSA
# private key in the login keychain (made once with Sparkle's generate_keys; its public half is
# SUPublicEDKey in macos/Ghostty-Info.plist). It only sees the zip, in its own folder, so the
# appcast lists just this release, with the zip's URL on this release's GitHub download path.
SPARKLE_BIN=$(echo ~/Library/Developer/Xcode/DerivedData/Ghostty-*/SourcePackages/artifacts/sparkle/Sparkle/bin(N[1]))
[[ -x "$SPARKLE_BIN/generate_appcast" ]] || { echo "No Sparkle tools found — build once with husk/build.sh"; exit 1; }
APPCAST_DIR="$OUT/appcast-src"
mkdir "$APPCAST_DIR"
cp "$OUT/$NAME.zip" "$APPCAST_DIR/"
"$SPARKLE_BIN/generate_appcast" \
  --download-url-prefix "https://github.com/antidrift-dev/husk/releases/download/v$VERSION/" \
  -o "$OUT/appcast.xml" "$APPCAST_DIR"
rm -rf "$APPCAST_DIR"

echo "\nv$VERSION ready:"
ls -lh "$OUT"
