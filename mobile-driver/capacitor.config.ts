import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.unitedcaremobility.driver',
  appName: 'UCM Driver',
  webDir: 'www',
  server: {
    url: 'https://driver.unitedcaremobility.com',
    cleartext: false,
    allowNavigation: [
      'driver.unitedcaremobility.com',
      'app.unitedcaremobility.com',
    ],
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      androidScaleType: 'CENTER_CROP',
      splashImmersive: true,
    },
  },
  ios: {
    scheme: 'UCMDriver',
    contentInset: 'automatic',
    backgroundColor: '#0a1e3d',
    preferredContentMode: 'mobile',
    allowsLinkPreview: false,
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0a1e3d',
  },
};

export default config;
