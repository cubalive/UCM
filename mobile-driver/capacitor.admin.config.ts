import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.unitedcaremobility.admin',
  appName: 'UCM',
  webDir: 'www',
  server: {
    url: 'https://app.unitedcaremobility.com',
    cleartext: false,
    androidScheme: 'https',
    iosScheme: 'https',
    allowNavigation: [
      'app.unitedcaremobility.com',
      'dispatch.unitedcaremobility.com',
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
    scheme: 'UCMAdmin',
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
