import { useState, useEffect, useCallback } from "react";
import { WifiOff, CloudOff, RefreshCw, Check } from "lucide-react";
import { getQueuedCount } from "@/lib/offlineOutbox";

export function OfflineQueueStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queuedCount, setQueuedCount] = useState(0);

  const refreshCount = useCallback(async () => {
    try {
      const count = await getQueuedCount();
      setQueuedCount(count);
    } catch {
      // IndexedDB may not be available
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      refreshCount();
    };
    const handleOffline = () => {
      setIsOnline(false);
      refreshCount();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Poll queue count periodically
    refreshCount();
    const interval = setInterval(refreshCount, 5000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [refreshCount]);

  // Don't render when online and no queued items
  if (isOnline && queuedCount === 0) return null;

  return (
    <div
      className={`fixed bottom-4 left-4 z-50 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium shadow-lg transition-all ${
        !isOnline
          ? "bg-red-900/90 text-red-200 border border-red-700"
          : "bg-amber-900/90 text-amber-200 border border-amber-700"
      }`}
    >
      {!isOnline ? (
        <>
          <WifiOff className="w-3.5 h-3.5" />
          <span>Offline</span>
          {queuedCount > 0 && (
            <span className="bg-red-800 px-1.5 py-0.5 rounded text-[10px]">
              {queuedCount} queued
            </span>
          )}
        </>
      ) : queuedCount > 0 ? (
        <>
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>Syncing {queuedCount} item{queuedCount !== 1 ? "s" : ""}...</span>
        </>
      ) : null}
    </div>
  );
}
