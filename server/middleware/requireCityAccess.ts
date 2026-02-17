import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { getUserCityIds } from "../auth";

export async function requireCityAccess(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }
  if (req.user.role === "SUPER_ADMIN") {
    return next();
  }
  const cityIdParam = parseInt((req.query.city_id || req.query.cityId || req.params.cityId) as string);
  if (!cityIdParam || isNaN(cityIdParam)) {
    return next();
  }
  const allowedCityIds = await getUserCityIds(req.user.userId, req.user.role);
  if (allowedCityIds.length === 0) {
    return next();
  }
  if (!allowedCityIds.includes(cityIdParam)) {
    return res.status(403).json({ message: "City access denied", code: "CITY_ACCESS_DENIED" });
  }
  next();
}
