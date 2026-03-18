/**
 * S1 FIX: MFA Controller
 * Implements TOTP setup, verification, challenge, and disable endpoints.
 * Enforces MFA for ADMIN and SUPER_ADMIN roles.
 */
import type { Response } from "express";
import type { AuthRequest } from "../auth";
import {
  setupTOTP,
  verifyTOTPSetup,
  verifyTOTP,
  useBackupCode,
  disableMFA,
  getMfaStatus,
  MFA_REQUIRED_ROLES,
} from "../lib/mfaEngine";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { signToken, signPreAuthToken, signMfaSetupToken, setAuthCookies, verifyToken } from "../auth";

/**
 * POST /api/auth/mfa/setup
 * Generate TOTP secret + QR code for the authenticated user.
 */
export async function mfaSetupHandler(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const [user] = await db.select().from(users).where(eq(users.id, req.user.userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.mfaEnabled) {
      return res.status(400).json({ error: "MFA is already enabled. Disable it first." });
    }

    const result = await setupTOTP(req.user.userId, user.email);
    return res.json({
      secret: result.secret,
      qrCodeDataUrl: result.qrCodeDataUrl,
      otpauthUri: result.otpauthUri,
    });
  } catch (err: any) {
    console.error("[MFA] Setup error:", err.message);
    return res.status(500).json({ error: "Failed to setup MFA" });
  }
}

/**
 * POST /api/auth/mfa/verify
 * Verify TOTP token during setup and activate MFA. Returns backup codes (shown once).
 */
export async function mfaVerifySetupHandler(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { code } = req.body;
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "TOTP code is required" });
    }

    const result = await verifyTOTPSetup(req.user.userId, code.trim());
    if (!result.success) {
      return res.status(400).json({ error: "Invalid TOTP code" });
    }

    // If user was in mfa_setup scope, upgrade to full token
    if (req.user.scope === "mfa_setup") {
      const [user] = await db.select().from(users).where(eq(users.id, req.user.userId));
      if (user) {
        const fullToken = signToken({
          userId: user.id,
          role: user.role,
          companyId: user.companyId,
          clinicId: user.clinicId,
          driverId: user.driverId,
          pharmacyId: user.pharmacyId,
          brokerId: user.brokerId,
        });
        // Re-import to avoid circular dep issues
        const { signRefreshToken } = await import("../auth");
        const refreshToken = signRefreshToken({ userId: user.id });
        setAuthCookies(res, fullToken, refreshToken, req);
      }
    }

    return res.json({
      success: true,
      backupCodes: result.backupCodes,
      message: "MFA enabled. Save your backup codes securely — they will not be shown again.",
    });
  } catch (err: any) {
    console.error("[MFA] Verify setup error:", err.message);
    return res.status(500).json({ error: "Failed to verify MFA" });
  }
}

/**
 * POST /api/auth/mfa/challenge
 * Validate MFA during login (check TOTP or backup code).
 * Requires a pre-auth token (scope: mfa_pending).
 */
export async function mfaChallengeHandler(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    // Only allow from mfa_pending scope
    if (req.user.scope !== "mfa_pending") {
      return res.status(400).json({ error: "MFA challenge requires pre-auth token" });
    }

    const { code, backupCode } = req.body;
    if (!code && !backupCode) {
      return res.status(400).json({ error: "TOTP code or backup code is required" });
    }

    let verified = false;

    if (backupCode && typeof backupCode === "string") {
      // Try backup code
      const bcResult = await useBackupCode(req.user.userId, backupCode.trim());
      verified = bcResult.success;
    } else if (code && typeof code === "string") {
      // Try TOTP
      const totpResult = await verifyTOTP(req.user.userId, code.trim());
      verified = totpResult.success;
    }

    if (!verified) {
      return res.status(401).json({ error: "Invalid MFA code" });
    }

    // Issue full access token
    const [user] = await db.select().from(users).where(eq(users.id, req.user.userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    const fullToken = signToken({
      userId: user.id,
      role: user.role,
      companyId: user.companyId,
      clinicId: user.clinicId,
      driverId: user.driverId,
      pharmacyId: user.pharmacyId,
      brokerId: user.brokerId,
    });

    const { signRefreshToken } = await import("../auth");
    const refreshToken = signRefreshToken({ userId: user.id });
    setAuthCookies(res, fullToken, refreshToken, req);

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
      },
    });
  } catch (err: any) {
    console.error("[MFA] Challenge error:", err.message);
    return res.status(500).json({ error: "MFA verification failed" });
  }
}

/**
 * POST /api/auth/mfa/disable
 * Disable MFA for the authenticated user. Requires current TOTP code.
 */
export async function mfaDisableHandler(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { code } = req.body;
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Current TOTP code is required to disable MFA" });
    }

    // Verify the code before disabling
    const result = await verifyTOTP(req.user.userId, code.trim());
    if (!result.success) {
      return res.status(401).json({ error: "Invalid TOTP code" });
    }

    await disableMFA(req.user.userId);
    return res.json({ success: true, message: "MFA has been disabled" });
  } catch (err: any) {
    console.error("[MFA] Disable error:", err.message);
    return res.status(500).json({ error: "Failed to disable MFA" });
  }
}

/**
 * GET /api/auth/mfa/status
 * Get MFA status for the authenticated user.
 */
export async function mfaStatusHandler(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const status = await getMfaStatus(req.user.userId);
    return res.json(status);
  } catch (err: any) {
    console.error("[MFA] Status error:", err.message);
    return res.status(500).json({ error: "Failed to get MFA status" });
  }
}

/**
 * Middleware: Enforce MFA for required roles.
 * Blocks ADMIN/SUPER_ADMIN if MFA not active AND session is not MFA-verified.
 */
export function enforceMfa(req: AuthRequest, res: Response, next: Function) {
  if (!req.user) return next();

  // Skip enforcement for MFA endpoints themselves
  if (req.path.startsWith("/api/auth/mfa")) return next();

  // Skip for non-required roles
  if (!MFA_REQUIRED_ROLES.includes(req.user.role)) return next();

  // If token scope is mfa_pending, they need to complete challenge first
  // (already handled by authMiddleware — this is defense-in-depth)
  if (req.user.scope === "mfa_pending" || req.user.scope === "mfa_setup") {
    return res.status(403).json({
      error: "MFA verification required",
      code: "MFA_REQUIRED",
    });
  }

  // Token scope is "full" — MFA was verified during login
  next();
}
