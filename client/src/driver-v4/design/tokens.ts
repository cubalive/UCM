export const colors = {
  bg0: "#000000",
  bg1: "#0a0015",
  bg2: "#0d001a",
  neonCyan: "#00f0ff",
  neonMagenta: "#ff00aa",
  neonPurple: "#a855f7",
  dangerNeon: "#ff3355",
  successNeon: "#00ff88",
  warningNeon: "#ffaa00",
  textPrimary: "#ffffff",
  textSecondary: "rgba(255,255,255,0.72)",
  textTertiary: "rgba(255,255,255,0.48)",
  glassFill: "rgba(255,255,255,0.10)",
  glassFillHover: "rgba(255,255,255,0.18)",
  glassStroke: "rgba(255,255,255,0.12)",
  glassStrokeActive: "rgba(255,255,255,0.25)",
} as const;

export const radii = {
  md: 16,
  lg: 24,
  xl: 32,
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
  sm: 20,
  md: 30,
  lg: 40,
} as const;

export const typography = {
  title: {
    fontFamily: "'Space Grotesk', 'Orbitron', system-ui, sans-serif",
    fontWeight: 700,
  },
  body: {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontWeight: 400,
  },
  caption: {
    fontFamily: "'Inter', system-ui, sans-serif",
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
  cyan: `0 0 20px rgba(0,240,255,0.4), 0 0 60px rgba(0,240,255,0.15)`,
  magenta: `0 0 20px rgba(255,0,170,0.4), 0 0 60px rgba(255,0,170,0.15)`,
  purple: `0 0 20px rgba(168,85,247,0.4), 0 0 60px rgba(168,85,247,0.15)`,
  danger: `0 0 20px rgba(255,51,85,0.4), 0 0 60px rgba(255,51,85,0.15)`,
  success: `0 0 20px rgba(0,255,136,0.4), 0 0 60px rgba(0,255,136,0.15)`,
} as const;
