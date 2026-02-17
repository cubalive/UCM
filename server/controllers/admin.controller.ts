import type { Response } from "express";
import { storage } from "../storage";
import { type AuthRequest, hashPassword, getCompanyIdFromAuth, checkCompanyOwnership } from "../auth";
import { db } from "../db";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { users, jobs } from "@shared/schema";
import { z } from "zod";
import { getSupabaseServer } from "../../lib/supabaseClient";
import { getJobStatus, getQueueStats, enqueueJob } from "../lib/jobQueue";
import { getSystemEvents } from "../lib/systemEvents";
import { getCachedSnapshot, getEngineStatus } from "../lib/aiEngine";
import { getScoresForCompany, getAnomaliesForCompany, computeScoresForCompany } from "../lib/opsIntelligence";

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
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const clinic = await storage.getClinic(id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const hasActive = await storage.hasActiveTripsForClinic(id);
    if (hasActive) return res.status(409).json({ message: "Cannot archive clinic with active trips" });

    const updated = await storage.updateClinic(id, { active: false, deletedAt: new Date() });

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ARCHIVE",
      entity: "clinic",
      entityId: id,
      details: `Archived clinic ${clinic.name}`,
      cityId: clinic.cityId,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function restoreClinicHandler(req: AuthRequest, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const clinic = await storage.getClinic(id);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const updated = await storage.updateClinic(id, { active: true, deletedAt: null } as any);

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
    const id = parseInt(req.params.id);
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
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const driver = await storage.getDriver(id);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

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
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const driver = await storage.getDriver(id);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

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
    const id = parseInt(req.params.id);
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
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const patient = await storage.getPatient(id);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

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
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const patient = await storage.getPatient(id);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

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
    const id = parseInt(req.params.id);
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
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const user = await storage.getUser(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "SUPER_ADMIN") return res.status(400).json({ message: "Cannot archive super admin" });

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
    const id = parseInt(req.params.id);
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
    const id = parseInt(req.params.id);
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
    const targetUserId = parseInt(req.params.id);
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
        const emailResult = await sendResetPasswordEmail(targetUser.email, tempPassword, `${targetUser.firstName} ${targetUser.lastName}`);
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
    const clinicId = parseInt(req.params.id);
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
      const emailResult = await sendResetPasswordEmail(clinic.email, tempPassword, clinic.name);
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
    const driverId = parseInt(req.params.id);
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
      const emailResult = await sendResetPasswordEmail(driver.email, tempPassword, driverName);
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
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const vehicle = await storage.getVehicle(id);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
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
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const vehicle = await storage.getVehicle(id);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
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
    const id = parseInt(req.params.id);
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
    const companyId = req.user!.companyId || (req.user!.role === "SUPER_ADMIN" && req.query.company_id ? parseInt(req.query.company_id as string) : null);
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
    const companyId = req.user!.companyId || (req.user!.role === "SUPER_ADMIN" && req.query.company_id ? parseInt(req.query.company_id as string) : null);
    if (!companyId) return res.status(400).json({ message: "No company context. SUPER_ADMIN: pass ?company_id=N" });
    const activeOnly = req.query.active !== "false";
    const anomalies = await getAnomaliesForCompany(companyId, activeOnly);
    res.json({ ok: true, anomalies });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function opsIntelRecomputeHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = req.user!.companyId || (req.user!.role === "SUPER_ADMIN" && req.body.company_id ? parseInt(req.body.company_id) : null);
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
    const companyId = req.user!.companyId || (req.user!.role === "SUPER_ADMIN" && req.query.company_id ? parseInt(req.query.company_id as string) : null);
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
    const job = await getJobStatusHelper(jobId);
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
    const jobId = req.params.id;
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
    if (statusFilter) conditions.push(eq(jobs.status, statusFilter));
    if (typeFilter) conditions.push(eq(jobs.type, typeFilter));

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
