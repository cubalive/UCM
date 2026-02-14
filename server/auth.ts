import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { users, userCityAccess } from "@shared/schema";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-change-me";

export interface AuthPayload {
  userId: number;
  role: string;
  companyId?: number | null;
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

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const token = header.slice(7);
    const payload = verifyToken(token);
    req.user = payload;
    next();
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
