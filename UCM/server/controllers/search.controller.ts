import { Router } from "express";
import { authMiddleware, type AuthRequest } from "../auth";
import { getScope, requireScope, buildScopeFilters } from "../middleware/scopeContext";
import { db } from "../db";
import { patients, drivers, vehicles, trips, clinics } from "@shared/schema";
import { and, eq, ilike, isNull, or, sql, desc } from "drizzle-orm";

const router = Router();

router.get("/api/search/patients", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const scope = await getScope(req);
    if (!scope || !requireScope(scope, res)) return;
    const filters = buildScopeFilters(scope);

    const q = ((req.query.q as string) || "").trim();
    if (q.length < 2) return res.status(400).json({ message: "Query must be at least 2 characters" });

    const pattern = `%${q}%`;
    const conditions: any[] = [
      isNull(patients.deletedAt),
      or(
        ilike(patients.firstName, pattern),
        ilike(patients.lastName, pattern),
        ilike(patients.phone, pattern),
        ilike(patients.email, pattern),
        ilike(patients.publicId, pattern),
      ),
    ];
    if (filters.companyId) conditions.push(eq(patients.companyId, filters.companyId));
    if (filters.cityId) conditions.push(eq(patients.cityId, filters.cityId));
    if (filters.clinicId) conditions.push(eq(patients.clinicId, filters.clinicId));

    const results = await db
      .select({
        id: patients.id,
        publicId: patients.publicId,
        firstName: patients.firstName,
        lastName: patients.lastName,
        phone: patients.phone,
        email: patients.email,
        cityId: patients.cityId,
        clinicId: patients.clinicId,
      })
      .from(patients)
      .where(and(...conditions))
      .limit(25);

    res.json(results);
  } catch (err: any) {
    console.error("[SEARCH] patients error:", err.message);
    res.status(500).json({ message: "Search failed" });
  }
});

router.get("/api/search/drivers", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const scope = await getScope(req);
    if (!scope || !requireScope(scope, res)) return;
    const filters = buildScopeFilters(scope);

    const q = ((req.query.q as string) || "").trim();
    if (q.length < 2) return res.status(400).json({ message: "Query must be at least 2 characters" });

    const pattern = `%${q}%`;
    const conditions: any[] = [
      eq(drivers.active, true),
      isNull(drivers.deletedAt),
      or(
        ilike(drivers.firstName, pattern),
        ilike(drivers.lastName, pattern),
        ilike(drivers.phone, pattern),
        ilike(drivers.email, pattern),
        ilike(drivers.publicId, pattern),
      ),
    ];
    if (filters.companyId) conditions.push(eq(drivers.companyId, filters.companyId));
    if (filters.cityId) conditions.push(eq(drivers.cityId, filters.cityId));

    const results = await db
      .select({
        id: drivers.id,
        publicId: drivers.publicId,
        firstName: drivers.firstName,
        lastName: drivers.lastName,
        phone: drivers.phone,
        email: drivers.email,
        cityId: drivers.cityId,
        status: drivers.status,
      })
      .from(drivers)
      .where(and(...conditions))
      .limit(25);

    res.json(results);
  } catch (err: any) {
    console.error("[SEARCH] drivers error:", err.message);
    res.status(500).json({ message: "Search failed" });
  }
});

router.get("/api/search/vehicles", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const scope = await getScope(req);
    if (!scope || !requireScope(scope, res)) return;
    const filters = buildScopeFilters(scope);

    const q = ((req.query.q as string) || "").trim();
    if (q.length < 2) return res.status(400).json({ message: "Query must be at least 2 characters" });

    const pattern = `%${q}%`;
    const conditions: any[] = [
      eq(vehicles.active, true),
      isNull(vehicles.deletedAt),
      or(
        ilike(vehicles.name, pattern),
        ilike(vehicles.licensePlate, pattern),
        ilike(vehicles.make, pattern),
        ilike(vehicles.model, pattern),
        ilike(vehicles.publicId, pattern),
      ),
    ];
    if (filters.companyId) conditions.push(eq(vehicles.companyId, filters.companyId));
    if (filters.cityId) conditions.push(eq(vehicles.cityId, filters.cityId));

    const results = await db
      .select({
        id: vehicles.id,
        publicId: vehicles.publicId,
        name: vehicles.name,
        licensePlate: vehicles.licensePlate,
        make: vehicles.make,
        model: vehicles.model,
        cityId: vehicles.cityId,
      })
      .from(vehicles)
      .where(and(...conditions))
      .limit(25);

    res.json(results);
  } catch (err: any) {
    console.error("[SEARCH] vehicles error:", err.message);
    res.status(500).json({ message: "Search failed" });
  }
});

router.get("/api/search/trips", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const scope = await getScope(req);
    if (!scope || !requireScope(scope, res)) return;
    const filters = buildScopeFilters(scope);

    const q = ((req.query.q as string) || "").trim();
    if (q.length < 2) return res.status(400).json({ message: "Query must be at least 2 characters" });

    const pattern = `%${q}%`;
    const conditions: any[] = [
      isNull(trips.deletedAt),
      or(
        ilike(trips.publicId, pattern),
        ilike(trips.pickupAddress, pattern),
        ilike(trips.dropoffAddress, pattern),
        ilike(trips.notes, pattern),
      ),
    ];
    if (filters.companyId) conditions.push(eq(trips.companyId, filters.companyId));
    if (filters.cityId) conditions.push(eq(trips.cityId, filters.cityId));
    if (filters.clinicId) conditions.push(eq(trips.clinicId, filters.clinicId));

    const results = await db
      .select({
        id: trips.id,
        publicId: trips.publicId,
        pickupAddress: trips.pickupAddress,
        dropoffAddress: trips.dropoffAddress,
        scheduledTime: trips.scheduledTime,
        status: trips.status,
        cityId: trips.cityId,
        patientId: trips.patientId,
      })
      .from(trips)
      .where(and(...conditions))
      .orderBy(desc(trips.scheduledTime))
      .limit(25);

    res.json(results);
  } catch (err: any) {
    console.error("[SEARCH] trips error:", err.message);
    res.status(500).json({ message: "Search failed" });
  }
});

router.get("/api/search/clinics", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const scope = await getScope(req);
    if (!scope || !requireScope(scope, res)) return;
    const filters = buildScopeFilters(scope);

    const q = ((req.query.q as string) || "").trim();
    if (q.length < 2) return res.status(400).json({ message: "Query must be at least 2 characters" });

    const pattern = `%${q}%`;
    const conditions: any[] = [
      eq(clinics.active, true),
      isNull(clinics.deletedAt),
      or(
        ilike(clinics.name, pattern),
        ilike(clinics.address, pattern),
        ilike(clinics.phone, pattern),
        ilike(clinics.publicId, pattern),
      ),
    ];
    if (filters.companyId) conditions.push(eq(clinics.companyId, filters.companyId));
    if (filters.cityId) conditions.push(eq(clinics.cityId, filters.cityId));

    const results = await db
      .select({
        id: clinics.id,
        publicId: clinics.publicId,
        name: clinics.name,
        address: clinics.address,
        phone: clinics.phone,
        cityId: clinics.cityId,
      })
      .from(clinics)
      .where(and(...conditions))
      .limit(25);

    res.json(results);
  } catch (err: any) {
    console.error("[SEARCH] clinics error:", err.message);
    res.status(500).json({ message: "Search failed" });
  }
});

export default router;
