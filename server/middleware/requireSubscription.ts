import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { checkCompanyAccess } from "../services/subscriptionService";

export async function requireSubscription(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });

    if (req.user.role === "SUPER_ADMIN") return next();

    const companyId = req.user.companyId;
    if (!companyId) return next();

    const access = await checkCompanyAccess(companyId);
    if (access.allowed) return next();

    return res.status(403).json({
      message: "Subscription required. Your company does not have an active subscription.",
      code: "SUBSCRIPTION_REQUIRED",
      reason: access.reason,
    });
  } catch (err: any) {
    console.error("[SUBSCRIPTION GUARD] Error:", err.message);
    return next();
  }
}
