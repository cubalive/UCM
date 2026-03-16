import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { users, userCityAccess, sessionRevocations, dispatcherCityPermissions } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { can, type Resource, type Permission } from "@shared/permissions";
import { setWithTtl, getString } from "./lib/redis";

const IS_PROD = process.env.NODE_ENV === "production";

if (IS_PROD && !process.env.JWT_SECRET) {
  console.error("[AUTH] FATAL: JWT_SECRET not set in production. Tokens will be insecure.");
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-dev-only";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET + "-refresh";
const UCM_COOKIE = "ucm_access";
const UCM_REFRESH_COOKIE = "ucm_refresh";
const UCM_CSRF_COOKIE = "ucm_csrf";
// Keep legacy cookie name for clearing on login (migration)
const LEGACY_COOKIE = "ucm_session";

const ACCESS_TOKEN_MAX_AGE = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCookieDomain(req: Request): string | undefined {
  const host = req.hostname || req.headers.host || "";
  if (host.endsWith("unitedcaremobility.com")) {
    return ".unitedcaremobility.com";
  }
  return undefined;
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string, req: Request): void {
  const domain = getCookieDomain(req);
  const sameSite: "strict" | "lax" | "none" = IS_PROD ? "strict" : "lax";

  // httpOnly access token cookie — 15 min
  res.cookie(UCM_COOKIE, accessToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite,
    domain,
    maxAge: ACCESS_TOKEN_MAX_AGE,
    path: "/",
  });

  // httpOnly refresh token cookie — 7 days, restricted to refresh path
  res.cookie(UCM_REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite,
    domain,
    maxAge: REFRESH_TOKEN_MAX_AGE,
    path: "/api/auth/refresh",
  });

  // CSRF token — readable by JS (not httpOnly), used as double-submit cookie
  const csrfToken = generateCsrfToken();
  res.cookie(UCM_CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: IS_PROD,
    sameSite,
    domain,
    maxAge: ACCESS_TOKEN_MAX_AGE,
    path: "/",
  });

  // Clear legacy cookie if present
  res.clearCookie(LEGACY_COOKIE, { domain, path: "/" });
}

/** @deprecated Use setAuthCookies instead. Kept for backward compat during migration. */
export function setAuthCookie(res: Response, token: string, req: Request): void {
  const refreshToken = signRefreshToken({ userId: (jwt.decode(token) as any)?.userId });
  setAuthCookies(res, token, refreshToken, req);
}

export function clearAuthCookies(res: Response, req: Request): void {
  const domain = getCookieDomain(req);
  const sameSite: "strict" | "lax" | "none" = IS_PROD ? "strict" : "lax";
  res.clearCookie(UCM_COOKIE, { httpOnly: true, secure: IS_PROD, sameSite, domain, path: "/" });
  res.clearCookie(UCM_REFRESH_COOKIE, { httpOnly: true, secure: IS_PROD, sameSite, domain, path: "/api/auth/refresh" });
  res.clearCookie(UCM_CSRF_COOKIE, { httpOnly: false, secure: IS_PROD, sameSite, domain, path: "/" });
  res.clearCookie(LEGACY_COOKIE, { domain, path: "/" });
}

/** @deprecated Use clearAuthCookies instead */
export function clearAuthCookie(res: Response, req: Request): void {
  clearAuthCookies(res, req);
}

export interface AuthPayload {
  userId: number;
  role: string;
  companyId?: number | null;
  clinicId?: number | null;
  driverId?: number | null;
  pharmacyId?: number | null;
  brokerId?: number | null;
  iat?: number;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });
}

export function signRefreshToken(payload: { userId: number }): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

export function verifyRefreshToken(token: string): { userId: number } {
  return jwt.verify(token, REFRESH_SECRET) as { userId: number };
}

/**
 * Revoke a specific token by storing its hash in Redis.
 * TTL = 24h (longer than any token validity).
 */
export async function revokeToken(token: string): Promise<void> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await setWithTtl(`revoked_token:${tokenHash}`, "1", 86400);
}

/**
 * Check if a token has been revoked via Redis.
 * Uses a short in-memory cache (3 seconds max) for performance.
 */
const revokedCheckCache = new Map<string, { revoked: boolean; cachedAt: number }>();
const REVOKED_CACHE_TTL = 3_000; // 3 seconds max

export async function isTokenRevoked(token: string): Promise<boolean> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const cached = revokedCheckCache.get(tokenHash);
  if (cached && (Date.now() - cached.cachedAt) < REVOKED_CACHE_TTL) {
    return cached.revoked;
  }

  try {
    const val = await getString(`revoked_token:${tokenHash}`);
    const revoked = val === "1";
    revokedCheckCache.set(tokenHash, { revoked, cachedAt: Date.now() });
    // Prune cache periodically
    if (revokedCheckCache.size > 10000) {
      const now = Date.now();
      for (const [k, v] of revokedCheckCache) {
        if (now - v.cachedAt > REVOKED_CACHE_TTL) revokedCheckCache.delete(k);
      }
    }
    return revoked;
  } catch {
    return false;
  }
}

