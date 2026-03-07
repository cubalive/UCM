import { motion } from "framer-motion";
import { useReducedMotion } from "../../design/accessibility";
import { colors, glowPresets, radii } from "../../design/tokens";
import { glowColor } from "../../design/theme";

interface NeonButtonProps {
  title: string;
  icon?: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  size?: "lg" | "md";
  testID?: string;
}

const variantConfig = {
  primary: {
    bg: colors.neonCyan,
    text: "#000000",
    glow: glowPresets.cyan,
    hoverBg: "#33f3ff",
  },
  secondary: {
    bg: "rgba(255,255,255,0.10)",
    text: colors.textPrimary,
    glow: "none",
    hoverBg: "rgba(255,255,255,0.18)",
  },
  danger: {
    bg: colors.dangerNeon,
    text: "#ffffff",
    glow: glowPresets.danger,
    hoverBg: "#ff5577",
  },
};

export function NeonButton({
  title,
  icon,
  onPress,
  disabled = false,
  variant = "primary",
  size = "lg",
  testID,
}: NeonButtonProps) {
  const reduced = useReducedMotion();
  const config = variantConfig[variant];

  return (
    <motion.button
      data-testid={testID}
      onClick={() => {
        if (!disabled) onPress();
      }}
      disabled={disabled}
      className={`relative flex items-center justify-center gap-3 font-semibold tracking-wide transition-colors
        ${size === "lg" ? "w-full py-4 px-8 text-base" : "py-3 px-6 text-sm"}`}
      style={{
        background: disabled ? "rgba(255,255,255,0.06)" : config.bg,
        color: disabled ? colors.textTertiary : config.text,
        borderRadius: radii.xl,
        boxShadow: disabled ? "none" : config.glow,
        border: variant === "secondary" ? `1px solid ${colors.glassStroke}` : "none",
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
      }}
      whileHover={
        !disabled && !reduced
          ? { scale: 1.02, boxShadow: variant === "primary" ? `0 0 30px ${glowColor(colors.neonCyan, 0.6)}, 0 0 80px ${glowColor(colors.neonCyan, 0.2)}` : config.glow }
          : undefined
      }
      whileTap={!disabled && !reduced ? { scale: 0.97 } : undefined}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      aria-label={title}
    >
      {variant === "primary" && !disabled && !reduced && (
        <motion.div
          className="absolute inset-0 rounded-[32px]"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          style={{
            boxShadow: `0 0 40px ${glowColor(colors.neonCyan, 0.3)}`,
            pointerEvents: "none",
          }}
        />
      )}
      {icon && <span className="relative z-10">{icon}</span>}
      <span className="relative z-10 uppercase">{title}</span>
    </motion.button>
  );
}
