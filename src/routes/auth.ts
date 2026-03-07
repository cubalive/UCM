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

export default router;
