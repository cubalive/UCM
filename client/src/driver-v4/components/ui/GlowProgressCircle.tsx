import { motion } from "framer-motion";
import { useReducedMotion } from "../../design/accessibility";
import { colors } from "../../design/tokens";

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
  accentColor = colors.sunrise,
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
            stroke="rgba(0,0,0,0.06)"
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
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-sm font-bold"
            style={{
              color: colors.textPrimary,
              fontFamily: "'Inter', system-ui",
            }}
          >
            {label}
          </span>
        </div>
      </div>
      {sublabel && (
        <span className="text-[10px] tracking-wider uppercase font-medium" style={{ color: colors.textTertiary }}>
          {sublabel}
        </span>
      )}
    </div>
  );
}
