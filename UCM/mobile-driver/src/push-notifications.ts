import { Preferences } from '@capacitor/preferences';

const TOKEN_KEY = 'ucm_driver_jwt';
const PUSH_TOKEN_KEY = 'ucm_push_token';
const API_BASE = 'https://driver.unitedcaremobility.com';

interface PushNotificationsPlugin {
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(eventName: 'registration', handler: (token: { value: string }) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'registrationError', handler: (error: any) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'pushNotificationReceived', handler: (notification: PushNotification) => void): Promise<{ remove: () => void }>;
  addListener(eventName: 'pushNotificationActionPerformed', handler: (action: PushAction) => void): Promise<{ remove: () => void }>;
}

interface PushNotification {
  title?: string;
  body?: string;
  data?: Record<string, string>;
}

interface PushAction {
  notification: PushNotification;
  actionId: string;
}

let pushPlugin: PushNotificationsPlugin | null = null;

function getPlatform(): 'ios' | 'android' | 'web' {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'web';
}

async function getAuthToken(): Promise<string | null> {
  const { value } = await Preferences.get({ key: TOKEN_KEY });
  return value;
}

async function registerTokenWithServer(pushToken: string): Promise<void> {
  const authToken = await getAuthToken();
  if (!authToken) {
    console.warn('[PUSH-CLIENT] No auth token available, skipping server registration');
    return;
  }

  const platform = getPlatform();

  try {
    const res = await fetch(`${API_BASE}/api/driver/push-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ platform, token: pushToken }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      console.error('[PUSH-CLIENT] Failed to register token:', err.message);
      return;
    }

    await Preferences.set({ key: PUSH_TOKEN_KEY, value: pushToken });
    console.log(`[PUSH-CLIENT] Token registered with server (${platform})`);
  } catch (err: any) {
    console.error('[PUSH-CLIENT] Error registering token:', err.message);
  }
}

async function unregisterTokenFromServer(): Promise<void> {
  const { value: pushToken } = await Preferences.get({ key: PUSH_TOKEN_KEY });
  if (!pushToken) return;

  const authToken = await getAuthToken();
  if (!authToken) return;

  try {
    await fetch(`${API_BASE}/api/driver/push-token`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token: pushToken }),
    });
    await Preferences.remove({ key: PUSH_TOKEN_KEY });
    console.log('[PUSH-CLIENT] Token unregistered from server');
  } catch (err: any) {
    console.error('[PUSH-CLIENT] Error unregistering token:', err.message);
  }
}

export async function initPushNotifications(): Promise<void> {
  if (!(window as any).Capacitor?.isNativePlatform?.()) {
    console.log('[PUSH-CLIENT] Not a native platform, skipping push init');
    return;
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    pushPlugin = PushNotifications as any;
  } catch (err) {
    console.warn('[PUSH-CLIENT] @capacitor/push-notifications not available');
    return;
  }

  if (!pushPlugin) return;

  const permResult = await pushPlugin.requestPermissions();
  if (permResult.receive !== 'granted') {
    console.warn('[PUSH-CLIENT] Push permission not granted:', permResult.receive);
    return;
  }

  await pushPlugin.addListener('registration', async (token) => {
    console.log('[PUSH-CLIENT] Received push token:', token.value.slice(0, 20) + '...');
    await registerTokenWithServer(token.value);
  });

  await pushPlugin.addListener('registrationError', (error) => {
    console.error('[PUSH-CLIENT] Registration error:', JSON.stringify(error));
  });

  await pushPlugin.addListener('pushNotificationReceived', (notification) => {
    console.log('[PUSH-CLIENT] Notification received in foreground:', notification.title);
  });

  await pushPlugin.addListener('pushNotificationActionPerformed', (action) => {
    console.log('[PUSH-CLIENT] Notification tapped:', action.actionId);
    handleNotificationTap(action.notification);
  });

  await pushPlugin.register();
  console.log('[PUSH-CLIENT] Push notifications initialized');
}

function handleNotificationTap(notification: PushNotification): void {
  const data = notification.data;
  if (!data) return;

  const { action, tripId } = data;

  if (tripId) {
    if (action === 'trip_offer') {
      window.location.href = '/driver';
    } else if (action === 'go_time') {
      window.location.href = '/driver';
    } else if (action === 'dispatch_message') {
      window.location.href = `/driver`;
    } else {
      window.location.href = '/driver';
    }
  }
}

export async function cleanupPushOnLogout(): Promise<void> {
  await unregisterTokenFromServer();
}

export async function refreshPushTokenAfterLogin(): Promise<void> {
  if (!(window as any).Capacitor?.isNativePlatform?.()) return;

  const { value: existingToken } = await Preferences.get({ key: PUSH_TOKEN_KEY });
  if (existingToken) {
    await registerTokenWithServer(existingToken);
  }
}
