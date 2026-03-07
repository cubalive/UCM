import type { Response } from "express";
import { storage } from "../storage";
import { hashPassword, type AuthRequest, CLINIC_SCOPED_ROLES } from "../auth";
import { generatePublicId } from "../public-id";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";

const ALLOWED_CLINIC_ROLES = ["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"] as const;

const createClinicUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4).optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(ALLOWED_CLINIC_ROLES).default("CLINIC_USER"),
  phone: z.string().nullable().optional(),
});

const updateClinicUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.enum(ALLOWED_CLINIC_ROLES).optional(),
  phone: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

function getCallerClinicContext(req: AuthRequest): { clinicId: number; companyId: number } | null {
  const role = req.user?.role;
  if (!role) return null;

  if (role === "SUPER_ADMIN" || role === "ADMIN" || role === "COMPANY_ADMIN") {
    const clinicId = parseInt(String(req.query.clinicId || req.params.clinicId || ""), 10);
    if (!isNaN(clinicId) && clinicId > 0) {
      return { clinicId, companyId: req.user!.companyId || 0 };
    }
    return null;
  }

  if (role === "CLINIC_ADMIN" && req.user?.clinicId) {
    return { clinicId: req.user.clinicId, companyId: req.user.companyId || 0 };
  }

  return null;
}

export async function getClinicUsersHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = getCallerClinicContext(req);
    if (!ctx) {
      return res.status(403).json({ message: "Clinic context required" });
    }

    const allUsers = await db
      .select({
        id: users.id,
        publicId: users.publicId,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        phone: users.phone,
        active: users.active,
        clinicId: users.clinicId,
        companyId: users.companyId,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.clinicId, ctx.clinicId));

    res.json(allUsers);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function createClinicUserHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = getCallerClinicContext(req);
    if (!ctx) {
      return res.status(403).json({ message: "Clinic context required" });
    }

    const parsed = createClinicUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid user data", errors: parsed.error.flatten().fieldErrors });
    }

    const existing = await storage.getUserByEmail(parsed.data.email.trim().toLowerCase());
    if (existing) {
      return res.status(409).json({ message: "A user with this email already exists" });
    }

    const clinic = await storage.getClinic(ctx.clinicId);
    if (!clinic) {
      return res.status(404).json({ message: "Clinic not found" });
    }

    const tempPassword = parsed.data.password || crypto.randomBytes(8).toString("hex");
    const hashed = await hashPassword(tempPassword);
    const publicId = await generatePublicId();

    const newUser = await storage.createUser({
      publicId,
      email: parsed.data.email.trim().toLowerCase(),
      password: hashed,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      role: parsed.data.role,
      phone: parsed.data.phone || null,
      active: true,
      mustChangePassword: !parsed.data.password,
      clinicId: ctx.clinicId,
      companyId: clinic.companyId || ctx.companyId,
    });

    if (clinic.cityId) {
      await storage.setUserCityAccess(newUser.id, [clinic.cityId]);
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CREATE",
      entity: "clinic_user",
      entityId: newUser.id,
      details: `Created clinic user ${parsed.data.email} with role ${parsed.data.role} for clinic ${ctx.clinicId}`,
      cityId: clinic.cityId || null,
    });

    const { password: _, ...safeUser } = newUser as any;
    res.json({
      ...safeUser,
      tempPassword: !parsed.data.password ? tempPassword : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function updateClinicUserHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = getCallerClinicContext(req);
    if (!ctx) {
      return res.status(403).json({ message: "Clinic context required" });
    }

    const userId = parseInt(String(req.params.id), 10);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const parsed = updateClinicUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten().fieldErrors });
    }

    const targetUser = await storage.getUser(userId);
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (targetUser.clinicId !== ctx.clinicId) {
      return res.status(403).json({ message: "Cannot modify users outside your clinic" });
    }

    if (userId === req.user!.userId && parsed.data.role && parsed.data.role !== targetUser.role) {
      return res.status(400).json({ message: "Cannot change your own role" });
    }

    if (userId === req.user!.userId && parsed.data.active === false) {
      return res.status(400).json({ message: "Cannot deactivate your own account" });
    }

    const updateData: any = {};
    if (parsed.data.firstName !== undefined) updateData.firstName = parsed.data.firstName;
    if (parsed.data.lastName !== undefined) updateData.lastName = parsed.data.lastName;
    if (parsed.data.role !== undefined) updateData.role = parsed.data.role;
    if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone;
    if (parsed.data.active !== undefined) updateData.active = parsed.data.active;

    const [updated] = await db
      .update(users)
      .set(updateData)
      .where(and(eq(users.id, userId), eq(users.clinicId, ctx.clinicId)))
      .returning();

    if (!updated) {
      return res.status(404).json({ message: "User not found or not in your clinic" });
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "UPDATE",
      entity: "clinic_user",
      entityId: userId,
      details: `Updated clinic user ${updated.email}: ${JSON.stringify(parsed.data)}`,
      cityId: null,
    });

    const { password: _, ...safeUser } = updated as any;
    res.json(safeUser);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function resetClinicUserPasswordHandler(req: AuthRequest, res: Response) {
  try {
    const ctx = getCallerClinicContext(req);
    if (!ctx) {
      return res.status(403).json({ message: "Clinic context required" });
    }

    const userId = parseInt(String(req.params.id), 10);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const targetUser = await storage.getUser(userId);
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (targetUser.clinicId !== ctx.clinicId) {
      return res.status(403).json({ message: "Cannot reset password for users outside your clinic" });
    }

    const tempPassword = crypto.randomBytes(8).toString("hex");
    const hashed = await hashPassword(tempPassword);

    await db
      .update(users)
      .set({ password: hashed, mustChangePassword: true })
      .where(eq(users.id, userId));

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "PASSWORD_RESET",
      entity: "clinic_user",
      entityId: userId,
      details: `Password reset for clinic user ${targetUser.email} in clinic ${ctx.clinicId}`,
      cityId: null,
    });

    res.json({ ok: true, tempPassword });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
