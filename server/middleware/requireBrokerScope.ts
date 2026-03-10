import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";

export const BROKER_SCOPED_ROLES = ["BROKER_ADMIN", "BROKER_USER"];

export function requireBrokerScope(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }

  if (req.user.role === "SUPER_ADMIN") {
    return next();
  }

  if (BROKER_SCOPED_ROLES.includes(req.user.role)) {
    if (!req.user.brokerId) {
      return res.status(403).json({
        message: "Broker context required",
        code: "BROKER_SCOPE_REQUIRED",
      });
    }
    (req as any).brokerScopeId = req.user.brokerId;
    return next();
  }

  if (["ADMIN", "COMPANY_ADMIN"].includes(req.user.role)) {
    return next();
  }

  return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
}

export function getBrokerScopeId(req: AuthRequest): number | null {
  return (req as any).brokerScopeId ?? req.user?.brokerId ?? null;
}

export function requireBrokerAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }

  if (req.user.role === "SUPER_ADMIN" || req.user.role === "ADMIN") {
    return next();
  }

  if (req.user.role === "BROKER_ADMIN" && req.user.brokerId) {
    (req as any).brokerScopeId = req.user.brokerId;
    return next();
  }

  return res.status(403).json({ message: "Forbidden: BROKER_ADMIN role required", code: "FORBIDDEN" });
}
