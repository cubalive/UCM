import { colors, blur, radii, glowPresets } from "./tokens";

export function glowColor(color: string, alpha = 0.4): string {
  const hex = color.replace("#", "");
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
  const { opacity = 0.12, blurAmount = blur.md, borderOpacity = 0.12 } = opts;
  return {
    background: `rgba(255,255,255,${opacity})`,
    backdropFilter: `blur(${blurAmount}px)`,
    WebkitBackdropFilter: `blur(${blurAmount}px)`,
    border: `1px solid rgba(255,255,255,${borderOpacity})`,
    borderRadius: radii.lg,
  };
}

export function neonBorder(color: string, width = 1): React.CSSProperties {
  return {
    border: `${width}px solid ${glowColor(color, 0.5)}`,
    boxShadow: `0 0 8px ${glowColor(color, 0.2)}, inset 0 0 8px ${glowColor(color, 0.05)}`,
  };
}

export const theme = {
  colors,
  radii,
  blur,
  glowPresets,
  glassStyle,
  glowColor,
  neonBorder,
} as const;

export type Theme = typeof theme;
