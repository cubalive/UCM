import type { Express } from "express";
import PDFDocument from "pdfkit";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { authMiddleware, requireRole, signToken, hashPassword, comparePassword, getUserCityIds, getCompanyIdFromAuth, applyCompanyFilter, checkCompanyOwnership, type AuthRequest } from "./auth";
import { generatePublicId } from "./public-id";
import { loginSchema, insertCitySchema, insertVehicleSchema, insertDriverSchema, insertClinicSchema, insertPatientSchema, insertTripSchema, insertCompanySchema, users, drivers, vehicles, cities, clinics, patients, vehicleMakes, vehicleModels, trips, tripMessages, recurringSchedules, companies, tripEvents, clinicAlertLog, citySettings, driverTripAlerts, driverOffers, invoices, scheduleChangeRequests, driverBonusRules, driverScores } from "@shared/schema";
import { z } from "zod";
import { eq, ne, sql, and, or, not, isNull, inArray, notInArray, desc, gte } from "drizzle-orm";
import { db } from "./db";
import { getSupabaseServer } from "../lib/supabaseClient";
import { registerMapsRoutes } from "./lib/mapsRoutes";
import { registerDispatchRoutes } from "./lib/dispatchRoutes";
import { registerSmsRoutes } from "./lib/smsRoutes";
import { registerVehicleAssignRoutes } from "./lib/vehicleAssignRoutes";
import { registerTrackingRoutes } from "./lib/trackingRoutes";
import { registerTripSeriesRoutes } from "./lib/tripSeriesRoutes";
import { registerReportRoutes } from "./lib/reportRoutes";
import { registerOpsRoutes, startOpsAlertScheduler } from "./lib/opsRoutes";
import { registerAutomationRoutes } from "./lib/automationRoutes";
import { registerScheduleRoutes } from "./lib/scheduleRoutes";
import { registerPricingRoutes } from "./lib/pricingRoutes";
import { registerAssignmentRoutes } from "./lib/assignmentRoutes";
import { registerPublicApiRoutes } from "./lib/publicApiRoutes";
import { registerClinicBillingRoutes } from "./lib/clinicBillingRoutes";
import { sendEmail } from "./lib/email";
import { startRouteScheduler } from "./lib/routeEngine";
import { startNoShowScheduler } from "./lib/noShowEngine";
import { startRecurringScheduleScheduler, runRecurringScheduleGenerator } from "./lib/recurringScheduleEngine";

async function checkCityAccess(req: AuthRequest, cityId: number | undefined): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === "SUPER_ADMIN") return true;
  if (!cityId) return true;
  const allowed = await getUserCityIds(req.user.userId, req.user.role);
  return allowed.includes(cityId);
}

import { tripLockedGuard } from "./lib/tripLockGuard";

