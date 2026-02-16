import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.unitedcaremobility.driver',
  appName: 'UCM Driver',
  webDir: 'www',
  server: {
    url: 'https://driver.unitedcaremobility.com',
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      androidScaleType: 'CENTER_CROP',
    },
  },
  ios: {
    scheme: 'UCMDriver',
    contentInset: 'automatic',
    backgroundColor: '#ffffff',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#ffffff',
  },
};

export default config;
