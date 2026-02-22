import { type Response } from "express";
import { type AuthRequest } from "../auth";
import { db } from "../db";
import { companies, users, cities, clinics, drivers, vehicles, patients, trips, usCities } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { generatePublicId } from "../public-id";
import { hashPassword } from "../auth";
import { storage } from "../storage";

const STATE_TIMEZONE: Record<string, string> = {
  TX: "America/Chicago", LA: "America/Chicago", AR: "America/Chicago",
  OK: "America/Chicago", KS: "America/Chicago", MO: "America/Chicago",
  IL: "America/Chicago", WI: "America/Chicago", MN: "America/Chicago",
  IA: "America/Chicago", NV: "America/Los_Angeles", CA: "America/Los_Angeles",
  WA: "America/Los_Angeles", OR: "America/Los_Angeles", AZ: "America/Phoenix",
  NY: "America/New_York", FL: "America/New_York", GA: "America/New_York",
  NC: "America/New_York", VA: "America/New_York", PA: "America/New_York",
  OH: "America/New_York", MI: "America/New_York", CO: "America/Denver",
  UT: "America/Denver", NM: "America/Denver", MT: "America/Denver",
};

export async function onboardingStatusHandler(_req: AuthRequest, res: Response) {
  try {
    const [companyCount] = await db.select({ count: sql<number>`count(*)::int` }).from(companies);
    const [cityCount] = await db.select({ count: sql<number>`count(*)::int` }).from(cities);
    const [clinicCount] = await db.select({ count: sql<number>`count(*)::int` }).from(clinics);
    const [driverCount] = await db.select({ count: sql<number>`count(*)::int` }).from(drivers);
    const [vehicleCount] = await db.select({ count: sql<number>`count(*)::int` }).from(vehicles);
    const [patientCount] = await db.select({ count: sql<number>`count(*)::int` }).from(patients);
    const [tripCount] = await db.select({ count: sql<number>`count(*)::int` }).from(trips);
    const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);

    const companyList = await db.select({ id: companies.id, name: companies.name })
      .from(companies).orderBy(companies.id);

    res.json({
      ready: companyCount.count > 0,
      counts: {
        companies: companyCount.count,
        cities: cityCount.count,
        clinics: clinicCount.count,
        drivers: driverCount.count,
        vehicles: vehicleCount.count,
        patients: patientCount.count,
        trips: tripCount.count,
        users: userCount.count,
      },
      companies: companyList,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function onboardCompanyHandler(req: AuthRequest, res: Response) {
  try {
    const existingCompanies = await db.select({ id: companies.id }).from(companies);
    if (existingCompanies.length >= 10) {
      return res.status(400).json({ message: "Onboarding limit reached (10 companies). Use standard company creation." });
    }

    const { name, usCityId, adminEmail, adminPassword, adminFirstName, adminLastName } = req.body;

    if (!name?.trim()) return res.status(400).json({ message: "Company name is required" });
    if (!usCityId) return res.status(400).json({ message: "US City ID is required" });
    if (!adminEmail?.trim()) return res.status(400).json({ message: "Admin email is required" });
    if (!adminPassword || adminPassword.length < 6) return res.status(400).json({ message: "Admin password must be at least 6 characters" });

    const [usCity] = await db.select().from(usCities).where(eq(usCities.id, usCityId));
    if (!usCity) return res.status(404).json({ message: "US City not found" });

    const existingEmail = await storage.getUserByEmail(adminEmail.trim().toLowerCase());
    if (existingEmail) return res.status(409).json({ message: "Email already in use" });

    const adminPublicId = await generatePublicId();
    const hashedPassword = await hashPassword(adminPassword);
    const tz = STATE_TIMEZONE[usCity.stateCode] || "America/New_York";

    const result = await db.transaction(async (tx) => {
      const [newCompany] = await tx.insert(companies).values({
        name: name.trim(),
      }).returning();

      let city;
      const existingCity = await tx.select().from(cities).where(
        sql`LOWER(${cities.name}) = LOWER(${usCity.city}) AND LOWER(${cities.state}) = LOWER(${usCity.stateCode})`
      );

      if (existingCity.length) {
        city = existingCity[0];
      } else {
        [city] = await tx.insert(cities).values({
          name: usCity.city,
          state: usCity.stateCode,
          timezone: tz,
          active: true,
          usCityId: usCity.id,
        }).returning();
      }

      const [adminUser] = await tx.insert(users).values({
        publicId: adminPublicId,
        email: adminEmail.trim().toLowerCase(),
        password: hashedPassword,
        firstName: (adminFirstName || "Company").trim(),
        lastName: (adminLastName || "Admin").trim(),
        role: "ADMIN",
        companyId: newCompany.id,
        active: true,
      }).returning();

      return { newCompany, city, adminUser };
    });

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ONBOARD_COMPANY",
      entity: "company",
      entityId: result.newCompany.id,
      details: `Onboarded company "${result.newCompany.name}" with admin ${result.adminUser.email} in ${usCity.city}, ${usCity.stateCode}`,
    });

    res.json({
      company: { id: result.newCompany.id, name: result.newCompany.name },
      city: { id: result.city.id, name: result.city.name, state: result.city.state },
      admin: { id: result.adminUser.id, publicId: result.adminUser.publicId, email: result.adminUser.email },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
