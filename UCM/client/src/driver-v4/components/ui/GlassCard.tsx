import { motion } from "framer-motion";
import { useReducedMotion } from "../../design/accessibility";
import { colors, blur as blurTokens, radii } from "../../design/tokens";
import { glowColor } from "../../design/theme";

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

  const opacityMap = { default: 0.10, elevated: 0.16, subtle: 0.06 };
  const blurMap = { default: blurTokens.md, elevated: blurTokens.lg, subtle: blurTokens.sm };

  const bgOpacity = opacityMap[variant];
  const blurAmount = blurMap[variant];
  const borderColor = glowAccent
    ? glowColor(glowAccent, 0.3)
    : colors.glassStroke;

  return (
    <motion.div
      data-testid={testID}
      onClick={onClick}
      initial={reduced ? {} : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`relative overflow-hidden ${padding} ${className}`}
      style={{
        background: `rgba(255,255,255,${bgOpacity})`,
        backdropFilter: `blur(${blurAmount}px)`,
        WebkitBackdropFilter: `blur(${blurAmount}px)`,
        border: `1px solid ${borderColor}`,
        borderRadius: radii[radius],
        boxShadow: glowAccent
          ? `0 0 20px ${glowColor(glowAccent, 0.15)}, inset 0 1px 0 rgba(255,255,255,0.08)`
          : `inset 0 1px 0 rgba(255,255,255,0.08)`,
        cursor: onClick ? "pointer" : undefined,
      }}
      whileHover={onClick && !reduced ? { scale: 1.01 } : undefined}
      whileTap={onClick && !reduced ? { scale: 0.98 } : undefined}
      aria-label={testID}
    >
      {children}
    </motion.div>
  );
}
