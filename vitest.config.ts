import { defineConfig } from "vitest/config";

export default defineConfig({
  // Override PostCSS config so vite doesn't try to load tailwindcss in test mode
  css: {
    postcss: { plugins: [] },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 10000,
  },
});
