import { motion } from "framer-motion";
import { useReducedMotion } from "../../design/accessibility";
import { colors, radii } from "../../design/tokens";

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
    bg: `linear-gradient(135deg, ${colors.sunrise}, ${colors.golden})`,
    text: "#FFFFFF",
    shadow: `0 4px 16px rgba(255,107,53,0.3), 0 2px 4px rgba(255,107,53,0.2)`,
    hoverShadow: `0 8px 24px rgba(255,107,53,0.4), 0 4px 8px rgba(255,107,53,0.3)`,
  },
  secondary: {
    bg: "rgba(255,255,255,0.80)",
    text: colors.textPrimary,
    shadow: colors.shadowSm,
    hoverShadow: colors.shadowMd,
  },
  danger: {
    bg: `linear-gradient(135deg, ${colors.danger}, #FF6B6B)`,
    text: "#FFFFFF",
    shadow: `0 4px 16px rgba(255,59,48,0.3)`,
    hoverShadow: `0 8px 24px rgba(255,59,48,0.4)`,
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
      onClick={() => { if (!disabled) onPress(); }}
      disabled={disabled}
      className={`relative flex items-center justify-center gap-2.5 font-semibold tracking-wide min-h-[44px]
        ${size === "lg" ? "w-full py-4 px-8 text-base" : "py-3 px-6 text-sm"}`}
      style={{
        background: disabled ? "#E5E7EB" : config.bg,
        color: disabled ? colors.textTertiary : config.text,
        borderRadius: radii.xl,
        boxShadow: disabled ? "none" : config.shadow,
        border: variant === "secondary" ? `1px solid ${colors.glassStroke}` : "none",
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "'Inter', system-ui, sans-serif",
        fontWeight: 600,
      }}
      whileHover={!disabled && !reduced ? { scale: 1.02, boxShadow: config.hoverShadow } : undefined}
      whileTap={!disabled && !reduced ? { scale: 0.97 } : undefined}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      aria-label={title}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      <span>{title}</span>
    </motion.button>
  );
}
