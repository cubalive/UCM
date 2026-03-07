import admin from "firebase-admin";
import { db } from "../db";
import { driverPushTokens, drivers } from "@shared/schema";
import { eq, and } from "drizzle-orm";

let firebaseApp: admin.app.App | null = null;
let messaging: admin.messaging.Messaging | null = null;

function initFirebase(): boolean {
  if (firebaseApp) return true;
  
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    console.warn("[PUSH] FIREBASE_SERVICE_ACCOUNT_JSON not set. Push notifications disabled.");
    return false;
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    messaging = firebaseApp.messaging();
    console.log("[PUSH] Firebase Admin SDK initialized");
    return true;
  } catch (err: any) {
    console.error(`[PUSH] Failed to initialize Firebase: ${err.message}`);
    return false;
  }
}

initFirebase();

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendPushToDriver(driverId: number, payload: PushPayload): Promise<{ sent: number; failed: number; cleaned: number }> {
  if (!messaging) {
    console.log(`[PUSH] Skipping push to driver ${driverId} — Firebase not initialized`);
    return { sent: 0, failed: 0, cleaned: 0 };
  }

  const tokens = await db.select().from(driverPushTokens).where(eq(driverPushTokens.driverId, driverId));
  if (tokens.length === 0) {
    return { sent: 0, failed: 0, cleaned: 0 };
  }

  let sent = 0;
  let failed = 0;
  let cleaned = 0;
  const staleTokenIds: number[] = [];

  for (const t of tokens) {
    try {
      await messaging!.send({
        token: t.token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data || {},
        android: {
          priority: "high",
          notification: {
            channelId: "ucm_driver",
            sound: "default",
          },
        },
        apns: {
          payload: {
            aps: {
              sound: "default",
              badge: 1,
            },
          },
        },
      });
      sent++;

      await db.update(driverPushTokens)
        .set({ lastSeenAt: new Date() })
        .where(eq(driverPushTokens.id, t.id));
    } catch (err: any) {
      failed++;
      const code = err?.code || err?.errorInfo?.code || "";
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument"
      ) {
        staleTokenIds.push(t.id);
      }
      console.warn(`[PUSH] Failed to send to token ${t.id} for driver ${driverId}: ${err.message}`);
    }
  }

  if (staleTokenIds.length > 0) {
    for (const id of staleTokenIds) {
      await db.delete(driverPushTokens).where(eq(driverPushTokens.id, id));
    }
    cleaned = staleTokenIds.length;
    console.log(`[PUSH] Cleaned ${cleaned} stale tokens for driver ${driverId}`);
  }

  console.log(`[PUSH] Driver ${driverId}: sent=${sent}, failed=${failed}, cleaned=${cleaned}`);
  return { sent, failed, cleaned };
}

export async function sendPushToMultipleDrivers(driverIds: number[], payload: PushPayload): Promise<void> {
  for (const driverId of driverIds) {
    try {
      await sendPushToDriver(driverId, payload);
    } catch (err: any) {
      console.error(`[PUSH] Error sending to driver ${driverId}: ${err.message}`);
    }
  }
}

export function isPushEnabled(): boolean {
  return messaging !== null;
}

export async function registerPushToken(driverId: number, companyId: number | null, platform: "ios" | "android" | "web", token: string): Promise<void> {
  const existing = await db.select().from(driverPushTokens)
    .where(and(eq(driverPushTokens.driverId, driverId), eq(driverPushTokens.token, token)));

  if (existing.length > 0) {
    await db.update(driverPushTokens)
      .set({ lastSeenAt: new Date(), platform })
      .where(eq(driverPushTokens.id, existing[0].id));
    return;
  }

  await db.insert(driverPushTokens).values({
    driverId,
    companyId,
    platform,
    token,
    lastSeenAt: new Date(),
  });
  console.log(`[PUSH] Registered ${platform} token for driver ${driverId}`);
}

export async function unregisterPushToken(driverId: number, token: string): Promise<void> {
  await db.delete(driverPushTokens)
    .where(and(eq(driverPushTokens.driverId, driverId), eq(driverPushTokens.token, token)));
  console.log(`[PUSH] Unregistered token for driver ${driverId}`);
}
