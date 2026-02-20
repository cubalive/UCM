import type { Response } from "express";
import { storage } from "../storage";
import { getCompanyIdFromAuth, applyCompanyFilter, hashPassword, type AuthRequest } from "../auth";
import { insertClinicSchema, users } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { generatePublicId } from "../public-id";
import { enforceCityContext, getAllowedCityId, checkCityAccess } from "../middleware/cityContext";

export async function getClinicsHandler(req: AuthRequest, res: Response) {
  try {
    const enforced = enforceCityContext(req, res);
    if (enforced === false) return;
    const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
    if (cityId === -1) return res.status(403).json({ message: "Access denied" });
    const companyId = getCompanyIdFromAuth(req);
    const allClinics = await storage.getClinics(cityId);
    res.json(applyCompanyFilter(allClinics, companyId));
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function createClinicHandler(req: AuthRequest, res: Response) {
  try {
    const parsed = insertClinicSchema.omit({ publicId: true }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid clinic data" });
    }
    if (!parsed.data.email || !parsed.data.email.trim()) {
      return res.status(400).json({ message: "Clinic email is required" });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(parsed.data.email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }
    if (!parsed.data.addressZip || !parsed.data.addressZip.trim()) {
      return res.status(400).json({ message: "ZIP code is required for clinic address" });
    }
    if (parsed.data.lat == null || parsed.data.lng == null) {
      return res.status(400).json({ message: "Address must be selected from autocomplete (lat/lng required)" });
    }
    if (!parsed.data.cityId) {
      return res.status(400).json({ message: "Service City is required" });
    }
    if (!(await checkCityAccess(req, parsed.data.cityId))) {
      return res.status(403).json({ message: "No access to this city" });
    }
    const selectedCity = await storage.getCity(parsed.data.cityId);
    if (!selectedCity) {
      return res.status(400).json({ message: "Invalid Service City" });
    }
    const addrCity = (parsed.data.addressCity || "").trim().toLowerCase();
    const addrState = (parsed.data.addressState || "").trim().toLowerCase();
    if (addrCity !== selectedCity.name.trim().toLowerCase() || addrState !== selectedCity.state.trim().toLowerCase()) {
      return res.status(400).json({
        message: "Clinic address must be inside the selected Service City. Please choose the correct Service City or pick an address within it.",
      });
    }
    const publicId = await generatePublicId();
    const callerCompanyId = getCompanyIdFromAuth(req);
    const clinicData = { ...parsed.data, publicId, companyId: callerCompanyId };
    if (clinicData.phone) {
      const { normalizePhone } = await import("../lib/twilioSms");
      clinicData.phone = normalizePhone(clinicData.phone) || clinicData.phone;
    }
    let clinic = await storage.createClinic(clinicData);

    let authProvisioned = false;
    let userCreated = false;
    let tempPassword: string | undefined;
    try {
      const { ensureAuthUserForClinic } = await import("../lib/driverAuth");
      const result = await ensureAuthUserForClinic({
        name: clinic.name,
        email: clinic.email!,
      });
      const updatedClinic = await storage.updateClinic(clinic.id, { authUserId: result.userId } as any);
      if (updatedClinic) clinic = updatedClinic;
      authProvisioned = true;
      if (result.tempPassword) tempPassword = result.tempPassword;
      console.log(`[clinicCreate] Auth user ${result.isNew ? "created" : "linked"}: ${result.userId}`);
    } catch (authErr: any) {
      console.error("[clinicCreate] Auth provisioning failed (non-fatal):", authErr.message);
    }

    try {
      const existingUsers = await db.select().from(users).where(eq(users.email, clinic.email!));
      if (existingUsers.length === 0) {
        const { generateTempPassword } = await import("../lib/driverAuth");
        const localTempPassword = tempPassword || generateTempPassword();
        const hashed = await hashPassword(localTempPassword);
        const userPublicId = await generatePublicId();
        const nameParts = clinic.name.split(" ");
        const newUser = await storage.createUser({
          publicId: userPublicId,
          email: clinic.email!,
          password: hashed,
          firstName: nameParts[0] || clinic.name,
          lastName: nameParts.slice(1).join(" ") || "Clinic",
          role: "CLINIC_ADMIN",
          phone: clinic.phone || null,
          active: true,
          mustChangePassword: true,
          clinicId: clinic.id,
          companyId: clinicData.companyId || null,
        });
        await storage.setUserCityAccess(newUser.id, [clinic.cityId]);
        userCreated = true;
        if (!tempPassword) tempPassword = localTempPassword;
      } else {
        const existingUser = existingUsers[0];
        if (!existingUser.clinicId) {
          await db.update(users).set({ clinicId: clinic.id }).where(eq(users.id, existingUser.id));
        }
      }
    } catch (userErr: any) {
      console.error("Auto user creation for clinic failed:", userErr.message);
    }

    let emailSent = false;
    if (authProvisioned && clinic.email) {
      try {
        const { sendClinicLoginLink } = await import("../services/emailService");
        const emailResult = await sendClinicLoginLink(clinic.email, clinic.name);
        emailSent = emailResult.success;
        if (!emailResult.success) {
          console.error("[clinicCreate] Login link email failed (non-fatal):", emailResult.error);
        }
      } catch (emailErr: any) {
        console.error("[clinicCreate] Email exception (non-fatal):", emailErr.message);
      }
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CREATE",
      entity: "clinic",
      entityId: clinic.id,
      details: `Created clinic ${clinic.name}${authProvisioned ? " (auth provisioned)" : ""}${userCreated ? " (user account created)" : ""}${emailSent ? " (login link emailed)" : ""}`,
      cityId: clinic.cityId,
    });
    res.json({ ...clinic, userCreated, authProvisioned, tempPassword, emailSent });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function updateClinicHandler(req: AuthRequest, res: Response) {
  try {
    const clinicId = parseInt(String(req.params.id));
    if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });

    const clinic = await storage.getClinic(clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    if (!(await checkCityAccess(req, clinic.cityId))) {
      return res.status(403).json({ message: "No access to this city" });
    }

    const allowed = ["name", "address", "addressStreet", "addressCity", "addressState", "addressZip", "addressPlaceId", "lat", "lng", "email", "phone", "contactName", "facilityType", "active", "cityId"];
    const updateData: any = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updateData[key] = req.body[key];
    }

    if (updateData.address !== undefined) {
      if (!updateData.addressZip || !updateData.addressZip.trim()) {
        return res.status(400).json({ message: "ZIP code is required for clinic address" });
      }
      if (updateData.lat == null || updateData.lng == null) {
        return res.status(400).json({ message: "Address must be selected from autocomplete (lat/lng required)" });
      }
    }

    const addressFieldChanged = updateData.address !== undefined || updateData.addressCity !== undefined || updateData.addressState !== undefined || updateData.lat !== undefined || updateData.lng !== undefined || updateData.addressZip !== undefined;
    const cityIdChanged = updateData.cityId !== undefined;
    if (addressFieldChanged || cityIdChanged) {
      const effectiveCityId = updateData.cityId ?? clinic.cityId;
      const effectiveAddrCity = updateData.addressCity ?? clinic.addressCity;
      const effectiveAddrState = updateData.addressState ?? clinic.addressState;
      const effectiveAddrZip = updateData.addressZip ?? clinic.addressZip;
      const effectiveLat = updateData.lat ?? clinic.lat;
      const effectiveLng = updateData.lng ?? clinic.lng;
      if (!effectiveAddrZip || !String(effectiveAddrZip).trim()) {
        return res.status(400).json({ message: "ZIP code is required for clinic address" });
      }
      if (effectiveLat == null || effectiveLng == null) {
        return res.status(400).json({ message: "Address must be selected from autocomplete (lat/lng required)" });
      }
      const targetCity = await storage.getCity(effectiveCityId);
      if (!targetCity) {
        return res.status(400).json({ message: "Invalid Service City" });
      }
      if (cityIdChanged && !(await checkCityAccess(req, updateData.cityId))) {
        return res.status(403).json({ message: "No access to target city" });
      }
      const ac = (effectiveAddrCity || "").trim().toLowerCase();
      const as_ = (effectiveAddrState || "").trim().toLowerCase();
      if (ac !== targetCity.name.trim().toLowerCase() || as_ !== targetCity.state.trim().toLowerCase()) {
        return res.status(400).json({
          message: "Clinic address must be inside the selected Service City. Please choose the correct Service City or pick an address within it.",
        });
      }
    }

    if (updateData.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(updateData.email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
    }

    if (updateData.phone) {
      const { normalizePhone } = await import("../lib/twilioSms");
      updateData.phone = normalizePhone(updateData.phone) || updateData.phone;
    }

    if (updateData.email && !clinic.authUserId) {
      try {
        const { ensureAuthUserForClinic } = await import("../lib/driverAuth");
        const { userId: authUserId } = await ensureAuthUserForClinic({
          name: clinic.name,
          email: updateData.email,
        });
        updateData.authUserId = authUserId;
        console.log(`[clinicUpdate] Auth user linked: ${authUserId}`);
      } catch (authErr: any) {
        console.error("[clinicUpdate] Auth provisioning failed (non-fatal):", authErr.message);
      }
    }

    const updated = await storage.updateClinic(clinicId, updateData);

    if (updateData.email && !clinic.email) {
      try {
        const existingUsers = await db.select().from(users).where(eq(users.email, updateData.email));
        if (existingUsers.length === 0) {
          const { generateTempPassword: genTP } = await import("../lib/driverAuth");
          const tp = genTP();
          const hashed = await hashPassword(tp);
          const userPublicId = await generatePublicId();
          const nameParts = clinic.name.split(" ");
          const newUser = await storage.createUser({
            publicId: userPublicId,
            email: updateData.email,
            password: hashed,
            firstName: nameParts[0] || clinic.name,
            lastName: nameParts.slice(1).join(" ") || "Clinic",
            role: "CLINIC_USER",
            phone: clinic.phone || null,
            active: true,
            mustChangePassword: true,
            clinicId: clinic.id,
            companyId: clinic.companyId || null,
          });
          await storage.setUserCityAccess(newUser.id, [clinic.cityId]);
        }
      } catch (userErr: any) {
        console.error("Auto user creation for clinic update failed:", userErr.message);
      }
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "UPDATE",
      entity: "clinic",
      entityId: clinicId,
      details: `Updated clinic ${clinic.name}`,
      cityId: clinic.cityId,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
