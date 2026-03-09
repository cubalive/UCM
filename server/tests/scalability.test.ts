/**
 * Scalability & Performance Tests
 * Tests that the system handles multi-tenant load with many drivers, patients, clinics, and trips.
 * Validates N+1 fixes, pagination, batch queries, and index usage.
 *
 * Requires a live Supabase DB connection — skips gracefully if unavailable.
 * Run with: SUPABASE_DB_URL=... npx vitest run server/tests/scalability.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { companies, cities, drivers, vehicles, patients, clinics, trips, users } from "@shared/schema";
import { eq, sql, and, inArray, isNull } from "drizzle-orm";
import { enrichTripsWithRelations } from "../controllers/trips.controller";

// Check DB connectivity before running
let dbAvailable = false;
try {
  const { pool } = await import("../db");
  const client = await pool.connect();
  await client.query("SELECT 1");
  client.release();
  dbAvailable = true;
} catch {
  console.log("⚠️  No DB connection available — scalability tests will be skipped");
}

const describeIfDb = dbAvailable ? describe : describe.skip;

// Test config
const NUM_COMPANIES = 3;
const NUM_CITIES = 2;
const DRIVERS_PER_COMPANY = 50;
const VEHICLES_PER_COMPANY = 40;
const PATIENTS_PER_COMPANY = 200;
const CLINICS_PER_COMPANY = 10;
const TRIPS_PER_COMPANY = 300;

const testIds = {
  companyIds: [] as number[],
  cityIds: [] as number[],
  driverIds: [] as number[],
  vehicleIds: [] as number[],
  patientIds: [] as number[],
  clinicIds: [] as number[],
  tripIds: [] as number[],
  userIds: [] as number[],
};

function generatePublicId(): string {
  return "TST" + Math.random().toString(36).substring(2, 12).toUpperCase();
}

describeIfDb("Scalability Tests", () => {
  beforeAll(async () => {
    console.log("🔧 Seeding test data for scalability tests...");
    const start = Date.now();

    // Create test companies
    for (let c = 0; c < NUM_COMPANIES; c++) {
      const [company] = await db.insert(companies).values({
        name: `TestCo_Scale_${c}_${Date.now()}`,
        timezone: "America/Chicago",
      }).returning();
      testIds.companyIds.push(company.id);
    }

    // Create test cities
    for (let c = 0; c < NUM_CITIES; c++) {
      const [city] = await db.insert(cities).values({
        name: `TestCity_Scale_${c}_${Date.now()}`,
        state: "TX",
        timezone: "America/Chicago",
      }).returning();
      testIds.cityIds.push(city.id);
    }

    // Create a test user for auth
    const [testUser] = await db.insert(users).values({
      publicId: generatePublicId(),
      email: `test_scale_${Date.now()}@test.com`,
      password: "hashed_test_pw",
      firstName: "Test",
      lastName: "Admin",
      role: "SUPER_ADMIN",
      companyId: testIds.companyIds[0],
    }).returning();
    testIds.userIds.push(testUser.id);

    // Bulk insert clinics
    for (let c = 0; c < NUM_COMPANIES; c++) {
      const clinicValues = Array.from({ length: CLINICS_PER_COMPANY }, (_, i) => ({
        publicId: generatePublicId(),
        cityId: testIds.cityIds[i % NUM_CITIES],
        name: `Clinic_${c}_${i}`,
        address: `${100 + i} Main St, TestCity, TX`,
        lat: 29.7604 + (Math.random() * 0.1),
        lng: -95.3698 + (Math.random() * 0.1),
        companyId: testIds.companyIds[c],
      }));
      const inserted = await db.insert(clinics).values(clinicValues).returning({ id: clinics.id });
      testIds.clinicIds.push(...inserted.map(r => r.id));
    }

    // Bulk insert vehicles
    for (let c = 0; c < NUM_COMPANIES; c++) {
      const vehicleValues = Array.from({ length: VEHICLES_PER_COMPANY }, (_, i) => ({
        publicId: generatePublicId(),
        cityId: testIds.cityIds[i % NUM_CITIES],
        name: `Vehicle_${c}_${i}`,
        licensePlate: `TST${c}${i}${Date.now() % 10000}`,
        companyId: testIds.companyIds[c],
        capability: i % 3 === 0 ? "WHEELCHAIR" : "SEDAN",
      }));
      const inserted = await db.insert(vehicles).values(vehicleValues).returning({ id: vehicles.id });
      testIds.vehicleIds.push(...inserted.map(r => r.id));
    }

    // Bulk insert drivers
    for (let c = 0; c < NUM_COMPANIES; c++) {
      const driverValues = Array.from({ length: DRIVERS_PER_COMPANY }, (_, i) => ({
        publicId: generatePublicId(),
        cityId: testIds.cityIds[i % NUM_CITIES],
        email: `driver_scale_${c}_${i}_${Date.now()}@test.com`,
        firstName: `Driver${i}`,
        lastName: `Co${c}`,
        phone: `555-${String(c).padStart(2, "0")}-${String(i).padStart(4, "0")}`,
        companyId: testIds.companyIds[c],
        vehicleId: testIds.vehicleIds[c * VEHICLES_PER_COMPANY + (i % VEHICLES_PER_COMPANY)],
        status: "ACTIVE" as const,
        dispatchStatus: i % 4 === 0 ? "enroute" as const : i % 4 === 1 ? "available" as const : "off" as const,
        lastLat: 29.7604 + (Math.random() * 0.1),
        lastLng: -95.3698 + (Math.random() * 0.1),
        lastSeenAt: new Date(),
      }));
      const inserted = await db.insert(drivers).values(driverValues).returning({ id: drivers.id });
      testIds.driverIds.push(...inserted.map(r => r.id));
    }

    // Bulk insert patients
    for (let c = 0; c < NUM_COMPANIES; c++) {
      const patientValues = Array.from({ length: PATIENTS_PER_COMPANY }, (_, i) => ({
        publicId: generatePublicId(),
        cityId: testIds.cityIds[i % NUM_CITIES],
        clinicId: testIds.clinicIds[c * CLINICS_PER_COMPANY + (i % CLINICS_PER_COMPANY)],
        firstName: `Patient${i}`,
        lastName: `Co${c}`,
        phone: `555-${String(c).padStart(2, "0")}-${String(i + 5000).padStart(4, "0")}`,
        companyId: testIds.companyIds[c],
        source: "clinic",
      }));
      const inserted = await db.insert(patients).values(patientValues).returning({ id: patients.id });
      testIds.patientIds.push(...inserted.map(r => r.id));
    }

    // Bulk insert trips
    const statuses = ["SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "IN_PROGRESS", "COMPLETED"] as const;
    for (let c = 0; c < NUM_COMPANIES; c++) {
      const tripValues = Array.from({ length: TRIPS_PER_COMPANY }, (_, i) => ({
        publicId: generatePublicId(),
        cityId: testIds.cityIds[i % NUM_CITIES],
        patientId: testIds.patientIds[c * PATIENTS_PER_COMPANY + (i % PATIENTS_PER_COMPANY)],
        driverId: i % 2 === 0 ? testIds.driverIds[c * DRIVERS_PER_COMPANY + (i % DRIVERS_PER_COMPANY)] : null,
        vehicleId: i % 2 === 0 ? testIds.vehicleIds[c * VEHICLES_PER_COMPANY + (i % VEHICLES_PER_COMPANY)] : null,
        clinicId: testIds.clinicIds[c * CLINICS_PER_COMPANY + (i % CLINICS_PER_COMPANY)],
        pickupAddress: `${i} Pickup St, TestCity, TX`,
        dropoffAddress: `${i} Dropoff Ave, TestCity, TX`,
        pickupLat: 29.7604 + (Math.random() * 0.05),
        pickupLng: -95.3698 + (Math.random() * 0.05),
        dropoffLat: 29.7604 + (Math.random() * 0.05),
        dropoffLng: -95.3698 + (Math.random() * 0.05),
        scheduledDate: "2026-03-10",
        pickupTime: `${8 + (i % 10)}:${String(i % 60).padStart(2, "0")}`,
        status: statuses[i % statuses.length],
        companyId: testIds.companyIds[c],
      }));
      const inserted = await db.insert(trips).values(tripValues).returning({ id: trips.id });
      testIds.tripIds.push(...inserted.map(r => r.id));
    }

    console.log(`✅ Seeded ${testIds.companyIds.length} companies, ${testIds.cityIds.length} cities, ${testIds.clinicIds.length} clinics, ${testIds.vehicleIds.length} vehicles, ${testIds.driverIds.length} drivers, ${testIds.patientIds.length} patients, ${testIds.tripIds.length} trips in ${Date.now() - start}ms`);
  }, 120_000);

  afterAll(async () => {
    console.log("🧹 Cleaning up test data...");
    // Clean up in reverse dependency order
    if (testIds.tripIds.length > 0) {
      await db.delete(trips).where(inArray(trips.id, testIds.tripIds));
    }
    if (testIds.patientIds.length > 0) {
      await db.delete(patients).where(inArray(patients.id, testIds.patientIds));
    }
    if (testIds.driverIds.length > 0) {
      await db.delete(drivers).where(inArray(drivers.id, testIds.driverIds));
    }
    if (testIds.vehicleIds.length > 0) {
      await db.delete(vehicles).where(inArray(vehicles.id, testIds.vehicleIds));
    }
    if (testIds.clinicIds.length > 0) {
      await db.delete(clinics).where(inArray(clinics.id, testIds.clinicIds));
    }
    if (testIds.cityIds.length > 0) {
      await db.delete(cities).where(inArray(cities.id, testIds.cityIds));
    }
    if (testIds.userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, testIds.userIds));
    }
    if (testIds.companyIds.length > 0) {
      await db.delete(companies).where(inArray(companies.id, testIds.companyIds));
    }
    console.log("✅ Cleanup complete");
  }, 60_000);

  // ─── Test 1: enrichTripsWithRelations batch performance ───
  it("enrichTripsWithRelations should batch-load 100 trips in < 2s", async () => {
    // Load 100 trips from DB
    const tripList = await db.select().from(trips)
      .where(inArray(trips.id, testIds.tripIds.slice(0, 100)));

    expect(tripList.length).toBe(100);

    const start = Date.now();
    const enriched = await enrichTripsWithRelations(tripList);
    const durationMs = Date.now() - start;

    console.log(`enrichTripsWithRelations(100 trips): ${durationMs}ms`);
    expect(durationMs).toBeLessThan(2000);
    expect(enriched.length).toBe(100);

    // Verify enrichment worked
    const withPatient = enriched.filter(t => t.patientName);
    expect(withPatient.length).toBeGreaterThan(0);
    const withDriver = enriched.filter(t => t.driverName);
    expect(withDriver.length).toBeGreaterThan(0);
    const withClinic = enriched.filter(t => t.clinicName);
    expect(withClinic.length).toBeGreaterThan(0);
  }, 10_000);

  // ─── Test 2: enrichTripsWithRelations with 300 trips ───
  it("enrichTripsWithRelations should handle 300 trips in < 5s", async () => {
    const tripList = await db.select().from(trips)
      .where(inArray(trips.id, testIds.tripIds.slice(0, 300)));

    const start = Date.now();
    const enriched = await enrichTripsWithRelations(tripList);
    const durationMs = Date.now() - start;

    console.log(`enrichTripsWithRelations(300 trips): ${durationMs}ms`);
    expect(durationMs).toBeLessThan(5000);
    expect(enriched.length).toBe(300);
  }, 15_000);

  // ─── Test 3: Company-scoped trip query uses index ───
  it("querying trips by companyId+status should be fast", async () => {
    const companyId = testIds.companyIds[0];

    const start = Date.now();
    const result = await db.select().from(trips)
      .where(and(
        eq(trips.companyId, companyId),
        eq(trips.status, "SCHEDULED"),
        isNull(trips.deletedAt),
      ))
      .limit(50);
    const durationMs = Date.now() - start;

    console.log(`trips by companyId+status: ${durationMs}ms, ${result.length} rows`);
    expect(durationMs).toBeLessThan(500);
    expect(result.length).toBeGreaterThan(0);
  });

  // ─── Test 4: City-scoped driver query ───
  it("querying drivers by cityId+status should be fast", async () => {
    const cityId = testIds.cityIds[0];

    const start = Date.now();
    const result = await db.select().from(drivers)
      .where(and(
        eq(drivers.cityId, cityId),
        eq(drivers.status, "ACTIVE"),
      ))
      .limit(100);
    const durationMs = Date.now() - start;

    console.log(`drivers by cityId+status: ${durationMs}ms, ${result.length} rows`);
    expect(durationMs).toBeLessThan(500);
    expect(result.length).toBeGreaterThan(0);
  });

  // ─── Test 5: Patient pagination ───
  it("patient list should respect pagination limits", async () => {
    const companyId = testIds.companyIds[0];

    const page1 = await db.select().from(patients)
      .where(and(eq(patients.companyId, companyId), eq(patients.active, true), isNull(patients.deletedAt)))
      .orderBy(patients.firstName)
      .limit(50).offset(0);

    const page2 = await db.select().from(patients)
      .where(and(eq(patients.companyId, companyId), eq(patients.active, true), isNull(patients.deletedAt)))
      .orderBy(patients.firstName)
      .limit(50).offset(50);

    expect(page1.length).toBe(50);
    expect(page2.length).toBe(50);
    // Pages should not overlap
    const page1Ids = new Set(page1.map(p => p.id));
    const overlap = page2.filter(p => page1Ids.has(p.id));
    expect(overlap.length).toBe(0);
  });

  // ─── Test 6: Multi-tenant isolation ───
  it("company queries should only return their own data", async () => {
    const co1Trips = await db.select({ id: trips.id }).from(trips)
      .where(eq(trips.companyId, testIds.companyIds[0]));
    const co2Trips = await db.select({ id: trips.id }).from(trips)
      .where(eq(trips.companyId, testIds.companyIds[1]));

    const co1Set = new Set(co1Trips.map(t => t.id));
    const co2Set = new Set(co2Trips.map(t => t.id));

    // No overlap between companies
    const shared = [...co1Set].filter(id => co2Set.has(id));
    expect(shared.length).toBe(0);
    expect(co1Trips.length).toBe(TRIPS_PER_COMPANY);
    expect(co2Trips.length).toBe(TRIPS_PER_COMPANY);
  });

  // ─── Test 7: Concurrent query performance ───
  it("10 concurrent company-scoped queries should complete in < 3s", async () => {
    const start = Date.now();
    const promises = testIds.companyIds.flatMap(companyId => [
      db.select().from(trips).where(and(eq(trips.companyId, companyId), eq(trips.status, "SCHEDULED"))).limit(50),
      db.select().from(drivers).where(and(eq(drivers.companyId, companyId), eq(drivers.status, "ACTIVE"))).limit(50),
      db.select().from(patients).where(and(eq(patients.companyId, companyId), eq(patients.active, true))).limit(50),
    ]);

    const results = await Promise.all(promises);
    const durationMs = Date.now() - start;

    console.log(`10 concurrent queries: ${durationMs}ms`);
    expect(durationMs).toBeLessThan(3000);
    expect(results.every(r => Array.isArray(r))).toBe(true);
  });

  // ─── Test 8: Clinic-scoped trip query ───
  it("querying trips by clinicId+status should be fast", async () => {
    const clinicId = testIds.clinicIds[0];

    const start = Date.now();
    const result = await db.select().from(trips)
      .where(and(
        eq(trips.clinicId, clinicId),
        eq(trips.status, "IN_PROGRESS"),
        isNull(trips.deletedAt),
      ));
    const durationMs = Date.now() - start;

    console.log(`trips by clinicId+status: ${durationMs}ms, ${result.length} rows`);
    expect(durationMs).toBeLessThan(500);
  });

  // ─── Test 9: Index existence verification ───
  it("critical indexes should exist in the database", async () => {
    const indexResult = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename IN ('trips', 'drivers', 'vehicles', 'patients', 'clinics')
      AND schemaname = 'public'
      ORDER BY indexname
    `);

    const indexNames = (indexResult.rows || []).map((r: any) => r.indexname);
    console.log("Found indexes:", indexNames.join(", "));

    // These should exist after schema push
    const criticalIndexes = [
      "idx_trips_company_status_created",
      "idx_trips_city_status_date",
      "idx_trips_driver_status",
      "idx_drivers_company_status",
      "idx_drivers_city_status",
      "idx_vehicles_company_status",
      "idx_vehicles_city_status",
      "idx_patients_company",
      "idx_patients_clinic",
      "idx_clinics_company",
      "idx_clinics_city",
    ];

    for (const idx of criticalIndexes) {
      expect(indexNames).toContain(idx);
    }
  });

  // ─── Test 10: DB pool handles burst ───
  it("DB pool should handle 30 simultaneous queries without errors", async () => {
    const promises = Array.from({ length: 30 }, (_, i) => {
      const companyId = testIds.companyIds[i % NUM_COMPANIES];
      return db.select({ count: sql<number>`count(*)` }).from(trips)
        .where(eq(trips.companyId, companyId));
    });

    const start = Date.now();
    const results = await Promise.all(promises);
    const durationMs = Date.now() - start;

    console.log(`30 simultaneous count queries: ${durationMs}ms`);
    expect(durationMs).toBeLessThan(5000);
    expect(results.length).toBe(30);
    expect(results.every(r => Array.isArray(r))).toBe(true);
  });
});
