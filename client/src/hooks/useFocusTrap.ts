import { useEffect, useRef, useCallback, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]:not([disabled])',
].join(', ');

/**
 * Traps focus within a container element (for modals, drawers, dialogs).
 * When active, Tab and Shift+Tab cycle through focusable elements inside
 * the container, preventing focus from escaping.
 *
 * @param containerRef - Ref to the container element
 * @param active - Whether the trap is currently active
 * @param onEscape - Optional callback when Escape key is pressed
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
) {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Focus the first focusable element when trap activates
  useEffect(() => {
    if (!active || !containerRef.current) return;

    // Store the element that had focus before the trap opened
    previouslyFocusedRef.current = document.activeElement as HTMLElement;

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);

    if (focusableElements.length > 0) {
      // Small delay to ensure the DOM is ready
      requestAnimationFrame(() => {
        focusableElements[0].focus();
      });
    } else {
      // If no focusable elements, focus the container itself
      container.setAttribute('tabindex', '-1');
      container.focus();
    }
  }, [active, containerRef]);

  // Handle Tab key cycling
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!active || !containerRef.current) return;

      if (event.key === 'Escape' && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }

      if (event.key !== 'Tab') return;

      const container = containerRef.current;
      const focusableElements = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        // Shift+Tab: if focus is on first element, wrap to last
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: if focus is on last element, wrap to first
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    },
    [active, containerRef, onEscape],
  );

  useEffect(() => {
    if (!active) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, handleKeyDown]);

  // Return focus to previously focused element when trap deactivates
  useEffect(() => {
    return () => {
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus();
      }
    };
  }, []);
}
