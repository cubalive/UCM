import { useState, useEffect } from "react";

export function useReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return prefersReduced;
}

export function accessibleTextColor(bgOpacity: number): string {
  return bgOpacity < 0.3 ? "#ffffff" : "rgba(255,255,255,0.95)";
}

export function a11yLabel(component: string, action?: string): Record<string, string> {
  return {
    "aria-label": action ? `${component}: ${action}` : component,
    role: action ? "button" : "text",
  };
}
