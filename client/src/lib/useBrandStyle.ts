import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

/**
 * Injects company brand color as CSS custom property on :root
 * so Tailwind/shadcn components can use it via var(--brand-color).
 */
export function useBrandStyle() {
  const { user } = useAuth();
  const brandColor = (user as any)?.brandColor;

  useEffect(() => {
    if (brandColor && /^#[0-9a-fA-F]{3,8}$/.test(brandColor)) {
      document.documentElement.style.setProperty("--brand-color", brandColor);
      // Convert hex to HSL-ish for primary override
      document.documentElement.style.setProperty("--brand-primary", brandColor);
    } else {
      document.documentElement.style.removeProperty("--brand-color");
      document.documentElement.style.removeProperty("--brand-primary");
    }
    return () => {
      document.documentElement.style.removeProperty("--brand-color");
      document.documentElement.style.removeProperty("--brand-primary");
    };
  }, [brandColor]);
}
