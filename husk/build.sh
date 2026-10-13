#!/bin/zsh
# Build husk (Husk on Ghostty), sign it, and install it to /Applications/husk.app.
#
#   husk/build.sh            optimized build (ReleaseLocal, Apple Silicon), signed with Developer ID
#   husk/build.sh notarize   same, then notarized by Apple (a few minutes; only needed to share it)
#   husk/build.sh debug      Debug build → macos/build.noindex/Debug/husk.app
#   husk/build.sh core       also rebuild the Zig core (after changing anything outside macos/)
#
# One-time setup this relies on:
#   - Zig 0.15.2 in .toolchain/ (Ghostty v1.3.1 needs exactly this version)
#   - Xcode's Metal toolchain:  xcodebuild -downloadComponent MetalToolchain
#   - The Developer ID certificate below in the login keychain
#   - For notarize:  xcrun notarytool store-credentials husk
set -e
setopt pipefail   # a failed xcodebuild must stop the script, not get signed and installed
ROOT=${0:A:h:h}
cd "$ROOT"

SIGN_ID="Developer ID Application: Reloop Labs, LLC (MV45NBJTQP)"

if [[ "$1" == "core" || ! -d macos/GhosttyKit.xcframework ]]; then
  PATH="$ROOT/.toolchain/zig-aarch64-macos-0.15.2:$PATH" \
    zig build -Demit-macos-app=false -Doptimize=ReleaseFast -Dxcframework-target=native
fi

CONFIG=ReleaseLocal
[[ "$1" == "debug" ]] && CONFIG=Debug

# Version v0.3.<build>: the build number in husk/build-number is the single source of truth,
# bumped on every build (like Husk's scripts/bump-build.ts).
BUILD=$(( $(cat husk/build-number) + 1 ))
echo $BUILD > husk/build-number
VERSION=0.3.$BUILD
echo "Husk v$VERSION"

cd macos
# -packageAuthorizationProvider netrc: otherwise SwiftPM blocks on a keychain prompt for github.com
# ARCHS=arm64: the Zig core is built native-only
PATH=/usr/bin:/bin:/usr/sbin:/sbin xcodebuild -project Ghostty.xcodeproj -scheme Ghostty \
  -configuration $CONFIG SYMROOT="$PWD/build.noindex" ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  MARKETING_VERSION=$VERSION CURRENT_PROJECT_VERSION=$BUILD \
  -skipPackagePluginValidation -skipMacroValidation -packageAuthorizationProvider netrc \
  build | grep -E "error:|BUILD (SUCCEEDED|FAILED)" | sort -u

if [[ $CONFIG == ReleaseLocal ]]; then
  APP="$ROOT/macos/build.noindex/ReleaseLocal/husk.app"

  # Sign: nested code first (Sparkle, its XPCs, DockTilePlugin), then the app with its entitlements.
  codesign --force --deep --options runtime --timestamp --sign "$SIGN_ID" "$APP"
  codesign --force --options runtime --timestamp \
    --entitlements "$ROOT/macos/GhosttyReleaseLocal.entitlements" --sign "$SIGN_ID" "$APP"
  codesign --verify --deep --strict "$APP"
  echo "Signed: $SIGN_ID"

  if [[ "$1" == "notarize" ]]; then
    ZIP="$ROOT/macos/build.noindex/husk.zip"
    rm -f "$ZIP"
    ditto -c -k --keepParent "$APP" "$ZIP"
    xcrun notarytool submit "$ZIP" --keychain-profile husk --wait
    xcrun stapler staple "$APP"
    spctl -a -vv "$APP"
  fi

  # Install to /Applications so Spotlight (⌘Space) always opens the latest build.
  # Never swap files under a running copy (that's what made Electron Husk jittery).
  if pgrep -f "/(husk|Husktty)\.app/Contents/MacOS/" >/dev/null; then
    echo "husk is running — not installing. New build: macos/build.noindex/ReleaseLocal/husk.app"
    echo "Quit husk and run: husk/install.sh"
    exit 0
  fi
  "$ROOT/husk/install.sh"
fi