/**
 * Revoke ALL tokens for a user (e.g. on password change).
 * Inserts a session revocation record so all tokens issued before now are invalid.
 */
export async function revokeAllUserTokens(userId: number): Promise<void> {
  try {
    await db.insert(sessionRevocations).values({
      userId,
      revokedAfter: new Date(),
    });
    invalidateRevocationCache(userId);
  } catch (err) {
    console.error("[AUTH] Failed to revoke all user tokens:", err);
  }
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
const REVOCATION_CACHE_TTL = 3_000; // 3 seconds — maximum acceptable window for medical data

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

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  let token: string | undefined;

  // Priority: 1) httpOnly access cookie, 2) legacy session cookie, 3) Bearer header (for driver app / mobile)
  if (req.cookies?.[UCM_COOKIE]) {
    token = req.cookies[UCM_COOKIE];
  } else if (req.cookies?.[LEGACY_COOKIE]) {
    token = req.cookies[LEGACY_COOKIE];
  } else {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      token = header.slice(7);
    }
  }

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Check per-token revocation via Redis (3s cache max)
  try {
    const revoked = await isTokenRevoked(token);
    if (revoked) {
      return res.status(401).json({ message: "Token revoked", code: "SESSION_REVOKED" });
    }
  } catch {
    // Redis failure — proceed with other checks
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;

    // All roles including SUPER_ADMIN are subject to session revocation.
    // A compromised SUPER_ADMIN token must be revocable.
    try {
      const revokedAfterSec = await getLatestRevocation(payload.userId);
      if (revokedAfterSec && payload.iat && payload.iat < revokedAfterSec) {
        return res.status(401).json({ message: "Session revoked", code: "SESSION_REVOKED" });
      }
      next();
    } catch {
      next();
    }
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

export function normalizeRole(role: string): string {
  return role;
}

export const CLINIC_SCOPED_ROLES = ["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"];

export function isDispatchLevel(role: string): boolean {
  return ["SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"].includes(role);
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
  return CLINIC_SCOPED_ROLES.includes(user.role) && user.clinicId != null;
}

export function isPatientUser(user: UserProfile): boolean {
  const role = normalizeRole(user.role);
  return role === "VIEWER" && user.patientId != null && user.clinicId == null;
}

export function isDriverUser(user: UserProfile): boolean {
  return user.role === "DRIVER" && user.driverId != null;
}

function logAccessDenied(req: AuthRequest, reason: string, extra?: Record<string, unknown>) {
  const entry: Record<string, unknown> = {
    level: "warn",
    event: "access_denied",
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    reason,
  };
  if (req.user) {
    entry.userId = req.user.userId;
    entry.role = req.user.role;
    entry.companyId = req.user.companyId ?? null;
  }
  if (extra) Object.assign(entry, extra);
  console.log(JSON.stringify(entry));
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
    logAccessDenied(req, "role_mismatch", { requiredRoles: roles, actualRole: req.user.role });
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  };
}

export function requirePermission(resource: Resource, permission: Permission = "read") {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
    }
    const effective = normalizeRole(req.user.role);
    if (can(effective, resource, permission)) {
      return next();
    }
    logAccessDenied(req, "permission_denied", { resource, permission, actualRole: req.user.role });
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  };
}

const OPS_DENIED_ROLES = ["DRIVER"];
export function opsRouteGuard(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }
  if (OPS_DENIED_ROLES.includes(req.user.role)) {
    logAccessDenied(req, "ops_route_denied", { actualRole: req.user.role });
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  next();
}

/**
 * Immutable audit log for SUPER_ADMIN company impersonation.
 * HIPAA requires an immutable record of cross-tenant access.
 */
async function auditSuperAdminImpersonation(req: AuthRequest, targetCompanyId: number): Promise<void> {
  const { logAudit } = require("./middleware/logAudit");
  await logAudit(
    "SUPER_ADMIN_COMPANY_IMPERSONATION",
    "company",
    targetCompanyId,
    {
      targetCompanyId,
      requestPath: req.path,
      requestMethod: req.method,
    },
    null,
    req.user!.userId,
    {
      companyId: targetCompanyId,
      actorRole: req.user!.role,
      req,
    }
  );
}

// Rate limit impersonation: max 100 per hour per SUPER_ADMIN
const impersonationCounts = new Map<number, { count: number; windowStart: number }>();
const IMPERSONATION_MAX = 100;
const IMPERSONATION_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const IMPERSONATION_ALERT_THRESHOLD = 10;
const IMPERSONATION_ALERT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function checkImpersonationRateLimit(userId: number): boolean {
  const now = Date.now();
  let entry = impersonationCounts.get(userId);
  if (!entry || (now - entry.windowStart) > IMPERSONATION_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    impersonationCounts.set(userId, entry);
  }
  entry.count++;
  if (entry.count > IMPERSONATION_MAX) {
    return false;
  }
  // Alert check: if > 10 in 5 minutes
  if (entry.count >= IMPERSONATION_ALERT_THRESHOLD && (now - entry.windowStart) < IMPERSONATION_ALERT_WINDOW_MS) {
    console.warn(JSON.stringify({
      event: "impersonation_alert",
      severity: "HIGH",
      userId,
      count: entry.count,
      windowMinutes: Math.round((now - entry.windowStart) / 60000),
      message: `SUPER_ADMIN userId=${userId} performed ${entry.count} impersonations in ${Math.round((now - entry.windowStart) / 60000)} minutes`,
      ts: new Date().toISOString(),
    }));
  }
  return true;
}

