import type { Response } from "express";
import { storage } from "../storage";
import { type AuthRequest, hashPassword, getCompanyIdFromAuth, checkCompanyOwnership, getActorContext } from "../auth";
import { db } from "../db";
import { eq, and, desc, gte, lte, sql, count, inArray, isNull, isNotNull } from "drizzle-orm";
import {
  users, jobs, clinics, drivers, patients, trips, vehicles, cities, companies,
  invoices, tripSmsLog, tripShareTokens, tripEvents, tripSignatures, tripBilling,
  auditLog, userCityAccess, clinicBillingProfiles, clinicBillingRules, clinicBillingInvoices,
  clinicBillingInvoiceLines, billingCycleInvoices, billingCycleInvoiceItems, invoicePayments,
  tripSeries, driverOffers, driverPushTokens, scheduleChangeRequests, driverShiftSwapRequests,
  driverWeeklySchedules, sundayRosterDrivers, driverScores, opsAnomalies,
  dailyMetricsRollup, weeklyScoreSnapshots, triScores, costLeakAlerts, ucmCertifications,
  clinicCertifications, quarterlyRankings, quarterlyRankingEntries, companyCities, clinicCompanies,
} from "@shared/schema";
import { z } from "zod";
import { getSupabaseServer } from "../../lib/supabaseClient";
import { getJobStatus, getQueueStats, enqueueJob } from "../lib/jobQueue";
import { getSystemEvents } from "../lib/systemEvents";
import { getCachedSnapshot, getEngineStatus } from "../lib/aiEngine";
import { getScoresForCompany, getAnomaliesForCompany, computeScoresForCompany } from "../lib/opsIntelligence";

async function enforceArchiveScoping(
  req: AuthRequest,
  entity: { companyId?: number | null; cityId?: number | null },
  entityType: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const actor = await getActorContext(req);
  if (!actor) return { allowed: false, reason: "Unauthorized" };
  if (actor.role === "SUPER_ADMIN") return { allowed: true };
  if (actor.role === "DISPATCH" || actor.role === "COMPANY_ADMIN" || actor.role === "ADMIN") {
    if (actor.companyId && entity.companyId && entity.companyId !== actor.companyId) {
      return { allowed: false, reason: `Cannot manage ${entityType} from another company` };
    }
    if (entity.cityId && actor.allowedCityIds.length > 0 && !actor.allowedCityIds.includes(entity.cityId)) {
      return { allowed: false, reason: `Cannot manage ${entityType} outside allowed cities` };
    }
    return { allowed: true };
  }
  return { allowed: false, reason: "Insufficient permissions" };
}

