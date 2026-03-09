import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import logger from "../lib/logger.js";

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      tenantId?: string;
      requestId?: string;
    }
  }
}

const UCM_COOKIE = "ucm_session";

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  let token: string | undefined;

  // 1. Bearer token (API clients, mobile apps)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }
  // 2. Cookie-based auth (web app, cross-subdomain SSO)
  else if (req.cookies?.[UCM_COOKIE]) {
    token = req.cookies[UCM_COOKIE];
  }

  if (!token) {
    res.status(401).json({ error: "Missing or invalid authorization" });
    return;
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET not configured");

    const payload = jwt.verify(token, secret) as AuthUser;
    req.user = payload;
    req.tenantId = payload.tenantId;
    next();
  } catch (err: any) {
    logger.warn("Authentication failed", { error: err.message, ip: req.ip });
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      logger.warn("Authorization denied", {
        userId: req.user.id,
        role: req.user.role,
        required: roles,
        path: req.path,
      });
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function tenantIsolation(req: Request, res: Response, next: NextFunction): void {
  if (!req.tenantId) {
    res.status(400).json({ error: "Tenant context required" });
    return;
  }
  next();
}
