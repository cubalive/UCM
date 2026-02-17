import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { users, userCityAccess, sessionRevocations } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

const IS_PROD = process.env.NODE_ENV === "production";

if (IS_PROD && !process.env.JWT_SECRET) {
  console.error("[AUTH] FATAL: JWT_SECRET not set in production. Tokens will be insecure.");
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-dev-only";
const UCM_COOKIE = "ucm_session";

function getCookieDomain(req: Request): string | undefined {
  const host = req.hostname || req.headers.host || "";
  if (host.endsWith("unitedcaremobility.com")) {
    return ".unitedcaremobility.com";
  }
  return undefined;
}

export function setAuthCookie(res: Response, token: string, req: Request): void {
  const domain = getCookieDomain(req);
  res.cookie(UCM_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "none" : "lax",
    domain,
    maxAge: 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearAuthCookie(res: Response, req: Request): void {
  const domain = getCookieDomain(req);
  res.clearCookie(UCM_COOKIE, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "none" : "lax",
    domain,
    path: "/",
  });
}

export interface AuthPayload {
  userId: number;
  role: string;
  companyId?: number | null;
  iat?: number;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

const revocationCache = new Map<number, { revokedAfter: number; cachedAt: number }>();
const REVOCATION_CACHE_TTL = 30_000;

async function getLatestRevocation(userId: number): Promise<number | null> {
  const cached = revocationCache.get(userId);
  if (cached && (Date.now() - cached.cachedAt) < REVOCATION_CACHE_TTL) {
    return cached.revokedAfter;
  }
  try {
    const rows = await db
      .select({ revokedAfter: sessionRevocations.revokedAfter })
      .from(sessionRevocations)
      .where(eq(sessionRevocations.userId, userId))
      .orderBy(desc(sessionRevocations.revokedAfter))
      .limit(1);
    if (rows.length > 0) {
      const ts = rows[0].revokedAfter.getTime() / 1000;
      revocationCache.set(userId, { revokedAfter: ts, cachedAt: Date.now() });
      return ts;
    }
    revocationCache.set(userId, { revokedAfter: 0, cachedAt: Date.now() });
    return null;
  } catch {
    return null;
  }
}

export function invalidateRevocationCache(userId: number): void {
  revocationCache.delete(userId);
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  let token: string | undefined;

  if (header?.startsWith("Bearer ")) {
    token = header.slice(7);
  } else if (req.cookies?.[UCM_COOKIE]) {
    token = req.cookies[UCM_COOKIE];
  }

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;

    if (payload.role === "SUPER_ADMIN") {
      return next();
    }

    getLatestRevocation(payload.userId).then((revokedAfterSec) => {
      if (revokedAfterSec && payload.iat && payload.iat < revokedAfterSec) {
        return res.status(401).json({ message: "Session revoked", code: "SESSION_REVOKED" });
      }
      next();
    }).catch(() => next());
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

export function normalizeRole(role: string): string {
  if (role === "CLINIC_USER") return "VIEWER";
  return role;
}

export function isDispatchLevel(role: string): boolean {
  return ["SUPER_ADMIN", "ADMIN", "DISPATCH"].includes(role);
}

export function isCompanyScoped(user: AuthPayload): boolean {
  return user.role === "COMPANY_ADMIN" && user.companyId != null;
}

export interface UserProfile {
  role: string;
  clinicId?: number | null;
  patientId?: number | null;
  driverId?: number | null;
}

export function isClinicUser(user: UserProfile): boolean {
  const role = normalizeRole(user.role);
  return role === "VIEWER" && user.clinicId != null;
}

export function isPatientUser(user: UserProfile): boolean {
  const role = normalizeRole(user.role);
  return role === "VIEWER" && user.patientId != null && user.clinicId == null;
}

export function isDriverUser(user: UserProfile): boolean {
  return user.role === "DRIVER" && user.driverId != null;
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
    }
    if (req.user.role === "SUPER_ADMIN") {
      return next();
    }
    const effective = normalizeRole(req.user.role);
    if (roles.includes(req.user.role) || roles.includes(effective)) {
      return next();
    }
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  };
}

const OPS_DENIED_ROLES = ["DRIVER", "CLINIC_USER"];
export function opsRouteGuard(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }
  if (OPS_DENIED_ROLES.includes(req.user.role)) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  next();
}

export function getCompanyIdFromAuth(req: AuthRequest): number | null {
  if (!req.user) return null;
  if (req.user.role === "SUPER_ADMIN") {
    const headerVal = req.headers["x-ucm-company-id"];
    if (headerVal) {
      const parsed = parseInt(String(headerVal), 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return null;
  }
  return req.user.companyId || null;
}

export function applyCompanyFilter<T extends { companyId?: number | null }>(items: T[], companyId: number | null): T[] {
  if (!companyId) return items;
  return items.filter(item => item.companyId === companyId || item.companyId === null);
}

export function checkCompanyOwnership(entity: { companyId?: number | null } | undefined, companyId: number | null): boolean {
  if (!entity) return false;
  if (!companyId) return true;
  return entity.companyId === companyId || entity.companyId === null;
}

export async function getUserCityIds(userId: number, role: string): Promise<number[]> {
  if (role === "SUPER_ADMIN") return [];
  const access = await db
    .select({ cityId: userCityAccess.cityId })
    .from(userCityAccess)
    .where(eq(userCityAccess.userId, userId));
  return access.map((a) => a.cityId);
}

export interface ActorContext {
  userId: number;
  role: string;
  companyId: number | null;
  clinicId: number | null;
  driverId: number | null;
  cityId: number | null;
  allowedCityIds: number[];
}

export async function getActorContext(req: AuthRequest): Promise<ActorContext | null> {
  if (!req.user) return null;
  const { userId, role, companyId } = req.user;
  const user = await db
    .select({ clinicId: users.clinicId, driverId: users.driverId })
    .from(users)
    .where(eq(users.id, userId))
    .then(r => r[0]);
  const allowedCityIds = await getUserCityIds(userId, role);
  let effectiveCompanyId = companyId || null;
  if (role === "SUPER_ADMIN") {
    const headerVal = req.headers["x-ucm-company-id"];
    if (headerVal) {
      const parsed = parseInt(String(headerVal), 10);
      if (!isNaN(parsed) && parsed > 0) effectiveCompanyId = parsed;
    }
  }
  return {
    userId,
    role,
    companyId: effectiveCompanyId,
    clinicId: user?.clinicId || null,
    driverId: user?.driverId || null,
    cityId: allowedCityIds.length === 1 ? allowedCityIds[0] : null,
    allowedCityIds,
  };
}
