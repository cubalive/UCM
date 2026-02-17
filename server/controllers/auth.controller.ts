import type { Request, Response } from "express";
import { storage } from "../storage";
import { signToken, comparePassword, getUserCityIds, setAuthCookie, type AuthRequest, verifyToken } from "../auth";
import { loginSchema, driverDevices } from "@shared/schema";
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

    const token = signToken({ userId: user.id, role: user.role, companyId: user.companyId || null });
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

    const token = signToken({ userId: user.id, role: user.role, companyId: user.companyId || null });
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
    const token = signToken({ userId: user.id, role: user.role, companyId: user.companyId || null });
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
    const accessibleCities = user.role === "SUPER_ADMIN"
      ? allCities
      : user.role === "COMPANY_ADMIN" && cityAccess.length === 0
      ? allCities
      : allCities.filter((c) => cityAccess.includes(c.id));

    const { password, ...safeUser } = user;
    res.json({ user: { ...safeUser, cityAccess }, cities: accessibleCities });
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
