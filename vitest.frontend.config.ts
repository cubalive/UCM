import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  css: {
    postcss: { plugins: [] },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/frontend/**/*.test.tsx", "tests/frontend/**/*.test.ts"],
    setupFiles: ["tests/setup-frontend.ts"],
    testTimeout: 10000,
  },
});
