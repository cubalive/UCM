import { Request } from "express";
import { getDb } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import logger from "../lib/logger.js";

export interface AuditEntry {
  tenantId?: string;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Build audit entry from an Express request — auto-populates tenant, user, IP, and user-agent.
 */
export function auditFromRequest(req: Request, data: Omit<AuditEntry, "tenantId" | "userId" | "ipAddress" | "userAgent">): AuditEntry {
  return {
    tenantId: req.tenantId,
    userId: req.user?.id,
    ipAddress: req.ip || (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim(),
    userAgent: req.headers["user-agent"]?.slice(0, 256),
    ...data,
  };
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const db = getDb();
    await db.insert(auditLog).values({
      tenantId: entry.tenantId,
      userId: entry.userId,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId,
      details: entry.details || {},
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    });
  } catch (err: any) {
    logger.error("Failed to write audit log", { error: err.message, entry });
  }
}
