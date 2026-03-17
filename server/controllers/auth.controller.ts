import type { Request, Response } from "express";
import { storage } from "../storage";
import { signToken, signRefreshToken, signPreAuthToken, signMfaSetupToken, comparePassword, hashPassword, getUserCityIds, setAuthCookies, clearAuthCookies, type AuthRequest, verifyToken, verifyRefreshToken, revokeToken, revokeAllUserTokens } from "../auth";
import { loginSchema, driverDevices, users, companies, trips, userCityAccess, drivers } from "@shared/schema";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { getSupabaseServer } from "../../lib/supabaseClient";
import { sendForgotPasswordLink } from "../services/emailService";
import { MFA_REQUIRED_ROLES } from "../lib/mfaEngine";
import { issueRefreshToken, consumeRefreshToken, revokeAllRefreshTokens } from "../lib/refreshTokenStore";

export async function loginHandler(req: Request, res: Response) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid email or password format" });
    }

    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const user = await storage.getUserByEmail(normalizedEmail);
    if (!user) {
      console.log(`[AUTH] Login failed: account not found`);
      storage.createAuditLog({ action: "LOGIN_FAILED", entity: "user", details: "Unknown email attempted", cityId: null, userId: null }).catch(() => {});
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const valid = await comparePassword(parsed.data.password, user.password);
    if (!valid) {
      console.log(`[AUTH] Login failed: password mismatch for userId=${user.id}`);
      storage.createAuditLog({ action: "LOGIN_FAILED", entity: "user", entityId: user.id, details: `Password mismatch for userId=${user.id}`, cityId: null, userId: user.id }).catch(() => {});
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.active) {
      storage.createAuditLog({ action: "LOGIN_FAILED", entity: "user", entityId: user.id, details: `Disabled account userId=${user.id}`, cityId: null, userId: user.id }).catch(() => {});
      return res.status(403).json({ message: "Account disabled" });
    }

    // C-8: Block non-SUPER_ADMIN users with no companyId
    if (user.role !== "SUPER_ADMIN" && !user.companyId) {
      return res.status(403).json({
        message: "Account configuration error: no company assigned",
        code: "NO_COMPANY",
      });
    }

    // C-4: Forced MFA setup for admin roles without MFA configured
    if (MFA_REQUIRED_ROLES.includes(user.role) && !user.mfaEnabled) {
      const setupToken = signMfaSetupToken(user.id, user.role, user.companyId || null);
      await storage.createAuditLog({
        userId: user.id,
        action: "LOGIN_MFA_SETUP_REQUIRED",
        entity: "user",
        entityId: user.id,
        details: `Admin login requires MFA setup for role=${user.role}`,
        cityId: null,
      });
      return res.status(200).json({
        mfaSetupRequired: true,
        setupToken,
        message: "Two-factor authentication is required for your role. Please configure it to access the platform.",
      });
    }

    // C-3: MFA gate — if user has MFA enabled, require verification before issuing full token
    if (user.mfaEnabled) {
      const preAuthToken = signPreAuthToken(user.id, user.role, user.companyId || null);

      // For SMS/Email methods, trigger challenge immediately
      if (user.mfaMethod === "sms" || user.mfaMethod === "email") {
        try {
          const { sendOTP } = await import("../lib/mfaEngine");
          await sendOTP(user.id, user.mfaMethod as "sms" | "email");
        } catch (err: any) {
          console.error("[AUTH] Failed to send MFA challenge:", err.message);
        }
      }

      const maskPhone = (phone: string | null) =>
        phone ? `***${phone.slice(-4)}` : undefined;
      const maskEmail = (email: string) =>
        email.replace(/(.{2})[^@]*(@.*)/, "$1****$2");

      await storage.createAuditLog({
        userId: user.id,
        action: "LOGIN_MFA_PENDING",
        entity: "user",
        entityId: user.id,
        details: `MFA challenge issued for ${user.email}`,
        cityId: null,
      });

      return res.status(200).json({
        mfaPending: true,
        preAuthToken,
        mfaMethod: user.mfaMethod,
        mfaHint: user.mfaMethod === "sms"
          ? maskPhone(user.mfaPhone || user.phone)
          : user.mfaMethod === "email"
          ? maskEmail(user.email)
          : undefined,
      });
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

    const tokenPayload = { userId: user.id, role: user.role, companyId: user.companyId || null, clinicId: user.clinicId || null, driverId: user.driverId || null, pharmacyId: (user as any).pharmacyId || null, brokerId: (user as any).brokerId || null };
    const accessToken = signToken(tokenPayload);
    // H-1: Single-use refresh token with rotation (fallback to JWT if table missing)
    let refreshToken: string;
    try {
      refreshToken = await issueRefreshToken(
        user.id,
        req.ip || undefined,
        req.headers["user-agent"] || undefined,
      );
    } catch (rtErr: any) {
      console.warn("[AUTH] issueRefreshToken failed (table may not exist), falling back to JWT refresh:", rtErr.message);
      refreshToken = signRefreshToken({ userId: user.id });
    }
    let cityAccess: number[] = [];
    let allCities: Awaited<ReturnType<typeof storage.getCities>> = [];
    try {
      cityAccess = await storage.getUserCityAccess(user.id);
      allCities = await storage.getCities();
    } catch (cityErr: any) {
      console.warn("[AUTH] City access query failed (non-fatal):", cityErr.message);
    }

    const accessibleCities = user.role === "SUPER_ADMIN"
      ? allCities
      : user.role === "COMPANY_ADMIN" && cityAccess.length === 0
      ? allCities
      : allCities.filter((c) => cityAccess.includes(c.id));

    const { password, ...safeUser } = user;

    storage.createAuditLog({
      userId: user.id,
      action: "LOGIN",
      entity: "user",
      entityId: user.id,
      details: `User ${user.email} logged in`,
      cityId: null,
    }).catch(() => {});

    setAuthCookies(res, accessToken, refreshToken, req);

    res.json({
      user: { ...safeUser, cityAccess },
      cities: accessibleCities,
      mustChangePassword: user.mustChangePassword || false,
    });
  } catch (err: any) {
    console.error("[loginHandler] Error:", err.message);
    res.status(500).json({ message: "An unexpected error occurred" });
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
      console.warn(`[AUTH] login-jwt: account not found`);
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const valid = await comparePassword(parsed.data.password, user.password);
    if (!valid) {
      console.warn(`[AUTH] login-jwt: password mismatch userId=${user.id}`);
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.active) {
      return res.status(403).json({ message: "Account disabled" });
    }

    if (user.role !== "DRIVER") {
      return res.status(403).json({ message: "This endpoint is for driver accounts only" });
    }

    // Block driver users with no company assigned
    if (!user.companyId) {
      return res.status(403).json({
        message: "Account configuration error: no company assigned",
        code: "NO_COMPANY",
      });
    }

    // MFA gate for driver JWT login
    if (user.mfaEnabled) {
      const preAuthToken = signPreAuthToken(user.id, user.role, user.companyId || null);
      if (user.mfaMethod === "sms" || user.mfaMethod === "email") {
        try {
          const { sendOTP } = await import("../lib/mfaEngine");
          await sendOTP(user.id, user.mfaMethod as "sms" | "email");
        } catch (err: any) {
          console.error("[AUTH] Failed to send MFA challenge:", err.message);
        }
      }
      return res.status(200).json({
        mfaPending: true,
        preAuthToken,
        mfaMethod: user.mfaMethod,
      });
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

    const tokenPayload = { userId: user.id, role: user.role, companyId: user.companyId || null, clinicId: user.clinicId || null, driverId: user.driverId || null, pharmacyId: (user as any).pharmacyId || null, brokerId: (user as any).brokerId || null };
    const token = signToken(tokenPayload);
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

    // Driver app (native/mobile) — still receives token in body since it doesn't use cookies
    res.json({
      token,
      user: { ...safeUser, cityAccess },
      cities: accessibleCities,
      mustChangePassword: user.mustChangePassword || false,
    });
  } catch (err: any) {
    console.error("[loginJwtHandler] Error:", err.message);
    res.status(500).json({ message: "An unexpected error occurred" });
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
    const tokenPayload = { userId: user.id, role: user.role, companyId: user.companyId || null, clinicId: user.clinicId || null, driverId: user.driverId || null, pharmacyId: (user as any).pharmacyId || null, brokerId: (user as any).brokerId || null };
    const accessToken = signToken(tokenPayload);
    const refreshToken = signRefreshToken({ userId: user.id });
    const cityAccess = await storage.getUserCityAccess(user.id);
    const allCities = await storage.getCities();
    const accessibleCities = user.role === "SUPER_ADMIN"
      ? allCities
      : allCities.filter((c) => cityAccess.includes(c.id));
    const { password, ...safeUser } = user;
    setAuthCookies(res, accessToken, refreshToken, _req);
    res.json({
      user: { ...safeUser, cityAccess },
      cities: accessibleCities,
    });
  } catch (err: any) {
    console.error("[devSessionHandler] Error:", err.message);
    res.status(500).json({ message: "An unexpected error occurred" });
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
    let companyBranding: { brandColor?: string | null; brandTagline?: string | null; customDomain?: string | null } = {};
    if (user.companyId) {
      const [company] = await db.select({
        name: companies.name,
        brandColor: companies.brandColor,
        brandTagline: companies.brandTagline,
        customDomain: companies.customDomain,
      }).from(companies).where(eq(companies.id, user.companyId));
      companyName = company?.name ?? null;
      companyBranding = {
        brandColor: company?.brandColor ?? null,
        brandTagline: company?.brandTagline ?? null,
        customDomain: company?.customDomain ?? null,
      };
    }

    let cityName: string | null = null;
    if (user.workingCityId) {
      const city = await storage.getCity(user.workingCityId);
      cityName = city?.name ?? null;
    }

    const { password, ...safeUser } = user;
    res.json({
      user: { ...safeUser, cityAccess, companyName, cityName, ...companyBranding },
      cities: dedupedCities,
      workingCityId: user.workingCityId ?? null,
      workingCityScope: user.workingCityScope ?? "CITY",
    });
  } catch (err: any) {
    console.error("[authMeHandler] Error:", err.message);
    res.status(500).json({ message: "An unexpected error occurred" });
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
      clinicId: user.clinicId || null,
      pharmacyId: (user as any).pharmacyId || null,
      city_id: primaryCityId,
      ucm_id: user.publicId,
    });
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

export async function authHealthHandler(_req: Request, res: Response) {
  res.json({ ok: true });
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

    // Revoke ALL existing tokens for this user on password change
    await revokeAllUserTokens(userId);

    storage.createAuditLog({
      action: "PASSWORD_CHANGED",
      entity: "user",
      entityId: userId,
      details: `User ${user.email} changed their password`,
      cityId: null,
      userId,
    }).catch(() => {});

    const freshUser = await storage.getUser(userId);
    if (freshUser) {
      const newTokenPayload = {
        userId: freshUser.id,
        role: freshUser.role,
        companyId: freshUser.companyId || null,
        clinicId: freshUser.clinicId || null,
        driverId: freshUser.driverId || null,
        pharmacyId: (freshUser as any).pharmacyId || null,
        brokerId: (freshUser as any).brokerId || null,
      };
      const newAccessToken = signToken(newTokenPayload);
      const newRefreshToken = signRefreshToken({ userId: freshUser.id });
      setAuthCookies(res, newAccessToken, newRefreshToken, req);
      return res.json({ success: true });
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error("[changePassword] Error:", err.message);
    return res.status(500).json({ message: "Failed to change password" });
  }
}

export async function tokenLoginHandler(req: Request, res: Response) {
  try {
    const { token, type } = req.body;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "Token is required" });
    }

    const supabase = getSupabaseServer();
    if (!supabase) {
      return res.status(500).json({ message: "Authentication service not configured" });
    }

    const otpType = type === "recovery" ? "recovery" : "magiclink";

    const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: token,
      type: otpType,
    });

    if (verifyError || !verifyData?.user?.email) {
      console.error("[tokenLogin] Supabase verifyOtp failed:", verifyError?.message || "No user email returned");
      return res.status(401).json({ message: "Invalid or expired login link. Please request a new one." });
    }

    const email = verifyData.user.email.trim().toLowerCase();
    const user = await storage.getUserByEmail(email);

    if (!user) {
      console.log(`[tokenLogin] No local user found for magic link login`);
      return res.status(401).json({ message: "No account found for this email. Contact your administrator." });
    }

    if (!user.active) {
      return res.status(403).json({ message: "Account disabled. Contact your administrator." });
    }

    const jwtToken = signToken({
      userId: user.id,
      role: user.role,
      companyId: user.companyId || null,
      clinicId: user.clinicId || null,
      driverId: user.driverId || null,
      pharmacyId: (user as any).pharmacyId || null,
      brokerId: (user as any).brokerId || null,
    });

    const cityAccess = await storage.getUserCityAccess(user.id);
    const allCities = await storage.getCities();
    const accessibleCities = user.role === "SUPER_ADMIN"
      ? allCities
      : user.role === "COMPANY_ADMIN" && cityAccess.length === 0
      ? allCities
      : allCities.filter((c) => cityAccess.includes(c.id));

    const { password, ...safeUser } = user;

    const isRecovery = type === "recovery";
    if (isRecovery && !user.mustChangePassword) {
      await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, user.id));
    }

    await storage.createAuditLog({
      userId: user.id,
      action: "LOGIN_MAGIC_LINK",
      entity: "user",
      entityId: user.id,
      details: `User ${user.email} logged in via ${otpType} link`,
      cityId: null,
    });

    const refreshTkn = signRefreshToken({ userId: user.id });
    setAuthCookies(res, jwtToken, refreshTkn, req);

    return res.json({
      user: { ...safeUser, cityAccess },
      cities: accessibleCities,
      mustChangePassword: isRecovery || user.mustChangePassword || false,
    });
  } catch (err: any) {
    console.error("[tokenLogin] Error:", err.message);
    return res.status(500).json({ message: "Login failed. Please try again." });
  }
}

