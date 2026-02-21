import { motion } from "framer-motion";
import { useReducedMotion } from "../../design/accessibility";
import { colors } from "../../design/tokens";
import { glowColor } from "../../design/theme";

interface GlowProgressCircleProps {
  progress: number;
  label: string;
  size?: number;
  accentColor?: string;
  sublabel?: string;
  testID?: string;
}

export function GlowProgressCircle({
  progress,
  label,
  size = 80,
  accentColor = colors.neonCyan,
  sublabel,
  testID,
}: GlowProgressCircleProps) {
  const reduced = useReducedMotion();
  const strokeWidth = 4;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - Math.min(Math.max(progress, 0), 1));

  return (
    <div
      data-testid={testID}
      className="flex flex-col items-center gap-1"
      aria-label={`${label}: ${Math.round(progress * 100)}%`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={strokeWidth}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={accentColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={reduced ? { strokeDashoffset } : { strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1, ease: "easeOut" }}
            style={{
              transform: "rotate(-90deg)",
              transformOrigin: "center",
              filter: `drop-shadow(0 0 6px ${glowColor(accentColor, 0.5)})`,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-sm font-bold"
            style={{
              color: colors.textPrimary,
              fontFamily: "'Space Grotesk', system-ui",
            }}
          >
            {label}
          </span>
        </div>
      </div>
      {sublabel && (
        <span className="text-[10px] tracking-wider uppercase" style={{ color: colors.textTertiary }}>
          {sublabel}
        </span>
      )}
    </div>
  );
}
