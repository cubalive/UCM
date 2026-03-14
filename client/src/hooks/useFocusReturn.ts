import { useEffect, useRef } from "react";

/**
 * Returns focus to the element that triggered a modal/dialog when it closes.
 * Call this hook in any component that opens a modal or drawer.
 *
 * @param isOpen - Whether the modal/dialog is currently open
 */
export function useFocusReturn(isOpen: boolean) {
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Capture the element that had focus when the modal opened
      triggerRef.current = document.activeElement as HTMLElement;
    } else if (triggerRef.current) {
      // When the modal closes, return focus to the trigger
      requestAnimationFrame(() => {
        if (triggerRef.current && typeof triggerRef.current.focus === 'function') {
          triggerRef.current.focus();
        }
      });
    }
  }, [isOpen]);

  return triggerRef;
}