export async function deleteAccountHandler(req: Request, res: Response) {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const { password, reason } = req.body;
    if (!password || typeof password !== "string") {
      return res.status(400).json({ message: "Password confirmation is required" });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const valid = await comparePassword(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: "Incorrect password" });
    }

    if (user.role === "SUPER_ADMIN") {
      return res.status(403).json({ message: "Super admin accounts cannot be self-deleted. Contact support." });
    }

    // Check for active trips
    const driverId = user.driverId || 0;
    const activeTrips = await db.select({ cnt: sql<number>`count(*)::int` }).from(trips)
      .where(and(
        eq(trips.driverId, driverId),
        sql`${trips.status} IN ('SCHEDULED', 'ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_PICKUP', 'PICKED_UP', 'EN_ROUTE_TO_DROPOFF')`
      ));

    if (activeTrips[0]?.cnt > 0) {
      return res.status(409).json({
        message: "Cannot delete account while you have active trips. Complete or cancel them first.",
        activeTrips: activeTrips[0].cnt,
      });
    }

    // Soft-delete: deactivate and anonymize PII
    const anonymizedEmail = `deleted_${userId}_${Date.now()}@deleted.ucm`;
    await db.update(users).set({
      active: false,
      email: anonymizedEmail,
      firstName: "Deleted",
      lastName: "User",
      phone: null,
      deletedAt: new Date(),
      deletedBy: userId,
      deleteReason: reason || "Self-service account deletion",
    }).where(eq(users.id, userId));

    await db.delete(userCityAccess).where(eq(userCityAccess.userId, userId));

    if (user.driverId) {
      await db.update(drivers).set({
        active: false,
        dispatchStatus: "off",
      }).where(eq(drivers.id, user.driverId));
    }

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
      console.error("[deleteAccount] Supabase cleanup failed (non-fatal):", sbErr.message);
    }

    await storage.createAuditLog({
      action: "ACCOUNT_DELETED",
      entity: "user",
      entityId: userId,
      details: `User self-deleted account. Reason: ${reason || "Not specified"}`,
      cityId: null,
      userId,
    });

    clearAuthCookies(res, req);
    return res.json({ success: true, message: "Account successfully deleted" });
  } catch (err: any) {
    console.error("[deleteAccount] Error:", err.message);
    return res.status(500).json({ message: "Failed to delete account" });
  }
}

