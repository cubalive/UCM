import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { users, userCityAccess, sessionRevocations } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-change-me";

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
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const token = header.slice(7);
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

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (req.user.role === "SUPER_ADMIN") {
      return next();
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

export function getCompanyIdFromAuth(req: AuthRequest): number | null {
  if (!req.user) return null;
  if (req.user.role === "SUPER_ADMIN") return null;
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
