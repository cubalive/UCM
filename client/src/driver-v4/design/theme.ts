import { colors, blur, radii, glowPresets } from "./tokens";

export function glowColor(color: string, alpha = 0.4): string {
  // Handle rgba strings
  if (color.startsWith("rgba")) return color;
  const hex = color.replace("#", "");
  if (hex.length < 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export interface GlassStyleOptions {
  opacity?: number;
  blurAmount?: number;
  borderOpacity?: number;
}

export function glassStyle(opts: GlassStyleOptions = {}): React.CSSProperties {
  const { opacity = 0.72, blurAmount = blur.md, borderOpacity = 0.06 } = opts;
  return {
    background: `rgba(255,255,255,${opacity})`,
    backdropFilter: `blur(${blurAmount}px)`,
    WebkitBackdropFilter: `blur(${blurAmount}px)`,
    border: `1px solid rgba(0,0,0,${borderOpacity})`,
    borderRadius: radii.lg,
  };
}

export function neonBorder(color: string, width = 1): React.CSSProperties {
  return {
    border: `${width}px solid ${glowColor(color, 0.15)}`,
    boxShadow: `0 2px 8px ${glowColor(color, 0.1)}`,
  };
}

/** Get an ambient gradient based on driver status */
export function statusGradient(status: "offline" | "online" | "busy" | "available"): string {
  switch (status) {
    case "offline":
      return "linear-gradient(160deg, #E8E4DF 0%, #F5F0EB 40%, #E2DDD6 100%)";
    case "online":
      return "linear-gradient(160deg, #FFF5EB 0%, #FFE8D6 40%, #FFF0E0 100%)";
    case "available":
      return "linear-gradient(160deg, #FFF0E0 0%, #FFE0C0 30%, #FFECD2 100%)";
    case "busy":
      return "linear-gradient(160deg, #E8F4FD 0%, #D6ECFA 40%, #E0F0FF 100%)";
  }
}

export const theme = {
  colors,
  radii,
  blur,
  glowPresets,
  glassStyle,
  glowColor,
  neonBorder,
  statusGradient,
} as const;

export type Theme = typeof theme;