/**
 * POST /api/auth/refresh — Issue new access token using refresh cookie.
 * The refresh token is in an httpOnly cookie scoped to /api/auth/refresh.
 */
export async function refreshHandler(req: Request, res: Response) {
  try {
    const refreshCookie = req.cookies?.ucm_refresh;
    if (!refreshCookie) {
      return res.status(401).json({ message: "No refresh token", code: "NO_REFRESH_TOKEN" });
    }

    // H-1: Single-use refresh token consumption with rotation
    // Try DB-backed rotation first, fall back to JWT verify
    let userId: number;
    let family: string | undefined;
    try {
      const result = await consumeRefreshToken(refreshCookie);
      if (!result) {
        // May be a JWT fallback token — try verifying as JWT
        try {
          const jwtPayload = verifyRefreshToken(refreshCookie);
          userId = jwtPayload.userId;
        } catch {
          return res.status(401).json({ message: "Invalid or expired refresh token", code: "INVALID_REFRESH_TOKEN" });
        }
      } else {
        userId = result.userId;
        family = result.family;
      }
    } catch {
      // DB table may not exist — try JWT fallback
      try {
        const jwtPayload = verifyRefreshToken(refreshCookie);
        userId = jwtPayload.userId;
      } catch {
        return res.status(401).json({ message: "Invalid or expired refresh token", code: "INVALID_REFRESH_TOKEN" });
      }
    }

    const user = await storage.getUser(userId);
    if (!user || !user.active) {
      return res.status(401).json({ message: "User not found or disabled", code: "USER_INVALID" });
    }

    const tokenPayload = {
      userId: user.id,
      role: user.role,
      companyId: user.companyId || null,
      clinicId: user.clinicId || null,
      driverId: user.driverId || null,
      pharmacyId: (user as any).pharmacyId || null,
      brokerId: (user as any).brokerId || null,
    };
    const newAccessToken = signToken(tokenPayload);
    // Issue new refresh token in the same family (rotation), with JWT fallback
    let newRefreshToken: string;
    try {
      newRefreshToken = await issueRefreshToken(
        user.id,
        req.ip || undefined,
        req.headers["user-agent"] || undefined,
        family,
      );
    } catch {
      newRefreshToken = signRefreshToken({ userId: user.id });
    }
    setAuthCookies(res, newAccessToken, newRefreshToken, req);

    return res.json({ success: true });
  } catch (err: any) {
    console.error("[refreshHandler] Error:", err.message);
    return res.status(500).json({ message: "An unexpected error occurred" });
  }
}

/**
 * POST /api/auth/logout — Revoke current token and clear all auth cookies.
 */
export async function logoutHandler(req: Request, res: Response) {
  try {
    // Revoke the access token if present
    const accessToken = req.cookies?.ucm_access || req.cookies?.ucm_session;
    if (accessToken) {
      await revokeToken(accessToken).catch(() => {});
    }

    clearAuthCookies(res, req);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("[logoutHandler] Error:", err.message);
    clearAuthCookies(res, req);
    return res.json({ success: true });
  }
}

export async function forgotPasswordHandler(req: Request, res: Response) {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await storage.getUserByEmail(email.trim().toLowerCase());
    const role = user?.role;

    const result = await sendForgotPasswordLink(email.trim().toLowerCase(), role);

    if (!result.success) {
      return res.status(500).json({ message: result.error || "Failed to send reset link" });
    }

    return res.json({ success: true, message: "If an account exists with this email, a reset link has been sent." });
  } catch (err: any) {
    console.error("[forgotPassword] Error:", err.message);
    return res.status(500).json({ message: "Failed to send reset link" });
  }
}
