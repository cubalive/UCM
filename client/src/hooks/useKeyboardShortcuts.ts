import { useEffect, useCallback } from "react";

type ShortcutHandler = () => void;

interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: ShortcutHandler;
  description: string;
}

/**
 * Registers keyboard shortcuts for a component.
 * Shortcuts are automatically disabled when focus is inside an input/textarea/select.
 *
 * @param shortcuts Array of keyboard shortcuts to register
 * @param enabled Whether shortcuts are currently active
 */
export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  enabled: boolean = true,
) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in form elements
      const target = event.target as HTMLElement;
      const isFormElement =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      if (isFormElement) return;

      for (const shortcut of shortcuts) {
        const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatch = !!shortcut.ctrl === (event.ctrlKey || event.metaKey);
        const shiftMatch = !!shortcut.shift === event.shiftKey;
        const altMatch = !!shortcut.alt === event.altKey;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          event.preventDefault();
          shortcut.handler();
          return;
        }
      }
    },
    [shortcuts, enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, handleKeyDown]);
}

/**
 * Hook for arrow key navigation within a list of elements.
 * Useful for navigating trip lists, driver pins, etc.
 *
 * @param containerSelector CSS selector for the container
 * @param itemSelector CSS selector for navigable items within the container
 * @param enabled Whether navigation is active
 */
export function useArrowKeyNavigation(
  containerSelector: string,
  itemSelector: string,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const container = document.querySelector(containerSelector);
      if (!container) return;

      // Only handle if focus is within the container
      if (!container.contains(document.activeElement)) return;

      const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
      if (items.length === 0) return;

      const currentIndex = items.indexOf(document.activeElement as HTMLElement);

      let nextIndex = -1;

      switch (event.key) {
        case "ArrowDown":
        case "ArrowRight":
          event.preventDefault();
          nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
          break;
        case "ArrowUp":
        case "ArrowLeft":
          event.preventDefault();
          nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
          break;
        case "Home":
          event.preventDefault();
          nextIndex = 0;
          break;
        case "End":
          event.preventDefault();
          nextIndex = items.length - 1;
          break;
      }

      if (nextIndex >= 0 && items[nextIndex]) {
        items[nextIndex].focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [containerSelector, itemSelector, enabled]);
}
