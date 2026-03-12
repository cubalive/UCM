import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { colors } from "../../design/tokens";

export type ToastType = "error" | "success" | "info";

interface ToastMessage {
  id: number;
  type: ToastType;
  text: string;
}

let toastId = 0;
let addToastFn: ((type: ToastType, text: string) => void) | null = null;

export function showToast(type: ToastType, text: string) {
  addToastFn?.(type, text);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastType, text: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-2), { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  const dismiss = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const iconMap = {
    error: <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: colors.danger }} />,
    success: <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: colors.success }} />,
    info: <Info className="w-4 h-4 flex-shrink-0" style={{ color: colors.sky }} />,
  };

  const bgMap = {
    error: "rgba(255,59,48,0.08)",
    success: "rgba(52,199,89,0.08)",
    info: "rgba(74,144,217,0.08)",
  };

  const borderMap = {
    error: "rgba(255,59,48,0.2)",
    success: "rgba(52,199,89,0.2)",
    info: "rgba(74,144,217,0.2)",
  };

  return (
    <div className="fixed top-4 left-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 430, margin: "0 auto" }}>
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-2xl"
            style={{
              background: bgMap[toast.type],
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: `1px solid ${borderMap[toast.type]}`,
              boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
            }}
          >
            {iconMap[toast.type]}
            <span className="flex-1 text-xs font-medium" style={{ color: colors.textPrimary }}>
              {toast.text}
            </span>
            <button onClick={() => dismiss(toast.id)} className="flex-shrink-0 p-0.5">
              <X className="w-3.5 h-3.5" style={{ color: colors.textTertiary }} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
