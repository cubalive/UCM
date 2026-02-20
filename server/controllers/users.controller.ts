import type { Response } from "express";
import { storage } from "../storage";
import { hashPassword, getCompanyIdFromAuth, applyCompanyFilter, type AuthRequest } from "../auth";
import { generatePublicId } from "../public-id";
import { z } from "zod";

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(["ADMIN", "DISPATCH", "DRIVER", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER"]),
  phone: z.string().nullable().optional(),
  cityIds: z.array(z.number()).optional(),
  companyId: z.number().nullable().optional(),
  clinicId: z.number().nullable().optional(),
});

export async function getUsersHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = getCompanyIdFromAuth(req);
    const allUsers = await storage.getUsers();
    res.json(applyCompanyFilter(allUsers as any[], companyId));
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function createUserHandler(req: AuthRequest, res: Response) {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid user data" });
    }
    const { cityIds, companyId: bodyCompanyId, clinicId: bodyClinicId, ...userData } = parsed.data;
    const hashed = await hashPassword(userData.password);
    const publicId = await generatePublicId();

    const callerCompanyId = getCompanyIdFromAuth(req);
    const effectiveCompanyId = callerCompanyId || bodyCompanyId || null;

    const CLINIC_ROLES_SET = ["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"];
    if (CLINIC_ROLES_SET.includes(userData.role) && !bodyClinicId) {
      return res.status(400).json({ message: "clinicId is required for clinic-scoped roles" });
    }

    const user = await storage.createUser({
      ...userData,
      password: hashed,
      publicId,
      active: true,
      phone: userData.phone || null,
      companyId: effectiveCompanyId,
      clinicId: bodyClinicId || null,
    });

    if (cityIds && cityIds.length > 0) {
      await storage.setUserCityAccess(user.id, cityIds);
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CREATE",
      entity: "user",
      entityId: user.id,
      details: `Created user ${userData.email}`,
      cityId: null,
    });

    res.json(user);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
