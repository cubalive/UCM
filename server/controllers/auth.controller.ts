import type { Request, Response } from "express";
import { storage } from "../storage";
import { signToken, comparePassword, hashPassword, getUserCityIds, setAuthCookie, type AuthRequest, verifyToken } from "../auth";
import { loginSchema, driverDevices, users, companies } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { getSupabaseServer } from "../../lib/supabaseClient";

export async function loginHandler(req: Request, res: Response) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid email or password format" });
    }

    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const user = await storage.getUserByEmail(normalizedEmail);
    if (!user) {
      console.log(`[AUTH] Login failed: no user found for email=${normalizedEmail}`);
      storage.createAuditLog({ action: "LOGIN_FAILED", entity: "user", details: `Unknown email: ${normalizedEmail}`, cityId: null, userId: null }).catch(() => {});
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const valid = await comparePassword(parsed.data.password, user.password);
    if (!valid) {
      console.log(`[AUTH] Login failed: password mismatch for email=${normalizedEmail}`);
      storage.createAuditLog({ action: "LOGIN_FAILED", entity: "user", entityId: user.id, details: `Password mismatch for ${normalizedEmail}`, cityId: null, userId: user.id }).catch(() => {});
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.active) {
      storage.createAuditLog({ action: "LOGIN_FAILED", entity: "user", entityId: user.id, details: `Disabled account: ${normalizedEmail}`, cityId: null, userId: user.id }).catch(() => {});
      return res.status(403).json({ message: "Account disabled" });
    }

    if (user.role === "DRIVER" && user.driverId && process.env.DRIVER_DEVICE_BINDING === "true") {
      const deviceHash = req.headers["x-ucm-device"] as string;
      if (deviceHash) {
        const existing = await db.select().from(driverDevices).where(eq(driverDevices.driverId, user.driverId));
        const match = existing.find(d => d.deviceFingerprintHash === deviceHash);
        if (match) {
          await db.update(driverDevices).set({ lastSeenAt: new Date() }).where(eq(driverDevices.id, match.id));
        } else if (existing.length >= 2) {
          console.warn(`[DEVICE-BIND] Driver ${user.driverId} denied: max 2 devices reached`);
          return res.status(403).json({ message: "Maximum devices reached. Contact dispatch to remove a device.", code: "MAX_DEVICES" });
        } else {
          await db.insert(driverDevices).values({
            driverId: user.driverId,
            companyId: user.companyId || null,
            deviceFingerprintHash: deviceHash,
            deviceLabel: req.headers["x-ucm-device-label"] as string || null,
          });
          console.log(`[DEVICE-BIND] Registered new device for driver ${user.driverId} (${existing.length + 1}/2)`);
        }
      }
    }

    const token = signToken({ userId: user.id, role: user.role, companyId: user.companyId || null, clinicId: user.clinicId || null });
    const cityAccess = await storage.getUserCityAccess(user.id);
    const allCities = await storage.getCities();

    const accessibleCities = user.role === "SUPER_ADMIN"
      ? allCities
      : user.role === "COMPANY_ADMIN" && cityAccess.length === 0
      ? allCities
      : allCities.filter((c) => cityAccess.includes(c.id));

    const { password, ...safeUser } = user;

    await storage.createAuditLog({
      userId: user.id,
      action: "LOGIN",
      entity: "user",
      entityId: user.id,
      details: `User ${user.email} logged in`,
      cityId: null,
    });

    setAuthCookie(res, token, req);

    res.json({
      token,
      user: { ...safeUser, cityAccess },
      cities: accessibleCities,
      mustChangePassword: user.mustChangePassword || false,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function loginJwtHandler(req: Request, res: Response) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid email or password format" });
    }

    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const user = await storage.getUserByEmail(normalizedEmail);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const valid = await comparePassword(parsed.data.password, user.password);
    if (!valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.active) {
      return res.status(403).json({ message: "Account disabled" });
    }

    if (user.role !== "DRIVER") {
      return res.status(403).json({ message: "This endpoint is for driver accounts only" });
    }

    if (user.role === "DRIVER" && user.driverId && process.env.DRIVER_DEVICE_BINDING === "true") {
      const deviceHash = req.headers["x-ucm-device"] as string;
      if (deviceHash) {
        const existing = await db.select().from(driverDevices).where(eq(driverDevices.driverId, user.driverId));
        const match = existing.find(d => d.deviceFingerprintHash === deviceHash);
        if (match) {
          await db.update(driverDevices).set({ lastSeenAt: new Date() }).where(eq(driverDevices.id, match.id));
        } else if (existing.length >= 2) {
          return res.status(403).json({ message: "Maximum devices reached. Contact dispatch to remove a device.", code: "MAX_DEVICES" });
        } else {
          await db.insert(driverDevices).values({
            driverId: user.driverId,
            companyId: user.companyId || null,
            deviceFingerprintHash: deviceHash,
            deviceLabel: req.headers["x-ucm-device-label"] as string || null,
          });
        }
      }
    }

    const token = signToken({ userId: user.id, role: user.role, companyId: user.companyId || null, clinicId: user.clinicId || null });
    const cityAccess = await storage.getUserCityAccess(user.id);
    const allCities = await storage.getCities();
    const userRole = user.role as string;
    const accessibleCities = userRole === "SUPER_ADMIN"
      ? allCities
      : allCities.filter((c) => cityAccess.includes(c.id));

    const { password, ...safeUser } = user;

    await storage.createAuditLog({
      userId: user.id,
      action: "LOGIN",
      entity: "user",
      entityId: user.id,
      details: `User ${user.email} logged in via JWT`,
      cityId: null,
    });

    res.json({
      token,
      user: { ...safeUser, cityAccess },
      cities: accessibleCities,
      mustChangePassword: user.mustChangePassword || false,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function devSessionHandler(_req: Request, res: Response) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      return res.status(503).json({ message: "Dev session unavailable: no ADMIN_EMAIL configured" });
    }
    const user = await storage.getUserByEmail(adminEmail);
    if (!user) {
      return res.status(503).json({ message: "Dev session unavailable: admin user not found" });
    }
    const token = signToken({ userId: user.id, role: user.role, companyId: user.companyId || null, clinicId: user.clinicId || null });
    const cityAccess = await storage.getUserCityAccess(user.id);
    const allCities = await storage.getCities();
    const accessibleCities = user.role === "SUPER_ADMIN"
      ? allCities
      : allCities.filter((c) => cityAccess.includes(c.id));
    const { password, ...safeUser } = user;
    setAuthCookie(res, token, _req);
    res.json({
      token,
      user: { ...safeUser, cityAccess },
      cities: accessibleCities,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function authMeHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const cityAccess = await storage.getUserCityAccess(user.id);
    const allCities = await storage.getCities();

    let accessibleCities: typeof allCities;
    if (user.role === "SUPER_ADMIN") {
      accessibleCities = allCities;
    } else if (user.companyId) {
      const companyCityIds = await storage.getCompanyCities(user.companyId);
      if (companyCityIds.length > 0) {
        accessibleCities = allCities.filter(c => companyCityIds.includes(c.id));
      } else if (cityAccess.length > 0) {
        accessibleCities = allCities.filter(c => cityAccess.includes(c.id));
      } else {
        accessibleCities = allCities;
      }
    } else if (cityAccess.length > 0) {
      accessibleCities = allCities.filter(c => cityAccess.includes(c.id));
    } else {
      accessibleCities = allCities;
    }

    const seen = new Set<string>();
    const dedupedCities = accessibleCities.filter(c => {
      const key = `${c.state}|${c.name.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let companyName: string | null = null;
    if (user.companyId) {
      const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, user.companyId));
      companyName = company?.name ?? null;
    }

    const { password, ...safeUser } = user;
    res.json({
      user: { ...safeUser, cityAccess, companyName },
      cities: dedupedCities,
      workingCityId: user.workingCityId ?? null,
      workingCityScope: user.workingCityScope ?? "CITY",
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function meHandler(req: Request, res: Response) {
  const header = req.headers.authorization;
  let token: string | undefined;

  if (header?.startsWith("Bearer ")) {
    token = header.slice(7);
  } else if (req.cookies?.ucm_session) {
    token = req.cookies.ucm_session;
  }

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  const sbServer = getSupabaseServer();
  if (sbServer) {
    try {
      const { data: { user: sbUser }, error } = await sbServer.auth.getUser(token);
      if (!error && sbUser) {
        const { data: profile } = await sbServer
          .from("profiles")
          .select("role, city_id")
          .eq("id", sbUser.id)
          .single();

        if (!profile) {
          return res.status(404).json({ message: "Profile not found" });
        }

        return res.json({
          ok: true,
          id: sbUser.id,
          email: sbUser.email,
          role: profile.role,
          userId: sbUser.id,
          companyId: null,
          city_id: profile.city_id,
          ucm_id: null,
        });
      }
    } catch {}
  }

  try {
    const payload = verifyToken(token);
    const user = await storage.getUser(payload.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const cityAccess = await storage.getUserCityAccess(user.id);
    const primaryCityId = cityAccess.length > 0 ? cityAccess[0] : null;

    return res.json({
      ok: true,
      id: user.id,
      userId: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId || null,
      city_id: primaryCityId,
      ucm_id: user.publicId,
    });
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

export async function authHealthHandler(_req: Request, res: Response) {
  const { allowedAppOrigins } = await import("../index");
  res.json({
    ok: true,
    allowedOrigins: Array.from(allowedAppOrigins),
    appBaseUrl: process.env.PUBLIC_BASE_URL_APP || "https://app.unitedcaremobility.com",
    driverBaseUrl: process.env.PUBLIC_BASE_URL_DRIVER || "https://driver.unitedcaremobility.com",
    apiBaseUrl: process.env.PUBLIC_BASE_URL_API || null,
    twilioConfigured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    geofenceEnabled: process.env.GEOFENCE_ENABLED === "true",
    smsReminderEnabled: process.env.SMS_REMINDER_ENABLED === "true",
  });
}

export async function setWorkingCityHandler(req: Request, res: Response) {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const { cityId, scope } = req.body;

    if (cityId !== null && cityId !== undefined) {
      const city = await storage.getCity(cityId);
      if (!city) {
        return res.status(404).json({ message: "City not found" });
      }
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const effectiveScope = cityId === null && isSuperAdmin ? "ALL" : (scope || "CITY");

    if (cityId === null && !isSuperAdmin) {
      return res.status(403).json({ message: "Only administrators can select All Cities" });
    }

    await storage.setUserWorkingCity(userId, cityId ?? null, effectiveScope);

    return res.json({ success: true, workingCityId: cityId, workingCityScope: effectiveScope });
  } catch (err: any) {
    console.error("[setWorkingCity] Error:", err.message);
    return res.status(500).json({ message: "Failed to set working city" });
  }
}

export async function changePasswordHandler(req: Request, res: Response) {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current password and new password are required" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters" });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const valid = await comparePassword(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    const hashed = await hashPassword(newPassword);
    await db.update(users).set({
      password: hashed,
      mustChangePassword: false,
    }).where(eq(users.id, userId));

    try {
      const supabase = getSupabaseServer();
      if (supabase) {
        const { data: listData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const sbUser = listData?.users?.find((u: any) => u.email?.toLowerCase() === user.email.toLowerCase());
        if (sbUser) {
          await supabase.auth.admin.updateUserById(sbUser.id, {
            password: newPassword,
            user_metadata: { must_change_password: false },
          });
        }
      }
    } catch (sbErr: any) {
      console.error("[changePassword] Supabase sync failed (non-fatal):", sbErr.message);
    }

    storage.createAuditLog({
      action: "PASSWORD_CHANGED",
      entity: "user",
      entityId: userId,
      details: `User ${user.email} changed their password`,
      cityId: null,
      userId,
    }).catch(() => {});

    return res.json({ success: true });
  } catch (err: any) {
    console.error("[changePassword] Error:", err.message);
    return res.status(500).json({ message: "Failed to change password" });
  }
}
