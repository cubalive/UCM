import { Router, Request, Response } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { getDb } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { validateBody } from "../middleware/validation.js";
import { authRateLimiter } from "../middleware/rateLimiter.js";
import { recordAudit } from "../services/auditService.js";
import logger from "../lib/logger.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

router.post("/login", authRateLimiter, validateBody(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const db = getDb();

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), eq(users.active, true)));

    if (!user) {
      logger.warn("Login failed: unknown email", { email, ip: req.ip });
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      logger.warn("Login failed: wrong password", { email, userId: user.id, ip: req.ip });
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Block login if password reset is required (imported drivers)
    if (user.mustResetPassword) {
      // Generate a short-lived reset token
      const resetSecret = process.env.JWT_SECRET;
      if (!resetSecret) {
        res.status(500).json({ error: "Server configuration error" });
        return;
      }
      const resetToken = jwt.sign(
        { id: user.id, tenantId: user.tenantId, purpose: "password-reset" },
        resetSecret,
        { expiresIn: "15m" }
      );
      res.status(403).json({
        error: "Password reset required",
        mustResetPassword: true,
        resetToken,
      });
      return;
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      logger.error("JWT_SECRET not configured");
      res.status(500).json({ error: "Server configuration error" });
      return;
    }

    const token = jwt.sign(
      {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        role: user.role,
      },
      secret,
      { expiresIn: "8h" }
    );

    await recordAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "user.login",
      resource: "user",
      resourceId: user.id,
      details: { email: user.email, role: user.role },
    });

    logger.info("User logged in", { userId: user.id, role: user.role, tenantId: user.tenantId });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        tenantId: user.tenantId,
      },
    });
  } catch (err: any) {
    logger.error("Login failed", { error: err.message });
    res.status(500).json({ error: "Login failed" });
  }
});

// Forgot password — user-initiated password reset request
const forgotPasswordSchema = z.object({
  email: z.string().email().max(255),
});

router.post("/forgot-password", authRateLimiter, validateBody(forgotPasswordSchema), async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const db = getDb();

    // Always respond with success to prevent email enumeration
    const successMessage = "If an account with that email exists, a password reset link has been sent.";

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), eq(users.active, true)));

    if (!user) {
      logger.info("Forgot password for unknown email", { email });
      res.json({ success: true, message: successMessage });
      return;
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      logger.error("JWT_SECRET not configured for password reset");
      res.status(500).json({ error: "Server configuration error" });
      return;
    }

    const resetToken = jwt.sign(
      { id: user.id, tenantId: user.tenantId, purpose: "password-reset" },
      secret,
      { expiresIn: "15m" }
    );

    // Build reset URL
    const appUrl = process.env.APP_URL || "http://localhost:5173";
    const baseUrl = appUrl.split(",")[0].trim();
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

    // Send email (fire-and-forget — never block the response)
    const { sendPasswordResetEmail } = await import("../services/emailService.js");
    sendPasswordResetEmail(user.email, user.firstName, resetUrl)
      .catch(err => logger.warn("Failed to send password reset email", { error: err.message, userId: user.id }));

    await recordAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "user.password_reset_requested",
      resource: "user",
      resourceId: user.id,
      details: { method: "forgot_password" },
    });

    logger.info("Password reset requested", { userId: user.id, tenantId: user.tenantId });
    res.json({ success: true, message: successMessage });
  } catch (err: any) {
    logger.error("Forgot password failed", { error: err.message });
    res.status(500).json({ error: "Request failed" });
  }
});

// Password reset — both for imported drivers (forced) and user-initiated (forgot password)
const resetPasswordSchema = z.object({
  resetToken: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

router.post("/reset-password", authRateLimiter, validateBody(resetPasswordSchema), async (req: Request, res: Response) => {
  try {
    const { resetToken, newPassword } = req.body;
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({ error: "Server configuration error" });
      return;
    }

    let payload: any;
    try {
      payload = jwt.verify(resetToken, secret);
    } catch {
      res.status(401).json({ error: "Invalid or expired reset token" });
      return;
    }

    if (payload.purpose !== "password-reset") {
      res.status(401).json({ error: "Invalid reset token" });
      return;
    }

    const db = getDb();
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, payload.id), eq(users.tenantId, payload.tenantId), eq(users.active, true)));

    if (!user) {
      res.status(404).json({ error: "User not found or inactive" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db
      .update(users)
      .set({ passwordHash, mustResetPassword: false, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    const method = user.mustResetPassword ? "import_forced_reset" : "forgot_password";
    await recordAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "user.password_reset",
      resource: "user",
      resourceId: user.id,
      details: { method },
    });

    logger.info("Password reset completed", { userId: user.id, tenantId: user.tenantId });
    res.json({ success: true, message: "Password has been reset. You can now log in." });
  } catch (err: any) {
    logger.error("Password reset failed", { error: err.message });
    res.status(500).json({ error: "Password reset failed" });
  }
});

export default router;
