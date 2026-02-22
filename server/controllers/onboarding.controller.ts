import { type Response } from "express";
import { type AuthRequest } from "../auth";
import { db } from "../db";
import { companies, users, cities, clinics, drivers, vehicles, patients, trips, usCities } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { generatePublicId } from "../public-id";
import { hashPassword } from "../auth";
import { storage } from "../storage";

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

    const [newCompany] = await db.insert(companies).values({
      name: name.trim(),
    }).returning();

    let city;
    const existingCity = await db.select().from(cities).where(
      sql`LOWER(${cities.name}) = LOWER(${usCity.city}) AND LOWER(${cities.state}) = LOWER(${usCity.stateCode})`
    );

    if (existingCity.length) {
      city = existingCity[0];
    } else {
      [city] = await db.insert(cities).values({
        name: usCity.city,
        state: usCity.stateCode,
        timezone: "America/Chicago",
        active: true,
        usCityId: usCity.id,
      }).returning();
    }

    const adminPublicId = await generatePublicId();
    const hashedPassword = await hashPassword(adminPassword);
    const [adminUser] = await db.insert(users).values({
      publicId: adminPublicId,
      email: adminEmail.trim().toLowerCase(),
      password: hashedPassword,
      firstName: (adminFirstName || "Company").trim(),
      lastName: (adminLastName || "Admin").trim(),
      role: "ADMIN",
      companyId: newCompany.id,
      active: true,
    }).returning();

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ONBOARD_COMPANY",
      entity: "company",
      entityId: newCompany.id,
      details: `Onboarded company "${newCompany.name}" with admin ${adminUser.email} in ${usCity.city}, ${usCity.stateCode}`,
    });

    res.json({
      company: { id: newCompany.id, name: newCompany.name },
      city: { id: city.id, name: city.name, state: city.state },
      admin: { id: adminUser.id, publicId: adminUser.publicId, email: adminUser.email },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
