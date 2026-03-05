import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.unitedcaremobility.clinic',
  appName: 'Clinic UCM',
  webDir: 'www',
  server: {
    url: 'https://clinic.unitedcaremobility.com',
    cleartext: false,
    androidScheme: 'https',
    iosScheme: 'https',
    allowNavigation: [
      'clinic.unitedcaremobility.com',
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
    scheme: 'UCMClinic',
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
