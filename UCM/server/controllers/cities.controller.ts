import type { Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireRole, getUserCityIds, getCompanyIdFromAuth, applyCompanyFilter, hashPassword, type AuthRequest } from "../auth";
import { insertCitySchema, insertCompanySchema, companies, cities as citiesTable, users } from "@shared/schema";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
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
    const { name, usCityId, cityTimezone } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: "Company name is required" });
    if (!usCityId) return res.status(400).json({ message: "City selection is required" });

    const tz = (cityTimezone && cityTimezone.trim()) || "America/Los_Angeles";
    if (!ALLOWED_TIMEZONES.includes(tz)) {
      return res.status(400).json({ message: `Invalid timezone. Allowed: ${ALLOWED_TIMEZONES.join(", ")}` });
    }

    const usCityIdNum = parseInt(String(usCityId));
    if (isNaN(usCityIdNum)) return res.status(400).json({ message: "Invalid city ID" });

    const usCityRows = await db.execute(
      sql`SELECT uc.id, uc.city, uc.state_code, us.name as state_name
          FROM us_cities uc JOIN us_states us ON uc.state_code = us.code
          WHERE uc.id = ${usCityIdNum}`
    );
    const usCity = usCityRows.rows?.[0] as any;
    if (!usCity) return res.status(400).json({ message: "Selected city not found" });

    const existingServiceCity = await db.execute(
      sql`SELECT id, name, state FROM cities WHERE us_city_id = ${usCityIdNum} LIMIT 1`
    );
    
    const result = await db.transaction(async (tx) => {
      const [company] = await tx.insert(companies).values({ name: name.trim(), timezone: tz }).returning();

      let city: any;
      if (existingServiceCity.rows?.length) {
        city = existingServiceCity.rows[0];
      } else {
        const [newCity] = await tx.insert(citiesTable).values({
          name: usCity.city,
          state: usCity.state_code,
          timezone: tz,
          usCityId: usCityIdNum,
        }).returning();
        city = newCity;
      }
      return { company, city };
    });

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CREATE",
      entity: "company",
      entityId: result.company.id,
      details: `Created company "${result.company.name}" with city "${result.city.name}, ${usCity.state_code}"`,
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
    const { usCityId, timezone: rawTz } = req.body;

    if (usCityId) {
      const usCityIdNum = parseInt(String(usCityId));
      if (isNaN(usCityIdNum)) return res.status(400).json({ message: "Invalid city ID" });

      const existingRows = await db.execute(
        sql`SELECT id FROM cities WHERE us_city_id = ${usCityIdNum} LIMIT 1`
      );
      if (existingRows.rows?.length) {
        return res.status(409).json({ message: "This city already exists as a service city" });
      }

      const usCityRows = await db.execute(
        sql`SELECT uc.city, uc.state_code FROM us_cities uc WHERE uc.id = ${usCityIdNum}`
      );
      const usCity = usCityRows.rows?.[0] as any;
      if (!usCity) return res.status(400).json({ message: "City not found in master data" });

      const tz = (rawTz && rawTz.trim()) || "America/Los_Angeles";
      if (!ALLOWED_TIMEZONES.includes(tz)) {
        return res.status(400).json({ message: `Invalid timezone. Allowed: ${ALLOWED_TIMEZONES.join(", ")}` });
      }

      const city = await storage.createCity({
        name: usCity.city,
        state: usCity.state_code,
        timezone: tz,
        usCityId: usCityIdNum,
      } as any);

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "CREATE",
        entity: "city",
        entityId: city.id,
        details: `Created service city ${city.name}, ${usCity.state_code}`,
        cityId: city.id,
      });
      return res.json(city);
    }

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

    const normalizedName = cityData.name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const state = (cityData.state || "").trim().toUpperCase();
    if (state.length === 2) {
      const matchRows = await db.execute(
        sql`SELECT id FROM us_cities WHERE state_code = ${state} AND city_normalized = ${normalizedName} LIMIT 1`
      );
      if (matchRows.rows?.length) {
        (cityData as any).usCityId = (matchRows.rows[0] as any).id;
      }
    }

    const city = await storage.createCity(cityData as any);
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

export async function deleteCityHandler(req: AuthRequest, res: Response) {
  try {
    const cityId = parseInt(String(req.params.id));
    if (isNaN(cityId)) return res.status(400).json({ message: "Invalid city ID" });

    const city = await storage.getCity(cityId);
    if (!city) return res.status(404).json({ message: "City not found" });

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "DELETE",
      entity: "city",
      entityId: cityId,
      details: `Deleted city ${city.name}, ${city.state}`,
      cityId: cityId,
    });

    const { db } = await import("../db");
    const { cities } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.delete(cities).where(eq(cities.id, cityId));

    res.json({ ok: true, message: `City ${city.name} deleted` });
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
