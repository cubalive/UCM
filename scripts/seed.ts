/**
 * UCM Realistic Test Data Seeder
 *
 * Usage:
 *   npx tsx scripts/seed.ts [size]
 *
 * Sizes:
 *   small   - 2 tenants, ~50 users, ~200 trips
 *   medium  - 5 tenants, ~500 users, ~2000 trips
 *   full    - 10 tenants, ~3000 users, ~8000 trips
 *
 * Requires DATABASE_URL in environment.
 * Safe: uses INSERT only, never deletes existing data.
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { randomUUID } from "crypto";
import * as schema from "../src/db/schema.js";

const { Pool } = pg;

// ── Config ──────────────────────────────────────────────────────────────

const SIZES = {
  small: { tenants: 2, clinicsPerTenant: 6, driversPerTenant: 25, patientsPerTenant: 80, tripsPerTenant: 100 },
  medium: { tenants: 5, clinicsPerTenant: 24, driversPerTenant: 100, patientsPerTenant: 400, tripsPerTenant: 400 },
  full: { tenants: 10, clinicsPerTenant: 12, driversPerTenant: 280, patientsPerTenant: 800, tripsPerTenant: 800 },
};

const size = (process.argv[2] || "medium") as keyof typeof SIZES;
const config = SIZES[size] || SIZES.medium;

console.log(`Seeding UCM data (${size}): ${config.tenants} tenants...`);

// ── Realistic Data ──────────────────────────────────────────────────────

const CITIES = [
  { name: "Miami", state: "FL", lat: 25.7617, lng: -80.1918, tz: "America/New_York" },
  { name: "Fort Lauderdale", state: "FL", lat: 26.1224, lng: -80.1373, tz: "America/New_York" },
  { name: "Orlando", state: "FL", lat: 28.5383, lng: -81.3792, tz: "America/New_York" },
  { name: "Tampa", state: "FL", lat: 27.9506, lng: -82.4572, tz: "America/New_York" },
  { name: "Houston", state: "TX", lat: 29.7604, lng: -95.3698, tz: "America/Chicago" },
  { name: "Dallas", state: "TX", lat: 32.7767, lng: -96.7970, tz: "America/Chicago" },
  { name: "Phoenix", state: "AZ", lat: 33.4484, lng: -112.0740, tz: "America/Phoenix" },
  { name: "Atlanta", state: "GA", lat: 33.7490, lng: -84.3880, tz: "America/New_York" },
  { name: "Chicago", state: "IL", lat: 41.8781, lng: -87.6298, tz: "America/Chicago" },
  { name: "Philadelphia", state: "PA", lat: 39.9526, lng: -75.1652, tz: "America/New_York" },
];

const FIRST_NAMES = ["James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda", "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Daniel", "Lisa", "Matthew", "Nancy", "Anthony", "Betty", "Mark", "Margaret", "Donald", "Sandra", "Steven", "Ashley", "Paul", "Dorothy", "Andrew", "Kimberly", "Joshua", "Emily", "Kenneth", "Donna"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson"];
const COMPANY_NAMES = ["CareRide", "MediTrans", "HealthRoute", "PatientLink", "SafeRide Medical", "ComfortCare Transit", "MedExpress", "CarePath", "VitalMove", "MedShuttle"];
const CLINIC_TYPES = ["Medical Center", "Family Practice", "Dialysis Center", "Oncology Clinic", "Rehabilitation Center", "Surgery Center", "Heart Institute", "Eye Center", "Dental Clinic", "Mental Health Center", "Pediatric Clinic", "Women's Health"];
const STREET_NAMES = ["Main St", "Oak Ave", "Pine Rd", "Maple Dr", "Cedar Ln", "Elm St", "Washington Blvd", "Park Ave", "Lake Dr", "River Rd", "Hill St", "Valley Way", "Forest Ave", "Ocean Dr", "Sunset Blvd"];
const TRIP_NOTES = ["Wheelchair required", "Oxygen tank", "Needs assistance walking", "Bariatric stretcher", "Child car seat needed", "Service animal", "Spanish speaker", "Hearing impaired", "Visual impairment", ""];
const VEHICLE_TYPES = ["Sedan", "SUV", "Wheelchair Van", "Stretcher Van", "Minivan"];
const TRIP_STATUSES: (typeof schema.tripStatusEnum.enumValues[number])[] = ["requested", "assigned", "en_route", "arrived", "in_progress", "completed", "cancelled"];
const AVAILABILITY: (typeof schema.driverAvailabilityEnum.enumValues[number])[] = ["available", "busy", "offline", "break"];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}
function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min: number, max: number) { return Math.random() * (max - min) + min; }
function jitter(base: number, range: number) { return base + randFloat(-range, range); }
function generateAddress(city: { name: string; state: string }) {
  return `${rand(100, 9999)} ${pick(STREET_NAMES)}, ${city.name}, ${city.state}`;
}
function generatePhone() { return `+1${rand(200, 999)}${rand(100, 999)}${rand(1000, 9999)}`; }
function hashPassword() { return "$2b$10$seedDataFakeHashDoNotUseInProd000000000000000000000"; }
function pastDate(daysAgo: number) { return new Date(Date.now() - daysAgo * 86400000); }
function futureDate(daysAhead: number) { return new Date(Date.now() + daysAhead * 86400000); }

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  let totalUsers = 0, totalPatients = 0, totalTrips = 0;

  for (let t = 0; t < config.tenants; t++) {
    const city = CITIES[t % CITIES.length];
    const companyName = t < COMPANY_NAMES.length ? COMPANY_NAMES[t] : `${COMPANY_NAMES[t % COMPANY_NAMES.length]} ${city.name}`;
    const slug = companyName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

    console.log(`  Creating tenant ${t + 1}/${config.tenants}: ${companyName} (${city.name})`);

    // Create tenant
    const [tenant] = await db.insert(schema.tenants).values({
      name: companyName,
      slug: `${slug}-${randomUUID().slice(0, 6)}`,
      timezone: city.tz,
      subscriptionTier: pick(["starter", "professional", "enterprise"]) as any,
      subscriptionStatus: "active",
      settings: { city: city.name, vehicleTypes: pickN(VEHICLE_TYPES, rand(2, 4)) },
    }).returning();

    // Create admin
    await db.insert(schema.users).values({
      tenantId: tenant.id,
      email: `admin@${slug}.ucm.test`,
      passwordHash: hashPassword(),
      role: "admin",
      firstName: "Admin",
      lastName: companyName.split(" ")[0],
      active: true,
    });
    totalUsers++;

    // Create dispatchers
    for (let d = 0; d < 3; d++) {
      await db.insert(schema.users).values({
        tenantId: tenant.id,
        email: `dispatch${d + 1}@${slug}.ucm.test`,
        passwordHash: hashPassword(),
        role: "dispatcher",
        firstName: pick(FIRST_NAMES),
        lastName: pick(LAST_NAMES),
        active: true,
      });
      totalUsers++;
    }

    // Create clinic users
    const clinicUsers: string[] = [];
    for (let c = 0; c < config.clinicsPerTenant; c++) {
      const [clinic] = await db.insert(schema.users).values({
        tenantId: tenant.id,
        email: `clinic${c + 1}@${slug}.ucm.test`,
        passwordHash: hashPassword(),
        role: "clinic",
        firstName: pick(CLINIC_TYPES).split(" ")[0],
        lastName: `Clinic ${c + 1}`,
        active: true,
      }).returning();
      clinicUsers.push(clinic.id);
      totalUsers++;
    }

    // Create drivers with status
    const driverIds: string[] = [];
    for (let d = 0; d < config.driversPerTenant; d++) {
      const [driver] = await db.insert(schema.users).values({
        tenantId: tenant.id,
        email: `driver${d + 1}@${slug}.ucm.test`,
        passwordHash: hashPassword(),
        role: "driver",
        firstName: pick(FIRST_NAMES),
        lastName: pick(LAST_NAMES),
        active: d < config.driversPerTenant * 0.9, // 10% inactive
      }).returning();
      driverIds.push(driver.id);
      totalUsers++;

      // Create driver status with realistic location
      const avail = d < config.driversPerTenant * 0.4 ? "available"
        : d < config.driversPerTenant * 0.65 ? "busy"
        : d < config.driversPerTenant * 0.85 ? "offline"
        : "break";

      await db.insert(schema.driverStatus).values({
        driverId: driver.id,
        tenantId: tenant.id,
        availability: avail as any,
        latitude: jitter(city.lat, 0.08).toFixed(7),
        longitude: jitter(city.lng, 0.08).toFixed(7),
        heading: rand(0, 359),
        speed: avail === "available" || avail === "busy" ? rand(0, 45) : 0,
        lastLocationAt: avail === "offline" ? pastDate(rand(1, 7)) : new Date(Date.now() - rand(0, 900000)),
      });
    }

    // Create patients
    const patientIds: string[] = [];
    for (let p = 0; p < config.patientsPerTenant; p++) {
      const [patient] = await db.insert(schema.patients).values({
        tenantId: tenant.id,
        firstName: pick(FIRST_NAMES),
        lastName: pick(LAST_NAMES),
        dateOfBirth: `${rand(1940, 2005)}-${String(rand(1, 12)).padStart(2, "0")}-${String(rand(1, 28)).padStart(2, "0")}`,
        phone: generatePhone(),
        email: `patient${p + 1}@${slug}.ucm.test`,
        address: generateAddress(city),
        insuranceId: `INS-${rand(100000, 999999)}`,
        notes: Math.random() > 0.7 ? pick(TRIP_NOTES.filter(n => n)) : null,
      }).returning();
      patientIds.push(patient.id);
      totalPatients++;
    }

    // Create trips with realistic distribution
    const activeDrivers = driverIds.slice(0, Math.floor(driverIds.length * 0.65));
    for (let tr = 0; tr < config.tripsPerTenant; tr++) {
      const isCompleted = tr < config.tripsPerTenant * 0.55;
      const isCancelled = !isCompleted && tr < config.tripsPerTenant * 0.65;
      const isActive = !isCompleted && !isCancelled && tr < config.tripsPerTenant * 0.85;
      const isRequested = !isCompleted && !isCancelled && !isActive;

      let status: string;
      let driverId: string | null = null;
      let startedAt: Date | null = null;
      let completedAt: Date | null = null;

      if (isCompleted) {
        status = "completed";
        driverId = pick(activeDrivers);
        startedAt = pastDate(rand(1, 30));
        completedAt = new Date(startedAt.getTime() + rand(15, 90) * 60000);
      } else if (isCancelled) {
        status = "cancelled";
        driverId = Math.random() > 0.3 ? pick(activeDrivers) : null;
      } else if (isActive) {
        status = pick(["assigned", "en_route", "arrived", "in_progress"]);
        driverId = pick(activeDrivers);
        if (status !== "assigned") startedAt = new Date(Date.now() - rand(5, 60) * 60000);
      } else {
        status = "requested";
      }

      const isImmediate = Math.random() > 0.8;
      const pickupCoord = { lat: jitter(city.lat, 0.06), lng: jitter(city.lng, 0.06) };
      const dropoffCoord = { lat: jitter(city.lat, 0.06), lng: jitter(city.lng, 0.06) };

      const estimatedMiles = Math.round(randFloat(1, 25) * 100) / 100;
      const estimatedMinutes = Math.round(estimatedMiles / 25 * 60 * randFloat(1.1, 1.5));

      await db.insert(schema.trips).values({
        tenantId: tenant.id,
        patientId: pick(patientIds),
        driverId,
        status: status as any,
        pickupAddress: generateAddress(city),
        dropoffAddress: generateAddress(city),
        pickupLat: pickupCoord.lat.toFixed(7),
        pickupLng: pickupCoord.lng.toFixed(7),
        dropoffLat: dropoffCoord.lat.toFixed(7),
        dropoffLng: dropoffCoord.lng.toFixed(7),
        estimatedMiles: estimatedMiles.toFixed(2),
        estimatedMinutes,
        scheduledAt: isCompleted ? pastDate(rand(1, 30)) : isActive ? new Date() : futureDate(rand(0, 14)),
        startedAt,
        completedAt,
        timezone: city.tz,
        mileage: isCompleted ? (estimatedMiles * randFloat(0.9, 1.15)).toFixed(2) : null,
        notes: Math.random() > 0.6 ? pick(TRIP_NOTES) : null,
        metadata: {
          isImmediate,
          seeded: true,
          vehicleType: pick(VEHICLE_TYPES),
          ...(isCompleted && driverId ? { acceptedAt: startedAt?.toISOString(), acceptedByDriver: true } : {}),
          ...(isCancelled ? { cancelledAt: pastDate(rand(1, 7)).toISOString(), cancellationReason: pick(["Patient no-show", "Clinic cancelled", "Driver unavailable", "Weather"]) } : {}),
        },
      });
      totalTrips++;
    }

    // Create some fee rules
    await db.insert(schema.feeRules).values([
      { tenantId: tenant.id, name: "Base fare", type: "flat", amount: "5.0000", priority: 1, active: true },
      { tenantId: tenant.id, name: "Per mile", type: "per_mile", amount: "2.5000", priority: 2, active: true },
      { tenantId: tenant.id, name: "Wheelchair surcharge", type: "surcharge", amount: "15.0000", priority: 3, active: true, conditions: { requiresWheelchair: true } },
      { tenantId: tenant.id, name: "After hours", type: "surcharge", amount: "10.0000", priority: 4, active: true, conditions: { afterHours: true } },
    ]);
  }

  console.log(`\nSeeding complete!`);
  console.log(`  Tenants: ${config.tenants}`);
  console.log(`  Users: ${totalUsers} (admins + dispatchers + clinics + drivers)`);
  console.log(`  Patients: ${totalPatients}`);
  console.log(`  Trips: ${totalTrips}`);
  console.log(`  Size: ${size}`);

  await pool.end();
}

main().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
