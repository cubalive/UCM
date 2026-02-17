import type { Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireRole, getUserCityIds, getCompanyIdFromAuth, applyCompanyFilter, hashPassword, type AuthRequest } from "../auth";
import { insertCitySchema, insertCompanySchema, companies, cities as citiesTable, users } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { generatePublicId } from "../public-id";

export const ALLOWED_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Indiana/Indianapolis",
];

export async function getTimezonesHandler(_req: AuthRequest, res: Response) {
  res.json({ ok: true, items: ALLOWED_TIMEZONES });
}

export async function getCompaniesHandler(_req: AuthRequest, res: Response) {
  try {
    const result = await db.select().from(companies).orderBy(companies.name);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function createCompanyHandler(req: AuthRequest, res: Response) {
  try {
    const { name, cityName, cityState, cityTimezone } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: "Company name is required" });
    if (!cityName || !cityName.trim()) return res.status(400).json({ message: "First city name is required" });
    if (!cityState || !cityState.trim()) return res.status(400).json({ message: "City state is required" });

    const tz = (cityTimezone && cityTimezone.trim()) || "America/New_York";
    if (!ALLOWED_TIMEZONES.includes(tz)) {
      return res.status(400).json({ message: `Invalid timezone. Allowed: ${ALLOWED_TIMEZONES.join(", ")}` });
    }

    const result = await db.transaction(async (tx) => {
      const [company] = await tx.insert(companies).values({ name: name.trim() }).returning();
      const [city] = await tx.insert(citiesTable).values({
        name: cityName.trim(),
        state: cityState.trim(),
        timezone: tz,
      }).returning();
      return { company, city };
    });

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CREATE",
      entity: "company",
      entityId: result.company.id,
      details: `Created company "${result.company.name}" with first city "${result.city.name}"`,
      cityId: result.city.id,
    });

    res.json({ ...result.company, firstCity: result.city });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function createCompanyAdminHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = parseInt(String(req.params.id));
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

    if (cityIds && Array.isArray(cityIds) && cityIds.length > 0) {
      await storage.setUserCityAccess(newUser.id, cityIds);
    } else {
      const allCities = await storage.getCities();
      if (allCities.length > 0) {
        await storage.setUserCityAccess(newUser.id, allCities.map(c => c.id));
      }
    }

    res.json({ id: newUser.id, email: newUser.email, role: newUser.role, companyId: newUser.companyId });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getCitiesHandler(req: AuthRequest, res: Response) {
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
}

export async function createCityHandler(req: AuthRequest, res: Response) {
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
}

export async function updateCityHandler(req: AuthRequest, res: Response) {
  try {
    const cityId = parseInt(String(req.params.id));
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
}
