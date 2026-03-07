import { storage } from "../storage";

export async function logAudit(
  action: string,
  entity: string,
  entityId: number | null,
  details: string | Record<string, unknown> | null,
  cityId: number | null,
  userId: number | null
): Promise<void> {
  try {
    const detailStr = details
      ? typeof details === "string"
        ? details
        : JSON.stringify(details)
      : null;
    await storage.createAuditLog({
      action,
      entity,
      entityId: entityId ?? undefined,
      details: detailStr,
      cityId: cityId ?? undefined,
      userId: userId ?? undefined,
    });
  } catch (err) {
    console.error("[AUDIT] Failed to write audit log:", err);
  }
}
