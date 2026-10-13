#!/bin/zsh
# Production release: a notarized build packaged like the Electron Husk mac releases,
# husk-<version>-b<build>-arm64.dmg and .zip, in macos/build.noindex/release/.
#
#   husk/release.sh
#
# Then commit husk/build-number and publish both files as a GitHub release:
#   gh release create v<version> --title "husk v<version>" --notes "…" macos/build.noindex/release/husk-*
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
hdiutil create -volname "husk $VERSION" -srcfolder "$STAGE" -format UDZO -ov "$OUT/$NAME.dmg"
rm -rf "$STAGE"
codesign --timestamp --sign "$SIGN_ID" "$OUT/$NAME.dmg"
xcrun notarytool submit "$OUT/$NAME.dmg" --keychain-profile husk --wait
xcrun stapler staple "$OUT/$NAME.dmg"
spctl -a -t open --context context:primary-signature -vv "$OUT/$NAME.dmg"

echo "\nv$VERSION ready:"
ls -lh "$OUT"
