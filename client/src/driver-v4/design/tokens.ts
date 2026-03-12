/* ─── Sunrise Design System Tokens ─── */

export const colors = {
  // Backgrounds — warm light palette
  bg0: "#FAFAF8",         // warm white
  bg1: "#F5F0EB",         // cream
  bg2: "#EDE7DF",         // warm sand

  // Primary palette — sunrise gradient
  sunrise: "#FF6B35",     // warm orange (primary CTA)
  sunriseLight: "#FF9F6C",
  golden: "#FFB347",      // golden yellow
  coral: "#FF7F7F",       // soft coral
  sky: "#4A90D9",         // calm blue
  skyLight: "#87BFFF",    // light sky
  ocean: "#2E5A88",       // deep ocean blue

  // Semantic colors
  success: "#34C759",     // iOS green
  successLight: "#D4F5DD",
  danger: "#FF3B30",      // iOS red
  dangerLight: "#FFDDD9",
  warning: "#FF9500",     // iOS orange
  warningLight: "#FFF0D6",
  info: "#007AFF",        // iOS blue

  // Text
  textPrimary: "#1A1A2E",    // near black, warm
  textSecondary: "#6B7280",  // medium gray
  textTertiary: "#9CA3AF",   // light gray
  textInverse: "#FFFFFF",

  // Glass layers — light mode
  glassFill: "rgba(255,255,255,0.72)",
  glassFillHover: "rgba(255,255,255,0.85)",
  glassStroke: "rgba(0,0,0,0.06)",
  glassStrokeActive: "rgba(0,0,0,0.12)",

  // Shadows
  shadowSm: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
  shadowMd: "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
  shadowLg: "0 12px 40px rgba(0,0,0,0.1), 0 4px 12px rgba(0,0,0,0.05)",
  shadowXl: "0 20px 60px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.06)",

  // Legacy aliases for components that still reference them
  neonCyan: "#4A90D9",
  neonMagenta: "#FF6B35",
  neonPurple: "#8B5CF6",
  dangerNeon: "#FF3B30",
  successNeon: "#34C759",
  warningNeon: "#FF9500",
  textPrimaryLegacy: "#1A1A2E",
} as const;

export const radii = {
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  full: 9999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export const blur = {
  sm: 12,
  md: 20,
  lg: 32,
} as const;

export const typography = {
  title: {
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    fontWeight: 700,
  },
  body: {
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    fontWeight: 400,
  },
  caption: {
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    fontWeight: 500,
  },
} as const;

export const fontSize = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
} as const;

export const glowPresets = {
  cyan: colors.shadowMd,
  magenta: colors.shadowMd,
  purple: colors.shadowMd,
  danger: `0 4px 16px rgba(255,59,48,0.2)`,
  success: `0 4px 16px rgba(52,199,89,0.2)`,
} as const;