export async function getCityMismatchHandler(req: AuthRequest, res: Response) {
  try {
    const allClinics = await storage.getClinics();
    const allCities = await storage.getCities();
    const cityMap = new Map(allCities.map((c) => [c.id, c]));
    const mismatched: any[] = [];
    for (const clinic of allClinics) {
      const city = cityMap.get(clinic.cityId);
      if (!city) {
        mismatched.push({
          clinicId: clinic.id,
          publicId: clinic.publicId,
          name: clinic.name,
          addressCity: clinic.addressCity,
          addressState: clinic.addressState,
          cityId: clinic.cityId,
          expectedCity: null,
          expectedState: null,
          issue: "city_not_found",
        });
        continue;
      }
      const ac = (clinic.addressCity || "").trim().toLowerCase();
      const as_ = (clinic.addressState || "").trim().toLowerCase();
      if (ac !== city.name.trim().toLowerCase() || as_ !== city.state.trim().toLowerCase()) {
        const matchingCity = allCities.find(
          (c) => c.name.trim().toLowerCase() === ac && c.state.trim().toLowerCase() === as_
        );
        mismatched.push({
          clinicId: clinic.id,
          publicId: clinic.publicId,
          name: clinic.name,
          addressCity: clinic.addressCity,
          addressState: clinic.addressState,
          cityId: clinic.cityId,
          expectedCity: city.name,
          expectedState: city.state,
          issue: "address_city_mismatch",
          suggestedCityId: matchingCity?.id || null,
          suggestedCityName: matchingCity ? `${matchingCity.name}, ${matchingCity.state}` : null,
        });
      }
    }
    res.json({ total: allClinics.length, mismatched });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function archiveClinicHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const clinic = await storage.getClinic(id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const scope = await enforceArchiveScoping(req, clinic, "clinic");
    if (!scope.allowed) return res.status(403).json({ message: scope.reason });

    const hasActive = await storage.hasActiveTripsForClinic(id);
    if (hasActive) return res.status(409).json({ message: "Cannot archive clinic with active trips" });

    const reason = req.body?.reason || null;
    const updated = await storage.updateClinic(id, { active: false, deletedAt: new Date(), deletedBy: req.user!.userId, deleteReason: reason } as any);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ARCHIVE",
      entity: "clinic",
      entityId: id,
      details: `Archived clinic ${clinic.name}${reason ? ` (reason: ${reason})` : ""}`,
      cityId: clinic.cityId,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function restoreClinicHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const clinic = await storage.getClinic(id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const scope = await enforceArchiveScoping(req, clinic, "clinic");
    if (!scope.allowed) return res.status(403).json({ message: scope.reason });

    const updated = await storage.updateClinic(id, { active: true, deletedAt: null, deletedBy: null, deleteReason: null } as any);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "RESTORE",
      entity: "clinic",
      entityId: id,
      details: `Restored clinic ${clinic.name}`,
      cityId: clinic.cityId,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function permanentDeleteClinicHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const clinic = await storage.getClinic(id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    if (clinic.active) return res.status(400).json({ message: "Must archive before permanent delete" });

    const hasActive = await storage.hasActiveTripsForClinic(id);
    if (hasActive) return res.status(409).json({ message: "Cannot delete clinic with active trips" });

    await storage.deleteClinic(id);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "PERMANENT_DELETE",
      entity: "clinic",
      entityId: id,
      details: `Permanently deleted clinic ${clinic.name}`,
      cityId: clinic.cityId,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function archiveDriverHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const driver = await storage.getDriver(id);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    const scope = await enforceArchiveScoping(req, driver, "driver");
    if (!scope.allowed) return res.status(403).json({ message: scope.reason });

    const hasActive = await storage.hasActiveTripsForDriver(id);
    if (hasActive) return res.status(409).json({ message: "Cannot archive driver with active trips" });

    const reason = req.body?.reason || null;
    const updated = await storage.updateDriver(id, { active: false, deletedAt: new Date(), deletedBy: req.user!.userId, deleteReason: reason } as any);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ARCHIVE",
      entity: "driver",
      entityId: id,
      details: `Archived driver ${driver.firstName} ${driver.lastName}${reason ? ` (reason: ${reason})` : ""}`,
      cityId: driver.cityId,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function restoreDriverHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const driver = await storage.getDriver(id);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    const scope = await enforceArchiveScoping(req, driver, "driver");
    if (!scope.allowed) return res.status(403).json({ message: scope.reason });

    const updated = await storage.updateDriver(id, { active: true, deletedAt: null, deletedBy: null, deleteReason: null } as any);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "RESTORE",
      entity: "driver",
      entityId: id,
      details: `Restored driver ${driver.firstName} ${driver.lastName}`,
      cityId: driver.cityId,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function permanentDeleteDriverHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const driver = await storage.getDriver(id);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    if (driver.active) return res.status(400).json({ message: "Must archive before permanent delete" });

    const hasActive = await storage.hasActiveTripsForDriver(id);
    if (hasActive) return res.status(409).json({ message: "Cannot delete driver with active trips" });

    await storage.deleteDriver(id);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "PERMANENT_DELETE",
      entity: "driver",
      entityId: id,
      details: `Permanently deleted driver ${driver.firstName} ${driver.lastName}`,
      cityId: driver.cityId,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function archivePatientHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const patient = await storage.getPatient(id);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    const scope = await enforceArchiveScoping(req, patient, "patient");
    if (!scope.allowed) return res.status(403).json({ message: scope.reason });

    const hasActive = await storage.hasActiveTripsForPatient(id);
    if (hasActive) return res.status(409).json({ message: "Cannot archive patient with active trips" });

    const updated = await storage.updatePatient(id, { active: false, deletedAt: new Date() });

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ARCHIVE",
      entity: "patient",
      entityId: id,
      details: `Archived patient ${patient.firstName} ${patient.lastName}`,
      cityId: patient.cityId,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function restorePatientHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const patient = await storage.getPatient(id);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    const scope = await enforceArchiveScoping(req, patient, "patient");
    if (!scope.allowed) return res.status(403).json({ message: scope.reason });

    const updated = await storage.updatePatient(id, { active: true, deletedAt: null } as any);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "RESTORE",
      entity: "patient",
      entityId: id,
      details: `Restored patient ${patient.firstName} ${patient.lastName}`,
      cityId: patient.cityId,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function permanentDeletePatientHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const patient = await storage.getPatient(id);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    if (patient.active) return res.status(400).json({ message: "Must archive before permanent delete" });

    const hasActive = await storage.hasActiveTripsForPatient(id);
    if (hasActive) return res.status(409).json({ message: "Cannot delete patient with active trips" });

    await storage.deletePatient(id);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "PERMANENT_DELETE",
      entity: "patient",
      entityId: id,
      details: `Permanently deleted patient ${patient.firstName} ${patient.lastName}`,
      cityId: patient.cityId,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function archiveUserHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const user = await storage.getUser(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "SUPER_ADMIN") return res.status(400).json({ message: "Cannot archive super admin" });

    // H-4: Check for active trips before archiving
    if (user.driverId) {
      const activeTrips = await storage.getActiveTripsForDriver(user.driverId);
      if (activeTrips.length > 0) {
        return res.status(409).json({
          message: `Cannot archive user with ${activeTrips.length} active trips. Complete or reassign them first.`,
          activeTrips: activeTrips.length,
        });
      }
    }

    const reason = req.body?.reason || null;
    const updated = await storage.updateUser(id, { active: false, deletedAt: new Date(), deletedBy: req.user!.userId, deleteReason: reason } as any);

    if (user.email) {
      try {
        const supabase = getSupabaseServer();
        if (supabase) {
          const { data: listData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
          const sbUser = listData?.users?.find((u: any) => u.email?.toLowerCase() === user.email.toLowerCase());
          if (sbUser) {
            await supabase.auth.admin.updateUserById(sbUser.id, { ban_duration: "876600h" });
          }
        }
      } catch (sbErr: any) {
        console.error("[archiveUser] Supabase ban failed (non-fatal):", sbErr.message);
      }
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ARCHIVE",
      entity: "user",
      entityId: id,
      details: `Archived user ${user.email}`,
      cityId: null,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function restoreUserHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const user = await storage.getUser(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const updated = await storage.updateUser(id, { active: true, deletedAt: null, deletedBy: null, deleteReason: null } as any);

    if (user.email) {
      try {
        const supabase = getSupabaseServer();
        if (supabase) {
          const { data: listData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
          const sbUser = listData?.users?.find((u: any) => u.email?.toLowerCase() === user.email.toLowerCase());
          if (sbUser) {
            await supabase.auth.admin.updateUserById(sbUser.id, { ban_duration: "none" });
          }
        }
      } catch (sbErr: any) {
        console.error("[restoreUser] Supabase un-ban failed (non-fatal):", sbErr.message);
      }
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "RESTORE",
      entity: "user",
      entityId: id,
      details: `Restored user ${user.email}`,
      cityId: null,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function permanentDeleteUserHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const { ack, confirm } = req.body || {};
    if (ack !== "I understand this cannot be undone" || confirm !== "DELETE") {
      return res.status(400).json({ message: "Must provide ack and confirm fields to permanently delete a user" });
    }

    const user = await storage.getUser(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.active) return res.status(400).json({ message: "Must archive before permanent delete" });

    if (user.role === "SUPER_ADMIN") return res.status(400).json({ message: "Cannot delete super admin" });

    if (user.email) {
      try {
        const supabase = getSupabaseServer();
        if (supabase) {
          const { data: listData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
          const sbUser = listData?.users?.find((u: any) => u.email?.toLowerCase() === user.email.toLowerCase());
          if (sbUser) {
            await supabase.auth.admin.deleteUser(sbUser.id);
          }
        }
      } catch (sbErr: any) {
        console.error("[permanentDeleteUser] Supabase auth delete failed (non-fatal):", sbErr.message);
      }
    }

    await storage.deleteUser(id);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "PERMANENT_DELETE",
      entity: "user",
      entityId: id,
      details: `Permanently deleted user ${user.email}`,
      cityId: null,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function resetUserPasswordHandler(req: AuthRequest, res: Response) {
  try {
    const targetUserId = parseInt(String(req.params.id));
    if (isNaN(targetUserId)) return res.status(400).json({ message: "Invalid user ID" });

    const targetUser = await storage.getUser(targetUserId);
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    const parsed = z.object({ newPassword: z.string().min(8).optional() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    }

    const tempPassword = parsed.data?.newPassword || (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2).toUpperCase() + "!1");
    const hashed = await hashPassword(tempPassword);
    await db.update(users).set({ password: hashed, mustChangePassword: true }).where(eq(users.id, targetUserId));

    if (targetUser.email) {
      try {
        const supabase = getSupabaseServer();
        if (supabase) {
          const { data: listData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
          const sbUser = listData?.users?.find((u: any) => u.email?.toLowerCase() === targetUser.email.toLowerCase());
          if (sbUser) {
            await supabase.auth.admin.updateUserById(sbUser.id, {
              password: tempPassword,
              user_metadata: { must_change_password: true },
            });
          }
        }
      } catch (sbErr: any) {
        console.error("[adminResetPassword] Supabase password sync failed (non-fatal):", sbErr.message);
      }

      try {
        const { sendResetPasswordEmail } = await import("../services/emailService");
        const emailResult = await sendResetPasswordEmail(targetUser.email, tempPassword, `${targetUser.firstName} ${targetUser.lastName}`, targetUser.role);
        if (!emailResult.success) {
          console.error("[adminResetPassword] Email send failed (non-fatal):", emailResult.error);
        }
      } catch (emailErr: any) {
        console.error("[adminResetPassword] Email exception (non-fatal):", emailErr.message);
      }
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ADMIN_RESET_PASSWORD",
      entity: "user",
      entityId: targetUserId,
      details: `Super admin reset password for user ${targetUser.email}`,
      cityId: null,
    });

    res.json({ ok: true, tempPassword });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function resetClinicPasswordHandler(req: AuthRequest, res: Response) {
  try {
    const clinicId = parseInt(String(req.params.id));
    if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });

    const clinic = await storage.getClinic(clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });
    if (!clinic.email) return res.status(400).json({ message: "Clinic has no email address" });

    const clinicUser = await storage.getUserByClinicId(clinicId);
    if (!clinicUser) return res.status(404).json({ message: "No user account found for this clinic" });

    const { generateTempPassword } = await import("../lib/driverAuth");
    const tempPassword = generateTempPassword();
    const hashed = await hashPassword(tempPassword);
    await db.update(users).set({ password: hashed, mustChangePassword: true }).where(eq(users.id, clinicUser.id));

    try {
      const supabase = getSupabaseServer();
      if (supabase) {
        const { data: listData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const sbUser = listData?.users?.find((u: any) => u.email?.toLowerCase() === clinic.email!.toLowerCase());
        if (sbUser) {
          await supabase.auth.admin.updateUserById(sbUser.id, { password: tempPassword, user_metadata: { must_change_password: true } });
        }
      }
    } catch (sbErr: any) {
      console.error("[clinicResetPassword] Supabase sync failed (non-fatal):", sbErr.message);
    }

    let emailSent = false;
    try {
      const { sendResetPasswordEmail } = await import("../services/emailService");
      const emailResult = await sendResetPasswordEmail(clinic.email, tempPassword, clinic.name, clinicUser.role);
      emailSent = emailResult.success;
    } catch (emailErr: any) {
      console.error("[clinicResetPassword] Email failed (non-fatal):", emailErr.message);
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ADMIN_RESET_PASSWORD",
      entity: "clinic",
      entityId: clinicId,
      details: `Reset password for clinic ${clinic.name} (${clinic.email})${emailSent ? " — email sent" : ""}`,
      cityId: clinic.cityId,
    });

    res.json({ ok: true, tempPassword, emailSent });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function resetDriverPasswordHandler(req: AuthRequest, res: Response) {
  try {
    const driverId = parseInt(String(req.params.id));
    if (isNaN(driverId)) return res.status(400).json({ message: "Invalid driver ID" });

    const driver = await storage.getDriver(driverId);
    if (!driver) return res.status(404).json({ message: "Driver not found" });
    if (!driver.email) return res.status(400).json({ message: "Driver has no email address" });

    const driverUser = await storage.getUserByDriverId(driverId);
    if (!driverUser) return res.status(404).json({ message: "No user account found for this driver" });

    const { generateTempPassword } = await import("../lib/driverAuth");
    const tempPassword = generateTempPassword();
    const hashed = await hashPassword(tempPassword);
    await db.update(users).set({ password: hashed, mustChangePassword: true }).where(eq(users.id, driverUser.id));

    try {
      const supabase = getSupabaseServer();
      if (supabase) {
        const { data: listData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const sbUser = listData?.users?.find((u: any) => u.email?.toLowerCase() === driver.email!.toLowerCase());
        if (sbUser) {
          await supabase.auth.admin.updateUserById(sbUser.id, { password: tempPassword, user_metadata: { must_change_password: true } });
        }
      }
    } catch (sbErr: any) {
      console.error("[driverResetPassword] Supabase sync failed (non-fatal):", sbErr.message);
    }

    let emailSent = false;
    try {
      const { sendResetPasswordEmail } = await import("../services/emailService");
      const driverName = `${driver.firstName} ${driver.lastName}`;
      const emailResult = await sendResetPasswordEmail(driver.email, tempPassword, driverName, "DRIVER");
      emailSent = emailResult.success;
    } catch (emailErr: any) {
      console.error("[driverResetPassword] Email failed (non-fatal):", emailErr.message);
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ADMIN_RESET_PASSWORD",
      entity: "driver",
      entityId: driverId,
      details: `Reset password for driver ${driver.firstName} ${driver.lastName} (${driver.email})${emailSent ? " — email sent" : ""}`,
      cityId: driver.cityId,
    });

    res.json({ ok: true, tempPassword, emailSent });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function archiveVehicleHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const vehicle = await storage.getVehicle(id);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
    const scope = await enforceArchiveScoping(req, vehicle, "vehicle");
    if (!scope.allowed) return res.status(403).json({ message: scope.reason });
    const hasActive = await storage.hasActiveTripsForVehicle(id);
    if (hasActive) return res.status(409).json({ message: "Cannot archive vehicle with active trips" });
    const reason = req.body?.reason || null;
    const updated = await storage.updateVehicle(id, { active: false, deletedAt: new Date(), deletedBy: req.user!.userId, deleteReason: reason } as any);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ARCHIVE",
      entity: "vehicle",
      entityId: id,
      details: `Archived vehicle ${vehicle.name}${reason ? ` (reason: ${reason})` : ""}`,
      cityId: vehicle.cityId,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function restoreVehicleHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const vehicle = await storage.getVehicle(id);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
    const scope = await enforceArchiveScoping(req, vehicle, "vehicle");
    if (!scope.allowed) return res.status(403).json({ message: scope.reason });
    const updated = await storage.updateVehicle(id, { active: true, deletedAt: null, deletedBy: null, deleteReason: null } as any);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "RESTORE",
      entity: "vehicle",
      entityId: id,
      details: `Restored vehicle ${vehicle.name}`,
      cityId: vehicle.cityId,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function permanentDeleteVehicleHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const vehicle = await storage.getVehicle(id);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
    if (vehicle.active) return res.status(400).json({ message: "Must archive before permanent delete" });
    const hasActive = await storage.hasActiveTripsForVehicle(id);
    if (hasActive) return res.status(409).json({ message: "Cannot delete vehicle with active trips" });
    await storage.deleteVehicle(id);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "PERMANENT_DELETE",
      entity: "vehicle",
      entityId: id,
      details: `Permanently deleted vehicle ${vehicle.name}`,
      cityId: vehicle.cityId,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function updateCompanyHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const company = await storage.getCompany(id);
    if (!company) return res.status(404).json({ message: "Company not found" });

    const allowedFields = ["name", "dispatchPhone", "timezone", "brandColor", "brandSecondaryColor", "brandTagline", "customDomain"] as const;
    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field] || null;
      }
    }
    if (updateData.timezone) {
      const VALID_TZ = ["America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Phoenix","America/Anchorage","Pacific/Honolulu","America/Indiana/Indianapolis"];
      if (!VALID_TZ.includes(updateData.timezone)) {
        return res.status(400).json({ message: "Invalid timezone" });
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const updated = await storage.updateCompany(id, updateData);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "UPDATE",
      entity: "company",
      entityId: id,
      details: JSON.stringify({ fields: Object.keys(updateData), changes: updateData }),
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export const companyLogoUploadMiddleware = (() => {
  const multer = require("multer");
  const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`File type '${file.mimetype}' not allowed. Accepted: PNG, JPEG, WebP, SVG.`));
      }
    },
  });
  return upload.single("logo");
})();

export async function uploadCompanyLogoHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const company = await storage.getCompany(id);
    if (!company) return res.status(404).json({ message: "Company not found" });

    const file = (req as any).file as Express.Multer.File;
    if (!file) return res.status(400).json({ message: "No file uploaded" });

    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ message: "Only PNG, JPEG, WebP, and SVG images are allowed" });
    }

    const base64 = file.buffer.toString("base64");
    const logoUrl = `/api/companies/${id}/logo`;

    await db.update(companies)
      .set({ logoUrl, logoData: base64, logoMimeType: file.mimetype })
      .where(eq(companies.id, id));

    res.json({ logoUrl });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function serveCompanyLogoHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const [company] = await db.select({
      logoData: companies.logoData,
      logoMimeType: companies.logoMimeType,
    }).from(companies).where(eq(companies.id, id)).limit(1);

    if (!company?.logoData) return res.status(404).json({ message: "No logo" });

    const buffer = Buffer.from(company.logoData, "base64");
    res.set("Content-Type", company.logoMimeType || "image/png");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function deleteCompanyLogoHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    await db.update(companies)
      .set({ logoUrl: null, logoData: null, logoMimeType: null })
      .where(eq(companies.id, id));

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function archiveCompanyHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const company = await storage.getCompany(id);
    if (!company) return res.status(404).json({ message: "Company not found" });
    const hasActive = await storage.hasActiveTripsForCompany(id);
    if (hasActive) return res.status(409).json({ message: "Cannot archive company with active trips" });
    const reason = req.body?.reason || null;
    const updated = await storage.updateCompany(id, { deletedAt: new Date(), deletedBy: req.user!.userId, deleteReason: reason } as any);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ARCHIVE",
      entity: "company",
      entityId: id,
      details: `Archived company ${company.name}${reason ? ` (reason: ${reason})` : ""}`,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function restoreCompanyHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const company = await storage.getCompany(id);
    if (!company) return res.status(404).json({ message: "Company not found" });
    const updated = await storage.updateCompany(id, { deletedAt: null, deletedBy: null, deleteReason: null } as any);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "RESTORE",
      entity: "company",
      entityId: id,
      details: `Restored company ${company.name}`,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function permanentDeleteCompanyHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const company = await storage.getCompany(id);
    if (!company) return res.status(404).json({ message: "Company not found" });
    if (!company.deletedAt) return res.status(400).json({ message: "Must archive before permanent delete" });
    const hasActive = await storage.hasActiveTripsForCompany(id);
    if (hasActive) return res.status(409).json({ message: "Cannot delete company with active trips" });
    await storage.deleteCompany(id);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "PERMANENT_DELETE",
      entity: "company",
      entityId: id,
      details: `Permanently deleted company ${company.name}`,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function archiveTripHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const role = req.user?.role;
    const userCompanyId = req.user?.companyId;
    if (role !== "SUPER_ADMIN") {
      if (!["COMPANY_ADMIN", "ADMIN", "DISPATCH"].includes(role || "")) {
        return res.status(403).json({ message: "Not authorized to archive trips" });
      }
      if (userCompanyId && trip.companyId !== userCompanyId) {
        return res.status(403).json({ message: "Cannot archive trips from another company" });
      }
    }

    const ACTIVE_STATUSES = ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];
    if (ACTIVE_STATUSES.includes(trip.status)) {
      return res.status(409).json({ message: "Cannot archive an active/in-progress trip" });
    }
    if (trip.archivedAt) {
      return res.status(400).json({ message: "Trip is already archived" });
    }

    const reason = req.body?.reason || null;
    const beforeSnapshot = { status: trip.status, archivedAt: trip.archivedAt };
    const updated = await storage.updateTrip(id, {
      archivedAt: new Date(),
      archivedBy: req.user!.userId,
      archiveReason: reason,
    } as any);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ARCHIVE_TRIP",
      entity: "trip",
      entityId: id,
      details: `Archived trip #${trip.publicId || trip.id}${reason ? ` (reason: ${reason})` : ""}`,
      cityId: trip.cityId,
      actorRole: role,
      companyId: trip.companyId,
      beforeJson: beforeSnapshot,
      afterJson: { archivedAt: new Date(), archivedBy: req.user!.userId, archiveReason: reason },
    } as any);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function restoreTripHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const role = req.user?.role;
    const userCompanyId = req.user?.companyId;
    if (role !== "SUPER_ADMIN") {
      if (!["COMPANY_ADMIN", "ADMIN", "DISPATCH"].includes(role || "")) {
        return res.status(403).json({ message: "Not authorized to restore trips" });
      }
      if (userCompanyId && trip.companyId !== userCompanyId) {
        return res.status(403).json({ message: "Cannot restore trips from another company" });
      }
    }

    if (!trip.archivedAt) {
      return res.status(400).json({ message: "Trip is not archived" });
    }

    const updated = await storage.updateTrip(id, { archivedAt: null, archivedBy: null, archiveReason: null } as any);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "RESTORE_TRIP",
      entity: "trip",
      entityId: id,
      details: `Restored trip #${trip.publicId || trip.id} from archive`,
      cityId: trip.cityId,
      actorRole: role,
      companyId: trip.companyId,
    } as any);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function permanentDeleteTripHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const DELETABLE_STATUSES = ["SCHEDULED", "ASSIGNED", "CANCELLED"];
    if (!DELETABLE_STATUSES.includes(trip.status)) {
      return res.status(400).json({
        message: `Cannot delete trip with status "${trip.status}". Only trips with status: ${DELETABLE_STATUSES.join(", ")} can be deleted.`,
        rule: "status_check",
      });
    }

    if (trip.invoiceId) {
      return res.status(400).json({
        message: "Cannot delete trip — it has a linked invoice. Remove the invoice first.",
        rule: "invoice_check",
      });
    }

    const { tripBilling: tripBillingTable } = await import("@shared/schema");
    const billingRecords = await db.select({ id: tripBillingTable.id }).from(tripBillingTable)
      .where(eq(tripBillingTable.tripId, id)).limit(1);
    if (billingRecords.length > 0) {
      return res.status(400).json({
        message: "Cannot delete trip — it has billing records. Resolve billing first.",
        rule: "billing_check",
      });
    }

    const beforeSnapshot = {
      id: trip.id,
      publicId: trip.publicId,
      status: trip.status,
      patientId: trip.patientId,
      driverId: trip.driverId,
      scheduledDate: trip.scheduledDate,
    };

    await storage.deleteTrip(id);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "PERMANENT_DELETE_TRIP",
      entity: "trip",
      entityId: id,
      details: `Permanently deleted trip #${trip.publicId || trip.id} (status: ${trip.status})`,
      cityId: trip.cityId,
      actorRole: req.user?.role,
      companyId: trip.companyId,
      beforeJson: beforeSnapshot,
    } as any);
    res.json({ success: true, deletedTripId: id });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function deepHealthHandler(_req: AuthRequest, res: Response) {
  try {
    const { runDeepHealth } = await import("../lib/deepHealth");
    const result = await runDeepHealth();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function metricsSummaryHandler(req: AuthRequest, res: Response) {
  try {
    const { getPerfSummary, isProfilingEnabled } = await import("../lib/requestTracing");
    const profilingEnabled = isProfilingEnabled();
    const windowMin = parseInt(req.query.window as string) || 5;
    const perf = getPerfSummary(windowMin);

    const { getQueueStats: queueStatsHelper } = await import("../lib/jobQueue");
    const queueStats = await queueStatsHelper();

    const fifteenAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentJobs = await db
      .select({
        status: jobs.status,
        count: sql<number>`count(*)::int`,
      })
      .from(jobs)
      .where(gte(jobs.createdAt, fifteenAgo))
      .groupBy(jobs.status);

    const jobCounts: Record<string, number> = {};
    for (const r of recentJobs) jobCounts[r.status] = r.count;

    const totalRecent = Object.values(jobCounts).reduce((a, b) => a + b, 0);
    const throughputPerMin = Math.round(totalRecent / 15);
    const failuresPerMin = Math.round((jobCounts["failed"] || 0) / 15 * 10) / 10;

    res.json({
      profilingEnabled,
      profilingDisabled: !profilingEnabled,
      requestCount: perf.total_requests,
      avgDbTimeMs: perf.avg_db_ms,
      cacheHitRate: perf.cache_hit_rate_pct,
      p50Ms: perf.p50_ms,
      p95Ms: perf.p95_ms,
      rpm: perf.rpm,
      slowestRoutes: perf.top_slow_routes.slice(0, 10),
      queryBudgetViolations: perf.query_budget_violations,
      queue: {
        ...queueStats,
        throughputPerMin,
        failuresPerMin,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function aiEngineSnapshotHandler(_req: AuthRequest, res: Response) {
  try {
    const snapshot = await getCachedSnapshot();
    if (!snapshot) {
      return res.json({ ok: false, message: "No snapshot available yet" });
    }
    res.json({ ok: true, ...snapshot });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function aiEngineStatusHandler(_req: AuthRequest, res: Response) {
  try {
    const status = getEngineStatus();
    res.json({ ok: true, ...status });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function opsIntelScoresHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = getCompanyIdFromAuth(req) || (req.query.company_id ? parseInt(req.query.company_id as string) : null);
    if (!companyId) return res.status(400).json({ message: "No company context. SUPER_ADMIN: pass ?company_id=N" });
    const window = (req.query.window === "30d" ? "30d" : "7d") as "7d" | "30d";
    const scores = await getScoresForCompany(companyId, window);
    res.json({ ok: true, window, scores });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function opsIntelAnomaliesHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = getCompanyIdFromAuth(req) || (req.query.company_id ? parseInt(req.query.company_id as string) : null);
    if (!companyId) return res.status(200).json({ ok: true, anomalies: [] });
    const activeOnly = req.query.active !== "false";
    const anomalies = await getAnomaliesForCompany(companyId, activeOnly);
    res.json({ ok: true, anomalies });
  } catch (err: any) {
    console.error("[ops-intel/anomalies] error:", err.message);
    res.status(200).json({ ok: true, anomalies: [], _error: err.message });
  }
}

export async function opsIntelRecomputeHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = getCompanyIdFromAuth(req) || (req.body.company_id ? parseInt(req.body.company_id) : null);
    if (!companyId) return res.status(400).json({ message: "No company context. SUPER_ADMIN: pass company_id in body" });
    const window = (req.body.window === "30d" ? "30d" : "7d") as "7d" | "30d";
    const scored = await computeScoresForCompany(companyId, window);
    res.json({ ok: true, scored, window });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function opsIntelScoresCsvHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = getCompanyIdFromAuth(req) || (req.query.company_id ? parseInt(req.query.company_id as string) : null);
    if (!companyId) return res.status(400).json({ message: "No company context. SUPER_ADMIN: pass ?company_id=N" });
    const window = (req.query.window === "30d" ? "30d" : "7d") as "7d" | "30d";
    const scores = await getScoresForCompany(companyId, window);
    const rows = ["Driver,Score,Punctuality,Completion,Cancellations,GPS Quality,Acceptance,Computed At"];
    for (const s of scores) {
      const c = s.components as any || {};
      rows.push(`"${s.driverFirstName} ${s.driverLastName}",${s.score},${c.punctuality ?? ""},${c.completion ?? ""},${c.cancellations ?? ""},${c.gpsQuality ?? ""},${c.acceptance ?? ""},${s.computedAt ? new Date(s.computedAt).toISOString() : ""}`);
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="driver-scores-${window}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(rows.join("\n"));
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function batchPdfHandler(req: AuthRequest, res: Response) {
  try {
    const { tripIds } = req.body;
    if (!Array.isArray(tripIds) || tripIds.length === 0) {
      return res.status(400).json({ message: "tripIds array required" });
    }
    if (tripIds.length > 50) {
      return res.status(400).json({ message: "Max 50 trips per batch" });
    }

    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const validTripIds: number[] = [];
    for (const id of tripIds) {
      const tid = parseInt(id);
      if (isNaN(tid)) continue;
      const trip = await storage.getTrip(tid);
      if (!trip) continue;

      if (user.role === "COMPANY_ADMIN") {
        if (!user.companyId || !trip.companyId || trip.companyId !== user.companyId) continue;
      }
      if (user.role === "CLINIC_USER") {
        if (!user.clinicId || trip.clinicId !== user.clinicId) continue;
      }
      validTripIds.push(tid);
    }

    if (validTripIds.length === 0) {
      return res.status(400).json({ message: "No accessible trips found in tripIds" });
    }

    const companyId = getCompanyIdFromAuth(req);
    const jobId = await enqueueJob("pdf_batch_zip", {
      tripIds: validTripIds,
      companyId,
      userId: req.user!.userId,
    }, {
      companyId,
    });

    res.status(202).json({
      message: "Batch PDF ZIP generation queued",
      jobId,
      tripCount: validTripIds.length,
      statusUrl: `/api/jobs/${jobId}`,
      downloadUrl: `/api/trips/pdf/batch/${jobId}/download`,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function batchPdfDownloadHandler(req: AuthRequest, res: Response) {
  try {
    const { jobId } = req.params;
    const { getJobStatus: getJobStatusHelper } = await import("../lib/jobQueue");
    const job = await getJobStatusHelper(String(jobId));
    if (!job) return res.status(404).json({ message: "Job not found" });

    const companyId = getCompanyIdFromAuth(req);
    if (job.companyId && companyId && job.companyId !== companyId) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (job.status !== "succeeded") {
      return res.status(202).json({
        message: `Job status: ${job.status}`,
        status: job.status,
        statusUrl: `/api/jobs/${jobId}`,
      });
    }

    const result = job.result as Record<string, unknown> | null;
    if (!result || !result.zipBase64) {
      return res.status(404).json({ message: "ZIP not found in job result" });
    }

    const buffer = Buffer.from(result.zipBase64 as string, "base64");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="trips-batch-${jobId}.zip"`);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export function appConfigHandler(req: AuthRequest, res: Response) {
  res.json({
    allowCompletedEdit: process.env.ALLOW_COMPLETED_EDIT === "true" && req.user?.role === "SUPER_ADMIN",
  });
}

export async function realtimeTokenHandler(req: AuthRequest, res: Response) {
  try {
    const { tripId } = req.body;
    if (!tripId || isNaN(Number(tripId))) {
      return res.status(400).json({ message: "tripId is required" });
    }

    const id = Number(tripId);
    const trip = await storage.getTrip(id);
    if (!trip) {
      return res.status(404).json({ message: "Trip not found" });
    }

    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const companyId = getCompanyIdFromAuth(req);
    if (!checkCompanyOwnership(trip, companyId)) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (user.role === "CLINIC_USER") {
      if (!user.clinicId || trip.clinicId !== user.clinicId) {
        return res.status(403).json({ message: "You can only access your clinic's trips" });
      }
    }

    if (user.role === "DRIVER") {
      if (!user.driverId || !trip.driverId || trip.driverId !== user.driverId) {
        return res.status(403).json({ message: "You can only access trips assigned to you" });
      }
    }

    const { signRealtimeToken, recordTokenIssued } = await import("../lib/supabaseRealtime");
    const token = signRealtimeToken({
      userId: user.id,
      role: user.role,
      companyId: user.companyId || null,
      clinicId: user.clinicId || null,
      tripId: id,
    });

    if (!token) {
      return res.status(500).json({ message: "Realtime token signing not configured" });
    }

    recordTokenIssued();

    res.json({
      token,
      channel: `trip:${id}`,
      expiresIn: 600,
    });
  } catch (err: any) {
    console.error("[REALTIME-TOKEN]", err.message);
    res.status(500).json({ message: err.message });
  }
}

export async function realtimeMetricsHandler(_req: AuthRequest, res: Response) {
  try {
    const { getRealtimeMetrics } = await import("../lib/supabaseRealtime");
    res.json({ ok: true, ...getRealtimeMetrics() });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function realtimeTestHandler(req: AuthRequest, res: Response) {
  try {
    const { tripId } = req.body;
    if (!tripId) {
      return res.status(400).json({ ok: false, message: "tripId required" });
    }
    const { broadcastTripSupabase } = await import("../lib/supabaseRealtime");
    await broadcastTripSupabase(tripId, {
      type: "test_ping",
      data: { message: "ok" },
    });
    res.json({ ok: true, tripId, ts: Date.now() });
  } catch (err: any) {
    console.error("[REALTIME-TEST]", err.message);
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function directionsMetricsHandler(_req: AuthRequest, res: Response) {
  try {
    const { getDirectionsMetrics } = await import("../lib/googleMaps");
    res.json({ ok: true, ...getDirectionsMetrics() });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function corsOriginsHandler(_req: AuthRequest, res: Response) {
  const { allowedAppOrigins, allowedPublicOrigins } = await import("../index");
  res.json({
    ok: true,
    allowedAppOrigins: Array.from(allowedAppOrigins),
    allowedPublicOrigins: Array.from(allowedPublicOrigins),
    host: _req.headers.host || "unknown",
    envMode: process.env.NODE_ENV || "development",
  });
}

export function authDiagnosticsHandler(req: AuthRequest, res: Response) {
  const authHeader = req.headers["authorization"] || "";
  res.json({
    ok: true,
    jwtSecretPresent: !!(process.env.JWT_SECRET),
    driverTokenHeaderSeen: authHeader.startsWith("Bearer "),
  });
}

export async function getJobHandler(req: AuthRequest, res: Response) {
  try {
    const jobId = String(req.params.id);
    const job = await getJobStatus(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const companyId = getCompanyIdFromAuth(req);
    if (companyId && job.companyId && job.companyId !== companyId) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json({
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      result: job.status === "succeeded" ? job.result : undefined,
      lastError: job.status === "failed" ? job.lastError : undefined,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function queueStatsHandler(_req: AuthRequest, res: Response) {
  try {
    const stats = await getQueueStats();
    res.json({ ok: true, ...stats });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function systemEventsHandler(req: AuthRequest, res: Response) {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const eventType = req.query.eventType as string | undefined;
    const entityType = req.query.entityType as string | undefined;
    const events = await getSystemEvents(null, { limit, eventType, entityType });
    res.json({ ok: true, events, count: events.length });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function opsJobsHandler(req: AuthRequest, res: Response) {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const statusFilter = req.query.status as string | undefined;
    const typeFilter = req.query.type as string | undefined;

    let query = db.select().from(jobs).$dynamic();

    const conditions: any[] = [];
    if (statusFilter) conditions.push(eq(jobs.status, statusFilter as any));
    if (typeFilter) conditions.push(eq(jobs.type, typeFilter as any));

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const rows = await query
      .orderBy(desc(jobs.createdAt))
      .limit(limit)
      .offset(offset);

    const stats = await getQueueStats();

    res.json({
      ok: true,
      jobs: rows.map(j => ({
        id: j.id,
        type: j.type,
        status: j.status,
        attempts: j.attempts,
        maxAttempts: j.maxAttempts,
        priority: j.priority,
        payload: j.payload,
        result: j.result,
        lastError: j.lastError,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        companyId: j.companyId,
      })),
      stats,
      total: rows.length,
      limit,
      offset,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function debugEmailHealthHandler(_req: AuthRequest, res: Response) {
  const { getEmailHealth } = await import("../lib/email");
  res.json(getEmailHealth());
}

export async function healthEmailHandler(_req: AuthRequest, res: Response) {
  const hasResendKey = !!process.env.RESEND_API_KEY;
  const hasSupabaseUrl = !!process.env.SUPABASE_URL;
  const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const provider = hasResendKey ? "resend" : "none";
  const canSend = hasResendKey;
  const canGenerateLinks = hasSupabaseUrl && hasServiceRole;
  res.json({
    ok: canSend && canGenerateLinks,
    provider,
    canSend,
    canGenerateLinks,
  });
}

export async function clinicPatientArchiveHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const actor = await getActorContext(req);
    if (!actor || !actor.clinicId) return res.status(403).json({ message: "Clinic user must be linked to a clinic" });

    const patient = await storage.getPatient(id);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    if (patient.clinicId !== actor.clinicId) return res.status(403).json({ message: "Can only archive patients from your own clinic" });

    const hasActive = await storage.hasActiveTripsForPatient(id);
    if (hasActive) return res.status(409).json({ message: "Cannot archive patient with active trips" });

    const updated = await storage.updatePatient(id, { active: false, deletedAt: new Date() });

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ARCHIVE",
      entity: "patient",
      entityId: id,
      details: JSON.stringify({ action: "clinic_user_archive", clinicId: actor.clinicId, before: { active: patient.active, deletedAt: patient.deletedAt }, after: { active: false, deletedAt: new Date().toISOString() } }),
      cityId: patient.cityId,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function clinicPatientUnarchiveHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const actor = await getActorContext(req);
    if (!actor || !actor.clinicId) return res.status(403).json({ message: "Clinic user must be linked to a clinic" });

    const patient = await storage.getPatient(id);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    if (patient.clinicId !== actor.clinicId) return res.status(403).json({ message: "Can only unarchive patients from your own clinic" });

    const updated = await storage.updatePatient(id, { active: true, deletedAt: null } as any);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "UNARCHIVE",
      entity: "patient",
      entityId: id,
      details: JSON.stringify({ action: "clinic_user_unarchive", clinicId: actor.clinicId, before: { active: patient.active, deletedAt: patient.deletedAt }, after: { active: true, deletedAt: null } }),
      cityId: patient.cityId,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

const HARD_DELETE_ENTITIES = ["company", "city", "clinic", "driver", "patient", "trip", "invoice", "billingCycleInvoice", "vehicle", "user"] as const;
type HardDeleteEntity = typeof HARD_DELETE_ENTITIES[number];

async function getDependentCounts(entity: HardDeleteEntity, id: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const c = async (table: any, field: any, label: string) => {
    const [row] = await db.select({ cnt: count() }).from(table).where(eq(field, id));
    counts[label] = row?.cnt ?? 0;
  };

  switch (entity) {
    case "company":
      await c(clinics, clinics.companyId, "clinics");
      await c(drivers, drivers.companyId, "drivers");
      await c(patients, patients.companyId, "patients");
      await c(trips, trips.companyId, "trips");
      await c(vehicles, vehicles.companyId, "vehicles");
      await c(users, users.companyId, "users");
      break;
    case "city":
      await c(clinics, clinics.cityId, "clinics");
      await c(drivers, drivers.cityId, "drivers");
      await c(patients, patients.cityId, "patients");
      await c(trips, trips.cityId, "trips");
      await c(vehicles, vehicles.cityId, "vehicles");
      break;
    case "clinic":
      await c(patients, patients.clinicId, "patients");
      await c(trips, trips.clinicId, "trips");
      await c(users, users.clinicId, "users");
      await c(clinicBillingProfiles, clinicBillingProfiles.clinicId, "billingProfiles");
      await c(billingCycleInvoices, billingCycleInvoices.clinicId, "cycleInvoices");
      break;
    case "driver":
      await c(trips, trips.driverId, "trips");
      await c(driverOffers, driverOffers.driverId, "offers");
      await c(driverScores, driverScores.driverId, "performanceScores");
      break;
    case "patient":
      await c(trips, trips.patientId, "trips");
      break;
    case "trip":
      await c(tripSmsLog, tripSmsLog.tripId, "smsLogs");
      await c(tripShareTokens, tripShareTokens.tripId, "shareTokens");
      await c(tripEvents, tripEvents.tripId, "events");
      await c(tripSignatures, tripSignatures.tripId, "signatures");
      break;
    case "vehicle":
      await c(trips, trips.vehicleId, "trips");
      break;
    case "invoice":
      break;
    case "billingCycleInvoice":
      await c(billingCycleInvoiceItems, billingCycleInvoiceItems.invoiceId, "lineItems");
      await c(invoicePayments, invoicePayments.invoiceId, "payments");
      break;
    case "user":
      await c(userCityAccess, userCityAccess.userId, "cityAccess");
      break;
  }
  return counts;
}

export async function hardDeletePreviewHandler(req: AuthRequest, res: Response) {
  try {
    const entity = req.query.entity as string;
    const id = parseInt(String(req.query.id));
    if (!entity || isNaN(id)) return res.status(400).json({ message: "entity and id are required" });
    if (!HARD_DELETE_ENTITIES.includes(entity as HardDeleteEntity)) {
      return res.status(400).json({ message: `Invalid entity. Must be one of: ${HARD_DELETE_ENTITIES.join(", ")}` });
    }

    const counts = await getDependentCounts(entity as HardDeleteEntity, id);
    const totalDependents = Object.values(counts).reduce((s, v) => s + v, 0);

    res.json({
      entity,
      id,
      dependentCounts: counts,
      totalDependents,
      warningLevel: totalDependents > 100 ? "HIGH" : totalDependents > 10 ? "MEDIUM" : "LOW",
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

async function safeDeleteTrip(tripId: number) {
  await db.delete(tripSmsLog).where(eq(tripSmsLog.tripId, tripId));
  await db.delete(tripShareTokens).where(eq(tripShareTokens.tripId, tripId));
  await db.delete(tripEvents).where(eq(tripEvents.tripId, tripId));
  await db.delete(tripSignatures).where(eq(tripSignatures.tripId, tripId));
  await db.delete(tripBilling).where(eq(tripBilling.tripId, tripId));
  await db.delete(trips).where(eq(trips.id, tripId));
}

export async function hardDeleteHandler(req: AuthRequest, res: Response) {
  try {
    const { entity, id, confirmWord } = req.body || {};
    if (!entity || !id) return res.status(400).json({ message: "entity and id are required" });
    if (confirmWord !== "delete") {
      return res.status(400).json({ error: "Confirmation required. Type 'delete'." });
    }
    if (!HARD_DELETE_ENTITIES.includes(entity as HardDeleteEntity)) {
      return res.status(400).json({ message: `Invalid entity. Must be one of: ${HARD_DELETE_ENTITIES.join(", ")}` });
    }

    const entityId = parseInt(String(id));
    if (isNaN(entityId)) return res.status(400).json({ message: "Invalid ID" });

    const preview = await getDependentCounts(entity as HardDeleteEntity, entityId);
    let deletedCounts: Record<string, number> = {};

    switch (entity as HardDeleteEntity) {
      case "patient": {
        const patient = await storage.getPatient(entityId);
        if (!patient) return res.status(404).json({ message: "Patient not found" });
        const hasActive = await storage.hasActiveTripsForPatient(entityId);
        if (hasActive) return res.status(409).json({ message: "Cannot delete patient with active trips" });
        const patientTrips = await db.select({ id: trips.id }).from(trips).where(eq(trips.patientId, entityId));
        for (const t of patientTrips) {
          await safeDeleteTrip(t.id);
        }
        deletedCounts.trips = patientTrips.length;
        await db.delete(patients).where(eq(patients.id, entityId));
        deletedCounts.patient = 1;
        break;
      }
      case "driver": {
        const driver = await storage.getDriver(entityId);
        if (!driver) return res.status(404).json({ message: "Driver not found" });
        const hasActive = await storage.hasActiveTripsForDriver(entityId);
        if (hasActive) return res.status(409).json({ message: "Cannot delete driver with active trips. Unassign first." });
        await db.update(trips).set({ driverId: null } as any).where(eq(trips.driverId, entityId));
        await db.delete(driverOffers).where(eq(driverOffers.driverId, entityId));
        await db.delete(driverPushTokens).where(eq(driverPushTokens.driverId, entityId));
        await db.delete(driverScores).where(eq(driverScores.driverId, entityId));
        await db.delete(scheduleChangeRequests).where(eq(scheduleChangeRequests.driverId, entityId));
        await db.delete(drivers).where(eq(drivers.id, entityId));
        deletedCounts.driver = 1;
        break;
      }
      case "clinic": {
        const clinic = await storage.getClinic(entityId);
        if (!clinic) return res.status(404).json({ message: "Clinic not found" });
        const hasActive = await storage.hasActiveTripsForClinic(entityId);
        if (hasActive) return res.status(409).json({ message: "Cannot delete clinic with active trips" });
        const clinicTrips = await db.select({ id: trips.id }).from(trips).where(eq(trips.clinicId, entityId));
        for (const t of clinicTrips) {
          await safeDeleteTrip(t.id);
        }
        deletedCounts.trips = clinicTrips.length;
        const clinicPatients = await db.select({ id: patients.id }).from(patients).where(eq(patients.clinicId, entityId));
        for (const p of clinicPatients) {
          await db.delete(patients).where(eq(patients.id, p.id));
        }
        deletedCounts.patients = clinicPatients.length;
        const cbpRows = await db.select({ id: clinicBillingProfiles.id }).from(clinicBillingProfiles).where(eq(clinicBillingProfiles.clinicId, entityId));
        for (const cbp of cbpRows) {
          await db.delete(clinicBillingRules).where(eq(clinicBillingRules.profileId, cbp.id));
        }
        await db.delete(clinicBillingProfiles).where(eq(clinicBillingProfiles.clinicId, entityId));
        const bciRows = await db.select({ id: billingCycleInvoices.id }).from(billingCycleInvoices).where(eq(billingCycleInvoices.clinicId, entityId));
        for (const bci of bciRows) {
          await db.delete(billingCycleInvoiceItems).where(eq(billingCycleInvoiceItems.invoiceId, bci.id));
          await db.delete(invoicePayments).where(eq(invoicePayments.invoiceId, bci.id));
        }
        await db.delete(billingCycleInvoices).where(eq(billingCycleInvoices.clinicId, entityId));
        await db.delete(clinicBillingInvoices).where(eq(clinicBillingInvoices.clinicId, entityId));
        await db.update(users).set({ clinicId: null } as any).where(eq(users.clinicId, entityId));
        await db.delete(clinicCertifications).where(eq(clinicCertifications.clinicId, entityId));
        await db.delete(clinics).where(eq(clinics.id, entityId));
        deletedCounts.clinic = 1;
        break;
      }
      case "trip": {
        const trip = await storage.getTrip(entityId);
        if (!trip) return res.status(404).json({ message: "Trip not found" });
        await safeDeleteTrip(entityId);
        deletedCounts.trip = 1;
        break;
      }
      case "vehicle": {
        const vehicle = await storage.getVehicle(entityId);
        if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
        const hasActive = await storage.hasActiveTripsForVehicle(entityId);
        if (hasActive) return res.status(409).json({ message: "Cannot delete vehicle with active trips" });
        await db.update(trips).set({ vehicleId: null } as any).where(eq(trips.vehicleId, entityId));
        await db.delete(vehicles).where(eq(vehicles.id, entityId));
        deletedCounts.vehicle = 1;
        break;
      }
      case "invoice": {
        await db.delete(invoices).where(eq(invoices.id, entityId));
        deletedCounts.invoice = 1;
        break;
      }
      case "billingCycleInvoice": {
        await db.delete(billingCycleInvoiceItems).where(eq(billingCycleInvoiceItems.invoiceId, entityId));
        await db.delete(invoicePayments).where(eq(invoicePayments.invoiceId, entityId));
        await db.delete(billingCycleInvoices).where(eq(billingCycleInvoices.id, entityId));
        deletedCounts.billingCycleInvoice = 1;
        break;
      }
      case "user": {
        const user = await storage.getUser(entityId);
        if (!user) return res.status(404).json({ message: "User not found" });
        if (user.role === "SUPER_ADMIN") return res.status(400).json({ message: "Cannot hard delete a SUPER_ADMIN user" });
        await db.delete(userCityAccess).where(eq(userCityAccess.userId, entityId));
        await db.delete(users).where(eq(users.id, entityId));
        deletedCounts.user = 1;
        break;
      }
      case "company": {
        const [company] = await db.select().from(companies).where(eq(companies.id, entityId));
        if (!company) return res.status(404).json({ message: "Company not found" });
        const totalDep = Object.values(preview).reduce((s, v) => s + v, 0);
        if (totalDep > 0) {
          return res.status(409).json({
            message: "Company has dependents. Delete all dependents first or use preview to see counts.",
            dependentCounts: preview,
          });
        }
        await db.delete(companies).where(eq(companies.id, entityId));
        deletedCounts.company = 1;
        break;
      }
      case "city": {
        const [city] = await db.select().from(cities).where(eq(cities.id, entityId));
        if (!city) return res.status(404).json({ message: "City not found" });
        const totalDep = Object.values(preview).reduce((s, v) => s + v, 0);
        if (totalDep > 0) {
          return res.status(409).json({
            message: "City has dependents. Delete all dependents first or use preview to see counts.",
            dependentCounts: preview,
          });
        }
        await db.delete(cities).where(eq(cities.id, entityId));
        deletedCounts.city = 1;
        break;
      }
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "HARD_DELETE",
      entity,
      entityId,
      details: JSON.stringify({
        confirmWordUsed: true,
        deletedBy: req.user!.userId,
        actorRole: req.user!.role,
        dependentCountsAtDelete: preview,
        deletedCounts,
      }),
      cityId: null,
    });

    res.json({ success: true, entity, id: entityId, deletedCounts, previewAtDelete: preview });
  } catch (err: any) {
    console.error("[HARD_DELETE] Error:", err);
    res.status(500).json({ message: err.message });
  }
}

export async function getCompanyCitiesHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = parseInt(req.params.companyId as string);
    if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });
    const cityIds = await storage.getCompanyCities(companyId);
    const citiesList = await storage.getCitiesForCompany(companyId);
    res.json({ companyId, cityIds, cities: citiesList });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function setCompanyCitiesHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = parseInt(req.params.companyId as string);
    if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });
    const { cityIds } = req.body;
    if (!Array.isArray(cityIds)) return res.status(400).json({ message: "cityIds must be an array" });
    await storage.setCompanyCities(companyId, cityIds);
    await storage.createAuditLog({
      action: "COMPANY_CITIES_UPDATED",
      entity: "company",
      entityId: companyId,
      details: `Cities set to: ${cityIds.join(", ")}`,
      cityId: null,
      userId: req.user!.userId,
    });
    res.json({ success: true, companyId, cityIds });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getClinicCompaniesHandler(req: AuthRequest, res: Response) {
  try {
    const clinicId = parseInt(req.params.clinicId as string);
    if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });
    const companyIds = await storage.getClinicCompanies(clinicId);
    const companiesList = await storage.getCompaniesForClinic(clinicId);
    res.json({ clinicId, companyIds, companies: companiesList });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function setClinicCompaniesHandler(req: AuthRequest, res: Response) {
  try {
    const clinicId = parseInt(req.params.clinicId as string);
    if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });
    const { companyIds } = req.body;
    if (!Array.isArray(companyIds)) return res.status(400).json({ message: "companyIds must be an array" });
    await storage.setClinicCompanies(clinicId, companyIds);
    await storage.createAuditLog({
      action: "CLINIC_COMPANIES_UPDATED",
      entity: "clinic",
      entityId: clinicId,
      details: `Companies set to: ${companyIds.join(", ")}`,
      cityId: null,
      userId: req.user!.userId,
    });
    res.json({ success: true, clinicId, companyIds });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getAllCompanyCitiesHandler(req: AuthRequest, res: Response) {
  try {
    const rows = await db.select().from(companyCities);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getAllClinicCompaniesHandler(req: AuthRequest, res: Response) {
  try {
    const rows = await db.select().from(clinicCompanies);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

const batchArchiveSchema = z.object({
  cutoffDays: z.number().int().min(1),
  batchSize: z.number().int().min(1).max(1000).default(200),
  reason: z.string().optional(),
});

export async function batchArchiveTripsHandler(req: AuthRequest, res: Response) {
  try {
    const parsed = batchArchiveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const { cutoffDays, batchSize, reason } = parsed.data;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);

    const activeStatuses = [
      "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP",
      "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS",
      "SCHEDULED", "ASSIGNED",
    ];

    const archiveReason = reason || `Bulk archive: trips older than ${cutoffDays} days`;
    const result = await db.execute(sql`
      UPDATE trips SET
        archived_at = NOW(),
        archived_by = ${req.user!.userId},
        archive_reason = ${archiveReason}
      WHERE id IN (
        SELECT id FROM trips
        WHERE created_at <= ${cutoffDate}
          AND archived_at IS NULL
          AND deleted_at IS NULL
          AND status NOT IN (${sql.raw(activeStatuses.map(s => `'${s}'`).join(","))})
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `);

    const rows = (result as any).rows || result;
    const updatedCount = Array.isArray(rows) ? rows.length : 0;

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "BULK_ARCHIVE",
      entity: "trip",
      entityId: 0,
      details: `Bulk archived ${updatedCount} trips older than ${cutoffDays} days`,
    });

    res.json({ updatedCount });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function unarchiveTripHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });

    const trip = await storage.getTrip(id);
    if (!trip) return res.status(404).json({ message: "Trip not found" });
    if (!trip.archivedAt) return res.status(400).json({ message: "Trip is not archived" });

    const updated = await storage.updateTrip(id, {
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
    } as any);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "UNARCHIVE",
      entity: "trip",
      entityId: id,
      details: `Unarchived trip #${id}`,
      cityId: trip.cityId,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function archiveStatsHandler(req: AuthRequest, res: Response) {
  try {
    const [activeCount] = await db.select({ count: count() }).from(trips).where(and(isNull(trips.archivedAt), isNull(trips.deletedAt)));
    const [archivedCount] = await db.select({ count: count() }).from(trips).where(and(isNotNull(trips.archivedAt), isNull(trips.deletedAt)));
    res.json({ active: activeCount.count, archived: archivedCount.count });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
