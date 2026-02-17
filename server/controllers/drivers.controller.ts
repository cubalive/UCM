import type { Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireRole, getCompanyIdFromAuth, applyCompanyFilter, checkCompanyOwnership, hashPassword, getUserCityIds, type AuthRequest } from "../auth";
import { insertDriverSchema, drivers, users, vehicles, trips } from "@shared/schema";
import { db } from "../db";
import { eq, ne, and, isNull, inArray } from "drizzle-orm";
import { generatePublicId } from "../public-id";
import { enforceCityContext, getAllowedCityId, checkCityAccess } from "../middleware/cityContext";
import { checkDriverQuota } from "../lib/companyQuotas";

export async function getDriversHandler(req: AuthRequest, res: Response) {
  try {
    const enforced = enforceCityContext(req, res);
    if (enforced === false) return;
    const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
    if (cityId === -1) return res.status(403).json({ message: "Access denied" });
    const companyId = getCompanyIdFromAuth(req);
    const allDrivers = await storage.getDrivers(cityId);
    res.json(applyCompanyFilter(allDrivers, companyId));
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function createDriverHandler(req: AuthRequest, res: Response) {
  try {
    const parsed = insertDriverSchema.omit({ publicId: true }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid driver data" });
    }
    if (!parsed.data.email || !parsed.data.email.trim()) {
      return res.status(400).json({ message: "Driver email is required" });
    }
    if (!parsed.data.cityId) {
      return res.status(400).json({ message: "City is required" });
    }
    if (parsed.data.vehicleId) {
      const vehicle = await storage.getVehicle(parsed.data.vehicleId);
      if (!vehicle) {
        return res.status(400).json({ message: "Vehicle not found" });
      }
      if (vehicle.cityId !== parsed.data.cityId) {
        return res.status(400).json({ message: "Vehicle must belong to the same city as the driver" });
      }
      if (vehicle.status !== "ACTIVE") {
        return res.status(400).json({ message: "Vehicle is not active and cannot be assigned." });
      }
    }
    if (!(await checkCityAccess(req, parsed.data.cityId))) {
      return res.status(403).json({ message: "No access to this city" });
    }
    if (parsed.data.licenseNumber) {
      parsed.data.licenseNumber = parsed.data.licenseNumber.trim().toUpperCase();
      if (!/^[A-Z0-9-]+$/.test(parsed.data.licenseNumber)) {
        return res.status(400).json({ message: "License number may only contain letters, numbers, and hyphens" });
      }
    }
    const callerCompanyId = getCompanyIdFromAuth(req);
    if (callerCompanyId) {
      const quota = await checkDriverQuota(callerCompanyId);
      if (!quota.allowed) {
        return res.status(429).json({
          message: "Driver quota exceeded",
          code: "QUOTA_EXCEEDED",
          current: quota.current,
          max: quota.max,
        });
      }
    }
    const publicId = await generatePublicId();
    const driverData: any = { ...parsed.data, publicId, companyId: callerCompanyId };
    if (driverData.phone) {
      const { normalizePhone } = await import("../lib/twilioSms");
      driverData.phone = normalizePhone(driverData.phone) || driverData.phone;
    }

    let authProvisioned = false;
    let tempPassword: string | undefined;
    try {
      const { ensureAuthUserForDriver } = await import("../lib/driverAuth");
      const result = await ensureAuthUserForDriver({
        name: `${driverData.firstName} ${driverData.lastName}`,
        email: driverData.email,
      });
      driverData.authUserId = result.userId;
      authProvisioned = true;
      if (result.tempPassword) tempPassword = result.tempPassword;
      console.log(`[driverCreate] Auth user ${result.isNew ? "created" : "linked"}: ${result.userId}`);
    } catch (authErr: any) {
      console.error("[driverCreate] Auth provisioning failed (non-fatal):", authErr.message);
    }

    const { generateTempPassword } = await import("../lib/driverAuth");
    let localTempPassword: string | undefined;
    const driver = await storage.createDriver(driverData);

    try {
      const existingUsers = await db.select().from(users).where(eq(users.email, driverData.email));
      if (existingUsers.length === 0) {
        localTempPassword = tempPassword || generateTempPassword();
        const hashed = await hashPassword(localTempPassword);
        const userPublicId = await generatePublicId();
        const newUser = await storage.createUser({
          publicId: userPublicId,
          email: driverData.email,
          password: hashed,
          firstName: driverData.firstName,
          lastName: driverData.lastName,
          role: "DRIVER",
          phone: driverData.phone || null,
          active: true,
          mustChangePassword: true,
          driverId: driver.id,
        });
        await storage.setUserCityAccess(newUser.id, [driverData.cityId]);
        driverData.userId = newUser.id;
        await db.update(drivers).set({ userId: newUser.id }).where(eq(drivers.id, driver.id));
        if (!tempPassword) tempPassword = localTempPassword;
      } else {
        const existingUser = existingUsers[0];
        if (!existingUser.driverId) {
          await db.update(users).set({ driverId: driver.id }).where(eq(users.id, existingUser.id));
        }
        if (!driver.userId) {
          await db.update(drivers).set({ userId: existingUser.id }).where(eq(drivers.id, driver.id));
        }
      }
    } catch (userErr: any) {
      console.error("[driverCreate] Local user creation failed (non-fatal):", userErr.message);
    }
    if (driver.vehicleId) {
      await storage.createVehicleAssignmentHistory({
        driverId: driver.id,
        vehicleId: driver.vehicleId,
        cityId: driver.cityId,
        assignedBy: req.user!.role === "SUPER_ADMIN" ? "super_admin" : "dispatch",
      });
    }
    let emailSent = false;
    if (tempPassword && driverData.email) {
      try {
        const { sendDriverTempPassword } = await import("../services/emailService");
        const driverName = `${driverData.firstName} ${driverData.lastName}`;
        const emailResult = await sendDriverTempPassword(driverData.email, tempPassword, driverName);
        emailSent = emailResult.success;
        if (!emailResult.success) {
          console.error("[driverCreate] Credentials email failed (non-fatal):", emailResult.error);
        }
      } catch (emailErr: any) {
        console.error("[driverCreate] Email exception (non-fatal):", emailErr.message);
      }
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CREATE",
      entity: "driver",
      entityId: driver.id,
      details: `Created driver ${driver.firstName} ${driver.lastName}${authProvisioned ? " (auth provisioned)" : ""}${emailSent ? " (credentials emailed)" : ""}`,
      cityId: driver.cityId,
    });
    res.json({ ...driver, tempPassword, authProvisioned, emailSent });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function updateDriverHandler(req: AuthRequest, res: Response) {
  try {
    const driverId = parseInt(req.params.id);
    const driver = await storage.getDriver(driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });
    if (!(await checkCityAccess(req, driver.cityId))) {
      return res.status(403).json({ message: "No access to this driver" });
    }

    const { firstName, lastName, phone, email, licenseNumber, vehicleId, status, unassignReason, forceAssign } = req.body;

    let forceUnassignedDriverId: number | null = null;

    if (vehicleId !== undefined && vehicleId !== null) {
      const vehicle = await storage.getVehicle(vehicleId);
      if (!vehicle) return res.status(400).json({ message: "Vehicle not found" });
      if (vehicle.cityId !== driver.cityId) {
        return res.status(400).json({ message: "Vehicle must belong to the same city as the driver" });
      }
      if (vehicle.status !== "ACTIVE") {
        return res.status(400).json({ message: "Vehicle is not active and cannot be assigned." });
      }

      if (vehicleId !== driver.vehicleId) {
        const allDrivers = await storage.getDrivers(driver.cityId);
        const conflicting = allDrivers.find(
          (d) => d.id !== driverId && d.vehicleId === vehicleId && d.status === "ACTIVE"
        );
        if (conflicting) {
          if (forceAssign && req.user!.role === "SUPER_ADMIN") {
            forceUnassignedDriverId = conflicting.id;
            await storage.updateDriver(conflicting.id, { vehicleId: null });

            const existingHistory = await storage.getVehicleAssignmentHistory(conflicting.id);
            const openRow = existingHistory.find((h) => h.vehicleId === vehicleId && !h.unassignedAt);
            if (openRow) {
              await storage.closeVehicleAssignmentHistory(conflicting.id, vehicleId);
            } else {
              await storage.createVehicleAssignmentHistory({
                driverId: conflicting.id,
                vehicleId,
                cityId: driver.cityId,
                assignedBy: "super_admin",
                assignedAt: conflicting.createdAt,
                unassignedAt: new Date(),
                reason: "Force reassigned by super admin",
              });
            }

            await storage.createAuditLog({
              userId: req.user!.userId,
              action: "UPDATE",
              entity: "driver",
              entityId: conflicting.id,
              details: `Force-unassigned vehicle ${vehicle.name} (${vehicle.licensePlate}) from driver ${conflicting.firstName} ${conflicting.lastName} for reassignment to ${driver.firstName} ${driver.lastName}`,
              cityId: driver.cityId,
            });
          } else {
            return res.status(400).json({
              message: `Vehicle is already assigned to driver ${conflicting.firstName} ${conflicting.lastName}. Unassign it first.`,
              code: "VEHICLE_ALREADY_ASSIGNED",
              conflictingDriverId: conflicting.id,
              conflictingDriverName: `${conflicting.firstName} ${conflicting.lastName}`,
            });
          }
        }
      }
    }

    let normalizedLicense = licenseNumber;
    if (normalizedLicense) {
      normalizedLicense = normalizedLicense.trim().toUpperCase();
      if (!/^[A-Z0-9-]+$/.test(normalizedLicense)) {
        return res.status(400).json({ message: "License number may only contain letters, numbers, and hyphens" });
      }
    }

    let normalizedPhone = phone;
    if (normalizedPhone) {
      const { normalizePhone } = await import("../lib/twilioSms");
      normalizedPhone = normalizePhone(normalizedPhone) || normalizedPhone;
    }

    const oldVehicleId = driver.vehicleId;
    const updated = await storage.updateDriver(driverId, {
      ...(firstName !== undefined ? { firstName } : {}),
      ...(lastName !== undefined ? { lastName } : {}),
      ...(normalizedPhone !== undefined ? { phone: normalizedPhone } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(normalizedLicense !== undefined ? { licenseNumber: normalizedLicense } : {}),
      ...(vehicleId !== undefined ? { vehicleId: vehicleId || null } : {}),
      ...(status !== undefined ? { status } : {}),
    });
    if (!updated) return res.status(404).json({ message: "Driver not found" });

    const assignedByValue = req.user!.role === "SUPER_ADMIN" ? "super_admin" : "dispatch";

    if (vehicleId !== undefined) {
      if (oldVehicleId && (vehicleId === null || vehicleId !== oldVehicleId)) {
        const existingHistory = await storage.getVehicleAssignmentHistory(driverId);
        const openRow = existingHistory.find((h) => h.vehicleId === oldVehicleId && !h.unassignedAt);
        if (openRow) {
          await storage.closeVehicleAssignmentHistory(driverId, oldVehicleId);
        } else {
          await storage.createVehicleAssignmentHistory({
            driverId,
            vehicleId: oldVehicleId,
            cityId: driver.cityId,
            assignedBy: assignedByValue,
            assignedAt: driver.createdAt,
            unassignedAt: new Date(),
            reason: unassignReason || null,
          });
        }
      }
      if (vehicleId && vehicleId !== oldVehicleId) {
        await storage.createVehicleAssignmentHistory({
          driverId,
          vehicleId,
          cityId: driver.cityId,
          assignedBy: assignedByValue,
          reason: null,
        });
      }
    }

    let auditDetails = `Updated driver ${updated.firstName} ${updated.lastName}`;
    if (vehicleId === null && oldVehicleId) {
      auditDetails = `Unassigned vehicle from driver ${updated.firstName} ${updated.lastName}`;
      if (unassignReason) auditDetails += ` — Reason: ${unassignReason}`;
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "UPDATE",
      entity: "driver",
      entityId: updated.id,
      details: auditDetails,
      cityId: updated.cityId,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverVehicleHistoryHandler(req: AuthRequest, res: Response) {
  try {
    const driverId = parseInt(req.params.id);
    const driver = await storage.getDriver(driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });
    if (!(await checkCityAccess(req, driver.cityId))) {
      return res.status(403).json({ message: "No access to this driver" });
    }
    let history = await storage.getVehicleAssignmentHistory(driverId);
    if (driver.vehicleId) {
      const hasOpen = history.some((h) => h.vehicleId === driver.vehicleId && !h.unassignedAt);
      if (!hasOpen) {
        await storage.createVehicleAssignmentHistory({
          driverId,
          vehicleId: driver.vehicleId,
          cityId: driver.cityId,
          assignedBy: "system",
          assignedAt: driver.createdAt,
        });
        history = await storage.getVehicleAssignmentHistory(driverId);
      }
    }
    const allVehicles = await storage.getVehicles(driver.cityId);
    const enriched = history.map((h) => {
      const v = allVehicles.find((v) => v.id === h.vehicleId);
      return {
        ...h,
        vehicleName: v ? v.name : "Unknown",
        vehicleLicensePlate: v ? v.licensePlate : "N/A",
      };
    });
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
