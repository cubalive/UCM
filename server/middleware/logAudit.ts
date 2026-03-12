import { storage } from "../storage";
import type { AuthRequest } from "../auth";

export async function logAudit(
  action: string,
  entity: string,
  entityId: number | null,
  details: string | Record<string, unknown> | null,
  cityId: number | null,
  userId: number | null,
  options?: {
    companyId?: number | null;
    actorRole?: string | null;
    req?: AuthRequest;
  }
): Promise<void> {
  try {
    const detailStr = details
      ? typeof details === "string"
        ? details
        : JSON.stringify(details)
      : null;

    let metadataJson: Record<string, unknown> | undefined;
    if (options?.req) {
      const forwarded = options.req.headers["x-forwarded-for"];
      const ip = typeof forwarded === "string"
        ? forwarded.split(",")[0].trim()
        : options.req.ip || options.req.socket.remoteAddress || "unknown";
      metadataJson = {
        ip,
        userAgent: (options.req.headers["user-agent"] || "").slice(0, 200),
        requestId: options.req.requestId,
      };
    }

    await storage.createAuditLog({
      action,
      entity,
      entityId: entityId ?? undefined,
      details: detailStr,
      cityId: cityId ?? undefined,
      userId: userId ?? undefined,
      companyId: options?.companyId ?? undefined,
      actorRole: options?.actorRole ?? undefined,
      metadataJson,
    });
  } catch (err) {
    console.error("[AUDIT] Failed to write audit log:", err);
  }
}
