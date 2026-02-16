#!/bin/bash
# UCM Driver Mobile App Setup Script
# Run this on a macOS machine with Xcode and/or Android Studio installed.

set -e

echo "=== UCM Driver Mobile Setup ==="
echo ""

# 1. Install dependencies
echo "[1/4] Installing npm dependencies..."
npm install

# 2. Add platforms
echo ""
echo "[2/4] Adding iOS and Android platforms..."

if [ ! -d "ios" ]; then
  npx cap add ios
  echo "  iOS platform added."
else
  echo "  iOS platform already exists."
fi

if [ ! -d "android" ]; then
  npx cap add android
  echo "  Android platform added."
else
  echo "  Android platform already exists."
fi

# 3. Sync
echo ""
echo "[3/4] Syncing Capacitor..."
npx cap sync

echo ""
echo "[4/4] Setup complete!"
echo ""
echo "=== MANUAL STEPS REQUIRED ==="
echo ""
echo "iOS (requires macOS + Xcode):"
echo "  1. Open ios/App/App/Info.plist in Xcode"
echo "  2. Add location permission keys from ios-config/Info.plist.additions"
echo "  3. Enable Background Modes > Location updates in Xcode target capabilities"
echo "  4. Run: npm run cap:ios"
echo ""
echo "Android (requires Android Studio):"
echo "  1. Open android/app/src/main/AndroidManifest.xml"
echo "  2. Add permissions from android-config/AndroidManifest.additions.xml"
echo "  3. Add foreground service declaration inside <application> tag"
echo "  4. Run: npm run cap:android"
echo ""
echo "=== BUILD COMMANDS ==="
echo "  iOS build:     npm run cap:build:ios && npm run cap:ios"
echo "  Android build: npm run cap:build:android && npm run cap:android"
echo ""