function getCityIdFromRequest(req: AuthRequest): number | undefined {
  const fromQuery = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
  if (fromQuery && !isNaN(fromQuery)) return fromQuery;
  const fromHeader = req.headers["x-city-id"];
  if (fromHeader) {
    const parsed = parseInt(fromHeader as string);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
}

async function getAllowedCityId(req: AuthRequest): Promise<number | undefined> {
  const cityId = getCityIdFromRequest(req);
  if (!cityId) return undefined;
  if (req.user!.role === "SUPER_ADMIN") return cityId;
  const allowed = await getUserCityIds(req.user!.userId, req.user!.role);
  if (!allowed.includes(cityId)) return -1;
  return cityId;
}

function enforceCityContext(req: AuthRequest, res: any): number | undefined | false {
  const role = req.user?.role || "";
  const cityId = getCityIdFromRequest(req);
  if (role === "SUPER_ADMIN") {
    return cityId || undefined;
  }
  if (["ADMIN", "DISPATCH", "COMPANY_ADMIN"].includes(role)) {
    if (!cityId) {
      res.status(400).json({ message: "CITY_REQUIRED", error: "You must select a working city before accessing data." });
      return false;
    }
    return cityId;
  }
  return cityId || undefined;
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

  app.get("/api/pwa/health", (_req, res) => {
    res.json({
      ok: true,
      pwa: true,
      serviceWorker: "sw.js",
      manifest: "/manifest.json",
      timestamp: new Date().toISOString(),
    });
  });

  registerMapsRoutes(app);
  registerDispatchRoutes(app);
  registerSmsRoutes(app);
  registerVehicleAssignRoutes(app);
  registerTrackingRoutes(app);
  registerTripSeriesRoutes(app);
  registerReportRoutes(app);
  registerOpsRoutes(app);
  registerAutomationRoutes(app);
  registerScheduleRoutes(app);
  registerPricingRoutes(app);
  registerAssignmentRoutes(app, authMiddleware);
  registerPublicApiRoutes(app);
  registerClinicBillingRoutes(app);
  startOpsAlertScheduler();
  startRouteScheduler();
  startNoShowScheduler();
  startRecurringScheduleScheduler();

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

      const token = signToken({ userId: user.id, role: user.role, companyId: user.companyId || null });
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
        const token = signToken({ userId: user.id, role: user.role, companyId: user.companyId || null });
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

  app.get("/api/companies", authMiddleware, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res) => {
    try {
      const result = await db.select().from(companies).orderBy(companies.name);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/companies", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const parsed = insertCompanySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid company data" });
      const [company] = await db.insert(companies).values(parsed.data).returning();
      res.json(company);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/companies/:id/admin", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const companyId = parseInt(req.params.id);
      if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });
      const existing = await db.select().from(companies).where(eq(companies.id, companyId));
      if (!existing.length) return res.status(404).json({ message: "Company not found" });

      const { email, password, firstName, lastName, cityIds } = req.body;
      if (!email || !password) return res.status(400).json({ message: "Email and password required" });

      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.hash(password, 10);
      const publicId = await generatePublicId();

      const newUser = await storage.createUser({
        email,
        password: hashedPassword,
        firstName: firstName || "Company",
        lastName: lastName || "Admin",
        role: "COMPANY_ADMIN",
        publicId,
        companyId,
      } as any);

      if (cityIds && Array.isArray(cityIds)) {
        for (const cid of cityIds) {
          await storage.createUserCity({ userId: newUser.id, cityId: cid });
        }
      }

      res.json({ id: newUser.id, email: newUser.email, role: newUser.role, companyId: newUser.companyId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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

  app.get("/api/users", authMiddleware, requireRole("ADMIN", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const companyId = getCompanyIdFromAuth(req);
      const allUsers = await storage.getUsers();
      res.json(applyCompanyFilter(allUsers as any[], companyId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const createUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(4),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    role: z.enum(["ADMIN", "DISPATCH", "DRIVER", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER"]),
    phone: z.string().nullable().optional(),
    cityIds: z.array(z.number()).optional(),
    companyId: z.number().nullable().optional(),
  });

  app.post("/api/users", authMiddleware, requireRole("ADMIN", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid user data" });
      }
      const { cityIds, companyId: bodyCompanyId, ...userData } = parsed.data;
      const hashed = await hashPassword(userData.password);
      const publicId = await generatePublicId();

      const callerCompanyId = getCompanyIdFromAuth(req);
      const effectiveCompanyId = callerCompanyId || bodyCompanyId || null;

      const user = await storage.createUser({
        ...userData,
        password: hashed,
        publicId,
        active: true,
        phone: userData.phone || null,
        companyId: effectiveCompanyId,
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

  app.get("/api/vehicle-makes", authMiddleware, async (_req: AuthRequest, res) => {
    try {
      const makes = await db.select().from(vehicleMakes).where(eq(vehicleMakes.isActive, true)).orderBy(vehicleMakes.name);
      res.json(makes);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/vehicle-models", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const makeId = parseInt(req.query.make_id as string);
      if (!makeId) return res.status(400).json({ message: "make_id is required" });
      const models = await db.select().from(vehicleModels)
        .where(sql`${vehicleModels.makeId} = ${makeId} AND ${vehicleModels.isActive} = true`)
        .orderBy(vehicleModels.name);
      res.json(models);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/vehicles", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const enforced = enforceCityContext(req, res);
      if (enforced === false) return;
      const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });
      const companyId = getCompanyIdFromAuth(req);
      const allVehicles = await storage.getVehicles(cityId);
      res.json(applyCompanyFilter(allVehicles, companyId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/vehicles/:id", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const vehicle = await storage.getVehicle(parseInt(req.params.id));
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      if (!(await checkCityAccess(req, vehicle.cityId))) {
        return res.status(403).json({ message: "No access to this vehicle" });
      }
      const companyId = getCompanyIdFromAuth(req);
      if (!checkCompanyOwnership(vehicle, companyId)) {
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

      const { name, licensePlate, colorHex, make, model, makeId, modelId, makeText, modelText, year, capacity, wheelchairAccessible, status, cityId, lastServiceDate, maintenanceNotes } = req.body;

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
        ...(makeId !== undefined ? { makeId: makeId || null } : {}),
        ...(modelId !== undefined ? { modelId: modelId || null } : {}),
        ...(makeText !== undefined ? { makeText: makeText || null } : {}),
        ...(modelText !== undefined ? { modelText: modelText || null } : {}),
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

  app.post("/api/vehicles", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
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
      const companyId = getCompanyIdFromAuth(req);
      const vehicle = await storage.createVehicle({ ...parsed.data, publicId, companyId });
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

  app.get("/api/drivers", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
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
  });

  app.post("/api/drivers", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
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
      const callerCompanyId = getCompanyIdFromAuth(req);
      const driverData: any = { ...parsed.data, publicId, companyId: callerCompanyId };
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
      let emailSent = false;
      if (tempPassword && driverData.email) {
        try {
          const { sendDriverTempPassword } = await import("./services/emailService");
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

  app.get("/api/clinics", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
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
  });

  app.post("/api/clinics", authMiddleware, requireRole("ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
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

      let emailSent = false;
      if (authProvisioned && clinic.email) {
        try {
          const { sendClinicLoginLink } = await import("./services/emailService");
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

  app.get("/api/patients", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if ((user?.role === "VIEWER" || user?.role === "CLINIC_USER") && user.clinicId) {
        const clinicPatients = await db.select().from(patients).where(
          and(eq(patients.clinicId, user.clinicId), eq(patients.active, true), isNull(patients.deletedAt))
        ).orderBy(patients.firstName);
        return res.json(clinicPatients);
      }
      const enforced = enforceCityContext(req, res);
      if (enforced === false) return;
      const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });
      const companyId = getCompanyIdFromAuth(req);

      const source = req.query.source as string | undefined;
      const conditions: any[] = [isNull(patients.deletedAt), eq(patients.active, true)];
      if (cityId && cityId > 0) conditions.push(eq(patients.cityId, cityId));
      if (companyId) conditions.push(eq(patients.companyId, companyId));

      if (source === "clinic") {
        conditions.push(eq(patients.source, "clinic"));
        const clinicIdFilter = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
        if (clinicIdFilter) conditions.push(eq(patients.clinicId, clinicIdFilter));
      } else if (source === "internal") {
        conditions.push(eq(patients.source, "internal"));
      } else if (source === "private") {
        conditions.push(eq(patients.source, "private"));
      }

      const result = await db.select().from(patients).where(and(...conditions)).orderBy(patients.firstName);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/patients/clinic-groups", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const enforced = enforceCityContext(req, res);
      if (enforced === false) return;
      const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });
      const companyId = getCompanyIdFromAuth(req);

      const conditions: any[] = [isNull(patients.deletedAt), eq(patients.active, true), eq(patients.source, "clinic")];
      if (cityId && cityId > 0) conditions.push(eq(patients.cityId, cityId));
      if (companyId) conditions.push(eq(patients.companyId, companyId));

      const clinicPatients = await db.select().from(patients).where(and(...conditions)).orderBy(patients.firstName);

      const allClinics = await storage.getClinics(cityId || undefined);
      const filteredClinics = applyCompanyFilter(allClinics, companyId).filter((c: any) => !c.deletedAt);

      const groups = filteredClinics.map((clinic: any) => {
        const pts = clinicPatients.filter((p: any) => p.clinicId === clinic.id);
        return {
          clinic_id: clinic.id,
          clinic_name: clinic.name,
          patient_count: pts.length,
          patients: pts,
        };
      }).filter((g: any) => g.patient_count > 0 || true);

      res.json(groups);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/patients", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if ((user?.role === "VIEWER" || user?.role === "CLINIC_USER") && user.clinicId) {
        const clinic = await storage.getClinic(user.clinicId);
        if (!clinic) return res.status(403).json({ message: "No clinic linked" });
        req.body.clinicId = user.clinicId;
        req.body.cityId = clinic.cityId;
      }
      const parsed = insertPatientSchema.omit({ publicId: true }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid patient data" });
      }
      if (parsed.data.address && !parsed.data.addressZip) {
        return res.status(400).json({ message: "ZIP code is required when providing an address" });
      }
      if (parsed.data.address && (parsed.data.lat == null || parsed.data.lng == null)) {
        return res.status(400).json({ message: "Address must be selected from autocomplete (lat/lng required)" });
      }
      if (!(await checkCityAccess(req, parsed.data.cityId))) {
        return res.status(403).json({ message: "No access to this city" });
      }
      const publicId = await generatePublicId();
      const callerCompanyId = getCompanyIdFromAuth(req);
      const autoSource = (user?.role === "CLINIC_USER" || user?.role === "VIEWER") && user.clinicId ? "clinic" : "internal";
      const patientData = { ...parsed.data, publicId, companyId: callerCompanyId, source: parsed.data.source || autoSource };
      const effectiveSource = patientData.source;
      if ((effectiveSource === "private" || effectiveSource === "internal") && !patientData.email?.trim()) {
        return res.status(400).json({ message: "Email is required for Private/Internal patients to receive invoices and payment links." });
      }
      if (patientData.email) {
        patientData.email = patientData.email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientData.email)) {
          return res.status(400).json({ message: "Invalid email address format." });
        }
      }
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

      const user = await storage.getUser(req.user!.userId);
      if (user?.role === "VIEWER" && user.clinicId) {
        if (existing.clinicId !== user.clinicId) {
          return res.status(403).json({ message: "You can only edit patients belonging to your clinic" });
        }
      }

      if (!(await checkCityAccess(req, existing.cityId))) {
        return res.status(403).json({ message: "No access to this city" });
      }

      const allowedFields = ["phone", "email", "address", "addressStreet", "addressCity", "addressState", "addressZip", "addressPlaceId", "lat", "lng", "notes", "insuranceId", "wheelchairRequired", "active", "firstName", "lastName", "dateOfBirth", "cityId"];
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

      if (updateData.address !== undefined) {
        if (!updateData.addressZip || !String(updateData.addressZip).trim()) {
          return res.status(400).json({ message: "ZIP code is required when providing an address" });
        }
        if (updateData.lat == null || updateData.lng == null) {
          return res.status(400).json({ message: "Address must be selected from autocomplete (lat/lng required)" });
        }
      }

      if (updateData.email !== undefined) {
        if (updateData.email) {
          updateData.email = updateData.email.trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updateData.email)) {
            return res.status(400).json({ message: "Invalid email address format." });
          }
        }
        const effectiveSource = existing.source;
        if ((effectiveSource === "private" || effectiveSource === "internal") && !updateData.email?.trim()) {
          return res.status(400).json({ message: "Email is required for Private/Internal patients." });
        }
      } else {
        const effectiveSource = existing.source;
        if ((effectiveSource === "private" || effectiveSource === "internal") && !existing.email?.trim()) {
          return res.status(400).json({ message: "Email is required for Private/Internal patients. Please add an email address." });
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

  app.get("/api/recurring-schedules", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;
      if (patientId) {
        const schedules = await storage.getRecurringSchedulesByPatient(patientId);
        return res.json(schedules);
      }
      const cityId = req.query.cityId ? Number(req.query.cityId) : undefined;
      if (cityId) {
        if (!(await checkCityAccess(req, cityId))) {
          return res.status(403).json({ message: "No access to this city" });
        }
        const schedules = await storage.getRecurringSchedulesByCity(cityId);
        return res.json(schedules);
      }
      const schedules = await storage.getActiveRecurringSchedules();
      res.json(schedules);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/recurring-schedules", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const { patientId, cityId, days, pickupTime, startDate, endDate } = req.body;
      if (!patientId || !cityId || !days?.length || !pickupTime || !startDate) {
        return res.status(400).json({ message: "patientId, cityId, days, pickupTime, and startDate are required" });
      }
      if (!(await checkCityAccess(req, cityId))) {
        return res.status(403).json({ message: "No access to this city" });
      }
      const patient = await storage.getPatient(patientId);
      if (!patient) {
        return res.status(404).json({ message: "Patient not found" });
      }
      if (!patient.address) {
        return res.status(400).json({ message: "Cannot create recurring schedule: patient has no address on file. Please add an address first." });
      }
      const schedule = await storage.createRecurringSchedule({
        patientId,
        cityId,
        days,
        pickupTime,
        startDate,
        endDate: endDate || null,
        active: true,
      });
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "CREATE",
        entity: "recurring_schedule",
        entityId: schedule.id,
        details: `Created recurring schedule for patient ${patientId}: ${days.join(",")} at ${pickupTime}`,
        cityId,
      });
      res.status(201).json(schedule);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/recurring-schedules/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const current = (await db.select().from(recurringSchedules).where(eq(recurringSchedules.id, id)).limit(1))[0];
      if (!current) return res.status(404).json({ message: "Schedule not found" });

      const merged = { ...current, ...req.body };
      if (merged.active) {
        if (!merged.days?.length || !merged.pickupTime) {
          return res.status(400).json({ message: "Cannot activate schedule without days and pickup time" });
        }
        const patient = await storage.getPatient(merged.patientId);
        if (!patient?.address) {
          return res.status(400).json({ message: "Cannot activate schedule: patient has no address on file" });
        }
      }
      if (merged.endDate && merged.startDate && merged.endDate < merged.startDate) {
        return res.status(400).json({ message: "End date must be on or after start date" });
      }

      const schedule = await storage.updateRecurringSchedule(id, req.body);
      if (!schedule) return res.status(404).json({ message: "Schedule not found" });
      res.json(schedule);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/recurring-schedules/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      await storage.deleteRecurringSchedule(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/recurring-schedules/generate", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const result = await runRecurringScheduleGenerator();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/driver/my-trips", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
      const driverTrips = await storage.getTripsByDriverAndDate(user.driverId, date);
      const allDriverTrips = await db.select().from(trips).where(
        and(
          eq(trips.driverId, user.driverId),
          isNull(trips.deletedAt)
        )
      );
      const todayTrips = driverTrips;
      res.json({ todayTrips, allTrips: allDriverTrips.slice(0, 100) });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/driver/profile", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const driver = await storage.getDriver(user.driverId);
      if (!driver) return res.status(404).json({ message: "Driver not found" });
      const vehicle = driver.vehicleId ? await storage.getVehicle(driver.vehicleId) : null;
      res.json({ driver, vehicle });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Phase 1: Driver availability toggle
  app.post("/api/driver/me/active", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const { active } = req.body;
      if (typeof active !== "boolean") return res.status(400).json({ message: "active must be boolean" });
      const newStatus = active ? "available" : "off";
      const now = new Date();
      const updateData: any = { dispatchStatus: newStatus, lastSeenAt: now };
      if (active) {
        updateData.lastActiveAt = now;
      } else {
        updateData.lastLat = null;
        updateData.lastLng = null;
      }
      await db.update(drivers).set(updateData).where(eq(drivers.id, user.driverId));
      const driver = await storage.getDriver(user.driverId);
      res.json({ driver });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/driver/me/break", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const driver = await storage.getDriver(user.driverId);
      if (!driver) return res.status(404).json({ message: "Driver not found" });
      const { onBreak } = req.body;
      if (typeof onBreak !== "boolean") return res.status(400).json({ message: "onBreak must be boolean" });
      if (onBreak) {
        if (driver.dispatchStatus === "off") {
          return res.status(400).json({ message: "Cannot go on break while offline. Go online first." });
        }
        const TERMINAL = ["COMPLETED", "CANCELLED", "NO_SHOW"];
        const activeTrips = await db.select({ id: trips.id }).from(trips).where(
          and(eq(trips.driverId, driver.id), not(inArray(trips.status, TERMINAL as any)))
        ).limit(1);
        if (activeTrips.length > 0) {
          return res.status(400).json({ message: "Cannot go on break while you have active trips." });
        }
        await db.update(drivers).set({ dispatchStatus: "hold", lastSeenAt: new Date() }).where(eq(drivers.id, driver.id));
      } else {
        if (driver.dispatchStatus !== "hold") {
          return res.status(400).json({ message: "You are not currently on break." });
        }
        await db.update(drivers).set({ dispatchStatus: "available", lastSeenAt: new Date() }).where(eq(drivers.id, driver.id));
      }
      const updated = await storage.getDriver(user.driverId);
      res.json({ driver: updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/auth/driver-logout", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.json({ ok: true });
      await db.update(drivers).set({
        dispatchStatus: "off",
        lastLat: null,
        lastLng: null,
        lastSeenAt: null,
      }).where(eq(drivers.id, user.driverId));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Phase 1: Get active drivers for dispatch
  app.get("/api/dispatch/drivers/active", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const enforced = enforceCityContext(req, res);
      if (enforced === false) return;
      const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });
      const activeDrivers = await db.select().from(drivers).where(
        and(
          eq(drivers.dispatchStatus, "available"),
          eq(drivers.active, true),
          isNull(drivers.deletedAt),
          ...(cityId && cityId > 0 ? [eq(drivers.cityId, cityId)] : [])
        )
      );
      const allCities = await storage.getCities();
      const cityMap = new Map(allCities.map(c => [c.id, c]));
      const enriched = await Promise.all(activeDrivers.map(async (d) => {
        const vehicle = d.vehicleId ? await storage.getVehicle(d.vehicleId) : null;
        const city = cityMap.get(d.cityId);
        return {
          ...d,
          vehicleName: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
          vehicleType: vehicle?.type || null,
          cityName: city?.name || null,
        };
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Phase 4: Driver location heartbeat
  app.post("/api/driver/me/location", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const { lat, lng, heading, speed } = req.body;
      if (typeof lat !== "number" || typeof lng !== "number") {
        return res.status(400).json({ message: "lat and lng are required numbers" });
      }

      const { cache, cacheKeys, CACHE_TTL } = await import("./lib/cache");
      const { broadcastToTrip } = await import("./lib/realtime");
      const locKey = cacheKeys("driver_location", user.driverId);
      cache.set(locKey, { driverId: user.driverId, lat, lng, timestamp: Date.now(), heading, speed }, CACHE_TTL.DRIVER_LOCATION);

      const persistKey = cacheKeys("driver_last_persist", user.driverId);
      const lastPersist = cache.get<number>(persistKey);
      if (!lastPersist || (Date.now() - lastPersist) >= 60_000) {
        await db.update(drivers).set({
          lastLat: lat,
          lastLng: lng,
          lastSeenAt: new Date(),
        }).where(eq(drivers.id, user.driverId));
        cache.set(persistKey, Date.now(), 120_000);
      }

      const allTrips = await storage.getActiveTripsForDriver(user.driverId);
      for (const trip of allTrips) {
        const tripLocKey = cacheKeys("trip_driver_last", trip.id);
        cache.set(tripLocKey, { driverId: user.driverId, lat, lng, timestamp: Date.now() }, CACHE_TTL.TRIP_DRIVER_LAST);
        broadcastToTrip(trip.id, { type: "driver_location", data: { driverId: user.driverId, lat, lng, ts: Date.now() } });
      }

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/driver/active-trip", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

      const companyId = getCompanyIdFromAuth(req);
      const TERMINAL = ["COMPLETED", "CANCELLED", "NO_SHOW"];
      const conditions = [
        eq(trips.driverId, user.driverId),
        isNull(trips.deletedAt),
        sql`${trips.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW')`,
      ];
      if (companyId) {
        conditions.push(eq(trips.companyId, companyId));
      }

      const activeTrip = await db.select().from(trips).where(
        and(...conditions)
      ).orderBy(desc(trips.updatedAt)).limit(1);

      if (activeTrip.length === 0) {
        return res.json({ trip: null });
      }

      const trip = activeTrip[0];
      const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;

      res.json({
        trip: {
          id: trip.id,
          publicId: trip.publicId,
          status: trip.status,
          pickupAddress: trip.pickupAddress,
          pickupLat: trip.pickupLat,
          pickupLng: trip.pickupLng,
          dropoffAddress: trip.dropoffAddress,
          dropoffLat: trip.dropoffLat,
          dropoffLng: trip.dropoffLng,
          routePolyline: trip.routePolyline,
          lastEtaMinutes: trip.lastEtaMinutes,
          lastEtaUpdatedAt: trip.lastEtaUpdatedAt,
          distanceMiles: trip.distanceMiles ? Number(trip.distanceMiles) : null,
          scheduledDate: trip.scheduledDate,
          pickupTime: trip.pickupTime,
          patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/driver/presence/heartbeat", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const driver = await storage.getDriver(user.driverId);
      if (!driver || !driver.active || driver.deletedAt) {
        return res.status(403).json({ message: "Driver profile inactive or deleted" });
      }
      const { lat, lng } = req.body;
      const hasGps = typeof lat === "number" && typeof lng === "number";

      const { cache, cacheKeys, CACHE_TTL } = await import("./lib/cache");

      if (hasGps) {
        const locKey = cacheKeys("driver_location", user.driverId);
        cache.set(locKey, { driverId: user.driverId, lat, lng, timestamp: Date.now() }, CACHE_TTL.DRIVER_LOCATION);
      }

      const persistKey = cacheKeys("driver_last_persist", user.driverId);
      const lastPersist = cache.get<number>(persistKey);
      const shouldPersist = !lastPersist || (Date.now() - lastPersist) >= 60_000;

      if (shouldPersist) {
        const updateData: any = { lastSeenAt: new Date() };
        if (hasGps) {
          updateData.lastLat = lat;
          updateData.lastLng = lng;
        }
        await db.update(drivers).set(updateData).where(eq(drivers.id, user.driverId));
        cache.set(persistKey, Date.now(), 120_000);
      }

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Go-Time: upcoming trips approaching pickup time
  app.get("/api/driver/upcoming-go-time", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const driver = await storage.getDriver(user.driverId);
      if (!driver) return res.status(404).json({ message: "Driver not found" });
      if (driver.dispatchStatus === "off") return res.json({ goTimeTrips: [] });

      const city = await storage.getCity(driver.cityId);
      const tz = city?.timezone || "America/New_York";

      const settings = await db.select().from(citySettings).where(eq(citySettings.cityId, driver.cityId)).limit(1);
      const goTimeMinutes = settings[0]?.driverGoTimeMinutes ?? 20;
      const repeatMinutes = settings[0]?.driverGoTimeRepeatMinutes ?? 5;

      const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
      const nowMs = Date.now();

      const upcoming = await db.select().from(trips).where(
        and(
          eq(trips.driverId, user.driverId),
          eq(trips.scheduledDate, today),
          inArray(trips.status, ["SCHEDULED", "ASSIGNED"] as any),
          isNull(trips.deletedAt)
        )
      );

      const goTimeTrips: any[] = [];
      for (const trip of upcoming) {
        const timeStr = trip.pickupTime || trip.scheduledTime || "";
        if (!timeStr) continue;

        const [hh, mm] = timeStr.split(":").map(Number);
        if (isNaN(hh) || isNaN(mm)) continue;

        const pickupDate = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
        pickupDate.setHours(hh, mm, 0, 0);
        const pickupMs = pickupDate.getTime();

        const goTimeMs = pickupMs - goTimeMinutes * 60 * 1000;
        const windowEndMs = pickupMs + 5 * 60 * 1000;

        if (nowMs >= goTimeMs && nowMs <= windowEndMs) {
          const secondsUntilPickup = Math.max(0, Math.floor((pickupMs - nowMs) / 1000));

          const existingAlert = await db.select().from(driverTripAlerts).where(
            and(
              eq(driverTripAlerts.tripId, trip.id),
              eq(driverTripAlerts.driverId, user.driverId),
              eq(driverTripAlerts.kind, "go_time")
            )
          ).limit(1);

          let alertRecord = existingAlert[0] || null;
          let shouldShowAlert = true;

          if (alertRecord) {
            if (alertRecord.acknowledgedAt) {
              shouldShowAlert = false;
            } else {
              const lastShown = alertRecord.lastShownAt.getTime();
              if (nowMs - lastShown < repeatMinutes * 60 * 1000) {
                shouldShowAlert = true;
              }
              await db.update(driverTripAlerts).set({ lastShownAt: new Date() }).where(eq(driverTripAlerts.id, alertRecord.id));
            }
          } else {
            const [newAlert] = await db.insert(driverTripAlerts).values({
              tripId: trip.id,
              driverId: user.driverId,
              kind: "go_time",
              firstShownAt: new Date(),
              lastShownAt: new Date(),
            }).returning();
            alertRecord = newAlert;
          }

          const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;

          goTimeTrips.push({
            tripId: trip.id,
            publicId: trip.publicId,
            pickupTime: timeStr,
            pickupAddress: trip.pickupAddress,
            pickupLat: trip.pickupLat,
            pickupLng: trip.pickupLng,
            dropoffAddress: trip.dropoffAddress,
            dropoffLat: trip.dropoffLat,
            dropoffLng: trip.dropoffLng,
            patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
            status: trip.status,
            secondsUntilPickup,
            goTimeMinutes,
            acknowledged: !!alertRecord?.acknowledgedAt,
            alertId: alertRecord?.id,
          });
        }
      }

      res.json({ goTimeTrips });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Acknowledge go-time alert (driver tapped Start Route)
  app.post("/api/driver/go-time/:alertId/acknowledge", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const alertId = parseInt(req.params.alertId);
      if (isNaN(alertId)) return res.status(400).json({ message: "Invalid alert ID" });

      const [alert] = await db.select().from(driverTripAlerts).where(
        and(
          eq(driverTripAlerts.id, alertId),
          eq(driverTripAlerts.driverId, user.driverId)
        )
      );
      if (!alert) return res.status(404).json({ message: "Alert not found" });

      await db.update(driverTripAlerts).set({ acknowledgedAt: new Date() }).where(eq(driverTripAlerts.id, alertId));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Driver offers: get active pending offers
  app.get("/api/driver/offers/active", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

      const now = new Date();

      await db.update(driverOffers).set({ status: "expired" }).where(
        and(
          eq(driverOffers.driverId, user.driverId),
          eq(driverOffers.status, "pending"),
          sql`${driverOffers.expiresAt} <= ${now}`
        )
      );

      const pendingOffers = await db.select().from(driverOffers).where(
        and(
          eq(driverOffers.driverId, user.driverId),
          eq(driverOffers.status, "pending"),
          sql`${driverOffers.expiresAt} > ${now}`
        )
      ).orderBy(desc(driverOffers.offeredAt));

      const enriched = await Promise.all(pendingOffers.map(async (offer) => {
        const trip = await db.select().from(trips).where(eq(trips.id, offer.tripId)).limit(1);
        const t = trip[0];
        if (!t) return null;
        const patient = t.patientId ? await storage.getPatient(t.patientId) : null;
        const secondsRemaining = Math.max(0, Math.floor((offer.expiresAt.getTime() - now.getTime()) / 1000));
        return {
          offerId: offer.id,
          tripId: t.id,
          publicId: t.publicId,
          pickupAddress: t.pickupAddress,
          pickupLat: t.pickupLat,
          pickupLng: t.pickupLng,
          dropoffAddress: t.dropoffAddress,
          dropoffLat: t.dropoffLat,
          dropoffLng: t.dropoffLng,
          pickupTime: t.pickupTime,
          scheduledDate: t.scheduledDate,
          patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
          status: t.status,
          secondsRemaining,
          expiresAt: offer.expiresAt.toISOString(),
        };
      }));

      res.json({ offers: enriched.filter(Boolean) });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Accept a driver offer
  app.post("/api/driver/offers/:offerId/accept", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const offerId = parseInt(req.params.offerId);
      if (isNaN(offerId)) return res.status(400).json({ message: "Invalid offer ID" });

      const [offer] = await db.select().from(driverOffers).where(
        and(
          eq(driverOffers.id, offerId),
          eq(driverOffers.driverId, user.driverId)
        )
      );
      if (!offer) return res.status(404).json({ message: "Offer not found" });

      const now = new Date();

      if (offer.status !== "pending") return res.status(409).json({ message: `Offer already ${offer.status}` });
      if (now > offer.expiresAt) {
        await db.update(driverOffers).set({ status: "expired" }).where(eq(driverOffers.id, offerId));
        return res.status(409).json({ message: "Offer has expired" });
      }

      const [accepted] = await db.update(driverOffers)
        .set({ status: "accepted", acceptedAt: now })
        .where(
          and(
            eq(driverOffers.id, offerId),
            eq(driverOffers.status, "pending"),
            sql`${driverOffers.expiresAt} > ${now}`
          )
        )
        .returning();

      if (!accepted) {
        return res.status(409).json({ message: "Offer is no longer available" });
      }

      const [trip] = await db.select().from(trips).where(eq(trips.id, offer.tripId));
      const driver = await storage.getDriver(user.driverId);
      if (trip && (trip.status === "SCHEDULED" || !trip.driverId)) {
        const updateData: any = {
          driverId: user.driverId,
          status: "ASSIGNED",
          assignedAt: now,
          assignedBy: offer.createdBy,
          assignmentSource: "driver_accept",
        };
        if (driver?.vehicleId) updateData.vehicleId = driver.vehicleId;
        await db.update(trips).set(updateData).where(eq(trips.id, offer.tripId));
      }

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "OFFER_ACCEPTED",
        entity: "trip",
        entityId: offer.tripId,
        details: `Driver ${driver?.firstName} ${driver?.lastName} accepted assignment offer for trip ${trip?.publicId}`,
        cityId: trip?.cityId || 0,
      });

      res.json({ ok: true, tripId: offer.tripId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Decline a driver offer
  app.post("/api/driver/offers/:offerId/decline", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const offerId = parseInt(req.params.offerId);
      if (isNaN(offerId)) return res.status(400).json({ message: "Invalid offer ID" });

      const [offer] = await db.select().from(driverOffers).where(
        and(
          eq(driverOffers.id, offerId),
          eq(driverOffers.driverId, user.driverId)
        )
      );
      if (!offer) return res.status(404).json({ message: "Offer not found" });
      if (offer.status !== "pending") return res.status(400).json({ message: `Offer already ${offer.status}` });

      await db.update(driverOffers).set({ status: "cancelled" }).where(eq(driverOffers.id, offerId));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/driver/schedule-change-requests", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const schema = z.object({
        requestedDate: z.string().min(1),
        requestType: z.enum(["swap", "cover", "unavailable", "other"]),
        notes: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const [request] = await db.insert(scheduleChangeRequests).values({
        driverId: user.driverId,
        requestedDate: data.requestedDate,
        requestType: data.requestType,
        notes: data.notes || null,
      }).returning();

      const driver = await db.select().from(drivers).where(eq(drivers.id, user.driverId)).then(r => r[0]);
      const dispatchUsers = await db.select().from(users).where(
        and(inArray(users.role, ["ADMIN", "DISPATCH", "SUPER_ADMIN"]), eq(users.active, true), isNull(users.deletedAt))
      );
      for (const du of dispatchUsers) {
        if (du.email) {
          await sendEmail({
            to: du.email,
            subject: `Schedule Change Request - ${driver?.firstName} ${driver?.lastName}`,
            html: `<p>Driver <strong>${driver?.firstName} ${driver?.lastName}</strong> has submitted a schedule change request:</p>
<ul><li><strong>Date:</strong> ${data.requestedDate}</li><li><strong>Type:</strong> ${data.requestType}</li><li><strong>Notes:</strong> ${data.notes || "None"}</li></ul>
<p>Please review in the dispatch dashboard.</p>`,
          });
        }
      }
      res.json(request);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/driver/schedule-change-requests", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const requests = await db.select().from(scheduleChangeRequests)
        .where(eq(scheduleChangeRequests.driverId, user.driverId))
        .orderBy(desc(scheduleChangeRequests.createdAt));
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/schedule-change-requests", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const statusFilter = req.query.status as string | undefined;
      const conditions: any[] = [];
      if (statusFilter) conditions.push(eq(scheduleChangeRequests.status, statusFilter));
      const requests = await db.select({
        request: scheduleChangeRequests,
        driver: { firstName: drivers.firstName, lastName: drivers.lastName, publicId: drivers.publicId },
      }).from(scheduleChangeRequests)
        .innerJoin(drivers, eq(scheduleChangeRequests.driverId, drivers.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(scheduleChangeRequests.createdAt));
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/schedule-change-requests/:id", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const schema = z.object({
        status: z.enum(["approved", "denied"]),
        decisionNotes: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const [existing] = await db.select().from(scheduleChangeRequests).where(eq(scheduleChangeRequests.id, id));
      if (!existing) return res.status(404).json({ message: "Request not found" });
      if (existing.status !== "pending") return res.status(400).json({ message: `Request already ${existing.status}` });

      const [updated] = await db.update(scheduleChangeRequests).set({
        status: data.status,
        decisionNotes: data.decisionNotes || null,
        decidedBy: req.user!.userId,
        decidedAt: new Date(),
      }).where(eq(scheduleChangeRequests.id, id)).returning();

      const driver = await db.select().from(drivers).where(eq(drivers.id, existing.driverId)).then(r => r[0]);
      if (driver?.email) {
        await sendEmail({
          to: driver.email,
          subject: `Schedule Change Request ${data.status === "approved" ? "Approved" : "Denied"}`,
          html: `<p>Your schedule change request for <strong>${existing.requestedDate}</strong> (${existing.requestType}) has been <strong>${data.status}</strong>.</p>
${data.decisionNotes ? `<p><strong>Notes:</strong> ${data.decisionNotes}</p>` : ""}`,
        });
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/driver/metrics", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const driver = await db.select().from(drivers).where(eq(drivers.id, user.driverId)).then(r => r[0]);
      if (!driver) return res.status(404).json({ message: "Driver not found" });

      const now = new Date();
      const weekDay = now.getDay();
      const weekStartDate = new Date(now);
      weekStartDate.setDate(now.getDate() - weekDay);
      const weekStart = weekStartDate.toISOString().split("T")[0];
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekStartDate.getDate() + 6);
      const weekEnd = weekEndDate.toISOString().split("T")[0];

      const [currentScore] = await db.select().from(driverScores)
        .where(and(eq(driverScores.driverId, user.driverId), eq(driverScores.weekStart, weekStart)));

      const weekTrips = await db.select().from(trips)
        .where(and(
          eq(trips.driverId, user.driverId),
          sql`${trips.scheduledDate} >= ${weekStart}`,
          sql`${trips.scheduledDate} <= ${weekEnd}`,
          isNull(trips.deletedAt),
        ));

      const totalTrips = weekTrips.length;
      const completedTrips = weekTrips.filter(t => t.status === "COMPLETED").length;
      const cancelledTrips = weekTrips.filter(t => t.status === "CANCELLED").length;
      const noShowTrips = weekTrips.filter(t => t.status === "NO_SHOW").length;
      const completionRate = totalTrips > 0 ? Math.round((completedTrips / totalTrips) * 100) : 0;

      const scoreHistory = await db.select().from(driverScores)
        .where(eq(driverScores.driverId, user.driverId))
        .orderBy(desc(driverScores.weekStart))
        .limit(4);

      res.json({
        weekStart,
        weekEnd,
        totalTrips,
        completedTrips,
        cancelledTrips,
        noShowTrips,
        completionRate,
        onTimeRate: currentScore?.onTimeRate != null ? Math.round(currentScore.onTimeRate * 100) : null,
        score: currentScore?.score ?? null,
        history: scoreHistory,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/driver/bonus-progress", authMiddleware, requireRole("DRIVER"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });
      const driver = await db.select().from(drivers).where(eq(drivers.id, user.driverId)).then(r => r[0]);
      if (!driver) return res.status(404).json({ message: "Driver not found" });

      const [rule] = await db.select().from(driverBonusRules).where(eq(driverBonusRules.cityId, driver.cityId));
      if (!rule || !rule.isEnabled) {
        return res.json({ active: false });
      }

      const criteria = (rule.criteriaJson as any) || {};
      const minTrips = criteria.minTrips ?? 20;
      const minOnTimeRate = criteria.minOnTimeRate ?? 90;
      const minCompletionRate = criteria.minCompletionRate ?? 85;

      const now = new Date();
      const weekDay = now.getDay();
      const weekStartDate = new Date(now);
      weekStartDate.setDate(now.getDate() - weekDay);
      const weekStart = weekStartDate.toISOString().split("T")[0];
      const weekEnd = new Date(weekStartDate);
      weekEnd.setDate(weekStartDate.getDate() + 6);
      const weekEndStr = weekEnd.toISOString().split("T")[0];

      const weekTrips = await db.select().from(trips)
        .where(and(
          eq(trips.driverId, user.driverId),
          sql`${trips.scheduledDate} >= ${weekStart}`,
          sql`${trips.scheduledDate} <= ${weekEndStr}`,
          isNull(trips.deletedAt),
        ));

      const totalTrips = weekTrips.length;
      const completedTrips = weekTrips.filter(t => t.status === "COMPLETED").length;
      const completionRate = totalTrips > 0 ? Math.round((completedTrips / totalTrips) * 100) : 0;

      const [scoreRow] = await db.select().from(driverScores)
        .where(and(eq(driverScores.driverId, user.driverId), eq(driverScores.weekStart, weekStart)));
      const onTimeRate = scoreRow?.onTimeRate != null ? Math.round(scoreRow.onTimeRate * 100) : 100;

      const tripsProgress = Math.min(100, Math.round((totalTrips / minTrips) * 100));
      const onTimeProgress = Math.min(100, Math.round((onTimeRate / minOnTimeRate) * 100));
      const completionProgress = Math.min(100, Math.round((completionRate / minCompletionRate) * 100));
      const overallProgress = Math.round((tripsProgress + onTimeProgress + completionProgress) / 3);

      let progressColor: "red" | "yellow" | "green" = "red";
      if (overallProgress >= 100) progressColor = "green";
      else if (overallProgress >= 70) progressColor = "yellow";

      const qualifies = totalTrips >= minTrips && onTimeRate >= minOnTimeRate && completionRate >= minCompletionRate;

      res.json({
        active: true,
        weeklyAmountCents: rule.weeklyAmountCents,
        qualifies,
        overallProgress,
        progressColor,
        requirements: {
          minTrips, currentTrips: totalTrips,
          minOnTimeRate, currentOnTimeRate: onTimeRate,
          minCompletionRate, currentCompletionRate: completionRate,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const HEARTBEAT_STALE_SEC = 90;
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - HEARTBEAT_STALE_SEC * 1000);
      const staleDrivers = await db.select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName, dispatchStatus: drivers.dispatchStatus })
        .from(drivers)
        .where(
          and(
            inArray(drivers.dispatchStatus, ["available", "enroute", "hold"] as any),
            eq(drivers.active, true),
            isNull(drivers.deletedAt),
            sql`${drivers.lastSeenAt} < ${cutoff}`
          )
        );
      if (staleDrivers.length > 0) {
        console.log(`[HEARTBEAT] ${staleDrivers.length} driver(s) PAUSED (GPS stale >90s): ${staleDrivers.map(d => `${d.firstName} ${d.lastName} (${d.dispatchStatus})`).join(", ")}`);
      }
    } catch (err: any) {
      console.error("[HEARTBEAT] Error in stale driver check:", err.message);
    }
  }, 30000);
  console.log("[HEARTBEAT] Stale driver monitor started (checks every 30s, threshold: 90s, mode: PAUSED)");

  // Dashboard driver stats with presence buckets
  const PRESENCE_TIMEOUT_SEC = 90;
  const ON_TRIP_STATUSES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];

  app.get("/api/dashboard/driver-stats", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const enforced = enforceCityContext(req, res);
      if (enforced === false) return;
      const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });

      const allDrivers = await db.select().from(drivers).where(
        and(
          eq(drivers.active, true),
          isNull(drivers.deletedAt),
          ...(cityId && cityId > 0 ? [eq(drivers.cityId, cityId)] : [])
        )
      );

      const driverIds = allDrivers.map(d => d.id);
      const activeTripRows = driverIds.length > 0 ? await db.select({
        driverId: trips.driverId,
        tripId: trips.id,
        tripPublicId: trips.publicId,
        tripStatus: trips.status,
      }).from(trips).where(
        and(
          inArray(trips.status, ON_TRIP_STATUSES as any),
          isNull(trips.cancelledBy),
          sql`${trips.driverId} IS NOT NULL`,
          inArray(trips.driverId, driverIds)
        )
      ) : [];
      const driverTripMap = new Map<number, { tripId: number; tripPublicId: string; tripStatus: string }>();
      for (const row of activeTripRows) {
        if (row.driverId) driverTripMap.set(row.driverId, { tripId: row.tripId, tripPublicId: row.tripPublicId, tripStatus: row.tripStatus });
      }

      const now = Date.now();
      const cutoff = now - PRESENCE_TIMEOUT_SEC * 1000;

      const activeDrivers: any[] = [];
      const inRouteDrivers: any[] = [];
      const offlineOrPausedDrivers: any[] = [];

      for (const d of allDrivers) {
        const connected = d.lastSeenAt ? new Date(d.lastSeenAt).getTime() > cutoff : false;
        const isOffOrHold = d.dispatchStatus === "off" || d.dispatchStatus === "hold";
        const onTrip = driverTripMap.has(d.id);
        const tripInfo = driverTripMap.get(d.id);

        if (!connected || isOffOrHold) {
          let reason = "offline";
          if (d.dispatchStatus === "hold") reason = "hold";
          else if (d.dispatchStatus === "off") reason = "off";
          else if (!connected) reason = "disconnected";
          offlineOrPausedDrivers.push({
            id: d.id,
            publicId: d.publicId,
            name: `${d.firstName} ${d.lastName}`,
            isOnline: connected,
            onHold: d.dispatchStatus === "hold",
            lastSeenAt: d.lastSeenAt,
            dispatchStatus: d.dispatchStatus,
            reason,
          });
        } else if (connected && onTrip && tripInfo) {
          inRouteDrivers.push({
            id: d.id,
            publicId: d.publicId,
            name: `${d.firstName} ${d.lastName}`,
            tripId: tripInfo.tripId,
            tripPublicId: tripInfo.tripPublicId,
            tripStatus: tripInfo.tripStatus,
            lastSeenAt: d.lastSeenAt,
            dispatchStatus: d.dispatchStatus,
          });
        } else {
          activeDrivers.push({
            id: d.id,
            publicId: d.publicId,
            name: `${d.firstName} ${d.lastName}`,
            lastSeenAt: d.lastSeenAt,
            dispatchStatus: d.dispatchStatus,
          });
        }
      }

      res.json({
        activeCount: activeDrivers.length,
        inRouteCount: inRouteDrivers.length,
        offlineHoldCount: offlineOrPausedDrivers.length,
        offlineOrPausedCount: offlineOrPausedDrivers.length,
        activeDrivers,
        inRouteDrivers,
        offlineHoldDrivers: offlineOrPausedDrivers,
        offlineOrPausedDrivers,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  async function enrichTripsWithRelations(tripList: any[]) {
    const allCities = await storage.getCities();
    const cityMap = new Map(allCities.map(c => [c.id, c]));

    const tripIds = tripList.map(t => t.id).filter(Boolean);
    const acceptedOffers = tripIds.length > 0
      ? await db.select({ tripId: driverOffers.tripId, acceptedAt: driverOffers.acceptedAt })
          .from(driverOffers)
          .where(and(inArray(driverOffers.tripId, tripIds), eq(driverOffers.status, "accepted")))
      : [];
    const acceptedMap = new Map(acceptedOffers.filter(o => o.acceptedAt).map(o => [o.tripId, o.acceptedAt]));

    return Promise.all(tripList.map(async (t) => {
      const patient = t.patientId ? await storage.getPatient(t.patientId) : null;
      const clinic = t.clinicId ? await storage.getClinic(t.clinicId) : null;
      const driver = t.driverId ? await storage.getDriver(t.driverId) : null;
      const vehicle = driver?.vehicleId ? await storage.getVehicle(driver.vehicleId) : (t.vehicleId ? await storage.getVehicle(t.vehicleId) : null);
      const city = cityMap.get(t.cityId);
      const offerAcceptedAt = acceptedMap.get(t.id);
      return {
        ...t,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : null,
        clinicName: clinic?.name || null,
        driverName: driver ? `${driver.firstName} ${driver.lastName}` : null,
        driverPhone: driver?.phone || null,
        driverLastLat: driver?.lastLat || null,
        driverLastLng: driver?.lastLng || null,
        driverLastSeenAt: driver?.lastSeenAt || null,
        vehicleLabel: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
        vehicleType: vehicle?.type || null,
        vehicleColor: vehicle?.color || null,
        vehicleMake: vehicle?.make || null,
        vehicleModel: vehicle?.model || null,
        cityName: city?.name || null,
        acceptedAt: offerAcceptedAt ? new Date(offerAcceptedAt).toISOString() : null,
      };
    }));
  }

  app.get("/api/dispatch/trips/:tab", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const enforced = enforceCityContext(req, res);
      if (enforced === false) return;
      const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });

      const tab = req.params.tab;
      const search = (req.query.search as string || "").toLowerCase().trim();
      const origin = (req.query.origin as string || "").toLowerCase().trim();
      const conditions: any[] = [isNull(trips.deletedAt)];
      if (cityId && cityId > 0) conditions.push(eq(trips.cityId, cityId));

      if (tab === "unassigned") {
        conditions.push(isNull(trips.driverId));
        conditions.push(
          inArray(trips.approvalStatus, ["approved"]),
        );
        conditions.push(
          inArray(trips.status, ["SCHEDULED", "ASSIGNED"]),
        );
      } else if (tab === "scheduled") {
        conditions.push(sql`${trips.driverId} IS NOT NULL`);
        conditions.push(inArray(trips.status, ["SCHEDULED", "ASSIGNED"]));
      } else if (tab === "active") {
        conditions.push(inArray(trips.status, ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"]));
      } else if (tab === "completed") {
        conditions.push(inArray(trips.status, ["COMPLETED", "CANCELLED", "NO_SHOW"]));
      } else {
        return res.status(400).json({ message: "Invalid tab. Use: unassigned, scheduled, active, completed" });
      }

      if (origin === "clinic") {
        conditions.push(sql`${trips.clinicId} IS NOT NULL`);
      } else if (origin === "private") {
        conditions.push(sql`${trips.clinicId} IS NULL`);
        conditions.push(sql`(${trips.tripType} != 'recurring' OR ${trips.tripType} IS NULL)`);
      } else if (origin === "dialysis_recurring") {
        conditions.push(eq(trips.tripType, "recurring"));
      }

      const result = await db.select().from(trips).where(and(...conditions)).orderBy(desc(trips.createdAt));
      const enriched = await enrichTripsWithRelations(result);

      let finalResult = enriched;
      if (search) {
        finalResult = enriched.filter((t: any) =>
          (t.patientName && t.patientName.toLowerCase().includes(search)) ||
          (t.clinicName && t.clinicName.toLowerCase().includes(search)) ||
          (t.driverName && t.driverName.toLowerCase().includes(search)) ||
          (t.publicId && t.publicId.toLowerCase().includes(search)) ||
          (t.pickupAddress && t.pickupAddress.toLowerCase().includes(search)) ||
          (t.dropoffAddress && t.dropoffAddress.toLowerCase().includes(search))
        );
      }

      if (origin === "clinic") {
        const grouped: Record<string, { clinicId: number; clinicName: string; trips: any[] }> = {};
        for (const t of finalResult) {
          const key = String(t.clinicId);
          if (!grouped[key]) {
            grouped[key] = { clinicId: t.clinicId, clinicName: t.clinicName || "Unknown Clinic", trips: [] };
          }
          grouped[key].trips.push(t);
        }
        return res.json({ grouped: Object.values(grouped), total: finalResult.length });
      }

      res.json(finalResult);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Phase 2: Assign driver to trip — creates a 30s offer for driver to accept
  app.patch("/api/trips/:id/assign", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      if (tripLockedGuard(trip, req, res)) return;
      const otherTerminal = ["CANCELLED", "NO_SHOW"];
      if (otherTerminal.includes(trip.status)) {
        return res.status(400).json({ message: `Cannot assign driver to a ${trip.status.toLowerCase()} trip` });
      }
      const { driverId, vehicleId } = req.body;
      if (!driverId) return res.status(400).json({ message: "driverId is required" });
      const driver = await storage.getDriver(driverId);
      if (!driver) return res.status(404).json({ message: "Driver not found" });
      if (driver.cityId !== trip.cityId) {
        return res.status(400).json({ message: "Driver must be in the same city as the trip" });
      }
      const { isDriverAssignable } = await import("./lib/driverClassification");
      const assignCheck = isDriverAssignable(driver);
      if (!assignCheck.ok) {
        return res.status(400).json({ message: assignCheck.reason });
      }
      const forceAssign = req.body.force === true;
      if (assignCheck.warning && !forceAssign) {
        return res.status(409).json({ message: assignCheck.warning, requiresConfirmation: true });
      }

      await db.update(driverOffers).set({ status: "cancelled" }).where(
        and(
          eq(driverOffers.tripId, id),
          eq(driverOffers.status, "pending")
        )
      );

      const OFFER_TTL_SECONDS = 30;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + OFFER_TTL_SECONDS * 1000);

      const [offer] = await db.insert(driverOffers).values({
        tripId: id,
        driverId,
        offeredAt: now,
        expiresAt,
        status: "pending",
        createdBy: req.user!.userId,
      }).returning();

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "OFFER_SENT",
        entity: "trip",
        entityId: id,
        details: `Sent assignment offer to driver ${driver.firstName} ${driver.lastName} (${driver.publicId}) for trip ${trip.publicId}. Expires in ${OFFER_TTL_SECONDS}s.`,
        cityId: trip.cityId,
      });

      res.json({
        offerId: offer.id,
        tripId: id,
        driverId,
        driverName: `${driver.firstName} ${driver.lastName}`,
        status: "pending",
        expiresAt: expiresAt.toISOString(),
        secondsRemaining: OFFER_TTL_SECONDS,
        offerSent: true,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dispatch/offers/:offerId/status", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const offerId = parseInt(req.params.offerId);
      if (isNaN(offerId)) return res.status(400).json({ message: "Invalid offer ID" });

      const [offer] = await db.select().from(driverOffers).where(eq(driverOffers.id, offerId));
      if (!offer) return res.status(404).json({ message: "Offer not found" });

      const now = new Date();
      if (offer.status === "pending" && now > offer.expiresAt) {
        await db.update(driverOffers).set({ status: "expired" }).where(eq(driverOffers.id, offerId));
        offer.status = "expired";
      }

      const driver = await storage.getDriver(offer.driverId);
      const trip = await storage.getTrip(offer.tripId);
      const secondsRemaining = offer.status === "pending"
        ? Math.max(0, Math.floor((offer.expiresAt.getTime() - now.getTime()) / 1000))
        : 0;

      res.json({
        offerId: offer.id,
        tripId: offer.tripId,
        tripPublicId: trip?.publicId || null,
        driverId: offer.driverId,
        driverName: driver ? `${driver.firstName} ${driver.lastName}` : null,
        status: offer.status,
        expiresAt: offer.expiresAt.toISOString(),
        secondsRemaining,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Phase 6: Trip messages
  app.get("/api/trips/:id/messages", authMiddleware, requireRole("ADMIN", "DISPATCH", "DRIVER", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const tripId = parseInt(req.params.id);
      if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(tripId);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      if (req.user!.role === "DRIVER") {
        const user = await storage.getUser(req.user!.userId);
        if (!user?.driverId || trip.driverId !== user.driverId) {
          return res.status(403).json({ message: "You can only view messages for your assigned trips" });
        }
      } else {
        const hasAccess = await checkCityAccess(req, trip.cityId);
        if (!hasAccess) return res.status(403).json({ message: "Access denied" });
      }
      const messages = await db.select().from(tripMessages)
        .where(eq(tripMessages.tripId, tripId))
        .orderBy(tripMessages.createdAt);
      res.json(messages);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/trips/:id/messages", authMiddleware, requireRole("ADMIN", "DISPATCH", "DRIVER", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const tripId = parseInt(req.params.id);
      if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(tripId);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      if (tripLockedGuard(trip, req, res)) return;
      const otherTerminalMsg = ["CANCELLED", "NO_SHOW"];
      if (otherTerminalMsg.includes(trip.status)) {
        return res.status(400).json({ message: `Cannot send messages on a ${trip.status.toLowerCase()} trip` });
      }
      if (req.user!.role === "DRIVER") {
        const user = await storage.getUser(req.user!.userId);
        if (!user?.driverId || trip.driverId !== user.driverId) {
          return res.status(403).json({ message: "You can only message on your assigned trips" });
        }
      } else {
        const hasAccess = await checkCityAccess(req, trip.cityId);
        if (!hasAccess) return res.status(403).json({ message: "Access denied" });
      }
      const { message } = req.body;
      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ message: "Message text is required" });
      }
      const [newMsg] = await db.insert(tripMessages).values({
        tripId,
        senderId: req.user!.userId,
        senderRole: req.user!.role,
        message: message.trim(),
      }).returning();
      res.json(newMsg);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/trips", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "SUPER_ADMIN", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if ((user?.role === "VIEWER" || user?.role === "CLINIC_USER") && user.clinicId) {
        const clinic = await storage.getClinic(user.clinicId);
        if (clinic) {
          const tripsResult = await storage.getTrips(clinic.cityId);
          return res.json(tripsResult);
        }
        return res.status(403).json({ message: "No clinic linked" });
      }
      const enforced = enforceCityContext(req, res);
      if (enforced === false) return;
      const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });

      const tab = (req.query.tab as string) || "all";
      const limitParam = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const companyId = getCompanyIdFromAuth(req);
      const source = req.query.source as string | undefined;

      const conditions: any[] = [isNull(trips.deletedAt)];
      if (cityId && cityId > 0) conditions.push(eq(trips.cityId, cityId));
      if (companyId) conditions.push(eq(trips.companyId, companyId));

      if (source === "clinic") {
        conditions.push(eq(trips.requestSource, "clinic"));
        const clinicIdFilter = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
        if (clinicIdFilter) conditions.push(eq(trips.clinicId, clinicIdFilter));
      } else if (source === "internal") {
        conditions.push(eq(trips.requestSource, "internal"));
      } else if (source === "private") {
        conditions.push(eq(trips.requestSource, "private"));
      }

      if (tab === "unassigned") {
        conditions.push(isNull(trips.driverId));
        conditions.push(inArray(trips.status, ["SCHEDULED", "ASSIGNED"]));
        conditions.push(eq(trips.approvalStatus, "approved"));
      } else if (tab === "scheduled") {
        conditions.push(inArray(trips.status, ["SCHEDULED", "ASSIGNED"]));
      } else if (tab === "active") {
        conditions.push(inArray(trips.status, ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"]));
      } else if (tab === "completed") {
        conditions.push(inArray(trips.status, ["COMPLETED", "CANCELLED", "NO_SHOW"]));
      }

      let query = db.select().from(trips).where(and(...conditions)).orderBy(desc(trips.createdAt));
      if (limitParam) query = query.limit(limitParam) as any;
      const result = await query;
      res.json(result);
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

  app.post("/api/trips", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER"), async (req: AuthRequest, res) => {
    try {
      const parsed = createTripSchema.safeParse(req.body);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        return res.status(400).json({ message: firstIssue?.message || "Invalid trip data" });
      }
      if (parsed.data.pickupAddress && !parsed.data.pickupZip) {
        return res.status(400).json({ message: "Pickup ZIP code is required" });
      }
      if (parsed.data.pickupLat == null || parsed.data.pickupLng == null) {
        if (parsed.data.pickupAddress) {
          try {
            const { geocodeAddress } = await import("./lib/googleMaps");
            const geo = await geocodeAddress(parsed.data.pickupAddress);
            (parsed.data as any).pickupLat = geo.lat;
            (parsed.data as any).pickupLng = geo.lng;
          } catch (geoErr: any) {
            return res.status(400).json({ message: `Could not geocode pickup address: ${geoErr.message}` });
          }
        } else {
          return res.status(400).json({ message: "Pickup address must be selected from autocomplete (lat/lng required)" });
        }
      }
      if (parsed.data.dropoffAddress && !parsed.data.dropoffZip) {
        return res.status(400).json({ message: "Dropoff ZIP code is required" });
      }
      if (parsed.data.dropoffLat == null || parsed.data.dropoffLng == null) {
        if (parsed.data.dropoffAddress) {
          try {
            const { geocodeAddress } = await import("./lib/googleMaps");
            const geo = await geocodeAddress(parsed.data.dropoffAddress);
            (parsed.data as any).dropoffLat = geo.lat;
            (parsed.data as any).dropoffLng = geo.lng;
          } catch (geoErr: any) {
            return res.status(400).json({ message: `Could not geocode dropoff address: ${geoErr.message}` });
          }
        } else {
          return res.status(400).json({ message: "Dropoff address must be selected from autocomplete (lat/lng required)" });
        }
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
      const user = await storage.getUser(req.user!.userId);
      const isClinic = (user?.role === "VIEWER" || user?.role === "CLINIC_USER") && user.clinicId != null;

      if (isClinic && parsed.data.patientId) {
        const patient = await storage.getPatient(parsed.data.patientId);
        if (!patient || patient.clinicId !== user!.clinicId) {
          return res.status(403).json({ message: "You can only create trips for your clinic's patients" });
        }
      }

      const approvalFields: Record<string, any> = {};
      if (isClinic) {
        approvalFields.approvalStatus = "pending";
        if (!parsed.data.clinicId) {
          (parsed.data as any).clinicId = user!.clinicId;
        }
      } else {
        approvalFields.approvalStatus = "approved";
        approvalFields.approvedAt = new Date();
        approvalFields.approvedBy = req.user!.userId;
      }
      const callerCompanyId = getCompanyIdFromAuth(req);
      const autoRequestSource = isClinic ? "clinic" : "internal";

      const isPrivatePay = !parsed.data.clinicId;
      if (isPrivatePay) {
        const { getDefaultPrivateClinicId } = await import("./lib/defaultClinic");
        (parsed.data as any).clinicId = await getDefaultPrivateClinicId(parsed.data.cityId);
        if (!(parsed.data as any).requestSource) {
          (parsed.data as any).requestSource = "phone";
        }
      }

      let pricingFields: Record<string, any> = {};
      if (isPrivatePay && parsed.data.pickupAddress && parsed.data.dropoffAddress && parsed.data.scheduledTime) {
        try {
          const { calculatePrivateQuote } = await import("./lib/privatePricing");
          const city = await storage.getCity(parsed.data.cityId);
          const quote = await calculatePrivateQuote({
            pickupAddress: parsed.data.pickupAddress,
            dropoffAddress: parsed.data.dropoffAddress,
            scheduledDate: parsed.data.scheduledDate || new Date().toISOString().slice(0, 10),
            scheduledTime: parsed.data.scheduledTime,
            isWheelchair: parsed.data.serviceType === "wheelchair",
            roundTrip: parsed.data.roundTrip === true,
            cityName: city?.name || "ALL",
          });
          pricingFields.priceTotalCents = quote.totalCents;
          pricingFields.pricingSnapshot = {
            computedAt: new Date().toISOString(),
            baseMiles: quote.baseMiles,
            baseMinutes: quote.baseMinutes,
            totalCents: quote.totalCents,
            breakdown: quote.breakdown,
            ratesUsed: quote.ratesUsed,
            profileName: quote.profileName,
            profileSource: quote.profileSource,
          };
        } catch (err: any) {
          console.warn(`[Pricing] Failed to compute quote for new trip, continuing without:`, err.message);
        }
      }

      const trip = await storage.createTrip({ ...parsed.data, publicId, ...approvalFields, ...pricingFields, companyId: callerCompanyId, requestSource: (parsed.data as any).requestSource || autoRequestSource } as any);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "CREATE",
        entity: "trip",
        entityId: trip.id,
        details: `Created trip ${publicId}${isClinic ? " (pending approval)" : ""}`,
        cityId: trip.cityId,
      });

      import("./lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
        autoNotifyPatient(trip.id, "scheduled");
      }).catch((err) => {
        console.error(`[SMS-AUTO] Failed to send scheduled SMS for trip ${trip.id}:`, err.message);
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
    pickupPlaceId: z.string().nullable().optional(),
    pickupLat: z.number().optional(),
    pickupLng: z.number().optional(),
    dropoffAddress: z.string().optional(),
    dropoffStreet: z.string().optional(),
    dropoffCity: z.string().optional(),
    dropoffState: z.string().optional(),
    dropoffZip: z.string().optional(),
    dropoffPlaceId: z.string().nullable().optional(),
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

      if (tripLockedGuard(existing, req, res)) return;
      const otherTerminalEdit = ["CANCELLED", "NO_SHOW"];
      if (otherTerminalEdit.includes(existing.status)) {
        return res.status(400).json({ message: `Trip is ${existing.status.toLowerCase()} and locked. No changes allowed.` });
      }

      if (!(await checkCityAccess(req, existing.cityId))) {
        return res.status(403).json({ message: "No access to this city" });
      }

      const editUser = await storage.getUser(req.user!.userId);
      const isClinicEditor = editUser?.role === "VIEWER" && editUser.clinicId != null;
      if (isClinicEditor) {
        if (existing.clinicId !== editUser.clinicId) {
          return res.status(403).json({ message: "You can only edit your own clinic's trips" });
        }
        const coreFields = ["pickupAddress", "pickupStreet", "pickupCity", "pickupState", "pickupZip", "pickupPlaceId", "pickupLat", "pickupLng",
          "dropoffAddress", "dropoffStreet", "dropoffCity", "dropoffState", "dropoffZip", "dropoffPlaceId", "dropoffLat", "dropoffLng",
          "scheduledDate", "scheduledTime", "pickupTime", "estimatedArrivalTime", "driverId", "vehicleId", "clinicId", "tripType", "recurringDays"];
        if (existing.approvalStatus !== "pending") {
          const hasCoreChange = Object.keys(req.body).some(k => coreFields.includes(k));
          if (hasCoreChange) {
            return res.status(403).json({ message: "Cannot edit core trip fields after approval. Contact dispatch for changes." });
          }
        }
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
        let effectiveLat = updateData.pickupLat ?? existing.pickupLat;
        let effectiveLng = updateData.pickupLng ?? existing.pickupLng;
        if (effectiveLat == null || effectiveLng == null) {
          try {
            const { geocodeAddress } = await import("./lib/googleMaps");
            const geo = await geocodeAddress(updateData.pickupAddress);
            updateData.pickupLat = geo.lat;
            updateData.pickupLng = geo.lng;
          } catch (geoErr: any) {
            return res.status(400).json({ message: `Could not geocode pickup address: ${geoErr.message}` });
          }
        }
      }
      if (updateData.dropoffAddress) {
        const effectiveZip = updateData.dropoffZip ?? existing.dropoffZip;
        if (!effectiveZip) {
          return res.status(400).json({ message: "Dropoff ZIP code is required" });
        }
        let effectiveLat = updateData.dropoffLat ?? existing.dropoffLat;
        let effectiveLng = updateData.dropoffLng ?? existing.dropoffLng;
        if (effectiveLat == null || effectiveLng == null) {
          try {
            const { geocodeAddress } = await import("./lib/googleMaps");
            const geo = await geocodeAddress(updateData.dropoffAddress);
            updateData.dropoffLat = geo.lat;
            updateData.dropoffLng = geo.lng;
          } catch (geoErr: any) {
            return res.status(400).json({ message: `Could not geocode dropoff address: ${geoErr.message}` });
          }
        }
      }

      const effectivePickup = updateData.pickupTime ?? existing.pickupTime;
      const effectiveArrival = updateData.estimatedArrivalTime ?? existing.estimatedArrivalTime;
      if (effectivePickup && effectiveArrival && effectivePickup >= effectiveArrival) {
        return res.status(400).json({ message: "Pickup time must be before estimated arrival time" });
      }

      const addressChanged = updateData.pickupAddress || updateData.dropoffAddress
        || updateData.pickupLat != null || updateData.pickupLng != null
        || updateData.dropoffLat != null || updateData.dropoffLng != null
        || updateData.pickupPlaceId !== undefined || updateData.dropoffPlaceId !== undefined;
      if (addressChanged) {
        updateData.staticMapThumbUrl = null;
        updateData.staticMapFullUrl = null;
        updateData.staticMapGeneratedAt = null;
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
    status: z.enum(["SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]),
  });

  const VALID_TRANSITIONS: Record<string, string[]> = {
    SCHEDULED: ["ASSIGNED", "CANCELLED"],
    ASSIGNED: ["EN_ROUTE_TO_PICKUP", "CANCELLED"],
    EN_ROUTE_TO_PICKUP: ["ARRIVED_PICKUP", "CANCELLED"],
    ARRIVED_PICKUP: ["PICKED_UP", "NO_SHOW", "CANCELLED"],
    PICKED_UP: ["EN_ROUTE_TO_DROPOFF", "IN_PROGRESS", "CANCELLED"],
    EN_ROUTE_TO_DROPOFF: ["ARRIVED_DROPOFF", "CANCELLED"],
    ARRIVED_DROPOFF: ["COMPLETED", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
  };

  const STATUS_TIMESTAMP_MAP: Record<string, string> = {
    EN_ROUTE_TO_PICKUP: "startedAt",
    ARRIVED_PICKUP: "arrivedPickupAt",
    PICKED_UP: "pickedUpAt",
    EN_ROUTE_TO_DROPOFF: "enRouteDropoffAt",
    ARRIVED_DROPOFF: "arrivedDropoffAt",
    COMPLETED: "completedAt",
  };

  app.patch("/api/trips/:id/status", authMiddleware, requireRole("ADMIN", "DISPATCH", "DRIVER"), async (req: AuthRequest, res) => {
    try {
      const parsed = updateStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid status" });
      }
      const id = parseInt(req.params.id);
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });

      if (tripLockedGuard(trip, req, res)) return;

      if (req.user!.role === "DRIVER") {
        const user = await storage.getUser(req.user!.userId);
        if (!user?.driverId || trip.driverId !== user.driverId) {
          return res.status(403).json({ message: "You can only update status for your assigned trips" });
        }
      }

      const allowedNext = VALID_TRANSITIONS[trip.status] || [];
      if (!allowedNext.includes(parsed.data.status)) {
        return res.status(400).json({ message: `Invalid transition from ${trip.status} to ${parsed.data.status}` });
      }

      const timestampField = STATUS_TIMESTAMP_MAP[parsed.data.status];
      const updateData: any = { status: parsed.data.status };
      if (timestampField) {
        updateData[timestampField] = new Date();
      }
      const updated = await db.update(trips).set(updateData).where(eq(trips.id, id)).returning();
      const updatedTrip = updated[0];

      import("./lib/realtime").then(({ broadcastToTrip }) => {
        broadcastToTrip(id, { type: "status_change", data: { status: parsed.data.status, tripId: id } });
      }).catch(() => {});

      const STATUS_PERSIST_TRIGGERS = ["ARRIVED_PICKUP", "PICKED_UP", "ARRIVED_DROPOFF", "EN_ROUTE_TO_DROPOFF"];
      if (updatedTrip.driverId && STATUS_PERSIST_TRIGGERS.includes(parsed.data.status)) {
        import("./lib/driverLocationIngest").then(({ persistOnStatusEvent, getDriverLocationFromCache }) => {
          const loc = getDriverLocationFromCache(updatedTrip.driverId!);
          if (loc) {
            persistOnStatusEvent(updatedTrip.driverId!, loc.lat, loc.lng);
          }
        }).catch(() => {});
      }

      if (parsed.data.status === "EN_ROUTE_TO_PICKUP" || parsed.data.status === "IN_PROGRESS") {
        import("./lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
          autoNotifyPatient(id, "arrived");
        }).catch(() => {});
      }

      if (parsed.data.status === "CANCELLED") {
        import("./lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
          autoNotifyPatient(id, "canceled");
        }).catch(() => {});
      }

      const terminalStatuses = ["COMPLETED", "CANCELLED", "NO_SHOW"];
      if (terminalStatuses.includes(parsed.data.status)) {
        storage.revokeTokensForTrip(id).catch((err: any) => {
          console.error(`[TRACKING] Failed to revoke tokens for trip ${id}:`, err.message);
        });

        if (!updatedTrip.billingOutcome) {
          import("./lib/clinicBillingRoutes").then(({ autoBillingClassify }) => {
            autoBillingClassify(updatedTrip).catch((err: any) => {
              console.error(`[BILLING] Auto-classify failed for trip ${id}:`, err.message);
            });
          }).catch(() => {});
        }
      }

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "UPDATE_STATUS",
        entity: "trip",
        entityId: updatedTrip.id,
        details: `Trip status changed to ${parsed.data.status}`,
        cityId: updatedTrip.cityId,
      });
      res.json(updatedTrip);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/trips/:id/dialysis-return-check", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN", "CLINIC_USER"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });

      if (req.user!.role === "CLINIC_USER") {
        const user = await storage.getUser(req.user!.userId);
        if (!user?.clinicId || user.clinicId !== trip.clinicId) {
          return res.status(403).json({ message: "Access denied: trip belongs to a different clinic" });
        }
      }
      if (req.user!.companyId && trip.companyId && req.user!.companyId !== trip.companyId) {
        return res.status(403).json({ message: "Access denied: trip belongs to a different company" });
      }

      if (trip.tripType !== "dialysis") {
        return res.json({ ok: true, applicable: false, reason: "Not a dialysis trip" });
      }
      if (trip.status !== "COMPLETED") {
        return res.json({ ok: true, applicable: false, reason: "Trip not completed" });
      }

      const clinic = trip.clinicId ? await storage.getClinic(trip.clinicId) : null;
      const isOutbound = clinic && clinic.lat && clinic.lng && trip.dropoffLat && trip.dropoffLng
        && (Math.abs(trip.dropoffLat - clinic.lat) + Math.abs(trip.dropoffLng - clinic.lng)) < 0.01;

      if (!isOutbound) {
        return res.json({ ok: true, applicable: false, reason: "Not an outbound trip to clinic" });
      }

      const sameDayDialysis = await db.select().from(trips).where(
        and(
          eq(trips.patientId, trip.patientId),
          eq(trips.scheduledDate, trip.scheduledDate),
          eq(trips.tripType, "dialysis"),
          isNull(trips.deletedAt),
          sql`${trips.id} != ${trip.id}`,
          sql`${trips.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW')`,
        )
      );

      const returnTrip = sameDayDialysis.find(t => {
        if (!clinic?.lat || !clinic?.lng || !t.pickupLat || !t.pickupLng) return false;
        return (Math.abs(t.pickupLat - clinic.lat) + Math.abs(t.pickupLng - clinic.lng)) < 0.01;
      });

      if (!returnTrip) {
        return res.json({ ok: true, applicable: false, reason: "No linked return trip found" });
      }

      const BUFFER_MINUTES = 30;
      const completedAt = trip.completedAt || trip.arrivedDropoffAt || new Date();
      const completedTime = new Date(completedAt);
      const proposedTime = new Date(completedTime.getTime() + BUFFER_MINUTES * 60000);
      const proposedPickupTime = `${String(proposedTime.getHours()).padStart(2, "0")}:${String(proposedTime.getMinutes()).padStart(2, "0")}`;

      const currentReturnPickupTime = returnTrip.pickupTime;
      const needsAdjustment = proposedPickupTime !== currentReturnPickupTime;

      res.json({
        ok: true,
        applicable: true,
        needsAdjustment,
        outboundTripId: trip.id,
        outboundPublicId: trip.publicId,
        returnTripId: returnTrip.id,
        returnPublicId: returnTrip.publicId,
        completedAtTime: completedTime.toISOString(),
        currentReturnPickupTime,
        proposedReturnPickupTime: proposedPickupTime,
        bufferMinutes: BUFFER_MINUTES,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/trips/:id/dialysis-return-adjust", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN", "CLINIC_USER"), async (req: AuthRequest, res) => {
    try {
      const outboundId = parseInt(req.params.id);
      if (isNaN(outboundId)) return res.status(400).json({ message: "Invalid trip ID" });

      const { action, returnTripId, proposedPickupTime } = req.body;
      if (!action || !returnTripId) {
        return res.status(400).json({ message: "action and returnTripId are required" });
      }
      if (!["confirm", "keep"].includes(action)) {
        return res.status(400).json({ message: "action must be 'confirm' or 'keep'" });
      }

      const outbound = await storage.getTrip(outboundId);
      if (!outbound) return res.status(404).json({ message: "Outbound trip not found" });

      if (req.user!.role === "CLINIC_USER") {
        const user = await storage.getUser(req.user!.userId);
        if (!user?.clinicId || user.clinicId !== outbound.clinicId) {
          return res.status(403).json({ message: "Access denied: trip belongs to a different clinic" });
        }
      }
      if (req.user!.companyId && outbound.companyId && req.user!.companyId !== outbound.companyId) {
        return res.status(403).json({ message: "Access denied: trip belongs to a different company" });
      }

      const returnTrip = await storage.getTrip(returnTripId);
      if (!returnTrip) return res.status(404).json({ message: "Return trip not found" });

      if (returnTrip.patientId !== outbound.patientId || returnTrip.scheduledDate !== outbound.scheduledDate) {
        return res.status(400).json({ message: "Return trip does not match outbound trip" });
      }

      const terminalStatuses = ["COMPLETED", "CANCELLED", "NO_SHOW"];
      if (terminalStatuses.includes(returnTrip.status)) {
        return res.status(400).json({ message: "Return trip is already in a terminal status" });
      }

      if (action === "confirm") {
        if (!proposedPickupTime) {
          return res.status(400).json({ message: "proposedPickupTime is required for confirm action" });
        }

        const previousTime = returnTrip.pickupTime;
        await db.update(trips).set({
          pickupTime: proposedPickupTime,
          scheduledTime: proposedPickupTime,
          updatedAt: new Date(),
        }).where(eq(trips.id, returnTripId));

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "DIALYSIS_RETURN_ADJUST",
          entity: "trip",
          entityId: returnTripId,
          details: `Dialysis return trip pickup time adjusted from ${previousTime} to ${proposedPickupTime} (linked to outbound trip #${outbound.publicId})`,
          cityId: outbound.cityId,
        });

        return res.json({ ok: true, action: "confirmed", returnTripId, previousTime, newTime: proposedPickupTime });
      }

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "DIALYSIS_RETURN_KEEP",
        entity: "trip",
        entityId: returnTripId,
        details: `Dialysis return trip pickup time kept at ${returnTrip.pickupTime} (linked to outbound trip #${outbound.publicId})`,
        cityId: outbound.cityId,
      });

      return res.json({ ok: true, action: "kept", returnTripId, currentTime: returnTrip.pickupTime });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Trip approval endpoint - dispatch/admin approves pending trips
  app.patch("/api/trips/:id/approve", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      if (trip.approvalStatus !== "pending") {
        return res.status(400).json({ message: `Trip is already ${trip.approvalStatus}` });
      }
      const updated = await storage.updateTrip(id, {
        approvalStatus: "approved",
        approvedAt: new Date(),
        approvedBy: req.user!.userId,
      } as any);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "APPROVE",
        entity: "trip",
        entityId: id,
        details: `Approved trip ${trip.publicId}`,
        cityId: trip.cityId,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  function computeCancelStage(trip: any): string {
    if (["PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"].includes(trip.status)) return "picked_up";
    if (trip.status === "ARRIVED_PICKUP") return "arrived_pickup";
    if (trip.status === "EN_ROUTE_TO_PICKUP") return "enroute_pickup";
    if (trip.driverId) return "assigned";
    return "pre_assign";
  }

  const CANCEL_FEE_SCHEDULE: Record<string, number> = {
    pre_assign: 0,
    assigned: 25,
    enroute_pickup: 50,
    arrived_pickup: 75,
    picked_up: 0,
  };

  function computeCancelFee(cancelStage: string): number {
    return CANCEL_FEE_SCHEDULE[cancelStage] ?? 0;
  }

  // Clinic requests cancellation of an approved trip
  app.patch("/api/trips/:id/cancel-request", authMiddleware, requireRole("VIEWER"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      if (tripLockedGuard(trip, req, res)) return;
      const cancelReqTerminal = ["CANCELLED", "NO_SHOW", "COMPLETED"];
      if (cancelReqTerminal.includes(trip.status)) {
        return res.status(400).json({ message: `Trip is ${trip.status.toLowerCase()} and locked` });
      }
      const user = await storage.getUser(req.user!.userId);
      if (!user?.clinicId || trip.clinicId !== user.clinicId) {
        return res.status(403).json({ message: "You can only cancel your own clinic's trips" });
      }
      const cancelStage = computeCancelStage(trip);
      const cancelFee = computeCancelFee(cancelStage);
      if (trip.approvalStatus === "pending") {
        const updated = await storage.updateTrip(id, {
          approvalStatus: "cancelled",
          cancelledBy: req.user!.userId,
          cancelledReason: req.body.reason || "Cancelled by clinic",
          cancelType: "soft",
          cancelledAt: new Date(),
          status: "CANCELLED",
          faultParty: "clinic",
          cancelStage,
          billable: false,
          cancelFee: "0",
        } as any);
        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "CANCEL",
          entity: "trip",
          entityId: id,
          details: `Clinic cancelled pending trip ${trip.publicId} (stage: ${cancelStage})`,
          cityId: trip.cityId,
        });

        import("./lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
          autoNotifyPatient(id, "canceled");
        }).catch(() => {});

        if (updated && !updated.billingOutcome) {
          import("./lib/clinicBillingRoutes").then(({ autoBillingClassify }) => {
            autoBillingClassify(updated).catch(() => {});
          }).catch(() => {});
        }

        return res.json(updated);
      }
      if (trip.approvalStatus !== "approved") {
        return res.status(400).json({ message: `Cannot request cancellation: trip is ${trip.approvalStatus}` });
      }
      const updated = await storage.updateTrip(id, {
        approvalStatus: "cancel_requested",
        cancelledBy: req.user!.userId,
        cancelledReason: req.body.reason || "Cancellation requested by clinic",
        cancelledAt: new Date(),
        faultParty: "clinic",
        cancelStage,
        billable: true,
        cancelFee: String(cancelFee),
      } as any);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "clinic_cancel_request",
        entity: "trip",
        entityId: id,
        details: JSON.stringify({
          reason: req.body.reason || "No reason given",
          notes: req.body.notes || null,
          cancelStage,
          cancelFee,
          faultParty: "clinic",
          clinicId: user.clinicId,
        }),
        cityId: trip.cityId,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dispatch/cancel-requests", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const companyId = getCompanyIdFromAuth(req);
      const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
      const conditions = [
        eq(trips.approvalStatus, "cancel_requested"),
        isNull(trips.deletedAt),
      ];
      if (cityId) conditions.push(eq(trips.cityId, cityId));
      const cancelRequests = await db.select().from(trips).where(and(...conditions)).orderBy(desc(trips.updatedAt));
      const filtered = applyCompanyFilter(cancelRequests, companyId);
      const result = await Promise.all(filtered.map(async (trip) => {
        const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;
        const driver = trip.driverId ? await storage.getDriver(trip.driverId) : null;
        const clinic = trip.clinicId ? await storage.getClinic(trip.clinicId) : null;
        const cancelledByUser = trip.cancelledBy ? await storage.getUser(trip.cancelledBy) : null;
        return {
          ...trip,
          patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, phone: patient.phone } : null,
          driver: driver ? { id: driver.id, firstName: driver.firstName, lastName: driver.lastName, phone: driver.phone } : null,
          clinic: clinic ? { id: clinic.id, name: clinic.name } : null,
          cancelledByName: cancelledByUser ? `${cancelledByUser.firstName || ""} ${cancelledByUser.lastName || ""}`.trim() : null,
        };
      }));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/trips/:id/reject-cancel", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      const companyId = getCompanyIdFromAuth(req);
      if (!checkCompanyOwnership(trip, companyId)) return res.status(403).json({ message: "Access denied" });
      if (trip.approvalStatus !== "cancel_requested") {
        return res.status(400).json({ message: `Trip is not in cancel_requested state (current: ${trip.approvalStatus})` });
      }
      const updated = await storage.updateTrip(id, {
        approvalStatus: "approved",
        cancelledBy: null,
        cancelledReason: null,
      } as any);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "REJECT_CANCEL_REQUEST",
        entity: "trip",
        entityId: id,
        details: `Rejected clinic cancellation request for trip ${trip.publicId}`,
        cityId: trip.cityId,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Dispatch/admin cancels an approved or cancel-requested trip (with fault/billing)
  app.patch("/api/trips/:id/cancel", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      if (tripLockedGuard(trip, req, res)) return;
      if (trip.status === "NO_SHOW") {
        return res.status(400).json({ message: "Trip is no_show and locked" });
      }
      if (trip.approvalStatus === "cancelled") {
        return res.status(400).json({ message: "Trip is already cancelled" });
      }
      const cancelType = req.body.type || "soft";
      if (!["soft", "hard"].includes(cancelType)) {
        return res.status(400).json({ message: "Cancel type must be 'soft' or 'hard'" });
      }
      const validFaultParties = ["clinic", "driver", "patient", "dispatch", "unknown"];
      const faultParty = req.body.faultParty && validFaultParties.includes(req.body.faultParty)
        ? req.body.faultParty
        : (trip as any).faultParty || "unknown";
      const isBillable = ["driver", "dispatch"].includes(faultParty) ? false : (req.body.billable !== undefined ? req.body.billable : true);
      const cancelStage = (trip as any).cancelStage || computeCancelStage(trip);
      let finalFee = 0;
      if (isBillable) {
        const baseFee = computeCancelFee(cancelStage);
        if (req.body.feeOverride !== undefined && req.body.feeOverride !== null) {
          finalFee = Number(req.body.feeOverride);
        } else {
          finalFee = baseFee;
        }
      }
      const updated = await storage.updateTrip(id, {
        approvalStatus: "cancelled",
        cancelledBy: req.user!.userId,
        cancelledReason: req.body.reason || "Cancelled by dispatch",
        cancelType: cancelType,
        cancelledAt: new Date(),
        status: "CANCELLED",
        faultParty,
        billable: isBillable,
        cancelStage,
        cancelFee: String(finalFee),
        cancelFeeOverride: req.body.feeOverride !== undefined && req.body.feeOverride !== null ? String(req.body.feeOverride) : null,
        cancelFeeOverrideNote: req.body.overrideNote || null,
      } as any);
      storage.revokeTokensForTrip(id).catch(() => {});

      if (updated && !updated.billingOutcome) {
        import("./lib/clinicBillingRoutes").then(({ autoBillingClassify }) => {
          autoBillingClassify(updated).catch(() => {});
        }).catch(() => {});
      }

      let invoiceId: number | null = null;
      if (isBillable && finalFee > 0) {
        try {
          let cancelClinicId = trip.clinicId;
          if (!cancelClinicId) {
            const { getDefaultPrivateClinicId } = await import("./lib/defaultClinic");
            cancelClinicId = await getDefaultPrivateClinicId(trip.cityId);
            await storage.updateTrip(id, { clinicId: cancelClinicId } as any);
          }
          const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;
          const invoice = await storage.createInvoice({
            clinicId: cancelClinicId,
            tripId: id,
            patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Unknown",
            serviceDate: trip.scheduledDate,
            amount: String(finalFee),
            status: "pending",
            notes: `Cancel fee (stage: ${cancelStage}, fault: ${faultParty})${req.body.overrideNote ? ` | Override: ${req.body.overrideNote}` : ""}`,
            reason: `Late cancellation - ${cancelStage}`,
            faultParty,
            relatedTripId: id,
          } as any);
          invoiceId = invoice.id;
          await storage.updateTrip(id, { invoiceId: invoice.id } as any);
          if (patient?.email && (patient.source === "private" || patient.source === "internal")) {
            try {
              await db.update(invoices).set({ emailTo: patient.email }).where(eq(invoices.id, invoice.id));
              const { sendInvoicePaymentEmail } = await import("./services/invoiceEmailService");
              sendInvoicePaymentEmail(invoice.id).catch((e: any) => console.error("[CANCEL] Invoice email error:", e.message));
            } catch {}
          }
        } catch (invErr: any) {
          console.error("[CANCEL] Invoice creation failed:", invErr.message);
        }
      }
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "dispatch_cancel_approve",
        entity: "trip",
        entityId: id,
        details: JSON.stringify({
          publicId: trip.publicId,
          cancelType,
          faultParty,
          billable: isBillable,
          cancelStage,
          fee: finalFee,
          feeOverride: req.body.feeOverride ?? null,
          overrideNote: req.body.overrideNote ?? null,
          invoiceId,
          reason: req.body.reason || "No reason given",
        }),
        cityId: trip.cityId,
      });

      import("./lib/dispatchAutoSms").then(({ autoNotifyPatient }) => {
        autoNotifyPatient(id, "canceled");
      }).catch(() => {});

      res.json({ ...updated, invoiceId, cancelFee: finalFee, billable: isBillable });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/trips/:id/return-trip", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
      const parentTrip = await storage.getTrip(id);
      if (!parentTrip) return res.status(404).json({ message: "Trip not found" });
      const companyId = getCompanyIdFromAuth(req);
      if (!checkCompanyOwnership(parentTrip, companyId)) return res.status(403).json({ message: "Access denied" });
      const publicId = await generatePublicId();
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
      const dateStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
      const returnTrip = await storage.createTrip({
        publicId,
        cityId: parentTrip.cityId,
        patientId: parentTrip.patientId,
        clinicId: parentTrip.clinicId,
        companyId: parentTrip.companyId,
        pickupAddress: parentTrip.dropoffAddress,
        pickupStreet: parentTrip.dropoffStreet,
        pickupCity: parentTrip.dropoffCity,
        pickupState: parentTrip.dropoffState,
        pickupZip: parentTrip.dropoffZip,
        pickupPlaceId: parentTrip.dropoffPlaceId,
        pickupLat: parentTrip.dropoffLat,
        pickupLng: parentTrip.dropoffLng,
        dropoffAddress: parentTrip.pickupAddress,
        dropoffStreet: parentTrip.pickupStreet,
        dropoffCity: parentTrip.pickupCity,
        dropoffState: parentTrip.pickupState,
        dropoffZip: parentTrip.pickupZip,
        dropoffPlaceId: parentTrip.pickupPlaceId,
        dropoffLat: parentTrip.pickupLat,
        dropoffLng: parentTrip.pickupLng,
        scheduledDate: dateStr,
        scheduledTime: timeStr,
        pickupTime: timeStr,
        estimatedArrivalTime: timeStr,
        tripType: "one_time",
        status: "SCHEDULED",
        requestSource: "internal",
        notes: `Return trip for ${parentTrip.publicId}${req.body.notes ? ` - ${req.body.notes}` : ""}`,
      } as any);
      await storage.updateTrip(returnTrip.id, { parentTripId: id } as any);
      if (parentTrip.driverId) {
        await storage.updateTrip(returnTrip.id, {
          driverId: parentTrip.driverId,
          vehicleId: parentTrip.vehicleId,
          status: "ASSIGNED",
          assignedAt: new Date(),
          assignedBy: req.user!.userId,
          assignmentSource: "dispatch_return",
        } as any);
      }
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "CREATE_RETURN_TRIP",
        entity: "trip",
        entityId: returnTrip.id,
        details: JSON.stringify({
          parentTripId: id,
          parentPublicId: parentTrip.publicId,
          returnPublicId: publicId,
          driverId: parentTrip.driverId,
        }),
        cityId: parentTrip.cityId,
      });
      const finalTrip = await storage.getTrip(returnTrip.id);
      res.json(finalTrip);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/trips/:id/route/recompute", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });

      const TERMINAL = ["COMPLETED", "CANCELLED", "NO_SHOW"];
      if (TERMINAL.includes(trip.status)) return res.status(400).json({ message: "Trip is in terminal status" });

      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const isDriver = user.role === "DRIVER" && user.driverId && trip.driverId === user.driverId;
      const isDispatch = ["ADMIN", "DISPATCH", "SUPER_ADMIN"].includes(user.role);
      const isClinic = user.role === "CLINIC_USER" && user.clinicId && trip.clinicId === user.clinicId;
      if (!isDriver && !isDispatch && !isClinic) {
        return res.status(403).json({ message: "Not authorized for this trip" });
      }

      const { originLat, originLng } = req.body;
      if (typeof originLat !== "number" || typeof originLng !== "number") {
        return res.status(400).json({ message: "originLat and originLng are required numbers" });
      }

      const PICKUP_STAGES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "SCHEDULED"];
      const isPickupPhase = PICKUP_STAGES.includes(trip.status);
      const targetLat = isPickupPhase ? trip.pickupLat : trip.dropoffLat;
      const targetLng = isPickupPhase ? trip.pickupLng : trip.dropoffLng;

      if (!targetLat || !targetLng) {
        return res.status(400).json({ message: "Trip missing target coordinates" });
      }

      const { cache, cacheKeys } = await import("./lib/cache");
      const routeCacheKey = `trip:${id}:route_last_compute`;
      const lastCompute = cache.get<number>(routeCacheKey);
      if (lastCompute && (Date.now() - lastCompute) < 20_000) {
        const existingTrip = await storage.getTrip(id);
        if (existingTrip?.routePolyline) {
          return res.json({
            ok: true,
            polyline: existingTrip.routePolyline,
            etaMinutes: existingTrip.lastEtaMinutes,
            distanceMiles: existingTrip.distanceMiles ? parseFloat(existingTrip.distanceMiles) : null,
            updatedAt: existingTrip.lastEtaUpdatedAt?.toISOString() || new Date().toISOString(),
            source: "throttled",
          });
        }
      }

      try {
        const { buildRoute } = await import("./lib/googleMaps");
        const route = await buildRoute(
          { lat: originLat, lng: originLng },
          { lat: Number(targetLat), lng: Number(targetLng) }
        );

        const updateData: any = {
          routePolyline: route.polyline,
          lastEtaMinutes: route.totalMinutes,
          durationMinutes: route.totalMinutes,
          distanceMiles: String(route.totalMiles),
          lastEtaUpdatedAt: new Date(),
        };

        await storage.updateTrip(id, updateData);
        cache.set(routeCacheKey, Date.now(), 30_000);

        res.json({
          ok: true,
          polyline: route.polyline,
          etaMinutes: route.totalMinutes,
          distanceMiles: route.totalMiles,
          updatedAt: updateData.lastEtaUpdatedAt.toISOString(),
          source: "google",
        });
      } catch (routeErr: any) {
        const { haversineEta } = await import("./lib/etaThrottle");
        const fallback = haversineEta(
          { lat: originLat, lng: originLng },
          { lat: Number(targetLat), lng: Number(targetLng) }
        );

        const updateData: any = {
          lastEtaMinutes: fallback.minutes,
          distanceMiles: String(fallback.distanceMiles),
          lastEtaUpdatedAt: new Date(),
        };
        await storage.updateTrip(id, updateData);

        res.json({
          ok: true,
          polyline: null,
          etaMinutes: fallback.minutes,
          distanceMiles: fallback.distanceMiles,
          updatedAt: updateData.lastEtaUpdatedAt.toISOString(),
          source: "haversine",
        });
      }
    } catch (err: any) {
      console.error("[ROUTE-RECOMPUTE]", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // SUPER_ADMIN archive (soft-delete) a trip
  app.patch("/api/admin/trips/:id/archive", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      const updated = await storage.updateTrip(id, { deletedAt: new Date() } as any);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "ARCHIVE",
        entity: "trip",
        entityId: id,
        details: `Archived trip ${trip.publicId}`,
        cityId: trip.cityId,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/trips/:id/restore", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      if (!trip.deletedAt) return res.status(400).json({ message: "Trip is not archived" });
      const updated = await storage.updateTrip(id, { deletedAt: null } as any);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "RESTORE",
        entity: "trip",
        entityId: id,
        details: `Restored trip ${trip.publicId}`,
        cityId: trip.cityId,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/trips/:id/permanent", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      if (!trip.deletedAt) return res.status(400).json({ message: "Trip must be archived before permanent deletion" });
      await storage.deleteTrip(id);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "DELETE",
        entity: "trip",
        entityId: id,
        details: `Permanently deleted trip ${trip.publicId}`,
        cityId: trip.cityId,
      });
      res.json({ ok: true, message: "Trip permanently deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/stats", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const enforced = enforceCityContext(req, res);
      if (enforced === false) return;
      const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
      if (cityId === -1) return res.status(403).json({ message: "Access denied" });
      res.json(await storage.getStats(cityId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/stats/trip-status", authMiddleware, requireRole("ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const enforced = enforceCityContext(req, res);
      if (enforced === false) return;
      const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
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
              await supabase.auth.admin.updateUserById(sbUser.id, {
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
              await supabase.auth.admin.updateUserById(sbUser.id, {
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

  const emailCooldowns = new Map<string, number>();
  const EMAIL_COOLDOWN_MS = 60_000;
  function checkEmailCooldown(key: string): boolean {
    const last = emailCooldowns.get(key);
    if (last && Date.now() - last < EMAIL_COOLDOWN_MS) return false;
    emailCooldowns.set(key, Date.now());
    return true;
  }

  app.post("/api/admin/drivers/:id/send-invite", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const driverId = parseInt(req.params.id);
      if (isNaN(driverId)) return res.status(400).json({ message: "Invalid driver ID" });

      const driver = await storage.getDriver(driverId);
      if (!driver) return res.status(404).json({ message: "Driver not found" });
      if (!driver.email) return res.status(400).json({ message: "Driver has no email address" });

      if (!checkEmailCooldown(`driver-invite-${driver.email}`)) {
        return res.status(429).json({ message: "An email was sent recently. Please wait 60 seconds before trying again." });
      }

      let tempPassword: string | undefined;

      if (!driver.authUserId) {
        try {
          const { ensureAuthUserForDriver } = await import("./lib/driverAuth");
          const result = await ensureAuthUserForDriver({
            name: `${driver.firstName} ${driver.lastName}`,
            email: driver.email,
          });
          await storage.updateDriver(driverId, { authUserId: result.userId } as any);
          tempPassword = result.tempPassword;
        } catch (provErr: any) {
          return res.status(500).json({ message: `Failed to provision auth: ${provErr.message}` });
        }
      }

      if (!tempPassword) {
        const { generateTempPassword } = await import("./lib/driverAuth");
        tempPassword = generateTempPassword();
      }

      const driverUser = await storage.getUserByDriverId(driverId);
      if (driverUser) {
        const hashed = await hashPassword(tempPassword);
        await db.update(users).set({ password: hashed, mustChangePassword: true }).where(eq(users.id, driverUser.id));
      }

      const { sendDriverTempPassword } = await import("./services/emailService");
      const driverName = `${driver.firstName} ${driver.lastName}`;
      const emailResult = await sendDriverTempPassword(driver.email, tempPassword, driverName);
      if (!emailResult.success) {
        return res.status(500).json({ message: emailResult.error || "Failed to send credentials email" });
      }

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "SEND_INVITE",
        entity: "driver",
        entityId: driverId,
        details: `Sent temp password email to driver ${driverName} (${driver.email})`,
        cityId: driver.cityId,
      });

      res.json({ success: true, message: `Credentials sent to ${driver.email}` });
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

      if (!checkEmailCooldown(`clinic-invite-${clinic.email}`)) {
        return res.status(429).json({ message: "An email was sent recently. Please wait 60 seconds before trying again." });
      }

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

      const { sendClinicLoginLink } = await import("./services/emailService");
      const result = await sendClinicLoginLink(clinic.email, clinic.name);
      if (!result.success) {
        return res.status(500).json({ message: result.error || "Failed to send login link email" });
      }

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "SEND_INVITE",
        entity: "clinic",
        entityId: clinicId,
        details: `Sent login link email to clinic ${clinic.name} (${clinic.email})`,
        cityId: clinic.cityId,
      });

      res.json({ success: true, message: `Login link sent to ${clinic.email}` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/send-login-link", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { targetType, targetId } = req.body;
      if (!targetType || !targetId) {
        return res.status(400).json({ message: "targetType and targetId are required" });
      }
      if (!["clinic", "driver", "dispatch"].includes(targetType)) {
        return res.status(400).json({ message: "targetType must be 'clinic', 'driver', or 'dispatch'" });
      }

      const id = parseInt(targetId);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid targetId" });

      let email: string | null = null;
      let recipientName = "";
      let clinicId: number | null = null;
      let driverId: number | null = null;
      let role = "";

      if (targetType === "clinic") {
        const clinic = await storage.getClinic(id);
        if (!clinic) return res.status(404).json({ message: "Clinic not found" });
        if (!clinic.email) return res.status(400).json({ message: "Clinic has no email address" });
        email = clinic.email;
        recipientName = clinic.name;
        clinicId = clinic.id;
        role = "VIEWER";
      } else if (targetType === "driver") {
        const driver = await storage.getDriver(id);
        if (!driver) return res.status(404).json({ message: "Driver not found" });
        if (!driver.email) return res.status(400).json({ message: "Driver has no email address" });
        email = driver.email;
        recipientName = `${driver.firstName} ${driver.lastName}`;
        driverId = driver.id;
        role = "DRIVER";
      } else {
        const targetUser = await storage.getUser(id);
        if (!targetUser) return res.status(404).json({ message: "User not found" });
        if (!targetUser.email) return res.status(400).json({ message: "User has no email address" });
        email = targetUser.email;
        recipientName = `${targetUser.firstName} ${targetUser.lastName}`;
        role = targetUser.role;
      }

      const crypto = await import("crypto");
      const { loginTokens } = await import("@shared/schema");

      const recentCheck = await db.select().from(loginTokens)
        .where(sql`created_at > NOW() - INTERVAL '60 seconds' AND (
          ${clinicId ? sql`clinic_id = ${clinicId}` : driverId ? sql`driver_id = ${driverId}` : sql`role = ${role} AND user_id = ${id}`}
        )`)
        .limit(1);
      if (recentCheck.length > 0) {
        return res.status(429).json({ message: "A login link was sent recently. Please wait 60 seconds." });
      }

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      const user = targetType === "clinic"
        ? await storage.getUserByClinicId(clinicId!)
        : targetType === "driver"
        ? await storage.getUserByDriverId(driverId!)
        : await storage.getUser(id);

      await db.insert(loginTokens).values({
        tokenHash,
        userId: user?.id || null,
        clinicId,
        driverId,
        role,
        expiresAt,
        createdBy: req.user!.userId,
      });

      const appUrl = process.env.APP_PUBLIC_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost:5000"}`;
      const loginUrl = `${appUrl}/login?token=${rawToken}`;

      const { sendEmail: sendEmailFn, buildLoginLinkEmail } = await import("./lib/email");
      const { subject, html } = buildLoginLinkEmail({
        recipientName,
        loginUrl,
        expiresMinutes: 15,
      });

      const emailResult = await sendEmailFn({ to: email, subject, html });

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "SEND_LOGIN_LINK",
        entity: targetType,
        entityId: id,
        details: `Sent login link to ${recipientName} (${email}). Email ${emailResult.success ? "delivered" : "failed"}: ${emailResult.error || "ok"}`,
        cityId: null,
      });

      if (!emailResult.success) {
        return res.status(500).json({ message: `Email failed: ${emailResult.error}` });
      }

      res.json({ success: true, message: `Login link sent to ${email}` });
    } catch (err: any) {
      console.error("[SEND_LOGIN_LINK] Error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required" });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }

      const allUsers = await storage.getUsers();
      const user = allUsers.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());

      if (!user) {
        return res.json({ success: true, message: "If an account exists with that email, a password reset link has been sent." });
      }

      const { sendForgotPasswordLink } = await import("./services/emailService");
      const result = await sendForgotPasswordLink(email);

      if (!result.success) {
        console.error("[FORGOT_PASSWORD] Email failed:", result.error);
      }

      await storage.createAuditLog({
        userId: user.id,
        action: "FORGOT_PASSWORD",
        entity: "user",
        entityId: user.id,
        details: `Password reset requested for ${email}`,
        cityId: null,
      });

      res.json({ success: true, message: "If an account exists with that email, a password reset link has been sent." });
    } catch (err: any) {
      console.error("[FORGOT_PASSWORD] Error:", err.message);
      res.json({ success: true, message: "If an account exists with that email, a password reset link has been sent." });
    }
  });

  app.post("/api/auth/token-login", async (req, res) => {
    try {
      const { token: rawToken } = req.body;
      if (!rawToken || typeof rawToken !== "string") {
        return res.status(400).json({ message: "Token is required" });
      }

      const crypto = await import("crypto");
      const { loginTokens } = await import("@shared/schema");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

      const [record] = await db.select().from(loginTokens)
        .where(sql`token_hash = ${tokenHash}`)
        .limit(1);

      if (!record) {
        return res.status(401).json({ message: "Invalid login link. Please request a new one from your administrator." });
      }

      if (record.usedAt) {
        return res.status(401).json({ message: "This login link has already been used. Please request a new one." });
      }

      if (new Date(record.expiresAt) < new Date()) {
        return res.status(401).json({ message: "This login link has expired. Please request a new one." });
      }

      await db.update(loginTokens).set({ usedAt: new Date() }).where(eq(loginTokens.id, record.id));

      let user;
      if (record.userId) {
        user = await storage.getUser(record.userId);
      }

      if (!user && record.clinicId) {
        user = await storage.getUserByClinicId(record.clinicId);
      }

      if (!user && record.driverId) {
        user = await storage.getUserByDriverId(record.driverId);
      }

      if (!user) {
        return res.status(404).json({ message: "No user account found for this login link. Contact your administrator." });
      }

      if (!user.active) {
        return res.status(403).json({ message: "Account disabled" });
      }

      const jwtToken = signToken({ userId: user.id, role: user.role, companyId: user.companyId || null });
      const cityAccess = await storage.getUserCityAccess(user.id);
      const allCities = await storage.getCities();
      const accessibleCities = user.role === "SUPER_ADMIN"
        ? allCities
        : allCities.filter((c) => cityAccess.includes(c.id));

      const { password, ...safeUser } = user;

      await storage.createAuditLog({
        userId: user.id,
        action: "TOKEN_LOGIN",
        entity: "user",
        entityId: user.id,
        details: `User ${user.email} logged in via magic link`,
        cityId: null,
      });

      res.json({
        token: jwtToken,
        user: { ...safeUser, cityAccess },
        cities: accessibleCities,
      });
    } catch (err: any) {
      console.error("[TOKEN_LOGIN] Error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/debug/email-health", authMiddleware, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res) => {
    const { getEmailHealth } = await import("./lib/email");
    res.json(getEmailHealth());
  });

  app.get("/api/health/email", async (_req, res) => {
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
  });

  app.get("/api/admin/clinics/city-mismatch", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
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
  });

  app.get("/api/clinic/ops", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

      const clinic = await storage.getClinic(user.clinicId);
      if (!clinic) return res.status(404).json({ message: "Clinic not found" });

      const todayDate = new Date().toISOString().split("T")[0];
      const PRESENCE_TIMEOUT = 120_000;
      const LATE_THRESHOLD_MINUTES = 10;

      const clinicTrips = await db.select().from(trips).where(
        and(eq(trips.clinicId, user.clinicId), isNull(trips.deletedAt))
      );

      const todayTrips = clinicTrips.filter(t => t.scheduledDate === todayDate);
      const activeStatuses = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];
      const mapVisibleStatuses = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF"];
      const activeTrips = todayTrips.filter(t => activeStatuses.includes(t.status));

      const isToClinic = (trip: any) => {
        if (!clinic.lat || !clinic.lng) return false;
        if (trip.dropoffLat && trip.dropoffLng) {
          const dist = Math.abs(trip.dropoffLat - clinic.lat) + Math.abs(trip.dropoffLng - clinic.lng);
          if (dist < 0.01) return true;
        }
        return false;
      };

      const isFromClinic = (trip: any) => {
        if (!clinic.lat || !clinic.lng) return false;
        if (trip.pickupLat && trip.pickupLng) {
          const dist = Math.abs(trip.pickupLat - clinic.lat) + Math.abs(trip.pickupLng - clinic.lng);
          if (dist < 0.01) return true;
        }
        return false;
      };

      const enRouteToClinic = activeTrips.filter(t => isToClinic(t) && ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF"].includes(t.status));
      const leavingClinic = activeTrips.filter(t => isFromClinic(t) && ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF"].includes(t.status));

      const arrivalsNext60 = activeTrips.filter(t => {
        if (!isToClinic(t)) return false;
        if (t.lastEtaMinutes != null && t.lastEtaMinutes <= 60) return true;
        if (t.estimatedArrivalTime) {
          const [h, m] = t.estimatedArrivalTime.split(":").map(Number);
          const now = new Date();
          const arrivalToday = new Date(now);
          arrivalToday.setHours(h, m, 0, 0);
          const diffMin = (arrivalToday.getTime() - now.getTime()) / 60000;
          return diffMin >= 0 && diffMin <= 60;
        }
        return false;
      });

      const lateRisk = todayTrips.filter(t => {
        if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(t.status)) return false;
        if (t.lastEtaMinutes != null && t.estimatedArrivalTime) {
          const [h, m] = t.estimatedArrivalTime.split(":").map(Number);
          const now = new Date();
          const arrivalTarget = new Date(now);
          arrivalTarget.setHours(h, m, 0, 0);
          const scheduledMinutesFromNow = (arrivalTarget.getTime() - now.getTime()) / 60000;
          if (t.lastEtaMinutes > scheduledMinutesFromNow + LATE_THRESHOLD_MINUTES) return true;
        }
        if (t.noShowRisk) return true;
        return false;
      });

      const noDriverAssigned = todayTrips.filter(t =>
        !t.driverId && !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(t.status)
      );
      const completedToday = todayTrips.filter(t => t.status === "COMPLETED");
      const noShowsToday = todayTrips.filter(t => t.status === "NO_SHOW");

      const clinicPatientIds = await db.select({ id: patients.id }).from(patients).where(
        and(eq(patients.clinicId, user.clinicId), eq(patients.active, true), isNull(patients.deletedAt))
      );
      const patientIds = clinicPatientIds.map(p => p.id);
      let recurringActiveCount = 0;
      if (patientIds.length > 0) {
        const schedules = await db.select().from(recurringSchedules).where(
          and(inArray(recurringSchedules.patientId, patientIds), eq(recurringSchedules.active, true))
        );
        recurringActiveCount = schedules.length;
      }

      const alerts: { type: string; severity: string; message: string; tripId?: number; tripPublicId?: string }[] = [];

      for (const trip of activeTrips) {
        if (trip.driverId) {
          const driver = await storage.getDriver(trip.driverId);
          if (driver) {
            const lastSeenMs = driver.lastSeenAt ? Date.now() - new Date(driver.lastSeenAt).getTime() : Infinity;
            if (lastSeenMs > PRESENCE_TIMEOUT) {
              alerts.push({ type: "driver_offline", severity: "warning", message: `Driver ${driver.firstName} ${driver.lastName} offline during trip ${trip.publicId}`, tripId: trip.id, tripPublicId: trip.publicId });
            }
          }
        }

        if (trip.lastEtaUpdatedAt) {
          const etaAge = (Date.now() - new Date(trip.lastEtaUpdatedAt).getTime()) / 60000;
          if (etaAge > 5) {
            alerts.push({ type: "eta_stale", severity: "info", message: `ETA stale for trip ${trip.publicId} (${Math.round(etaAge)} min old)`, tripId: trip.id, tripPublicId: trip.publicId });
          }
        }
      }

      for (const trip of lateRisk) {
        alerts.push({ type: "late_risk", severity: "danger", message: `Late risk: Trip ${trip.publicId}`, tripId: trip.id, tripPublicId: trip.publicId });
      }

      for (const trip of noDriverAssigned) {
        alerts.push({ type: "no_driver", severity: "warning", message: `No driver assigned to trip ${trip.publicId}`, tripId: trip.id, tripPublicId: trip.publicId });
      }

      const enrichedActiveTrips = await Promise.all(activeTrips.map(async (trip) => {
        const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;
        let driverData = null;
        if (trip.driverId) {
          const driver = await storage.getDriver(trip.driverId);
          if (driver) {
            const lastSeenMs = driver.lastSeenAt ? Date.now() - new Date(driver.lastSeenAt).getTime() : Infinity;
            const isOnline = lastSeenMs < PRESENCE_TIMEOUT && driver.dispatchStatus !== "off" && driver.dispatchStatus !== "hold";
            const vehicle = driver.vehicleId ? await storage.getVehicle(driver.vehicleId) : null;
            let cachedLat = driver.lastLat;
            let cachedLng = driver.lastLng;
            try {
              const { getDriverLocationFromCache } = await import("./lib/driverLocationIngest");
              const cached = getDriverLocationFromCache(driver.id);
              if (cached) { cachedLat = cached.lat; cachedLng = cached.lng; }
            } catch {}
            driverData = {
              id: driver.id, firstName: driver.firstName, lastName: driver.lastName,
              phone: driver.phone, lastLat: cachedLat, lastLng: cachedLng,
              lastSeenAt: driver.lastSeenAt, isOnline,
              vehicleColor: vehicle?.color || null,
              vehicleLabel: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
            };
          }
        }

        const direction = isToClinic(trip) ? "TO_CLINIC" : isFromClinic(trip) ? "FROM_CLINIC" : "UNKNOWN";
        let lateStatus = "on_time";
        if (trip.estimatedArrivalTime && trip.lastEtaMinutes != null) {
          const [h, m] = trip.estimatedArrivalTime.split(":").map(Number);
          const now = new Date();
          const target = new Date(now);
          target.setHours(h, m, 0, 0);
          const scheduledMinFromNow = (target.getTime() - now.getTime()) / 60000;
          if (trip.lastEtaMinutes > scheduledMinFromNow + LATE_THRESHOLD_MINUTES) lateStatus = "late";
          else if (trip.lastEtaMinutes > scheduledMinFromNow) lateStatus = "at_risk";
        }

        const driverVisible = trip.lastEtaMinutes != null && trip.lastEtaMinutes < 15;

        const mapVisible = mapVisibleStatuses.includes(trip.status) && !!trip.driverId;

        return {
          tripId: trip.id, publicId: trip.publicId, status: trip.status,
          pickupAddress: trip.pickupAddress, dropoffAddress: trip.dropoffAddress,
          pickupLat: trip.pickupLat, pickupLng: trip.pickupLng,
          dropoffLat: trip.dropoffLat, dropoffLng: trip.dropoffLng,
          scheduledDate: trip.scheduledDate, pickupTime: trip.pickupTime,
          estimatedArrivalTime: trip.estimatedArrivalTime,
          tripType: trip.tripType, tripSeriesId: trip.tripSeriesId,
          direction, lateStatus, driverVisible, mapVisible,
          patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, phone: patient.phone } : null,
          driver: driverData ? {
            ...driverData,
            lastLat: driverVisible ? driverData.lastLat : null,
            lastLng: driverVisible ? driverData.lastLng : null,
          } : null,
          eta: trip.lastEtaMinutes != null ? { minutes: trip.lastEtaMinutes, updatedAt: trip.lastEtaUpdatedAt?.toISOString() || null } : null,
        };
      }));

      res.json({
        ok: true,
        clinic: { id: clinic.id, name: clinic.name, lat: clinic.lat, lng: clinic.lng, address: clinic.address },
        kpis: {
          enRouteToClinic: enRouteToClinic.length,
          leavingClinic: leavingClinic.length,
          arrivalsNext60: arrivalsNext60.length,
          lateRisk: lateRisk.length,
          noDriverAssigned: noDriverAssigned.length,
          completedToday: completedToday.length,
          noShowsToday: noShowsToday.length,
          recurringActive: recurringActiveCount,
        },
        activeTrips: enrichedActiveTrips,
        alerts,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  const clinicEtaCache = new Map<number, { eta: number | null; stale: boolean; updatedAt: string; }>();
  const CLINIC_ETA_CACHE_TTL = 60_000;

  function haversineDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3958.8;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  app.get("/api/clinic/active-trips", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.role !== "CLINIC_USER") return res.status(403).json({ message: "Access denied: clinic users only" });
      if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

      const clinic = await storage.getClinic(user.clinicId);
      if (!clinic) return res.status(404).json({ message: "Clinic not found" });

      const ACTIVE_STATUSES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF"];
      const STALE_THRESHOLD_MS = 90 * 1000;

      const clinicTrips = await db.select().from(trips).where(
        and(
          eq(trips.clinicId, user.clinicId),
          inArray(trips.status, ACTIVE_STATUSES),
          isNull(trips.deletedAt),
        )
      );

      const result = await Promise.all(clinicTrips.map(async (trip) => {
        const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;
        let driverData: any = null;
        let driverStale = false;
        let driverLastLat: number | null = null;
        let driverLastLng: number | null = null;
        let driverLastSeenAt: string | null = null;

        if (trip.driverId) {
          const driver = await storage.getDriver(trip.driverId);
          if (driver) {
            driverLastLat = driver.lastLat ?? null;
            driverLastLng = driver.lastLng ?? null;
            try {
              const { getDriverLocationFromCache } = await import("./lib/driverLocationIngest");
              const cached = getDriverLocationFromCache(driver.id);
              if (cached) { driverLastLat = cached.lat; driverLastLng = cached.lng; }
            } catch {}
            driverLastSeenAt = driver.lastSeenAt ? new Date(driver.lastSeenAt).toISOString() : null;
            const lastSeenMs = driver.lastSeenAt ? Date.now() - new Date(driver.lastSeenAt).getTime() : Infinity;
            driverStale = lastSeenMs > STALE_THRESHOLD_MS;
            const vehicle = driver.vehicleId ? await storage.getVehicle(driver.vehicleId) : null;
            driverData = {
              id: driver.id,
              firstName: driver.firstName,
              lastName: driver.lastName,
              phone: driver.phone,
              lastLat: driverLastLat,
              lastLng: driverLastLng,
              lastSeenAt: driverLastSeenAt,
              stale: driverStale,
              vehicleColor: vehicle?.color || null,
              vehicleLabel: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
            };
          }
        }

        let etaToClinic: number | null = null;
        let etaUpdatedAt: string | null = null;
        let etaStale = true;

        if (clinic.lat && clinic.lng && driverLastLat && driverLastLng && !driverStale) {
          const cacheEntry = clinicEtaCache.get(trip.id);
          const now = Date.now();
          if (cacheEntry && (now - new Date(cacheEntry.updatedAt).getTime()) < CLINIC_ETA_CACHE_TTL) {
            etaToClinic = cacheEntry.eta;
            etaUpdatedAt = cacheEntry.updatedAt;
            etaStale = cacheEntry.stale;
          } else {
            try {
              const { googleDistanceMatrix } = await import("./lib/googleMaps");
              const dmResult = await googleDistanceMatrix(
                { lat: driverLastLat, lng: driverLastLng },
                [{ lat: clinic.lat, lng: clinic.lng }]
              );
              const el = dmResult.elements[0];
              if (el && el.status === "OK") {
                etaToClinic = Math.round(el.durationSeconds / 60);
              } else {
                const dist = haversineDistanceMiles(driverLastLat, driverLastLng, clinic.lat, clinic.lng);
                etaToClinic = Math.round((dist / 25) * 60);
              }
              etaUpdatedAt = new Date().toISOString();
              etaStale = false;
              clinicEtaCache.set(trip.id, { eta: etaToClinic, stale: false, updatedAt: etaUpdatedAt });
            } catch {
              const dist = haversineDistanceMiles(driverLastLat, driverLastLng, clinic.lat, clinic.lng);
              etaToClinic = Math.round((dist / 25) * 60);
              etaUpdatedAt = new Date().toISOString();
              etaStale = false;
              clinicEtaCache.set(trip.id, { eta: etaToClinic, stale: false, updatedAt: etaUpdatedAt });
            }
          }
        } else if (driverStale) {
          etaToClinic = null;
          etaStale = true;
          etaUpdatedAt = null;
        }

        return {
          tripId: trip.id,
          publicId: trip.publicId,
          status: trip.status,
          approvalStatus: trip.approvalStatus,
          scheduledDate: trip.scheduledDate,
          pickupTime: trip.pickupTime,
          pickupAddress: trip.pickupAddress,
          dropoffAddress: trip.dropoffAddress,
          pickupLat: trip.pickupLat,
          pickupLng: trip.pickupLng,
          dropoffLat: trip.dropoffLat,
          dropoffLng: trip.dropoffLng,
          tripType: trip.tripType,
          routePolyline: trip.routePolyline || null,
          lastEtaMinutes: trip.lastEtaMinutes ?? null,
          distanceMiles: trip.distanceMiles ? Number(trip.distanceMiles) : null,
          lastEtaUpdatedAt: trip.lastEtaUpdatedAt ? new Date(trip.lastEtaUpdatedAt).toISOString() : null,
          patient: patient ? {
            id: patient.id,
            firstName: patient.firstName,
            lastName: patient.lastName,
            phone: patient.phone,
          } : null,
          driver: driverData,
          etaToClinic: etaToClinic,
          etaUpdatedAt: etaUpdatedAt,
          stale: driverStale,
        };
      }));

      res.json({
        ok: true,
        clinic: { id: clinic.id, name: clinic.name, lat: clinic.lat, lng: clinic.lng, address: clinic.address },
        trips: result,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.get("/api/clinic/metrics", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

      const now = new Date();
      const endDate = req.query.endDate as string || now.toISOString().split("T")[0];
      const startDefault = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];
      const startDate = req.query.startDate as string || startDefault;

      const clinicTrips = await db.select().from(trips).where(
        and(
          eq(trips.clinicId, user.clinicId),
          isNull(trips.deletedAt),
          gte(trips.scheduledDate, startDate),
          sql`${trips.scheduledDate} <= ${endDate}`,
        )
      );

      const total = clinicTrips.length;
      const completed = clinicTrips.filter(t => t.status === "COMPLETED");
      const cancelled = clinicTrips.filter(t => t.status === "CANCELLED");
      const noShows = clinicTrips.filter(t => t.status === "NO_SHOW");

      let totalDelayMinutes = 0;
      let delayCount = 0;
      let onTimeCount = 0;

      for (const trip of completed) {
        if (trip.lastEtaMinutes != null && trip.estimatedArrivalTime) {
          const [h, m] = trip.estimatedArrivalTime.split(":").map(Number);
          if (!isNaN(h) && !isNaN(m)) {
            if (trip.completedAt) {
              const completedTime = new Date(trip.completedAt);
              const targetTime = new Date(completedTime);
              targetTime.setHours(h, m, 0, 0);
              const delayMin = (completedTime.getTime() - targetTime.getTime()) / 60000;
              if (delayMin > 0) {
                totalDelayMinutes += delayMin;
                delayCount++;
              } else {
                onTimeCount++;
              }
            } else {
              onTimeCount++;
            }
          }
        } else {
          onTimeCount++;
        }
      }

      const onTimeRate = completed.length > 0 ? Math.round((onTimeCount / completed.length) * 100) : 100;
      const avgDelayMinutes = delayCount > 0 ? Math.round(totalDelayMinutes / delayCount) : 0;
      const noShowRate = total > 0 ? Math.round((noShows.length / total) * 100) : 0;
      const cancellationRate = total > 0 ? Math.round((cancelled.length / total) * 100) : 0;

      const dayMap: Record<string, { total: number; completed: number; late: number; noShows: number }> = {};
      for (const trip of clinicTrips) {
        if (!dayMap[trip.scheduledDate]) dayMap[trip.scheduledDate] = { total: 0, completed: 0, late: 0, noShows: 0 };
        dayMap[trip.scheduledDate].total++;
        if (trip.status === "COMPLETED") dayMap[trip.scheduledDate].completed++;
        if (trip.status === "NO_SHOW") dayMap[trip.scheduledDate].noShows++;
      }

      const dailyData = Object.entries(dayMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, data]) => ({ date, ...data }));
      const daysInRange = Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1);
      const tripsPerDay = Math.round((total / daysInRange) * 10) / 10;

      const recurringTrips = clinicTrips.filter(t => t.tripType === "dialysis" || t.tripType === "recurring" || t.tripSeriesId);
      const recurringCompleted = recurringTrips.filter(t => t.status === "COMPLETED");
      const recurringReliability = recurringTrips.length > 0 ? Math.round((recurringCompleted.length / recurringTrips.length) * 100) : 100;

      let busiestDay = "";
      let busiestCount = 0;
      for (const [date, data] of Object.entries(dayMap)) {
        if (data.total > busiestCount) { busiestCount = data.total; busiestDay = date; }
      }

      res.json({
        ok: true,
        period: { startDate, endDate },
        metrics: {
          totalTrips: total,
          completedTrips: completed.length,
          cancelledTrips: cancelled.length,
          noShowTrips: noShows.length,
          onTimeRate,
          avgDelayMinutes,
          noShowRate,
          cancellationRate,
          tripsPerDay,
          recurringReliability,
          busiestDay,
          busiestDayCount: busiestCount,
        },
        dailyData,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.get("/api/clinic/map", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

      const CLINIC_MAP_STATUSES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF"];
      const PRESENCE_TIMEOUT = 120_000;

      const clinicTrips = await db.select().from(trips).where(
        and(
          eq(trips.clinicId, user.clinicId),
          inArray(trips.status, CLINIC_MAP_STATUSES),
          isNull(trips.deletedAt),
        )
      );

      const result = await Promise.all(clinicTrips.map(async (trip) => {
        let driverData = null;
        if (trip.driverId) {
          const driver = await storage.getDriver(trip.driverId);
          if (driver) {
            const lastSeenMs = driver.lastSeenAt ? Date.now() - new Date(driver.lastSeenAt).getTime() : Infinity;
            const isOnline = lastSeenMs < PRESENCE_TIMEOUT
              && driver.dispatchStatus !== "off"
              && driver.dispatchStatus !== "hold";
            const vehicle = driver.vehicleId ? await storage.getVehicle(driver.vehicleId) : null;
            let cachedLat2 = driver.lastLat;
            let cachedLng2 = driver.lastLng;
            try {
              const { getDriverLocationFromCache } = await import("./lib/driverLocationIngest");
              const cached = getDriverLocationFromCache(driver.id);
              if (cached) { cachedLat2 = cached.lat; cachedLng2 = cached.lng; }
            } catch {}
            driverData = {
              id: driver.id,
              firstName: driver.firstName,
              lastName: driver.lastName,
              lastLat: cachedLat2,
              lastLng: cachedLng2,
              lastSeenAt: driver.lastSeenAt,
              dispatchStatus: driver.dispatchStatus,
              isOnline,
              vehicleColor: vehicle?.color || null,
              vehicleLabel: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
            };
          }
        }

        const driverVisible = trip.lastEtaMinutes != null && trip.lastEtaMinutes < 15;

        return {
          tripId: trip.id,
          publicId: trip.publicId,
          status: trip.status,
          pickupLat: trip.pickupLat,
          pickupLng: trip.pickupLng,
          pickupAddress: trip.pickupAddress,
          dropoffLat: trip.dropoffLat,
          dropoffLng: trip.dropoffLng,
          dropoffAddress: trip.dropoffAddress,
          scheduledDate: trip.scheduledDate,
          pickupTime: trip.pickupTime,
          driverVisible,
          driver: driverData ? {
            ...driverData,
            lastLat: driverVisible ? driverData.lastLat : null,
            lastLng: driverVisible ? driverData.lastLng : null,
          } : null,
          eta: trip.lastEtaMinutes != null ? {
            minutes: trip.lastEtaMinutes,
            updatedAt: trip.lastEtaUpdatedAt?.toISOString() || null,
          } : null,
        };
      }));

      res.json({ ok: true, trips: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.get("/api/clinic/trips/export", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user || !user.clinicId) {
        return res.status(403).json({ message: "No clinic linked to this account" });
      }

      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate query params required (YYYY-MM-DD)" });
      }

      const conditions: any[] = [
        eq(trips.clinicId, user.clinicId),
        isNull(trips.deletedAt),
        gte(trips.scheduledDate, startDate),
      ];
      conditions.push(sql`${trips.scheduledDate} <= ${endDate}`);

      const result = await db.select().from(trips).where(and(...conditions)).orderBy(trips.scheduledDate);
      const enriched = await enrichTripsWithRelations(result);

      const csvHeader = "Trip ID,Date,Pickup Time,Patient,Pickup Address,Dropoff Address,Status,Driver,ETA (min),Mileage\n";
      const csvRows = enriched.map((t: any) => {
        const fields = [
          t.publicId || "",
          t.scheduledDate || "",
          t.pickupTime || "",
          (t.patientName || "").replace(/,/g, " "),
          (t.pickupAddress || "").replace(/,/g, " "),
          (t.dropoffAddress || "").replace(/,/g, " "),
          t.status || "",
          (t.driverName || "").replace(/,/g, " "),
          t.lastEtaMinutes != null ? t.lastEtaMinutes : "",
          t.estimatedMiles != null ? t.estimatedMiles : "",
        ];
        return fields.join(",");
      });

      const csv = csvHeader + csvRows.join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=trips_${startDate}_to_${endDate}.csv`);
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clinic/trips", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

      const statusFilter = (req.query.status as string || "active").toLowerCase();
      const conditions: any[] = [
        eq(trips.clinicId, user.clinicId),
        isNull(trips.deletedAt),
      ];

      if (statusFilter === "today") {
        const todayDate = new Date().toISOString().split("T")[0];
        conditions.push(eq(trips.scheduledDate, todayDate));
      } else if (statusFilter === "active") {
        conditions.push(
          inArray(trips.status, ["SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"])
        );
      } else if (statusFilter === "live") {
        conditions.push(
          inArray(trips.status, ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"])
        );
      } else if (statusFilter === "scheduled") {
        conditions.push(inArray(trips.status, ["SCHEDULED", "ASSIGNED"]));
      } else if (statusFilter === "pending") {
        conditions.push(eq(trips.approvalStatus, "pending"));
        conditions.push(sql`${trips.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW')`);
      } else if (statusFilter === "completed") {
        conditions.push(inArray(trips.status, ["COMPLETED", "CANCELLED", "NO_SHOW"]));
      }

      const tripTypeFilter = req.query.tripType as string;
      if (tripTypeFilter === "recurring") {
        conditions.push(or(
          inArray(trips.tripType, ["recurring", "dialysis"]),
          sql`${trips.tripSeriesId} IS NOT NULL`
        )!);
      } else if (tripTypeFilter === "one_time") {
        conditions.push(eq(trips.tripType, "one_time"));
        conditions.push(isNull(trips.tripSeriesId));
      }

      const result = await db.select().from(trips).where(and(...conditions)).orderBy(desc(trips.createdAt));
      const enriched = await enrichTripsWithRelations(result);
      const sanitized = enriched.map((t: any) => {
        const { routePolyline, lastEtaMinutes, distanceMiles, lastEtaUpdatedAt, ...rest } = t;
        if (rest.driver) {
          const { lastLat, lastLng, lastLocationAt, ...driverRest } = rest.driver;
          rest.driver = driverRest;
        }
        return rest;
      });
      res.json(sanitized);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clinic/trips/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

      const tripId = parseInt(req.params.id);
      if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(tripId);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      if (trip.clinicId !== user.clinicId) return res.status(403).json({ message: "Access denied" });

      const [enriched] = await enrichTripsWithRelations([trip]);

      const clinicSafe = {
        id: enriched.id,
        publicId: enriched.publicId,
        clinicName: enriched.clinicName,
        patientName: enriched.patientName,
        scheduledDate: enriched.scheduledDate,
        pickupTime: enriched.pickupTime,
        estimatedArrivalTime: enriched.estimatedArrivalTime,
        pickupAddress: enriched.pickupAddress,
        pickupLat: enriched.pickupLat,
        pickupLng: enriched.pickupLng,
        dropoffAddress: enriched.dropoffAddress,
        dropoffLat: enriched.dropoffLat,
        dropoffLng: enriched.dropoffLng,
        distanceMiles: enriched.distanceMiles ? parseFloat(enriched.distanceMiles) : null,
        status: enriched.status,
        tripType: enriched.tripType,
        direction: enriched.direction,
        approvalStatus: enriched.approvalStatus,
        approvedAt: enriched.approvedAt,
        assignedAt: enriched.assignedAt,
        acceptedAt: enriched.acceptedAt,
        startedAt: enriched.startedAt,
        arrivedPickupAt: enriched.arrivedPickupAt,
        pickedUpAt: enriched.pickedUpAt,
        enRouteDropoffAt: enriched.enRouteDropoffAt,
        arrivedDropoffAt: enriched.arrivedDropoffAt,
        completedAt: enriched.completedAt,
        cancelledAt: enriched.cancelledAt,
        cancelledReason: enriched.cancelledReason,
        billingOutcome: enriched.billingOutcome,
        billingReason: enriched.billingReason,
        billingSetAt: enriched.billingSetAt,
        driverName: enriched.driverName,
        vehicleLabel: enriched.vehicleLabel,
        vehicleColor: enriched.vehicleColor,
        vehicleMake: enriched.vehicleMake,
        vehicleModel: enriched.vehicleModel,
        routePolyline: enriched.routePolyline,
        staticMapThumbUrl: enriched.staticMapThumbUrl,
        staticMapFullUrl: enriched.staticMapFullUrl,
        lastEtaMinutes: enriched.lastEtaMinutes,
        createdAt: enriched.createdAt,
      };

      res.json(clinicSafe);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clinic/trips/:id/pdf", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

      const tripId = parseInt(req.params.id);
      if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(tripId);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      if (trip.clinicId !== user.clinicId) return res.status(403).json({ message: "Access denied" });

      const [enriched] = await enrichTripsWithRelations([trip]);
      const clinic = trip.clinicId ? await storage.getClinic(trip.clinicId) : null;
      const clinicName = clinic?.name || "Unknown Clinic";

      const formatPdfTime = (isoStr: string | Date | null | undefined): string => {
        if (!isoStr) return "N/A";
        try {
          const d = new Date(isoStr);
          if (isNaN(d.getTime())) return "N/A";
          return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
        } catch { return "N/A"; }
      };

      const formatPdfDate = (dateStr: string | null | undefined): string => {
        if (!dateStr) return "N/A";
        try {
          const [y, m, d] = dateStr.split("-").map(Number);
          return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
        } catch { return dateStr || "N/A"; }
      };

      let onsiteMinutes: number | null = null;
      if (trip.arrivedPickupAt && trip.completedAt) {
        onsiteMinutes = Math.round((new Date(trip.completedAt).getTime() - new Date(trip.arrivedPickupAt).getTime()) / 60000);
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="trip-${enriched.publicId || trip.id}.pdf"`);

      const doc = new PDFDocument({ margin: 50, size: "LETTER" });
      doc.pipe(res);

      doc.fontSize(18).text("TRIP REPORT", { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor("#666").text("United Care Mobility", { align: "center" });
      doc.moveDown(1);

      doc.fillColor("#000").fontSize(12).text(formatPdfDate(trip.scheduledDate), { align: "left" });
      doc.fontSize(10).text(`Trip ID: ${enriched.publicId || trip.id}`);
      doc.text(`Clinic: ${clinicName}`);
      if (enriched.patientName) doc.text(`Patient: ${enriched.patientName}`);

      const outcomeLabel = trip.status === "COMPLETED" ? "Completed" : trip.status === "NO_SHOW" ? "No Show" : trip.status === "CANCELLED" ? "Cancelled" : trip.status;
      doc.text(`Outcome: ${outcomeLabel}`);
      if (trip.billingOutcome) doc.text(`Billing: ${trip.billingOutcome}`);
      if (trip.billingReason) doc.text(`Reason: ${trip.billingReason}`);
      doc.moveDown(1);

      doc.moveTo(50, doc.y).lineTo(560, doc.y).stroke("#ddd");
      doc.moveDown(0.5);

      doc.fontSize(12).fillColor("#000").text("Route");
      doc.moveDown(0.3);
      doc.fontSize(10);
      doc.text(`Pickup (A): ${trip.pickupAddress || "N/A"}`);
      doc.text(`Dropoff (B): ${trip.dropoffAddress || "N/A"}`);
      if (trip.distanceMiles) doc.text(`Distance: ${parseFloat(trip.distanceMiles as string).toFixed(1)} miles`);
      doc.moveDown(0.8);

      if (trip.staticMapFullUrl || trip.staticMapThumbUrl) {
        try {
          const mapUrl = trip.staticMapFullUrl || trip.staticMapThumbUrl;
          const mapResponse = await fetch(mapUrl as string);
          if (mapResponse.ok) {
            const mapBuffer = Buffer.from(await mapResponse.arrayBuffer());
            doc.image(mapBuffer, { width: 400, align: "center" });
            doc.moveDown(0.5);
          }
        } catch { /* skip map image if fetch fails */ }
      }

      doc.moveTo(50, doc.y).lineTo(560, doc.y).stroke("#ddd");
      doc.moveDown(0.5);

      doc.fontSize(12).fillColor("#000").text("Timeline");
      doc.moveDown(0.3);
      doc.fontSize(10);

      const pdfEvents: { label: string; time: string; reason?: string }[] = [];
      if (trip.pickupTime) {
        const formatPickupTime = (t: string) => {
          try { const [h,m] = t.split(":").map(Number); const d = new Date(2000,0,1,h,m); return d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true}); } catch { return t; }
        };
        pdfEvents.push({ label: "Scheduled Pickup", time: formatPickupTime(trip.pickupTime) });
      }
      if (trip.createdAt) pdfEvents.push({ label: "Created", time: formatPdfTime(trip.createdAt) });
      if (trip.approvedAt) pdfEvents.push({ label: "Approved", time: formatPdfTime(trip.approvedAt) });
      if (trip.assignedAt) pdfEvents.push({ label: "Assigned to Driver", time: formatPdfTime(trip.assignedAt) });
      if (enriched.acceptedAt) pdfEvents.push({ label: "Driver Accepted", time: formatPdfTime(enriched.acceptedAt) });
      if (trip.startedAt) pdfEvents.push({ label: "En Route to Pickup", time: formatPdfTime(trip.startedAt) });
      if (trip.arrivedPickupAt) pdfEvents.push({ label: "Arrived at Pickup", time: formatPdfTime(trip.arrivedPickupAt) });
      if (trip.pickedUpAt) pdfEvents.push({ label: "Picked Up", time: formatPdfTime(trip.pickedUpAt) });
      if (trip.enRouteDropoffAt) pdfEvents.push({ label: "En Route to Dropoff", time: formatPdfTime(trip.enRouteDropoffAt) });
      if (trip.arrivedDropoffAt) pdfEvents.push({ label: "Arrived at Dropoff", time: formatPdfTime(trip.arrivedDropoffAt) });
      if (trip.completedAt && trip.status !== "CANCELLED" && trip.status !== "NO_SHOW") pdfEvents.push({ label: "Completed", time: formatPdfTime(trip.completedAt) });
      if (trip.cancelledAt && trip.status === "CANCELLED") pdfEvents.push({ label: "Cancelled", time: formatPdfTime(trip.cancelledAt), reason: trip.cancelledReason || undefined });
      if (trip.cancelledAt && trip.status === "NO_SHOW") pdfEvents.push({ label: "No-Show", time: formatPdfTime(trip.cancelledAt), reason: trip.cancelledReason || undefined });
      if (trip.billingOutcome === "company_error" && trip.billingSetAt) pdfEvents.push({ label: "Company Error", time: formatPdfTime(trip.billingSetAt), reason: trip.billingReason || undefined });

      for (const evt of pdfEvents) {
        doc.text(`${evt.label}: ${evt.time}`);
        if (evt.reason) doc.fillColor("#666").text(`  Reason: ${evt.reason}`).fillColor("#000");
      }

      if (onsiteMinutes != null) { doc.moveDown(0.3); doc.text(`On-Site Duration: ${onsiteMinutes} min`); }
      let transportMinutes: number | null = null;
      if (trip.pickedUpAt && trip.arrivedDropoffAt) {
        transportMinutes = Math.round((new Date(trip.arrivedDropoffAt).getTime() - new Date(trip.pickedUpAt).getTime()) / 60000);
      }
      if (transportMinutes != null) doc.text(`Transport Duration: ${transportMinutes} min`);
      doc.moveDown(0.8);

      doc.moveTo(50, doc.y).lineTo(560, doc.y).stroke("#ddd");
      doc.moveDown(0.5);

      doc.fontSize(12).fillColor("#000").text("Driver & Vehicle");
      doc.moveDown(0.3);
      doc.fontSize(10);
      doc.text(`Driver: ${enriched.driverName || "Unassigned"}`);
      if (enriched.vehicleLabel) doc.text(`Vehicle: ${enriched.vehicleLabel}`);
      if (enriched.vehicleColor) doc.text(`Color: ${enriched.vehicleColor}`);
      doc.moveDown(1);

      doc.fontSize(8).fillColor("#999").text(`Generated: ${new Date().toLocaleString("en-US")}`, { align: "center" });

      doc.end();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clinic/trips/:id/tracking", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!user.clinicId) return res.status(403).json({ message: "No clinic linked to this account" });

      const tripId = parseInt(req.params.id);
      if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });
      const trip = await storage.getTrip(tripId);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      if (trip.clinicId !== user.clinicId) {
        return res.status(403).json({ message: "You can only track your clinic's trips" });
      }

      const terminalStatuses = ["COMPLETED", "CANCELLED", "NO_SHOW"];
      if (terminalStatuses.includes(trip.status)) {
        return res.json({
          ok: true,
          tripId: trip.id,
          status: trip.status,
          completed: true,
          driver: null,
          route: null,
        });
      }

      const driver = trip.driverId ? await storage.getDriver(trip.driverId) : null;
      const vehicle = driver?.vehicleId ? await storage.getVehicle(driver.vehicleId) : null;

      const driverVisible = trip.lastEtaMinutes != null && trip.lastEtaMinutes < 15;

      let driverLat = driver?.lastLat ?? null;
      let driverLng = driver?.lastLng ?? null;
      if (driver) {
        try {
          const { getDriverLocationFromCache } = await import("./lib/driverLocationIngest");
          const cached = getDriverLocationFromCache(driver.id);
          if (cached) {
            driverLat = cached.lat;
            driverLng = cached.lng;
          }
        } catch {}
      }

      const driverData = driver ? {
        id: driver.id,
        name: `${driver.firstName} ${driver.lastName}`,
        phone: driver.phone,
        lat: driverVisible ? driverLat : null,
        lng: driverVisible ? driverLng : null,
        lastSeenAt: driver.lastSeenAt,
        connected: driver.lastSeenAt ? (Date.now() - new Date(driver.lastSeenAt).getTime()) < 120000 : false,
        vehicleLabel: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
        vehicleColor: vehicle?.color || null,
        vehicleMake: vehicle?.make || null,
        vehicleModel: vehicle?.model || null,
        driverVisible,
      } : null;

      const routeData = {
        pickupAddress: trip.pickupAddress,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        dropoffAddress: trip.dropoffAddress,
        dropoffLat: trip.dropoffLat,
        dropoffLng: trip.dropoffLng,
        etaMinutes: trip.lastEtaMinutes,
        distanceMiles: trip.distanceMiles ? Number(trip.distanceMiles) : null,
        routePolyline: trip.routePolyline || null,
      };

      res.json({
        ok: true,
        tripId: trip.id,
        publicId: trip.publicId,
        status: trip.status,
        scheduledDate: trip.scheduledDate,
        pickupTime: trip.pickupTime,
        completed: false,
        driverVisible,
        driver: driverData,
        route: routeData,
      });
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

  app.get("/api/trips/:id/invoice", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER"), async (req: AuthRequest, res) => {
    try {
      const tripId = parseInt(req.params.id);
      if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });

      const trip = await storage.getTrip(tripId);
      if (!trip) return res.status(404).json({ message: "Trip not found" });

      if (req.user!.companyId && trip.companyId && req.user!.companyId !== trip.companyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (req.user!.role === "CLINIC_USER") {
        const user = await storage.getUser(req.user!.userId);
        if (!user?.clinicId || user.clinicId !== trip.clinicId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      let invoice = trip.invoiceId ? await storage.getInvoice(trip.invoiceId) : null;
      if (!invoice) {
        invoice = (await storage.getInvoiceByTripId(tripId)) || null;
        if (invoice && !trip.invoiceId) {
          await storage.updateTrip(trip.id, { invoiceId: invoice.id });
        }
      }
      res.json({ invoice });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/trips/:id/invoice", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const tripId = parseInt(req.params.id);
      if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });

      const trip = await storage.getTrip(tripId);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      if (trip.status !== "COMPLETED") {
        return res.status(400).json({ message: "Invoice can only be created for completed trips" });
      }

      if (req.user!.companyId && trip.companyId && req.user!.companyId !== trip.companyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const existing = await storage.getInvoiceByTripId(tripId);
      if (existing) {
        return res.status(409).json({ message: "Invoice already exists for this trip", invoice: existing });
      }

      const { amount, notes } = req.body;
      if (!amount || isNaN(parseFloat(amount))) {
        return res.status(400).json({ message: "Valid amount is required" });
      }

      let tripClinicId = trip.clinicId;
      if (!tripClinicId) {
        const { getDefaultPrivateClinicId } = await import("./lib/defaultClinic");
        tripClinicId = await getDefaultPrivateClinicId(trip.cityId);
        await storage.updateTrip(trip.id, { clinicId: tripClinicId } as any);
      }

      const patient = await storage.getPatient(trip.patientId);
      const patientName = patient ? `${patient.firstName} ${patient.lastName}` : "Unknown";

      const invoice = await storage.createInvoice({
        clinicId: tripClinicId,
        tripId: trip.id,
        patientName,
        serviceDate: trip.scheduledDate,
        amount: parseFloat(amount).toFixed(2),
        status: "pending",
        notes: notes || null,
      });

      await storage.updateTrip(trip.id, { invoiceId: invoice.id });

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "invoice_created",
        entity: "trip",
        entityId: trip.id,
        details: `Invoice #${invoice.id} created for trip #${trip.publicId}, amount: $${parseFloat(amount).toFixed(2)}${notes ? `, notes: ${notes}` : ""}`,
        cityId: trip.cityId,
      });

      if (patient?.email && (patient.source === "private" || patient.source === "internal")) {
        try {
          await db.update(invoices).set({ emailTo: patient.email }).where(eq(invoices.id, invoice.id));
          const { sendInvoicePaymentEmail } = await import("./services/invoiceEmailService");
          const emailResult = await sendInvoicePaymentEmail(invoice.id);
          if (emailResult.success) {
            console.log(`[Invoice] Auto-sent payment email for invoice #${invoice.id} to ${patient.email}`);
          } else {
            console.error(`[Invoice] Auto-send failed for invoice #${invoice.id}:`, emailResult.error);
          }
        } catch (emailErr: any) {
          console.error("[Invoice] Auto-send email error:", emailErr.message);
        }
      }

      const updatedInvoice = await storage.getInvoice(invoice.id);
      res.status(201).json(updatedInvoice || invoice);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/invoices/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      if (invoice.tripId && req.user!.companyId) {
        const trip = await storage.getTrip(invoice.tripId);
        if (trip && trip.companyId && req.user!.companyId !== trip.companyId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      if (invoice.status === "paid") {
        return res.status(400).json({ message: "Cannot edit a paid invoice" });
      }

      const { amount, status, notes } = req.body;
      const updateData: any = {};
      if (amount !== undefined) {
        if (isNaN(parseFloat(amount))) return res.status(400).json({ message: "Invalid amount" });
        updateData.amount = parseFloat(amount).toFixed(2);
      }
      if (status !== undefined) {
        const validStatuses = ["pending", "approved", "paid"];
        if (!validStatuses.includes(status)) return res.status(400).json({ message: "Invalid status. Must be: pending, approved, or paid" });
        updateData.status = status;
      }
      if (notes !== undefined) {
        updateData.notes = notes || null;
      }

      const updated = await storage.updateInvoice(invoiceId, updateData);

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "invoice_updated",
        entity: "invoice",
        entityId: invoiceId,
        details: `Invoice updated${amount ? `, amount: $${parseFloat(amount).toFixed(2)}` : ""}${status ? `, status: ${status}` : ""}${notes !== undefined ? `, notes: ${notes || "(cleared)"}` : ""}`,
        cityId: null,
      });

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/invoices/:id/mark-paid", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      if (invoice.tripId && req.user!.companyId) {
        const trip = await storage.getTrip(invoice.tripId);
        if (trip && trip.companyId && req.user!.companyId !== trip.companyId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      if (invoice.status === "paid") {
        return res.status(400).json({ message: "Invoice is already marked as paid" });
      }

      const updated = await storage.updateInvoice(invoiceId, { status: "paid" } as any);

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "MARK_INVOICE_PAID",
        entity: "invoice",
        entityId: invoiceId,
        details: `Invoice marked as paid, amount: $${invoice.amount}`,
        cityId: null,
      });

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/invoices/:id/pdf", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER"), async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      if (req.user!.role === "CLINIC_USER") {
        const user = await storage.getUser(req.user!.userId);
        if (!user?.clinicId || user.clinicId !== invoice.clinicId) {
          return res.status(403).json({ message: "Access denied" });
        }
      } else if (req.user!.companyId && invoice.tripId) {
        const trip = await storage.getTrip(invoice.tripId);
        if (trip && trip.companyId && req.user!.companyId !== trip.companyId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const clinic = await storage.getClinic(invoice.clinicId);
      const clinicName = clinic?.name || "Unknown Clinic";

      let tripData: any = null;
      if (invoice.tripId) {
        tripData = await storage.getTrip(invoice.tripId);
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.id}.pdf"`);

      const doc = new PDFDocument({ margin: 50, size: "LETTER" });
      doc.pipe(res);

      doc.fontSize(20).text("INVOICE", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor("#666").text("United Care Mobility", { align: "center" });
      doc.moveDown(1);

      doc.fillColor("#000").fontSize(11);
      doc.text(`Invoice #: ${invoice.id}`);
      doc.text(`Clinic: ${clinicName}`);
      doc.text(`Patient: ${invoice.patientName}`);
      doc.text(`Service Date: ${invoice.serviceDate}`);
      doc.text(`Status: ${invoice.status.toUpperCase()}`);
      doc.text(`Generated: ${new Date(invoice.createdAt).toLocaleDateString()}`);
      if (invoice.notes) {
        doc.text(`Notes: ${invoice.notes}`);
      }
      doc.moveDown(1);

      if (tripData) {
        doc.fontSize(13).text("Trip Details", { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor("#000");
        doc.text(`Trip ID: ${tripData.publicId || tripData.id}`);
        doc.text(`Scheduled Date: ${tripData.scheduledDate || "N/A"}`);
        doc.text(`Pickup: ${tripData.pickupAddress || "N/A"}`);
        doc.text(`Dropoff: ${tripData.dropoffAddress || "N/A"}`);
        doc.text(`Pickup Time: ${tripData.pickupTime || "N/A"}`);
        doc.text(`Status: ${tripData.status}`);
        doc.moveDown(1);
      }

      doc.moveTo(50, doc.y).lineTo(560, doc.y).stroke("#ccc");
      doc.moveDown(0.5);
      doc.fontSize(14).fillColor("#000").text(`Total Amount: $${parseFloat(invoice.amount).toFixed(2)}`);

      doc.end();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/invoices/:id/send-email", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      if (req.user!.companyId && invoice.tripId) {
        const trip = await storage.getTrip(invoice.tripId);
        if (trip && trip.companyId && req.user!.companyId !== trip.companyId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      if (!invoice.emailTo) {
        if (invoice.tripId) {
          const trip = await storage.getTrip(invoice.tripId);
          if (trip?.patientId) {
            const patient = await storage.getPatient(trip.patientId);
            if (patient?.email) {
              await db.update(invoices).set({ emailTo: patient.email }).where(eq(invoices.id, invoiceId));
            } else {
              return res.status(400).json({ message: "Patient has no email address. Please add an email to the patient record first." });
            }
          } else {
            return res.status(400).json({ message: "No patient email found for this invoice." });
          }
        } else {
          return res.status(400).json({ message: "No email address on invoice and no linked trip to look up patient email." });
        }
      }

      const { sendInvoicePaymentEmail } = await import("./services/invoiceEmailService");
      const result = await sendInvoicePaymentEmail(invoiceId);

      if (!result.success) {
        return res.status(500).json({ message: result.error || "Failed to send email" });
      }

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "SEND_INVOICE_EMAIL",
        entityType: "invoice",
        entityId: String(invoiceId),
        details: `Invoice email sent to ${invoice.emailTo}`,
        ipAddress: req.ip || null,
      });

      res.json({ success: true, paymentLink: result.paymentLink });
    } catch (err: any) {
      console.error("[Routes] send-email error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/billing/weekly", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
      const companyId = req.user!.companyId;
      let result: any[];
      if (companyId) {
        const allWeekly = await storage.getWeeklyInvoices(clinicId);
        const clinicIds = (await storage.getClinics()).filter((c: any) => c.companyId === companyId).map((c: any) => c.id);
        result = allWeekly.filter((inv: any) => clinicIds.includes(inv.clinicId));
      } else {
        result = await storage.getWeeklyInvoices(clinicId);
      }

      const enriched = await Promise.all(result.map(async (inv: any) => {
        const linkedTrips = await storage.getTripsByInvoiceId(inv.id);
        const clinic = await storage.getClinic(inv.clinicId);
        return { ...inv, tripCount: linkedTrips.length, clinicName: clinic?.name || "Unknown" };
      }));

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/billing/weekly/preview", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(req.query.clinic_id as string);
      const startDate = req.query.start_date as string;
      const endDate = req.query.end_date as string;
      if (isNaN(clinicId) || !startDate || !endDate) {
        return res.status(400).json({ message: "clinic_id, start_date, and end_date are required" });
      }
      const companyId = req.user!.companyId || null;
      const uninvoicedTrips = await storage.getUninvoicedCompletedTrips(clinicId, startDate, endDate, companyId);
      const patients = new Map<number, any>();
      for (const t of uninvoicedTrips) {
        if (!patients.has(t.patientId)) {
          const p = await storage.getPatient(t.patientId);
          if (p) patients.set(t.patientId, p);
        }
      }
      const tripsWithPatient = uninvoicedTrips.map((t: any) => {
        const p = patients.get(t.patientId);
        return { ...t, patientName: p ? `${p.firstName} ${p.lastName}` : "Unknown" };
      });
      res.json({ trips: tripsWithPatient, count: tripsWithPatient.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/billing/weekly/generate", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { clinicId, startDate, endDate, amount } = req.body;
      if (!clinicId || !startDate || !endDate || amount === undefined) {
        return res.status(400).json({ message: "clinicId, startDate, endDate, and amount are required" });
      }
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        return res.status(400).json({ message: "Invalid amount" });
      }

      const companyId = req.user!.companyId || null;
      const uninvoicedTrips = await storage.getUninvoicedCompletedTrips(parseInt(clinicId), startDate, endDate, companyId);
      if (uninvoicedTrips.length === 0) {
        return res.status(400).json({ message: "No uninvoiced completed trips found for this clinic and date range" });
      }

      const clinic = await storage.getClinic(parseInt(clinicId));
      const clinicName = clinic?.name || "Unknown Clinic";
      const rangeLabel = `${startDate} to ${endDate}`;

      const invoice = await storage.createInvoice({
        clinicId: parseInt(clinicId),
        tripId: null as any,
        patientName: `Weekly: ${clinicName}`,
        serviceDate: rangeLabel,
        amount: parsedAmount.toFixed(2),
        status: "pending",
        notes: `Weekly invoice for ${clinicName}, ${rangeLabel}, ${uninvoicedTrips.length} trips`,
      });

      const tripIds = uninvoicedTrips.map((t: any) => t.id);
      await storage.linkTripsToInvoice(tripIds, invoice.id);

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "CREATE_WEEKLY_INVOICE",
        entity: "invoice",
        entityId: invoice.id,
        details: `Weekly invoice created for ${clinicName}, ${rangeLabel}, ${uninvoicedTrips.length} trips, amount: $${parsedAmount.toFixed(2)}`,
        cityId: null,
      });

      res.status(201).json({ invoice, tripCount: uninvoicedTrips.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/billing/weekly/:id/trips", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      if (req.user!.companyId) {
        const clinic = await storage.getClinic(invoice.clinicId);
        if (clinic && clinic.companyId && req.user!.companyId !== clinic.companyId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const linkedTrips = await storage.getTripsByInvoiceId(invoiceId);
      const patients = new Map<number, any>();
      for (const t of linkedTrips) {
        if (!patients.has(t.patientId)) {
          const p = await storage.getPatient(t.patientId);
          if (p) patients.set(t.patientId, p);
        }
      }
      const tripsWithPatient = linkedTrips.map((t: any) => {
        const p = patients.get(t.patientId);
        return { ...t, patientName: p ? `${p.firstName} ${p.lastName}` : "Unknown" };
      });

      const clinic = await storage.getClinic(invoice.clinicId);

      res.json({
        invoice,
        clinic: clinic ? { id: clinic.id, name: clinic.name } : null,
        trips: tripsWithPatient,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/billing/weekly/:id/pdf", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      if (req.user!.companyId) {
        const clinic = await storage.getClinic(invoice.clinicId);
        if (clinic && clinic.companyId && req.user!.companyId !== clinic.companyId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const linkedTrips = await storage.getTripsByInvoiceId(invoiceId);
      const clinic = await storage.getClinic(invoice.clinicId);
      const clinicName = clinic?.name || "Unknown Clinic";

      const patients = new Map<number, any>();
      for (const t of linkedTrips) {
        if (!patients.has(t.patientId)) {
          const p = await storage.getPatient(t.patientId);
          if (p) patients.set(t.patientId, p);
        }
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.id}-weekly.pdf"`);

      const doc = new PDFDocument({ margin: 50, size: "LETTER" });
      doc.pipe(res);

      doc.fontSize(20).text("INVOICE", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor("#666").text("United Care Mobility", { align: "center" });
      doc.moveDown(1);

      doc.fillColor("#000").fontSize(11);
      doc.text(`Invoice #: ${invoice.id}`);
      doc.text(`Clinic: ${clinicName}`);
      doc.text(`Period: ${invoice.serviceDate}`);
      doc.text(`Status: ${invoice.status.toUpperCase()}`);
      doc.text(`Generated: ${new Date(invoice.createdAt).toLocaleDateString()}`);
      doc.moveDown(1);

      doc.fontSize(13).text("Trip Details", { underline: true });
      doc.moveDown(0.5);

      const tableTop = doc.y;
      const col = { num: 50, date: 80, patient: 180, pickup: 330 };
      doc.fontSize(9).fillColor("#444");
      doc.text("#", col.num, tableTop);
      doc.text("Date", col.date, tableTop);
      doc.text("Patient", col.patient, tableTop);
      doc.text("Pickup Address", col.pickup, tableTop);
      doc.moveTo(50, tableTop + 14).lineTo(560, tableTop + 14).stroke("#ccc");

      let y = tableTop + 20;
      doc.fillColor("#000").fontSize(9);
      linkedTrips.forEach((t: any, i: number) => {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        const p = patients.get(t.patientId);
        const patientName = p ? `${p.firstName} ${p.lastName}` : "Unknown";
        const pickup = (t.pickupAddress || "").substring(0, 40);
        doc.text(String(i + 1), col.num, y, { width: 25 });
        doc.text(t.scheduledDate || "", col.date, y, { width: 95 });
        doc.text(patientName, col.patient, y, { width: 145 });
        doc.text(pickup, col.pickup, y, { width: 230 });
        y += 16;
      });

      y += 10;
      if (y > 700) { doc.addPage(); y = 50; }
      doc.moveTo(50, y).lineTo(560, y).stroke("#ccc");
      y += 8;
      doc.fontSize(11).fillColor("#000");
      doc.text(`Total Trips: ${linkedTrips.length}`, 50, y);
      y += 16;
      doc.fontSize(13).text(`Total Amount: $${parseFloat(invoice.amount).toFixed(2)}`, 50, y);

      doc.end();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ops/driver-locations", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "VIEWER", "DRIVER"), async (req: AuthRequest, res) => {
    try {
      const role = req.user!.role;
      const userId = req.user!.userId;
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ message: "User not found" });

      const isDispatchLevel = ["SUPER_ADMIN", "ADMIN", "DISPATCH"].includes(role);
      const isClinicUser = role === "VIEWER" && user.clinicId != null;
      const isPatientUser = role === "VIEWER" && user.patientId != null && !user.clinicId;
      const isDriverUser = role === "DRIVER" && user.driverId != null;

      let allowedDriverIds: number[] | null = null;

      if (isDispatchLevel) {
        const cityId = parseInt(req.query.city_id as string);
        if (isNaN(cityId)) return res.status(400).json({ message: "city_id is required" });
        const hasAccess = await checkCityAccess(req, cityId);
        if (!hasAccess) return res.status(403).json({ message: "No access to this city" });

        const allDrivers = await storage.getDrivers(cityId);
        const allVehicles = await storage.getVehicles(cityId);
        const vehicleMap = new Map(allVehicles.map((v: any) => [v.id, v]));
        const activeDrivers = allDrivers.filter((d: any) => d.status === "ACTIVE");

        const todayStr = new Date().toISOString().split("T")[0];
        const allTrips = await storage.getTrips(cityId);
        const activeStatuses = ["SCHEDULED", "EN_ROUTE_PICKUP", "AT_PICKUP", "IN_TRANSIT", "AT_DROPOFF"];
        const driverTripMap = new Map<number, any>();
        for (const trip of allTrips) {
          if (trip.driverId && activeStatuses.includes(trip.status) && trip.scheduledDate === todayStr) {
            if (!driverTripMap.has(trip.driverId)) {
              driverTripMap.set(trip.driverId, trip);
            }
          }
        }

        const locations = activeDrivers
          .filter((d: any) => d.lastLat != null && d.lastLng != null)
          .map((d: any) => {
            const vehicle = d.vehicleId ? vehicleMap.get(d.vehicleId) : null;
            const activeTrip = driverTripMap.get(d.id);
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
              vehicle_color_hex: vehicle?.colorHex ?? null,
              vehicle_make: vehicle?.make ?? null,
              vehicle_model: vehicle?.model ?? null,
              active_trip_status: activeTrip?.status ?? null,
              active_trip_id: activeTrip?.publicId ?? null,
              active_trip_patient: activeTrip?.patientId ? `#${activeTrip.patientId}` : null,
            };
          });

        return res.json(locations);
      }

      if (isClinicUser) {
        const cityId = parseInt(req.query.city_id as string);
        if (isNaN(cityId)) return res.status(400).json({ message: "city_id is required" });
        allowedDriverIds = await storage.getActiveDriverIdsForClinic(cityId, user.clinicId!);
      } else if (isPatientUser) {
        const activeDriverId = await storage.getActiveDriverIdForPatient(user.patientId!);
        allowedDriverIds = activeDriverId ? [activeDriverId] : [];
      } else if (isDriverUser) {
        allowedDriverIds = [user.driverId!];
      } else {
        return res.status(403).json({ message: "No map access for this role" });
      }

      if (!allowedDriverIds || allowedDriverIds.length === 0) {
        return res.json([]);
      }

      const driverIds = new Set(allowedDriverIds);
      const cityId = parseInt(req.query.city_id as string);
      const driverCity = !isNaN(cityId) ? cityId : undefined;

      const allDrivers = driverCity
        ? await storage.getDrivers(driverCity)
        : await storage.getDrivers();
      const filteredDrivers = allDrivers.filter((d: any) => driverIds.has(d.id) && d.lastLat != null && d.lastLng != null);

      const vehicleCities = [...new Set(filteredDrivers.map((d: any) => d.cityId))];
      let allVehicles: any[] = [];
      for (const cid of vehicleCities) {
        allVehicles = allVehicles.concat(await storage.getVehicles(cid));
      }
      const vehicleMap = new Map(allVehicles.map((v: any) => [v.id, v]));

      const locations = filteredDrivers.map((d: any) => {
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
          vehicle_color_hex: vehicle?.colorHex ?? null,
          vehicle_make: vehicle?.make ?? null,
          vehicle_model: vehicle?.model ?? null,
        };
      });

      res.json(locations);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ops/my-active-trips", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "VIEWER", "DRIVER"), async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const role = req.user!.role;
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ message: "User not found" });

      const isClinicUser = role === "VIEWER" && user.clinicId != null;
      const isPatientUser = role === "VIEWER" && user.patientId != null && !user.clinicId;

      if (isClinicUser) {
        const cityId = parseInt(req.query.city_id as string);
        if (isNaN(cityId)) return res.status(400).json({ message: "city_id is required" });
        const activeTrips = await storage.getActiveTripsForClinic(cityId, user.clinicId!);
        const tripData = [];
        for (const trip of activeTrips) {
          let driverInfo = null;
          let patientInfo = null;
          if (trip.driverId) {
            const driver = await storage.getDriver(trip.driverId);
            if (driver) driverInfo = { id: driver.id, firstName: driver.firstName, lastName: driver.lastName };
          }
          if (trip.patientId) {
            const patient = await storage.getPatient(trip.patientId);
            if (patient) patientInfo = { id: patient.id, firstName: patient.firstName, lastName: patient.lastName };
          }
          tripData.push({
            id: trip.id,
            publicId: trip.publicId,
            status: trip.status,
            pickupAddress: trip.pickupAddress,
            pickupTime: trip.pickupTime,
            scheduledDate: trip.scheduledDate,
            driver: driverInfo,
            patient: patientInfo,
          });
        }
        return res.json({ role: "clinic", clinicId: user.clinicId, trips: tripData });
      }

      if (isPatientUser) {
        const trip = await storage.getActiveTripForPatient(user.patientId!);
        if (!trip) return res.json({ role: "patient", patientId: user.patientId, trip: null });
        let driverInfo = null;
        if (trip.driverId) {
          const driver = await storage.getDriver(trip.driverId);
          if (driver) driverInfo = { id: driver.id, firstName: driver.firstName, lastName: driver.lastName };
        }
        return res.json({
          role: "patient",
          patientId: user.patientId,
          trip: {
            id: trip.id,
            publicId: trip.publicId,
            status: trip.status,
            pickupAddress: trip.pickupAddress,
            pickupTime: trip.pickupTime,
            scheduledDate: trip.scheduledDate,
            driver: driverInfo,
          },
        });
      }

      return res.json({ role, trips: [] });
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

  app.get("/api/admin/archived", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const entity = req.query.entity as string;
      const role = (await storage.getUser(req.user!.userId))?.role;
      switch (entity) {
        case "clinics":
          if (role !== "SUPER_ADMIN") return res.status(403).json({ message: "Only super admin can view archived clinics" });
          return res.json(await storage.getArchivedClinics());
        case "drivers":
          return res.json(await storage.getArchivedDrivers());
        case "patients":
          return res.json(await storage.getArchivedPatients());
        case "users":
          if (role !== "SUPER_ADMIN") return res.status(403).json({ message: "Only super admin can view archived users" });
          return res.json(await storage.getArchivedUsers());
        case "trips":
          if (role !== "SUPER_ADMIN") return res.status(403).json({ message: "Only super admin can view archived trips" });
          return res.json(await storage.getArchivedTrips());
        case "vehicles":
          if (role !== "SUPER_ADMIN") return res.status(403).json({ message: "Only super admin can view archived vehicles" });
          return res.json(await storage.getArchivedVehicles());
        default:
          return res.status(400).json({ message: "Invalid entity type. Must be clinics, drivers, patients, users, trips, or vehicles" });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/clinics/:id/archive", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
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
  });

  app.patch("/api/admin/clinics/:id/restore", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
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
  });

  app.delete("/api/admin/clinics/:id/permanent", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
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
  });

  app.patch("/api/admin/drivers/:id/archive", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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
  });

  app.patch("/api/admin/drivers/:id/restore", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
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
  });

  app.delete("/api/admin/drivers/:id/permanent", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
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
  });

  app.patch("/api/admin/patients/:id/archive", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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
  });

  app.patch("/api/admin/patients/:id/restore", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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
  });

  app.delete("/api/admin/patients/:id/permanent", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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
  });

  app.patch("/api/admin/users/:id/archive", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

      const user = await storage.getUser(id);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (user.role === "SUPER_ADMIN") return res.status(400).json({ message: "Cannot archive super admin" });

      const reason = req.body?.reason || null;
      const updated = await storage.updateUser(id, { active: false, deletedAt: new Date(), deletedBy: req.user!.userId, deleteReason: reason } as any);

      // Ban Supabase auth user if exists
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
  });

  app.patch("/api/admin/users/:id/restore", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

      const user = await storage.getUser(id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const updated = await storage.updateUser(id, { active: true, deletedAt: null, deletedBy: null, deleteReason: null } as any);

      // Un-ban Supabase auth user if exists
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
  });

  app.delete("/api/admin/users/:id/permanent", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
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

      // Delete Supabase auth user if exists
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
  });

  app.post("/api/admin/users/:id/reset-password", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
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
          const { sendResetPasswordEmail } = await import("./services/emailService");
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
  });

  app.post("/api/admin/clinics/:id/reset-password", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(req.params.id);
      if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });

      const clinic = await storage.getClinic(clinicId);
      if (!clinic) return res.status(404).json({ message: "Clinic not found" });
      if (!clinic.email) return res.status(400).json({ message: "Clinic has no email address" });

      const clinicUser = await storage.getUserByClinicId(clinicId);
      if (!clinicUser) return res.status(404).json({ message: "No user account found for this clinic" });

      const { generateTempPassword } = await import("./lib/driverAuth");
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
        const { sendResetPasswordEmail } = await import("./services/emailService");
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
  });

  app.post("/api/admin/drivers/:id/reset-password", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const driverId = parseInt(req.params.id);
      if (isNaN(driverId)) return res.status(400).json({ message: "Invalid driver ID" });

      const driver = await storage.getDriver(driverId);
      if (!driver) return res.status(404).json({ message: "Driver not found" });
      if (!driver.email) return res.status(400).json({ message: "Driver has no email address" });

      const driverUser = await storage.getUserByDriverId(driverId);
      if (!driverUser) return res.status(404).json({ message: "No user account found for this driver" });

      const { generateTempPassword } = await import("./lib/driverAuth");
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
        const { sendResetPasswordEmail } = await import("./services/emailService");
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
  });

  // Vehicle archive/restore/permanent delete
  app.patch("/api/admin/vehicles/:id/archive", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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
  });

  app.patch("/api/admin/vehicles/:id/restore", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
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
  });

  app.delete("/api/admin/vehicles/:id/permanent", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
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
  });

  // Clinic user: delete own patient (VIEWER+clinicId, patient must belong to clinic, no active trips)
  app.delete("/api/clinic/patients/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user || user.role !== "VIEWER" || !user.clinicId) {
        return res.status(403).json({ message: "Only clinic users can use this endpoint" });
      }
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const patient = await storage.getPatient(id);
      if (!patient) return res.status(404).json({ message: "Patient not found" });
      if (patient.clinicId !== user.clinicId) {
        return res.status(403).json({ message: "You can only delete patients belonging to your clinic" });
      }
      const hasActive = await storage.hasActiveTripsForPatient(id);
      if (hasActive) return res.status(409).json({ message: "Cannot delete patient with active trips" });
      const reason = req.body?.reason || null;
      const updated = await storage.updatePatient(id, { active: false, deletedAt: new Date(), deletedBy: req.user!.userId, deleteReason: reason } as any);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "ARCHIVE",
        entity: "patient",
        entityId: id,
        details: `Clinic user archived patient ${patient.firstName} ${patient.lastName}`,
        cityId: patient.cityId,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Clinic user: delete own pending trip (VIEWER+clinicId, trip must be pending approval)
  app.delete("/api/clinic/trips/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user || user.role !== "VIEWER" || !user.clinicId) {
        return res.status(403).json({ message: "Only clinic users can use this endpoint" });
      }
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      if (trip.clinicId !== user.clinicId) {
        return res.status(403).json({ message: "You can only delete trips belonging to your clinic" });
      }
      if (trip.approvalStatus !== "pending") {
        return res.status(400).json({ message: "Can only delete trips with pending approval status" });
      }
      const updated = await storage.updateTrip(id, { deletedAt: new Date() } as any);
      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "ARCHIVE",
        entity: "trip",
        entityId: id,
        details: `Clinic user deleted pending trip ${trip.publicId}`,
        cityId: trip.cityId,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clinic/patients", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user || user.role !== "VIEWER" || !user.clinicId) {
        return res.status(403).json({ message: "Only clinic users can use this endpoint" });
      }
      const clinicPatients = await db.select().from(patients).where(
        and(eq(patients.clinicId, user.clinicId), eq(patients.active, true), isNull(patients.deletedAt))
      ).orderBy(patients.firstName);
      res.json(clinicPatients);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clinic/profile", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user || !user.clinicId) return res.status(403).json({ message: "No clinic linked" });
      const clinic = await storage.getClinic(user.clinicId);
      if (!clinic) return res.status(404).json({ message: "Clinic not found" });
      res.json(clinic);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clinic/recurring-schedules", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user || user.role !== "VIEWER" || !user.clinicId) {
        return res.status(403).json({ message: "Only clinic users can use this endpoint" });
      }
      const clinicPatientIds = await db.select({ id: patients.id }).from(patients).where(
        and(eq(patients.clinicId, user.clinicId), eq(patients.active, true), isNull(patients.deletedAt))
      );
      const patientIds = clinicPatientIds.map(p => p.id);
      if (patientIds.length === 0) return res.json([]);
      const schedules = await db.select().from(recurringSchedules).where(
        and(inArray(recurringSchedules.patientId, patientIds), eq(recurringSchedules.active, true))
      );
      res.json(schedules);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/app-config", authMiddleware, (req: AuthRequest, res) => {
    res.json({
      allowCompletedEdit: process.env.ALLOW_COMPLETED_EDIT === "true" && req.user?.role === "SUPER_ADMIN",
    });
  });

  return httpServer;
}
