import { useState, useEffect } from "react";
import { WifiOff, RefreshCw } from "lucide-react";

export function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (wasOffline) {
        setTimeout(() => setWasOffline(false), 3000);
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [wasOffline]);

  if (isOnline && !wasOffline) return null;

  if (!isOnline) {
    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a1a14]/95 backdrop-blur-sm"
        data-testid="overlay-offline"
      >
        <div className="text-center space-y-4 px-6 max-w-sm">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
            <WifiOff className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-white">No Internet Connection</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            UCM requires an internet connection to work. Please check your Wi-Fi or cellular data and try again.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
            data-testid="button-retry-connection"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9998] bg-green-600 text-white text-center py-1 text-xs font-medium animate-in slide-in-from-top"
      data-testid="banner-back-online"
    >
      Back online
    </div>
  );
}
