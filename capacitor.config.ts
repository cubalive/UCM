import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.unitedcaremobility.driver",
  appName: "UCM Driver",
  webDir: "dist/public",
  server: {
    androidScheme: "https",
    iosScheme: "https",
  },
};

export default config;
