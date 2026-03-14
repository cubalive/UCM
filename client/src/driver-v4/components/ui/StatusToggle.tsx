import { motion, AnimatePresence } from "framer-motion";
import { useReducedMotion } from "../../design/accessibility";
import { colors } from "../../design/tokens";
import { glowColor } from "../../design/theme";

interface StatusToggleProps {
  value: boolean;
  onChange: (val: boolean) => void;
  labels?: { on: string; off: string };
  testID?: string;
}

export function StatusToggle({
  value,
  onChange,
  labels = { on: "ONLINE", off: "OFFLINE" },
  testID,
}: StatusToggleProps) {
  const reduced = useReducedMotion();
  const activeColor = colors.success;

  return (
    <button
      data-testid={testID}
      onClick={() => onChange(!value)}
      aria-label={value ? labels.on : labels.off}
      aria-checked={value}
      role="switch"
      className="relative flex items-center gap-3 cursor-pointer select-none min-h-[44px]"
      style={{ outline: "none" }}
    >
      <div
        className="relative flex items-center"
        style={{
          width: 56,
          height: 30,
          borderRadius: 15,
          background: value ? glowColor(activeColor, 0.2) : "rgba(0,0,0,0.06)",
          border: `1.5px solid ${value ? glowColor(activeColor, 0.3) : "rgba(0,0,0,0.08)"}`,
          boxShadow: value ? `0 2px 8px ${glowColor(activeColor, 0.2)}` : "none",
          transition: reduced ? "none" : "all 0.3s ease",
        }}
      >
        <motion.div
          layout={!reduced}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            background: value ? activeColor : "rgba(0,0,0,0.15)",
            marginLeft: value ? 30 : 4,
            boxShadow: value ? `0 2px 8px ${glowColor(activeColor, 0.3)}` : colors.shadowSm,
          }}
        />
      </div>
      <AnimatePresence mode="wait">
        <motion.span
          key={value ? "on" : "off"}
          initial={reduced ? {} : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? {} : { opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
          className="text-xs font-semibold tracking-wider uppercase"
          style={{
            color: value ? activeColor : colors.textTertiary,
          }}
        >
          {value ? labels.on : labels.off}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
