import { db } from "../db";
import { billingAuditEvents } from "@shared/schema";
import type { AuthRequest } from "../auth";

interface AuditParams {
  actorUserId?: number | null;
  actorRole?: string | null;
  scopeClinicId?: number | null;
  scopeCompanyId?: number | null;
  action: string;
  entityType: string;
  entityId: string | number;
  details?: Record<string, any>;
  req?: AuthRequest;
}

export async function writeBillingAudit(params: AuditParams): Promise<void> {
  try {
    await db.insert(billingAuditEvents).values({
      actorUserId: params.actorUserId ?? null,
      actorRole: params.actorRole ?? null,
      scopeClinicId: params.scopeClinicId ?? null,
      scopeCompanyId: params.scopeCompanyId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: String(params.entityId),
      details: params.details ?? null,
      ip: params.req ? (params.req.headers["x-forwarded-for"] as string || params.req.ip || null) : null,
      userAgent: params.req?.headers["user-agent"] || null,
    });
  } catch (err: any) {
    console.error("[BillingAudit] Write failed:", err.message);
  }
}

export function auditFromRequest(req: AuthRequest): Partial<AuditParams> {
  return {
    actorUserId: req.user?.userId,
    actorRole: req.user?.role,
    req,
  };
}
