import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { authMiddleware, requireRole, signToken, hashPassword, comparePassword, getUserCityIds, type AuthRequest } from "./auth";
import { generatePublicId } from "./public-id";
import { loginSchema, insertCitySchema, insertVehicleSchema, insertDriverSchema, insertClinicSchema, insertPatientSchema, insertTripSchema, users, drivers } from "@shared/schema";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { getSupabaseServer } from "../lib/supabaseClient";
import { registerMapsRoutes } from "./lib/mapsRoutes";
import { registerDispatchRoutes } from "./lib/dispatchRoutes";
import { registerSmsRoutes } from "./lib/smsRoutes";
import { registerVehicleAssignRoutes } from "./lib/vehicleAssignRoutes";
import { registerTrackingRoutes } from "./lib/trackingRoutes";

async function checkCityAccess(req: AuthRequest, cityId: number | undefined): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === "SUPER_ADMIN") return true;
  if (!cityId) return true;
  const allowed = await getUserCityIds(req.user.userId, req.user.role);
  return allowed.includes(cityId);
}

async function getAllowedCityId(req: AuthRequest): Promise<number | undefined> {
  const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
  if (!cityId) return undefined;
  if (req.user!.role === "SUPER_ADMIN") return cityId;
  const allowed = await getUserCityIds(req.user!.userId, req.user!.role);
  if (!allowed.includes(cityId)) return -1;
  return cityId;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/health", async (_req, res) => {
    let dbStatus = "disconnected";
    let supabaseStatus = "not_configured";

    try {
      const { pool } = await import("./db");
      await pool.query("SELECT 1");
      dbStatus = "connected";
    } catch {}

    const sbServer = getSupabaseServer();
    if (sbServer) {
      try {
        const { data, error } = await sbServer.from("cities").select("id").limit(1);
        supabaseStatus = error ? `error: ${error.message}` : "connected";
      } catch (e: any) {
        supabaseStatus = `error: ${e.message}`;
      }
    }

    const ok = dbStatus === "connected";
    res.status(ok ? 200 : 500).json({
      ok,
      db: dbStatus,
      supabase: supabaseStatus,
      version: "1.0.0",
    });
  });

  registerMapsRoutes(app);
  registerDispatchRoutes(app);
  registerSmsRoutes(app);
  registerVehicleAssignRoutes(app);
  registerTrackingRoutes(app);

  app.post("/api/auth/login", async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid email or password format" });
      }

      const normalizedEmail = parsed.data.email.trim().toLowerCase();
      const user = await storage.getUserByEmail(normalizedEmail);
      if (!user) {
        console.log(`[AUTH] Login failed: no user found for email=${normalizedEmail}`);
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const valid = await comparePassword(parsed.data.password, user.password);
      if (!valid) {
        console.log(`[AUTH] Login failed: password mismatch for email=${normalizedEmail}`);
        return res.status(401).json({ message: "Invalid credentials" });
      }

      if (!user.active) {
        return res.status(403).json({ message: "Account disabled" });
      }

      const token = signToken({ userId: user.id, role: user.role });
      const cityAccess = await storage.getUserCityAccess(user.id);
      const allCities = await storage.getCities();

      const accessibleCities = user.role === "SUPER_ADMIN"
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

      res.json({
        token,
        user: { ...safeUser, cityAccess },
        cities: accessibleCities,
        mustChangePassword: user.mustChangePassword || false,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  if (process.env.NODE_ENV === "development") {
    app.get("/api/auth/dev-session", async (_req, res) => {
      try {
        const adminEmail = process.env.ADMIN_EMAIL;
        if (!adminEmail) {
          return res.status(503).json({ message: "Dev session unavailable: no ADMIN_EMAIL configured" });
        }
        const user = await storage.getUserByEmail(adminEmail);
        if (!user) {
          return res.status(503).json({ message: "Dev session unavailable: admin user not found" });
        }
        const token = signToken({ userId: user.id, role: user.role });
        const cityAccess = await storage.getUserCityAccess(user.id);
        const allCities = await storage.getCities();
        const accessibleCities = user.role === "SUPER_ADMIN"
          ? allCities
          : allCities.filter((c) => cityAccess.includes(c.id));
        const { password, ...safeUser } = user;
        res.json({
          token,
          user: { ...safeUser, cityAccess },
          cities: accessibleCities,
        });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    });
  }

  app.get("/api/auth/me", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const cityAccess = await storage.getUserCityAccess(user.id);
      const allCities = await storage.getCities();
      const accessibleCities = user.role === "SUPER_ADMIN"
        ? allCities
        : allCities.filter((c) => cityAccess.includes(c.id));

      const { password, ...safeUser } = user;
      res.json({ user: { ...safeUser, cityAccess }, cities: accessibleCities });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/me", async (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }
    const token = header.slice(7);

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
            id: sbUser.id,
            email: sbUser.email,
            role: profile.role,
            city_id: profile.city_id,
            ucm_id: null,
          });
        }
      } catch {}
    }

    try {
      const { verifyToken } = await import("./auth");
      const payload = verifyToken(token);
      const user = await storage.getUser(payload.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const cityAccess = await storage.getUserCityAccess(user.id);
      const primaryCityId = cityAccess.length > 0 ? cityAccess[0] : null;

      return res.json({
        id: user.id,
        email: user.email,
        role: user.role,
        city_id: primaryCityId,
        ucm_id: user.publicId,
      });
    } catch {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  });

  const ALLOWED_TIMEZONES = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Indiana/Indianapolis",
  ];

  app.get("/api/timezones", authMiddleware, (_req: AuthRequest, res) => {
    res.json({ ok: true, items: ALLOWED_TIMEZONES });
  });

  app.get("/api/cities", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const allCities = await storage.getCities();
      if (req.user!.role === "SUPER_ADMIN") {
        return res.json(allCities);
      }
      const cityIds = await getUserCityIds(req.user!.userId, req.user!.role);
      res.json(allCities.filter((c) => cityIds.includes(c.id)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/cities", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const parsed = insertCitySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid city data" });
      }
      const cityData = { ...parsed.data };
      if (!cityData.timezone || !cityData.timezone.trim()) {
        cityData.timezone = "America/Los_Angeles";
      }
      if (!ALLOWED_TIMEZONES.includes(cityData.timezone)) {
        return res.status(400).json({ message: `Invalid timezone. Allowed: ${ALLOWED_TIMEZONES.join(", ")}` });
      }
      const city = await storage.createCity(cityData);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "CREATE",
        entity: "city",
        entityId: city.id,
        details: `Created city ${city.name}`,
        cityId: city.id,
      });
      res.json(city);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/cities/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.params.id);
      if (isNaN(cityId)) return res.status(400).json({ message: "Invalid city ID" });

      const city = await storage.getCity(cityId);
      if (!city) return res.status(404).json({ message: "City not found" });

      const allowed = ["name", "state", "timezone", "active"];
      const updateData: any = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updateData[key] = req.body[key];
      }

      if (updateData.timezone && !ALLOWED_TIMEZONES.includes(updateData.timezone)) {
        return res.status(400).json({ message: `Invalid timezone. Allowed: ${ALLOWED_TIMEZONES.join(", ")}` });
      }

      const updated = await storage.updateCity(cityId, updateData);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "UPDATE",
        entity: "city",
        entityId: cityId,
        details: `Updated city ${city.name}`,
        cityId: cityId,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/users", authMiddleware, requireRole("ADMIN"), async (_req: AuthRequest, res) => {
    try {
      res.json(await storage.getUsers());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const createUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(4),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    role: z.enum(["ADMIN", "DISPATCH", "DRIVER", "VIEWER"]),
    phone: z.string().nullable().optional(),
    cityIds: z.array(z.number()).optional(),
  });

  app.post("/api/users", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid user data" });
      }
      const { cityIds, ...userData } = parsed.data;
      const hashed = await hashPassword(userData.password);
      const publicId = await generatePublicId();

      const user = await storage.createUser({
        ...userData,
        password: hashed,
        publicId,
        active: true,
        phone: userData.phone || null,
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
  });

  app.get("/api/vehicles", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const cityId = await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });
      res.json(await storage.getVehicles(cityId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/vehicles/:id", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const vehicle = await storage.getVehicle(parseInt(req.params.id));
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      if (!(await checkCityAccess(req, vehicle.cityId))) {
        return res.status(403).json({ message: "No access to this vehicle" });
      }
      res.json(vehicle);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/vehicles/:id", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const vehicleId = parseInt(req.params.id);
      const vehicle = await storage.getVehicle(vehicleId);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      if (!(await checkCityAccess(req, vehicle.cityId))) {
        return res.status(403).json({ message: "No access to this vehicle" });
      }

      const { name, licensePlate, colorHex, make, model, year, capacity, wheelchairAccessible, status, cityId, lastServiceDate, maintenanceNotes } = req.body;

      if (!colorHex || !colorHex.trim()) {
        return res.status(400).json({ message: "Vehicle color is required" });
      }
      if (cityId && cityId !== vehicle.cityId) {
        if (!(await checkCityAccess(req, cityId))) {
          return res.status(403).json({ message: "No access to the target city" });
        }
        const assignedDriver = await storage.getDriverByVehicleId(vehicleId);
        if (assignedDriver && assignedDriver.cityId !== cityId) {
          return res.status(400).json({ message: "Vehicle is assigned to a driver in another city; unassign first." });
        }
      }
      let plate = licensePlate;
      if (plate) {
        plate = plate.trim().toUpperCase();
        if (!/^[A-Z0-9-]+$/.test(plate)) {
          return res.status(400).json({ message: "License plate may only contain letters, numbers, and hyphens" });
        }
      }

      const updated = await storage.updateVehicle(vehicleId, {
        name, licensePlate: plate, colorHex, make, model, year, capacity, wheelchairAccessible, status,
        ...(cityId ? { cityId } : {}),
        ...(lastServiceDate !== undefined ? { lastServiceDate: lastServiceDate ? new Date(lastServiceDate) : null } : {}),
        ...(maintenanceNotes !== undefined ? { maintenanceNotes } : {}),
      });
      if (!updated) return res.status(404).json({ message: "Vehicle not found" });

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "UPDATE",
        entity: "vehicle",
        entityId: updated.id,
        details: `Updated vehicle ${updated.name}`,
        cityId: updated.cityId,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/vehicles", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const parsed = insertVehicleSchema.omit({ publicId: true }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid vehicle data" });
      }
      if (!parsed.data.colorHex || !parsed.data.colorHex.trim()) {
        return res.status(400).json({ message: "Vehicle color is required" });
      }
      if (!parsed.data.cityId) {
        return res.status(400).json({ message: "City is required" });
      }
      if (!(await checkCityAccess(req, parsed.data.cityId))) {
        return res.status(403).json({ message: "No access to this city" });
      }
      if (parsed.data.licensePlate) {
        parsed.data.licensePlate = parsed.data.licensePlate.trim().toUpperCase();
        if (!/^[A-Z0-9-]+$/.test(parsed.data.licensePlate)) {
          return res.status(400).json({ message: "License plate may only contain letters, numbers, and hyphens" });
        }
      }
      const publicId = await generatePublicId();
      const vehicle = await storage.createVehicle({ ...parsed.data, publicId });
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "CREATE",
        entity: "vehicle",
        entityId: vehicle.id,
        details: `Created vehicle ${vehicle.name}`,
        cityId: vehicle.cityId,
      });
      res.json(vehicle);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/drivers", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const cityId = await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });
      res.json(await storage.getDrivers(cityId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/drivers", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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
      const publicId = await generatePublicId();
      const driverData: any = { ...parsed.data, publicId };
      if (driverData.phone) {
        const { normalizePhone } = await import("./lib/twilioSms");
        driverData.phone = normalizePhone(driverData.phone) || driverData.phone;
      }

      let authProvisioned = false;
      let tempPassword: string | undefined;
      try {
        const { ensureAuthUserForDriver } = await import("./lib/driverAuth");
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

      const { generateTempPassword } = await import("./lib/driverAuth");
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
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "CREATE",
        entity: "driver",
        entityId: driver.id,
        details: `Created driver ${driver.firstName} ${driver.lastName}${authProvisioned ? " (auth provisioned)" : ""}`,
        cityId: driver.cityId,
      });
      res.json({ ...driver, tempPassword, authProvisioned });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/drivers/:id", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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
        const { normalizePhone } = await import("./lib/twilioSms");
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
  });

  app.get("/api/drivers/:id/vehicle-history", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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
  });

  app.get("/api/clinics", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const cityId = await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });
      res.json(await storage.getClinics(cityId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/clinics", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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
      if (!(await checkCityAccess(req, parsed.data.cityId))) {
        return res.status(403).json({ message: "No access to this city" });
      }
      const publicId = await generatePublicId();
      const clinicData = { ...parsed.data, publicId };
      if (clinicData.phone) {
        const { normalizePhone } = await import("./lib/twilioSms");
        clinicData.phone = normalizePhone(clinicData.phone) || clinicData.phone;
      }
      let clinic = await storage.createClinic(clinicData);

      let authProvisioned = false;
      let userCreated = false;
      let tempPassword: string | undefined;
      try {
        const { ensureAuthUserForClinic } = await import("./lib/driverAuth");
        const result = await ensureAuthUserForClinic({
          name: clinic.name,
          email: clinic.email!,
        });
        clinic = await storage.updateClinic(clinic.id, { authUserId: result.userId } as any);
        authProvisioned = true;
        if (result.tempPassword) tempPassword = result.tempPassword;
        console.log(`[clinicCreate] Auth user ${result.isNew ? "created" : "linked"}: ${result.userId}`);
      } catch (authErr: any) {
        console.error("[clinicCreate] Auth provisioning failed (non-fatal):", authErr.message);
      }

      try {
        const existingUsers = await db.select().from(users).where(eq(users.email, clinic.email!));
        if (existingUsers.length === 0) {
          const { generateTempPassword } = await import("./lib/driverAuth");
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
            role: "VIEWER",
            phone: clinic.phone || null,
            active: true,
            mustChangePassword: true,
            clinicId: clinic.id,
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

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "CREATE",
        entity: "clinic",
        entityId: clinic.id,
        details: `Created clinic ${clinic.name}${authProvisioned ? " (auth provisioned)" : ""}${userCreated ? " (user account created)" : ""}`,
        cityId: clinic.cityId,
      });
      res.json({ ...clinic, userCreated, authProvisioned, tempPassword });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/clinics/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(req.params.id);
      if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });

      const clinic = await storage.getClinic(clinicId);
      if (!clinic) return res.status(404).json({ message: "Clinic not found" });

      if (!(await checkCityAccess(req, clinic.cityId))) {
        return res.status(403).json({ message: "No access to this city" });
      }

      const allowed = ["name", "address", "addressStreet", "addressCity", "addressState", "addressZip", "lat", "lng", "email", "phone", "contactName", "facilityType", "active"];
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

      if (updateData.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(updateData.email)) {
          return res.status(400).json({ message: "Invalid email format" });
        }
      }

      if (updateData.phone) {
        const { normalizePhone } = await import("./lib/twilioSms");
        updateData.phone = normalizePhone(updateData.phone) || updateData.phone;
      }

      if (updateData.email && !clinic.authUserId) {
        try {
          const { ensureAuthUserForClinic } = await import("./lib/driverAuth");
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
            const { generateTempPassword: genTP } = await import("./lib/driverAuth");
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
              role: "VIEWER",
              phone: clinic.phone || null,
              active: true,
              mustChangePassword: true,
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
  });

  app.get("/api/patients", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (user?.role === "VIEWER" && user.clinicId) {
        const clinic = await storage.getClinic(user.clinicId);
        if (clinic) {
          const patients = await storage.getPatients(clinic.cityId);
          return res.json(patients);
        }
        return res.status(403).json({ message: "No clinic linked" });
      }
      const cityId = await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });
      res.json(await storage.getPatients(cityId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/patients", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER"), async (req: AuthRequest, res) => {
    try {
      const parsed = insertPatientSchema.omit({ publicId: true }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid patient data" });
      }
      if (parsed.data.address && !parsed.data.addressZip) {
        return res.status(400).json({ message: "ZIP code is required when providing an address" });
      }
      if (!(await checkCityAccess(req, parsed.data.cityId))) {
        return res.status(403).json({ message: "No access to this city" });
      }
      const publicId = await generatePublicId();
      const patientData = { ...parsed.data, publicId };
      if (patientData.phone) {
        const { normalizePhone } = await import("./lib/twilioSms");
        patientData.phone = normalizePhone(patientData.phone) || patientData.phone;
      }
      const patient = await storage.createPatient(patientData);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "CREATE",
        entity: "patient",
        entityId: patient.id,
        details: `Created patient ${patient.firstName} ${patient.lastName}`,
        cityId: patient.cityId,
      });
      res.json(patient);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/patients/:id", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid patient ID" });

      const existing = await storage.getPatient(id);
      if (!existing) return res.status(404).json({ message: "Patient not found" });

      if (!(await checkCityAccess(req, existing.cityId))) {
        return res.status(403).json({ message: "No access to this city" });
      }

      const allowedFields = ["phone", "address", "addressStreet", "addressCity", "addressState", "addressZip", "lat", "lng", "notes", "insuranceId", "wheelchairRequired", "active", "firstName", "lastName", "dateOfBirth", "cityId"];
      const updateData: Record<string, any> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) {
          updateData[key] = req.body[key];
        }
      }

      if (updateData.cityId && updateData.cityId !== existing.cityId) {
        if (!(await checkCityAccess(req, updateData.cityId))) {
          return res.status(403).json({ message: "No access to target city" });
        }
      }

      if (updateData.phone) {
        const { normalizePhone } = await import("./lib/twilioSms");
        updateData.phone = normalizePhone(updateData.phone) || updateData.phone;
      }

      const patient = await storage.updatePatient(id, updateData as any);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "UPDATE",
        entity: "patient",
        entityId: id,
        details: `Updated patient fields: ${Object.keys(updateData).join(", ")}`,
        cityId: patient?.cityId ?? existing.cityId,
      });
      res.json(patient);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/trips", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (user?.role === "VIEWER" && user.clinicId) {
        const clinic = await storage.getClinic(user.clinicId);
        if (clinic) {
          const trips = await storage.getTrips(clinic.cityId);
          return res.json(trips);
        }
        return res.status(403).json({ message: "No clinic linked" });
      }
      const cityId = await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      res.json(await storage.getTrips(cityId, limit));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const createTripSchema = insertTripSchema.omit({ publicId: true }).refine(
    (d) => !!d.pickupZip,
    { message: "Pickup ZIP code is required", path: ["pickupZip"] }
  ).refine(
    (d) => !!d.dropoffZip,
    { message: "Dropoff ZIP code is required", path: ["dropoffZip"] }
  ).refine(
    (d) => d.tripType !== "recurring" || (Array.isArray(d.recurringDays) && d.recurringDays.length > 0),
    { message: "Recurring trips must have at least one day selected", path: ["recurringDays"] }
  );

  app.post("/api/trips", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER"), async (req: AuthRequest, res) => {
    try {
      const parsed = createTripSchema.safeParse(req.body);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        return res.status(400).json({ message: firstIssue?.message || "Invalid trip data" });
      }
      if (parsed.data.pickupAddress && !parsed.data.pickupZip) {
        return res.status(400).json({ message: "Pickup ZIP code is required" });
      }
      if (parsed.data.dropoffAddress && !parsed.data.dropoffZip) {
        return res.status(400).json({ message: "Dropoff ZIP code is required" });
      }
      if (parsed.data.pickupTime && parsed.data.estimatedArrivalTime && parsed.data.pickupTime >= parsed.data.estimatedArrivalTime) {
        return res.status(400).json({ message: "Pickup time must be before estimated arrival time" });
      }
      if (!(await checkCityAccess(req, parsed.data.cityId))) {
        return res.status(403).json({ message: "No access to this city" });
      }

      const city = await storage.getCity(parsed.data.cityId);
      if (city) {
        const tz = city.timezone || "America/New_York";
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
        const y = parts.find(p => p.type === "year")?.value;
        const m = parts.find(p => p.type === "month")?.value;
        const d = parts.find(p => p.type === "day")?.value;
        const todayStr = `${y}-${m}-${d}`;
        if (parsed.data.scheduledDate < todayStr) {
          return res.status(400).json({ message: "Trip date cannot be in the past" });
        }
      }

      const publicId = await generatePublicId();
      const trip = await storage.createTrip({ ...parsed.data, publicId });
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "CREATE",
        entity: "trip",
        entityId: trip.id,
        details: `Created trip ${publicId}`,
        cityId: trip.cityId,
      });
      res.json(trip);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const updateTripSchema = z.object({
    pickupAddress: z.string().optional(),
    pickupStreet: z.string().optional(),
    pickupCity: z.string().optional(),
    pickupState: z.string().optional(),
    pickupZip: z.string().optional(),
    pickupLat: z.number().optional(),
    pickupLng: z.number().optional(),
    dropoffAddress: z.string().optional(),
    dropoffStreet: z.string().optional(),
    dropoffCity: z.string().optional(),
    dropoffState: z.string().optional(),
    dropoffZip: z.string().optional(),
    dropoffLat: z.number().optional(),
    dropoffLng: z.number().optional(),
    scheduledDate: z.string().optional(),
    scheduledTime: z.string().nullable().optional(),
    pickupTime: z.string().optional(),
    estimatedArrivalTime: z.string().optional(),
    tripType: z.enum(["one_time", "recurring"]).optional(),
    recurringDays: z.array(z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])).nullable().optional(),
    driverId: z.number().nullable().optional(),
    vehicleId: z.number().nullable().optional(),
    clinicId: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
  });

  app.patch("/api/trips/:id", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });

      const parsed = updateTripSchema.safeParse(req.body);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        return res.status(400).json({ message: firstIssue?.message || "Invalid trip data" });
      }

      const existing = await storage.getTrip(id);
      if (!existing) return res.status(404).json({ message: "Trip not found" });

      if (!(await checkCityAccess(req, existing.cityId))) {
        return res.status(403).json({ message: "No access to this city" });
      }

      const updateData: Record<string, any> = {};
      for (const [key, value] of Object.entries(parsed.data)) {
        if (value !== undefined) {
          updateData[key] = value;
        }
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const effectiveTripType = updateData.tripType ?? existing.tripType;
      if (effectiveTripType === "recurring") {
        const effectiveDays = updateData.recurringDays ?? existing.recurringDays;
        if (!Array.isArray(effectiveDays) || effectiveDays.length === 0) {
          return res.status(400).json({ message: "Recurring trips must have at least one day selected" });
        }
      }
      if (updateData.tripType === "one_time") {
        updateData.recurringDays = null;
      }

      if (updateData.pickupAddress) {
        const effectiveZip = updateData.pickupZip ?? existing.pickupZip;
        if (!effectiveZip) {
          return res.status(400).json({ message: "Pickup ZIP code is required" });
        }
      }
      if (updateData.dropoffAddress) {
        const effectiveZip = updateData.dropoffZip ?? existing.dropoffZip;
        if (!effectiveZip) {
          return res.status(400).json({ message: "Dropoff ZIP code is required" });
        }
      }

      const effectivePickup = updateData.pickupTime ?? existing.pickupTime;
      const effectiveArrival = updateData.estimatedArrivalTime ?? existing.estimatedArrivalTime;
      if (effectivePickup && effectiveArrival && effectivePickup >= effectiveArrival) {
        return res.status(400).json({ message: "Pickup time must be before estimated arrival time" });
      }

      const trip = await storage.updateTrip(id, updateData);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "UPDATE",
        entity: "trip",
        entityId: id,
        details: `Updated trip fields: ${Object.keys(updateData).join(", ")}`,
        cityId: existing.cityId,
      });
      res.json(trip);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const updateStatusSchema = z.object({
    status: z.enum(["SCHEDULED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]),
  });

  app.patch("/api/trips/:id/status", authMiddleware, requireRole("ADMIN", "DISPATCH", "DRIVER"), async (req: AuthRequest, res) => {
    try {
      const parsed = updateStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid status" });
      }
      const id = parseInt(req.params.id);
      const trip = await storage.updateTripStatus(id, parsed.data.status);
      if (!trip) return res.status(404).json({ message: "Trip not found" });

      if (parsed.data.status === "IN_PROGRESS") {
        const { autoNotifyPatient } = await import("./lib/dispatchAutoSms");
        autoNotifyPatient(id, "arrived");
      }

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "UPDATE_STATUS",
        entity: "trip",
        entityId: trip.id,
        details: `Trip status changed to ${parsed.data.status}`,
        cityId: trip.cityId,
      });
      res.json(trip);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/stats", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const cityId = await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });
      res.json(await storage.getStats(cityId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/stats/trip-status", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const cityId = await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });
      res.json(await storage.getTripStatusSummary(cityId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/audit", authMiddleware, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const cityId = await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });
      res.json(await storage.getAuditLogs(cityId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/auth/health", async (_req, res) => {
    try {
      const hasJwtSecret = !!process.env.JWT_SECRET;
      const hasAdminEmail = !!process.env.ADMIN_EMAIL;
      const hasAdminPassword = !!process.env.ADMIN_PASSWORD;
      const hasSupabaseUrl = !!process.env.SUPABASE_URL;
      const hasAnonKey = !!process.env.SUPABASE_ANON_KEY;
      const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
      const hasDatabaseUrl = !!process.env.DATABASE_URL;
      const nodeEnv = process.env.NODE_ENV || "development";

      let dbConnected = false;
      let userCount = 0;
      try {
        const result = await db.select({ count: sql<number>`count(*)` }).from(users);
        dbConnected = true;
        userCount = Number(result[0]?.count || 0);
      } catch {}

      let adminExists = false;
      if (process.env.ADMIN_EMAIL) {
        const admin = await storage.getUserByEmail(process.env.ADMIN_EMAIL.trim().toLowerCase());
        adminExists = !!admin;
      }

      res.json({
        ok: dbConnected && (hasAdminEmail && adminExists),
        nodeEnv,
        hasJwtSecret,
        jwtMode: hasJwtSecret ? "env" : "fallback",
        hasAdminEmail,
        hasAdminPassword,
        adminExists,
        hasSupabaseUrl,
        hasAnonKey,
        hasServiceRole,
        hasDatabaseUrl,
        dbConnected,
        userCount,
        siteUrl: process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS}` : "unknown",
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/auth/admin/health", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { checkAdminHealth } = await import("./lib/driverAuth");
      const result = await checkAdminHealth();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, hasServiceRole: false, canCreateUsers: false, error: err.message });
    }
  });

  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
  });

  app.post("/api/auth/change-password", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
      }

      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const valid = await comparePassword(parsed.data.currentPassword, user.password);
      if (!valid) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      const hashed = await hashPassword(parsed.data.newPassword);
      await db.update(users).set({ password: hashed, mustChangePassword: false }).where(eq(users.id, user.id));

      if (user.email) {
        try {
          const supabase = getSupabaseServer();
          if (supabase) {
            const { data: listData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
            const sbUser = listData?.users?.find((u: any) => u.email?.toLowerCase() === user.email.toLowerCase());
            if (sbUser) {
              await supabase.auth.admin.updateUser(sbUser.id, {
                password: parsed.data.newPassword,
                user_metadata: { must_change_password: false },
              });
            }
          }
        } catch (sbErr: any) {
          console.error("[changePassword] Supabase password sync failed (non-fatal):", sbErr.message);
        }
      }

      await storage.createAuditLog({
        userId: user.id,
        action: "CHANGE_PASSWORD",
        entity: "user",
        entityId: user.id,
        details: `User ${user.email} changed password`,
        cityId: null,
      });

      res.json({ success: true, message: "Password changed successfully" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const adminSetPasswordSchema = z.object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
  });

  app.post("/api/admin/users/:id/set-password", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const targetUserId = parseInt(req.params.id);
      if (isNaN(targetUserId)) return res.status(400).json({ message: "Invalid user ID" });

      const parsed = adminSetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
      }

      const targetUser = await storage.getUser(targetUserId);
      if (!targetUser) return res.status(404).json({ message: "User not found" });

      const hashed = await hashPassword(parsed.data.newPassword);
      await db.update(users).set({ password: hashed, mustChangePassword: false }).where(eq(users.id, targetUserId));

      if (targetUser.email) {
        try {
          const supabase = getSupabaseServer();
          if (supabase) {
            const { data: listData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
            const sbUser = listData?.users?.find((u: any) => u.email?.toLowerCase() === targetUser.email.toLowerCase());
            if (sbUser) {
              await supabase.auth.admin.updateUser(sbUser.id, {
                password: parsed.data.newPassword,
                user_metadata: { must_change_password: false },
              });
            }
          }
        } catch (sbErr: any) {
          console.error("[adminSetPassword] Supabase password sync failed (non-fatal):", sbErr.message);
        }
      }

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "ADMIN_SET_PASSWORD",
        entity: "user",
        entityId: targetUserId,
        details: `Super admin reset password for user ${targetUser.email}`,
        cityId: null,
      });

      res.json({ success: true, message: `Password set for ${targetUser.email}` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/drivers/:id/send-invite", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const driverId = parseInt(req.params.id);
      if (isNaN(driverId)) return res.status(400).json({ message: "Invalid driver ID" });

      const driver = await storage.getDriver(driverId);
      if (!driver) return res.status(404).json({ message: "Driver not found" });
      if (!driver.email) return res.status(400).json({ message: "Driver has no email address" });

      if (!driver.authUserId) {
        try {
          const { ensureAuthUserForDriver } = await import("./lib/driverAuth");
          const { userId: authUserId } = await ensureAuthUserForDriver({
            name: `${driver.firstName} ${driver.lastName}`,
            email: driver.email,
          });
          await storage.updateDriver(driverId, { authUserId } as any);
        } catch (provErr: any) {
          return res.status(500).json({ message: `Failed to provision auth: ${provErr.message}` });
        }
      }

      const { generateInviteLink } = await import("./lib/driverAuth");
      const result = await generateInviteLink(driver.email);
      if (!result.success) {
        return res.status(500).json({ message: result.error || "Failed to send invite" });
      }

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "SEND_INVITE",
        entity: "driver",
        entityId: driverId,
        details: `Sent login invite to driver ${driver.firstName} ${driver.lastName} (${driver.email})`,
        cityId: driver.cityId,
      });

      res.json({ success: true, message: `Login link sent to ${driver.email}` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/drivers/backfill-auth", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const allDrivers = await storage.getDrivers();
      const results = { processed: 0, created: 0, linked: 0, skipped: 0, errors: [] as string[] };

      for (const driver of allDrivers) {
        if (!driver.email) {
          results.skipped++;
          continue;
        }
        if (driver.authUserId) {
          results.skipped++;
          continue;
        }
        results.processed++;
        try {
          const { ensureAuthUserForDriver } = await import("./lib/driverAuth");
          const { userId: authUserId, isNew } = await ensureAuthUserForDriver({
            name: `${driver.firstName} ${driver.lastName}`,
            email: driver.email,
          });
          await storage.updateDriver(driver.id, { authUserId } as any);
          if (isNew) results.created++;
          else results.linked++;
        } catch (err: any) {
          results.errors.push(`Driver ${driver.id} (${driver.email}): ${err.message}`);
        }
      }

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "BACKFILL_AUTH",
        entity: "driver",
        entityId: null,
        details: `Backfill auth: processed=${results.processed}, created=${results.created}, linked=${results.linked}, skipped=${results.skipped}`,
        cityId: null,
      });

      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/clinics/:id/send-invite", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(req.params.id);
      if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });

      const clinic = await storage.getClinic(clinicId);
      if (!clinic) return res.status(404).json({ message: "Clinic not found" });
      if (!clinic.email) return res.status(400).json({ message: "Clinic has no email address" });

      if (!clinic.authUserId) {
        try {
          const { ensureAuthUserForClinic } = await import("./lib/driverAuth");
          const { userId: authUserId } = await ensureAuthUserForClinic({
            name: clinic.name,
            email: clinic.email,
          });
          await storage.updateClinic(clinicId, { authUserId } as any);
        } catch (provErr: any) {
          return res.status(500).json({ message: `Failed to provision auth: ${provErr.message}` });
        }
      }

      const { generateInviteLink } = await import("./lib/driverAuth");
      const result = await generateInviteLink(clinic.email);
      if (!result.success) {
        return res.status(500).json({ message: result.error || "Failed to send invite" });
      }

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "SEND_INVITE",
        entity: "clinic",
        entityId: clinicId,
        details: `Sent login invite to clinic ${clinic.name} (${clinic.email})`,
        cityId: clinic.cityId,
      });

      res.json({ success: true, message: `Login link sent to ${clinic.email}` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clinic/invoices", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (user.role === "SUPER_ADMIN" || user.role === "ADMIN" || user.role === "DISPATCH") {
        const allInvoices = await storage.getInvoices();
        return res.json(allInvoices);
      }

      if (!user.clinicId) {
        return res.status(403).json({ message: "No clinic linked to this account" });
      }

      const clinicInvoices = await storage.getInvoices(user.clinicId);
      res.json(clinicInvoices);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clinic/invoices/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (user.role === "SUPER_ADMIN" || user.role === "ADMIN" || user.role === "DISPATCH") {
        return res.json(invoice);
      }

      if (!user.clinicId || user.clinicId !== invoice.clinicId) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(invoice);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/invoices", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (_req: AuthRequest, res) => {
    try {
      res.json(await storage.getInvoices());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ops/driver-locations", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.query.city_id as string);
      if (isNaN(cityId)) return res.status(400).json({ message: "city_id is required" });

      const hasAccess = await checkCityAccess(req, cityId);
      if (!hasAccess) return res.status(403).json({ message: "No access to this city" });

      const allDrivers = await storage.getDrivers(cityId);
      const allVehicles = await storage.getVehicles(cityId);
      const vehicleMap = new Map(allVehicles.map((v: any) => [v.id, v]));
      const activeDrivers = allDrivers.filter((d: any) => d.status === "ACTIVE");

      const locations = activeDrivers
        .filter((d: any) => d.lastLat != null && d.lastLng != null)
        .map((d: any) => {
          const vehicle = d.vehicleId ? vehicleMap.get(d.vehicleId) : null;
          return {
            driver_id: d.id,
            driver_name: `${d.firstName} ${d.lastName}`,
            city_id: d.cityId,
            lat: d.lastLat,
            lng: d.lastLng,
            updated_at: d.lastSeenAt ? new Date(d.lastSeenAt).toISOString() : null,
            status: d.dispatchStatus,
            vehicle_id: vehicle?.id ?? null,
            vehicle_label: vehicle ? `${vehicle.name}` : null,
            vehicle_color: vehicle?.colorHex ?? null,
          };
        });

      res.json(locations);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ops/fleet", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.query.city_id as string);
      if (isNaN(cityId)) return res.status(400).json({ message: "city_id is required" });

      const hasAccess = await checkCityAccess(req, cityId);
      if (!hasAccess) return res.status(403).json({ message: "No access to this city" });

      const allDrivers = await storage.getDrivers(cityId);
      const allVehicles = await storage.getVehicles(cityId);

      const activeDrivers = allDrivers.filter((d: any) => d.status === "ACTIVE");
      const activeVehicles = allVehicles.filter((v: any) => v.status === "ACTIVE");

      const assignedDrivers = activeDrivers.filter((d: any) => d.vehicleId != null);
      const unassignedDrivers = activeDrivers.filter((d: any) => d.vehicleId == null);

      const assignedVehicleIds = new Set(activeDrivers.filter((d: any) => d.vehicleId != null).map((d: any) => d.vehicleId));
      const unassignedVehicles = activeVehicles.filter((v: any) => !assignedVehicleIds.has(v.id));
      const assignedVehicles = activeVehicles.filter((v: any) => assignedVehicleIds.has(v.id));

      const conflicts: any[] = [];

      for (const d of assignedDrivers) {
        if (!d.vehicleId) continue;
        const vehicle = allVehicles.find((v: any) => v.id === d.vehicleId);
        if (!vehicle) continue;
        if (vehicle.cityId !== d.cityId) {
          conflicts.push({
            type: "vehicle_city_mismatch",
            driverId: d.id,
            driverName: `${d.firstName} ${d.lastName}`,
            driverPublicId: d.publicId,
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            vehiclePublicId: vehicle.publicId,
            vehicleCityId: vehicle.cityId,
            driverCityId: d.cityId,
            message: `Driver ${d.firstName} ${d.lastName} (${d.publicId}) assigned to vehicle ${vehicle.name} (${vehicle.publicId}) from different city`,
          });
        }
      }

      for (const d of allDrivers) {
        if (!d.vehicleId) continue;
        const vehicle = allVehicles.find((v: any) => v.id === d.vehicleId);
        if (!vehicle) continue;
        if (vehicle.status !== "ACTIVE") {
          conflicts.push({
            type: "vehicle_not_active_but_assigned",
            driverId: d.id,
            driverName: `${d.firstName} ${d.lastName}`,
            driverPublicId: d.publicId,
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            vehiclePublicId: vehicle.publicId,
            vehicleStatus: vehicle.status,
            message: `Driver ${d.firstName} ${d.lastName} (${d.publicId}) assigned to ${vehicle.status} vehicle ${vehicle.name} (${vehicle.publicId})`,
          });
        }
      }

      const vehicleDriverMap: Record<number, any[]> = {};
      for (const d of allDrivers) {
        if (!d.vehicleId) continue;
        if (!vehicleDriverMap[d.vehicleId]) vehicleDriverMap[d.vehicleId] = [];
        vehicleDriverMap[d.vehicleId].push(d);
      }
      for (const [vehicleIdStr, driverList] of Object.entries(vehicleDriverMap)) {
        if (driverList.length > 1) {
          const vehicle = allVehicles.find((v: any) => v.id === parseInt(vehicleIdStr));
          conflicts.push({
            type: "duplicate_vehicle_assignments",
            vehicleId: parseInt(vehicleIdStr),
            vehicleName: vehicle?.name || "Unknown",
            vehiclePublicId: vehicle?.publicId || "",
            drivers: driverList.map((d: any) => ({
              id: d.id,
              name: `${d.firstName} ${d.lastName}`,
              publicId: d.publicId,
            })),
            message: `Vehicle ${vehicle?.name || vehicleIdStr} (${vehicle?.publicId}) assigned to ${driverList.length} drivers: ${driverList.map((d: any) => `${d.firstName} ${d.lastName}`).join(", ")}`,
          });
        }
      }

      res.json({
        cityId,
        summary: {
          drivers_total: activeDrivers.length,
          vehicles_total: activeVehicles.length,
          drivers_assigned: assignedDrivers.length,
          drivers_unassigned: unassignedDrivers.length,
          vehicles_assigned: assignedVehicles.length,
          vehicles_unassigned: unassignedVehicles.length,
        },
        unassigned_drivers: unassignedDrivers.map((d: any) => ({
          id: d.id,
          publicId: d.publicId,
          name: `${d.firstName} ${d.lastName}`,
          phone: d.phone,
          dispatchStatus: d.dispatchStatus,
        })),
        unassigned_vehicles: unassignedVehicles.map((v: any) => ({
          id: v.id,
          publicId: v.publicId,
          name: v.name,
          licensePlate: v.licensePlate,
          capacity: v.capacity,
          wheelchairAccessible: v.wheelchairAccessible,
        })),
        conflicts,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
