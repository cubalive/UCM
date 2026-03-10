import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React + routing (loaded on every page)
          "vendor-react": [
            "react",
            "react-dom",
            "wouter",
            "zustand",
          ],
          // Data fetching layer
          "vendor-query": [
            "@tanstack/react-query",
          ],
          // UI component library (Radix + shadcn primitives)
          "vendor-ui": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-select",
            "@radix-ui/react-tabs",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-popover",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-switch",
            "@radix-ui/react-label",
            "@radix-ui/react-slot",
            "@radix-ui/react-separator",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-avatar",
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-accordion",
            "class-variance-authority",
            "clsx",
            "tailwind-merge",
          ],
          // Form handling
          "vendor-forms": [
            "react-hook-form",
            "@hookform/resolvers",
            "zod",
          ],
          // Icons (large bundle)
          "vendor-icons": [
            "lucide-react",
          ],
          // Charts / visualization
          "vendor-charts": [
            "recharts",
          ],
          // Date utilities
          "vendor-date": [
            "date-fns",
          ],
          // PDF generation (heavy, rarely used)
          "vendor-pdf": [
            "jspdf",
            "html2canvas",
          ],
          // i18n
          "vendor-i18n": [
            "i18next",
            "react-i18next",
          ],
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
