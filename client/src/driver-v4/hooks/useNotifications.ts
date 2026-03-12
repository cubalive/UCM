import { useState, useEffect, useCallback } from "react";
import { resolveUrl, getStoredToken } from "@/lib/api";
import { DRIVER_TOKEN_KEY } from "@/lib/hostDetection";

export type NotificationStatus = "default" | "granted" | "denied" | "unsupported";

interface UseNotificationsResult {
  status: NotificationStatus;
  isSupported: boolean;
  requestPermission: () => Promise<boolean>;
  registerPushToken: () => Promise<boolean>;
}

function getToken(): string | null {
  return localStorage.getItem(DRIVER_TOKEN_KEY) || getStoredToken();
}

export function useNotifications(): UseNotificationsResult {
  const [status, setStatus] = useState<NotificationStatus>("default");

  const isSupported = typeof window !== "undefined" && "Notification" in window;

  useEffect(() => {
    if (!isSupported) {
      setStatus("unsupported");
      return;
    }
    setStatus(Notification.permission as NotificationStatus);
  }, [isSupported]);

  const registerPushToken = useCallback(async (): Promise<boolean> => {
    try {
      if (!("serviceWorker" in navigator)) return false;

      const registration = await navigator.serviceWorker.ready;

      // Try to get existing subscription or create new one
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        // In production, the VAPID public key would come from the server
        // For now, we register what we can
        try {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: undefined,
          });
        } catch {
          // Push manager subscribe may fail without VAPID key - that's okay
          // We'll still send a placeholder token so the server knows we want notifications
        }
      }

      const token = getToken();
      if (!token) return false;

      const pushToken = subscription
        ? JSON.stringify(subscription.toJSON())
        : `web-notification-${Date.now()}`;

      const res = await fetch(resolveUrl("/api/driver/push-token"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          token: pushToken,
          platform: "web",
          userAgent: navigator.userAgent,
        }),
      });

      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    try {
      const result = await Notification.requestPermission();
      setStatus(result as NotificationStatus);

      if (result === "granted") {
        // Register for push after permission granted
        await registerPushToken();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [isSupported, registerPushToken]);

  return {
    status,
    isSupported,
    requestPermission,
    registerPushToken,
  };
}
