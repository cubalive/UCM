#!/bin/bash
# UCM Driver Mobile App Setup Script
# Run this on a macOS machine with Xcode and/or Android Studio installed.

set -e

echo "=== UCM Driver Mobile Setup ==="
echo ""

# 1. Install dependencies
echo "[1/5] Installing npm dependencies..."
npm install

# 2. Add platforms
echo ""
echo "[2/5] Adding iOS and Android platforms..."

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
echo "[3/5] Syncing Capacitor..."
npx cap sync

# 4. Verify www directory
echo ""
echo "[4/5] Verifying web directory..."
if [ ! -f "www/index.html" ]; then
  echo "  WARNING: www/index.html not found. Creating placeholder..."
  mkdir -p www
  echo '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>UCM Driver</title></head><body><p>Loading UCM Driver...</p></body></html>' > www/index.html
fi

echo ""
echo "[5/5] Setup complete!"
echo ""
echo "============================================"
echo "=== MANUAL STEPS REQUIRED               ==="
echo "============================================"
echo ""
echo "--- iOS (requires macOS + Xcode 15+) ---"
echo ""
echo "  1. Open ios/App/App/Info.plist in Xcode"
echo "  2. Merge the keys from ios-config/Info.plist.additions:"
echo "     - NSLocationWhenInUseUsageDescription"
echo "     - NSLocationAlwaysAndWhenInUseUsageDescription"
echo "     - NSLocationAlwaysUsageDescription"
echo "     - UIBackgroundModes: [location, fetch, processing]"
echo "  3. In Xcode target > Signing & Capabilities:"
echo "     - Add 'Background Modes' capability"
echo "     - Check 'Location updates'"
echo "     - Check 'Background fetch'"
echo "     - Check 'Background processing'"
echo "  4. Build and run:"
echo "     npm run cap:ios"
echo ""
echo "--- Android (requires Android Studio) ---"
echo ""
echo "  1. Open android/app/src/main/AndroidManifest.xml"
echo "  2. Add permissions from android-config/AndroidManifest.additions.xml"
echo "  3. Add foreground service inside <application> tag:"
echo '     <service'
echo '       android:name="com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService"'
echo '       android:foregroundServiceType="location"'
echo '       android:exported="false" />'
echo "  4. Build and run:"
echo "     npm run cap:android"
echo ""
echo "--- Battery Optimization (Android) ---"
echo ""
echo "  The app will prompt drivers to disable battery optimization."
echo "  For OEM-specific issues see: https://dontkillmyapp.com/"
echo ""
echo "============================================"
echo "=== BUILD COMMANDS                       ==="
echo "============================================"
echo ""
echo "  iOS:     npm run cap:build:ios && npm run cap:ios"
echo "  Android: npm run cap:build:android && npm run cap:android"
echo ""
