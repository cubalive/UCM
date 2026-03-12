import { motion } from "framer-motion";
import { useReducedMotion } from "../../design/accessibility";
import { colors, blur as blurTokens, radii } from "../../design/tokens";

interface GlassCardProps {
  children: React.ReactNode;
  variant?: "default" | "elevated" | "subtle";
  radius?: keyof typeof radii;
  padding?: string;
  glowAccent?: string;
  className?: string;
  testID?: string;
  onClick?: () => void;
}

export function GlassCard({
  children,
  variant = "default",
  radius = "lg",
  padding = "p-5",
  glowAccent,
  className = "",
  testID,
  onClick,
}: GlassCardProps) {
  const reduced = useReducedMotion();

  const bgMap = {
    default: "rgba(255,255,255,0.72)",
    elevated: "rgba(255,255,255,0.88)",
    subtle: "rgba(255,255,255,0.50)",
  };
  const shadowMap = {
    default: colors.shadowSm,
    elevated: colors.shadowMd,
    subtle: "none",
  };
  const blurMap = { default: blurTokens.md, elevated: blurTokens.lg, subtle: blurTokens.sm };

  return (
    <motion.div
      data-testid={testID}
      onClick={onClick}
      initial={reduced ? {} : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`relative overflow-hidden ${padding} ${className}`}
      style={{
        background: bgMap[variant],
        backdropFilter: `blur(${blurMap[variant]}px)`,
        WebkitBackdropFilter: `blur(${blurMap[variant]}px)`,
        border: `1px solid ${colors.glassStroke}`,
        borderRadius: radii[radius],
        boxShadow: shadowMap[variant],
        cursor: onClick ? "pointer" : undefined,
      }}
      whileHover={onClick && !reduced ? { scale: 1.01, boxShadow: colors.shadowMd } : undefined}
      whileTap={onClick && !reduced ? { scale: 0.98 } : undefined}
      aria-label={testID}
    >
      {children}
    </motion.div>
  );
}
