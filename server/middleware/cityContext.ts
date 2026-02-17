import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { getUserCityIds } from "../auth";

export function getCityIdFromRequest(req: AuthRequest): number | undefined {
  const fromQuery = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
  if (fromQuery && !isNaN(fromQuery)) return fromQuery;
  const fromHeader = req.headers["x-city-id"];
  if (fromHeader) {
    const parsed = parseInt(fromHeader as string);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
}

export async function getAllowedCityId(req: AuthRequest): Promise<number | undefined> {
  const cityId = getCityIdFromRequest(req);
  if (!cityId) return undefined;
  if (req.user!.role === "SUPER_ADMIN") return cityId;
  const allowed = await getUserCityIds(req.user!.userId, req.user!.role);
  if (!allowed.includes(cityId)) return -1;
  return cityId;
}

export function enforceCityContext(req: AuthRequest, res: Response): number | undefined | false {
  const role = req.user?.role || "";
  const cityId = getCityIdFromRequest(req);
  if (role === "SUPER_ADMIN") {
    return cityId || undefined;
  }
  if (["ADMIN", "DISPATCH", "COMPANY_ADMIN"].includes(role)) {
    if (!cityId) {
      res.status(400).json({ message: "CITY_REQUIRED", error: "You must select a working city before accessing data." });
      return false;
    }
    return cityId;
  }
  return cityId || undefined;
}

export async function checkCityAccess(req: AuthRequest, cityId: number | undefined): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === "SUPER_ADMIN") return true;
  if (!cityId) return true;
  const allowed = await getUserCityIds(req.user.userId, req.user.role);
  return allowed.includes(cityId);
}
