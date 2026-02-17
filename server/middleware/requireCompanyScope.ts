import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";

export function requireCompanyScope(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }
  if (req.user.role === "SUPER_ADMIN") {
    return next();
  }
  if (["COMPANY_ADMIN", "ADMIN", "DISPATCH"].includes(req.user.role) && !req.user.companyId) {
    return res.status(403).json({ message: "Company scope required", code: "COMPANY_SCOPE_REQUIRED" });
  }
  next();
}
