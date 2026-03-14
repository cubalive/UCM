import { motion, AnimatePresence } from "framer-motion";
import { colors } from "../../design/tokens";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBg = variant === "danger"
    ? `linear-gradient(135deg, ${colors.danger}, #E53935)`
    : `linear-gradient(135deg, ${colors.sunrise}, ${colors.golden})`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9998] flex items-center justify-center px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/30" onClick={onCancel} aria-hidden="true" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className="relative w-full max-w-sm rounded-3xl overflow-hidden p-6"
            style={{
              background: "rgba(255,255,255,0.97)",
              backdropFilter: "blur(24px)",
              boxShadow: "0 16px 48px rgba(0,0,0,0.12)",
            }}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <h3 id="confirm-dialog-title" className="text-base font-bold mb-2" style={{ color: colors.textPrimary }}>
              {title}
            </h3>
            <p className="text-sm mb-6" style={{ color: colors.textSecondary }}>
              {message}
            </p>
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 py-3 rounded-2xl text-sm font-semibold min-h-[44px]"
                style={{
                  background: "rgba(0,0,0,0.04)",
                  color: colors.textSecondary,
                  border: "1px solid rgba(0,0,0,0.06)",
                }}
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className="flex-1 py-3 rounded-2xl text-sm font-bold text-white min-h-[44px]"
                style={{
                  background: confirmBg,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
