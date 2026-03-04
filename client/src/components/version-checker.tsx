import { useEffect, useRef, useCallback, useState } from "react";
import { resolveUrl } from "@/lib/api";

const CHECK_INTERVAL = 5 * 60 * 1000;
const STORAGE_KEY = "ucm_known_version";

export function useAppVersion() {
  const [version, setVersion] = useState<string | null>(null);
  const knownRef = useRef<string | null>(localStorage.getItem(STORAGE_KEY));

  const check = useCallback(async () => {
    try {
      const res = await fetch(resolveUrl("/version.json"), {
        cache: "no-store",
        credentials: "omit",
      });
      if (!res.ok) return;
      const data = await res.json();
      const v = data.version || "unknown";
      setVersion(v);

      if (!knownRef.current) {
        knownRef.current = v;
        localStorage.setItem(STORAGE_KEY, v);
        return;
      }

      if (knownRef.current !== v && v !== "dev") {
        console.log(`[UCM] Version changed: ${knownRef.current} → ${v}. Reloading.`);
        knownRef.current = v;
        localStorage.setItem(STORAGE_KEY, v);

        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            await reg.update();
            reg.waiting?.postMessage("SKIP_WAITING");
          }
        }

        window.location.reload();
      }
    } catch {}
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [check]);

  return version;
}

export function VersionDisplay({ className }: { className?: string }) {
  const version = useAppVersion();
  if (!version) return null;
  return (
    <span className={className} data-testid="text-app-version">
      v{version}
    </span>
  );
}