export function getCompanyIdFromAuth(req: AuthRequest): number | null {
  const tenantId = (req as any).tenantId;
  if (tenantId) return tenantId;

  if (!req.user) return null;
  if (req.user.role === "SUPER_ADMIN") {
    const headerVal = req.headers["x-ucm-company-id"];
    if (headerVal) {
      const parsed = parseInt(String(headerVal), 10);
      if (!isNaN(parsed) && parsed > 0) {
        // Rate limit check
        if (!checkImpersonationRateLimit(req.user.userId)) {
          console.error(JSON.stringify({
            event: "impersonation_rate_limited",
            severity: "CRITICAL",
            userId: req.user.userId,
            targetCompanyId: parsed,
            ts: new Date().toISOString(),
          }));
          return null; // Deny impersonation
        }
        // Audit trail — fire-and-forget but log errors
        auditSuperAdminImpersonation(req, parsed).catch((err) => {
          console.error("[AUTH] Failed to audit SUPER_ADMIN impersonation:", err);
        });
        return parsed;
      }
    }
    return null;
  }
  return req.user.companyId || null;
}

export function applyCompanyFilter<T extends { companyId?: number | null }>(items: T[], companyId: number | null): T[] {
  if (!companyId) return items;
  return items.filter(item => item.companyId === companyId);
}

export function checkCompanyOwnership(entity: { companyId?: number | null } | undefined, companyId: number | null): boolean {
  if (!entity) return false;
  if (!companyId) return false;
  return entity.companyId === companyId;
}

export async function getUserCityIds(userId: number, role: string, companyId?: number | null): Promise<number[]> {
  if (role === "SUPER_ADMIN") return [];
  if (role === "DISPATCH" && companyId) {
    const rows = await db
      .select({ cityId: dispatcherCityPermissions.cityId })
      .from(dispatcherCityPermissions)
      .where(
        and(
          eq(dispatcherCityPermissions.userId, userId),
          eq(dispatcherCityPermissions.companyId, companyId),
        ),
      );
    return rows.map((r) => r.cityId);
  }
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
  let effectiveCompanyId = companyId || null;
  if (role === "SUPER_ADMIN") {
    const headerVal = req.headers["x-ucm-company-id"];
    if (headerVal) {
      const parsed = parseInt(String(headerVal), 10);
      if (!isNaN(parsed) && parsed > 0) {
        effectiveCompanyId = parsed;
        // Audit is already handled by getCompanyIdFromAuth — no need to duplicate
      }
    }
  }
  const allowedCityIds = await getUserCityIds(userId, role, effectiveCompanyId);
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

/**
 * CSRF protection middleware — validates X-CSRF-Token header against ucm_csrf cookie.
 * Only applies to state-changing methods (POST, PUT, PATCH, DELETE).
 * Skips CSRF for:
 *   - Bearer token auth (mobile/driver app — not cookie-based)
 *   - Stripe webhooks (use Stripe-Signature instead)
 *   - Public API endpoints
 */
/**
 * Paths to skip CSRF validation (relative to /api mount point).
 * Since this middleware is mounted via app.use("/api", csrfProtection),
 * req.path inside the handler does NOT include the "/api" prefix.
 */
const CSRF_SKIP_PATHS = new Set([
  "/stripe/webhook",
  "/stripe-connect/webhook",
  "/broker-api/v1",
]);

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Only validate on state-changing methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  // Skip CSRF for non-cookie auth (Bearer token from mobile apps)
  const hasBearer = req.headers.authorization?.startsWith("Bearer ");
  const hasCookieAuth = req.cookies?.[UCM_COOKIE] || req.cookies?.[LEGACY_COOKIE];
  if (hasBearer && !hasCookieAuth) {
    return next();
  }

  // Skip CSRF for webhook/public paths
  for (const skipPath of CSRF_SKIP_PATHS) {
    if (req.path.startsWith(skipPath)) return next();
  }
  if (req.path.startsWith("/public/")) return next();

  // Skip CSRF for login/auth endpoints that don't yet have a session
  if (req.path === "/auth/login" || req.path === "/auth/login-jwt" || req.path === "/auth/token-login" || req.path === "/auth/forgot-password") {
    return next();
  }

  const csrfCookie = req.cookies?.[UCM_CSRF_COOKIE];
  const csrfHeader = req.headers["x-csrf-token"] as string;

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return res.status(403).json({ message: "CSRF token validation failed", code: "CSRF_INVALID" });
  }

  next();
}
