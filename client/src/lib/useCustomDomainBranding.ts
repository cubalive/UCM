import { useState, useEffect } from "react";
import { customDomainSlug } from "@/lib/hostDetection";

export interface DomainBranding {
  companyId: number;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  brandTagline: string | null;
}

/**
 * Fetches company branding when the app is accessed via a custom domain.
 * Returns null if on a standard domain or if the company is not found.
 */
export function useCustomDomainBranding() {
  const [branding, setBranding] = useState<DomainBranding | null>(null);
  const [loading, setLoading] = useState(!!customDomainSlug);

  useEffect(() => {
    if (!customDomainSlug) {
      setLoading(false);
      return;
    }

    fetch(`/api/branding/resolve?domain=${encodeURIComponent(customDomainSlug)}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setBranding(data);
          // Apply brand color to CSS
          if (data.brandColor) {
            document.documentElement.style.setProperty("--brand-color", data.brandColor);
            document.documentElement.style.setProperty("--brand-primary", data.brandColor);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { branding, loading, isCustomDomain: !!customDomainSlug };
}
