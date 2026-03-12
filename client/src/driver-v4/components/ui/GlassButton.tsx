import { motion } from "framer-motion";
import { useReducedMotion } from "../../design/accessibility";
import { colors } from "../../design/tokens";
import { glowColor } from "../../design/theme";

interface GlassButtonProps {
  icon: React.ReactNode;
  onPress: () => void;
  label: string;
  size?: number;
  accentColor?: string;
  badge?: number;
  testID?: string;
}

export function GlassButton({
  icon,
  onPress,
  label,
  size = 44,
  accentColor = colors.sunrise,
  badge,
  testID,
}: GlassButtonProps) {
  const reduced = useReducedMotion();

  return (
    <motion.button
      data-testid={testID}
      onClick={onPress}
      aria-label={label}
      className="relative flex items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        background: "rgba(255,255,255,0.80)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: `1px solid ${colors.glassStroke}`,
        color: colors.textPrimary,
        cursor: "pointer",
        boxShadow: colors.shadowSm,
      }}
      whileHover={!reduced ? { scale: 1.1, boxShadow: colors.shadowMd } : undefined}
      whileTap={!reduced ? { scale: 0.92 } : undefined}
    >
      {icon}
      {badge != null && badge > 0 && (
        <span
          className="absolute -top-1 -right-1 flex items-center justify-center text-[9px] font-bold"
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            background: colors.danger,
            color: "#fff",
            boxShadow: `0 2px 6px ${glowColor(colors.danger, 0.3)}`,
          }}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </motion.button>
  );
}
