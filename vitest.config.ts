import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Override PostCSS config so vite doesn't try to load tailwindcss in test mode
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
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "server/tests/**/*.test.ts", "shared/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 10000,
  },
});
