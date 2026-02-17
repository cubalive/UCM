import { db } from "../db";
import { systemEvents } from "@shared/schema";

interface SystemEventData {
  companyId?: number | null;
  actorUserId?: number | null;
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown>;
}

export async function logSystemEvent(data: SystemEventData): Promise<void> {
  try {
    await db.insert(systemEvents).values({
      companyId: data.companyId ?? null,
      actorUserId: data.actorUserId ?? null,
      eventType: data.eventType,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
      payload: data.payload ?? {},
    });
  } catch (err: any) {
    console.error(`[SYSTEM-EVENT] Failed to log event "${data.eventType}": ${err.message}`);
  }
}

export async function getSystemEvents(
  companyId: number | null,
  options?: { limit?: number; eventType?: string; entityType?: string }
): Promise<any[]> {
  const { limit = 100, eventType, entityType } = options || {};
  const conditions: any[] = [];

  if (companyId) {
    const { eq } = await import("drizzle-orm");
    conditions.push(eq(systemEvents.companyId, companyId));
  }
  if (eventType) {
    const { eq } = await import("drizzle-orm");
    conditions.push(eq(systemEvents.eventType, eventType));
  }
  if (entityType) {
    const { eq } = await import("drizzle-orm");
    conditions.push(eq(systemEvents.entityType, entityType));
  }

  const { desc, and } = await import("drizzle-orm");
  const query = db.select().from(systemEvents);
  if (conditions.length > 0) {
    return query.where(and(...conditions)).orderBy(desc(systemEvents.createdAt)).limit(limit);
  }
  return query.orderBy(desc(systemEvents.createdAt)).limit(limit);
}
