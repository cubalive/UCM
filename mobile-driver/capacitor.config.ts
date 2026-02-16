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
    BackgroundGeolocation: {
      notifications: {
        title: 'UCM Driver',
        text: 'Tracking your location',
      },
    },
  },
  ios: {
    scheme: 'UCMDriver',
    contentInset: 'automatic',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
