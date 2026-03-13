/**
 * UCM Test User Matrix — Creates one user per role for all portals
 * Safe to run multiple times (idempotent — skips existing users)
 *
 * Usage: npx tsx scripts/create-test-users.ts
 */

import { db } from "../server/db";
import { storage } from "../server/storage";
import { hashPassword } from "../server/auth";
import { generatePublicId } from "../server/public-id";
import {
  users, companies, cities, clinics, pharmacies, brokers, drivers, patients, trips,
  userCityAccess, dispatcherCityPermissions,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const PASSWORD = "UCM_Test_2026!";

interface TestUser {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  portal: string;
  entityLink?: "driver" | "clinic" | "pharmacy" | "broker";
}

const TEST_USERS: TestUser[] = [
  { email: "superadmin@ucm-test.com", firstName: "Super", lastName: "Admin UCM", role: "SUPER_ADMIN", portal: "Main (full access)" },
  { email: "admin@ucm-test.com", firstName: "Company", lastName: "Admin UCM", role: "ADMIN", portal: "Main admin portal" },
  { email: "companyadmin@ucm-test.com", firstName: "Company", lastName: "Admin Test", role: "COMPANY_ADMIN", portal: "Company management" },
  { email: "dispatch@ucm-test.com", firstName: "Dispatcher", lastName: "Test", role: "DISPATCH", portal: "Dispatch board, live map" },
  { email: "driver@ucm-test.com", firstName: "Test", lastName: "Driver", role: "DRIVER", portal: "Driver App v4", entityLink: "driver" },
  { email: "viewer@ucm-test.com", firstName: "Read Only", lastName: "Viewer", role: "VIEWER", portal: "Main portal (read-only)" },
  { email: "clinic.admin@ucm-test.com", firstName: "Clinic", lastName: "Admin Test", role: "CLINIC_ADMIN", portal: "Clinic portal", entityLink: "clinic" },
  { email: "clinic.user@ucm-test.com", firstName: "Clinic", lastName: "User Test", role: "CLINIC_USER", portal: "Clinic portal (limited)", entityLink: "clinic" },
  { email: "clinic.viewer@ucm-test.com", firstName: "Clinic", lastName: "Viewer Test", role: "CLINIC_VIEWER", portal: "Clinic portal (read-only)", entityLink: "clinic" },
  { email: "pharmacy.admin@ucm-test.com", firstName: "Pharmacy", lastName: "Admin Test", role: "PHARMACY_ADMIN", portal: "Pharmacy portal", entityLink: "pharmacy" },
  { email: "pharmacy.user@ucm-test.com", firstName: "Pharmacy", lastName: "User Test", role: "PHARMACY_USER", portal: "Pharmacy portal (limited)", entityLink: "pharmacy" },
  { email: "broker.admin@ucm-test.com", firstName: "Broker", lastName: "Admin Test", role: "BROKER_ADMIN", portal: "Broker portal", entityLink: "broker" },
  { email: "broker.user@ucm-test.com", firstName: "Broker", lastName: "User Test", role: "BROKER_USER", portal: "Broker portal (limited)", entityLink: "broker" },
];

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log(" UCM TEST USER MATRIX — Creating test users");
  console.log("═══════════════════════════════════════════════════════\n");

  // ── STEP 1: Query existing data ──
  console.log("📋 Step 1: Querying existing data...\n");

  const existingCompanies = await db.select().from(companies).limit(5);
  const existingCities = await db.select().from(cities).limit(5);
  const existingClinics = await db.select().from(clinics).limit(3);
  const existingPharmacies = await db.select().from(pharmacies).limit(3);
  const existingBrokers = await db.select().from(brokers).limit(3);
  const existingUsers = await db.select({ email: users.email, role: users.role }).from(users).limit(20);

  console.log(`  Companies: ${existingCompanies.map(c => `${c.id}:${c.name}`).join(", ") || "NONE"}`);
  console.log(`  Cities:    ${existingCities.map(c => `${c.id}:${c.name}`).join(", ") || "NONE"}`);
  console.log(`  Clinics:   ${existingClinics.map(c => `${c.id}:${c.name}`).join(", ") || "NONE"}`);
  console.log(`  Pharmacies:${existingPharmacies.map(p => `${p.id}:${p.name}`).join(", ") || "NONE"}`);
  console.log(`  Brokers:   ${existingBrokers.map(b => `${b.id}:${b.name}`).join(", ") || "NONE"}`);
  console.log(`  Users:     ${existingUsers.map(u => `${u.email}(${u.role})`).join(", ") || "NONE"}`);
  console.log();

  // ── STEP 2: Ensure required entities exist ──
  console.log("📋 Step 2: Ensuring required entities exist...\n");

  let companyId: number;
  if (existingCompanies.length > 0) {
    companyId = existingCompanies[0].id;
    console.log(`  Using existing company: ${existingCompanies[0].name} (ID: ${companyId})`);
  } else {
    const [newCompany] = await db.insert(companies).values({ name: "UCM Test Company" }).returning();
    companyId = newCompany.id;
    console.log(`  Created company: UCM Test Company (ID: ${companyId})`);
  }

  let cityId: number;
  if (existingCities.length > 0) {
    cityId = existingCities[0].id;
    console.log(`  Using existing city: ${existingCities[0].name} (ID: ${cityId})`);
  } else {
    const city = await storage.createCity({ name: "Las Vegas", state: "NV", timezone: "America/Los_Angeles", active: true } as any);
    cityId = city.id;
    console.log(`  Created city: Las Vegas (ID: ${cityId})`);
  }

  let clinicId: number;
  if (existingClinics.length > 0) {
    clinicId = existingClinics[0].id;
    console.log(`  Using existing clinic: ${existingClinics[0].name} (ID: ${clinicId})`);
  } else {
    const clinic = await storage.createClinic({
      publicId: await generatePublicId(), companyId, cityId,
      name: "UCM Test Clinic", address: "100 Test St, Las Vegas, NV 89101",
      phone: "(702) 555-0001", contactName: "Dr. Test", active: true,
    } as any);
    clinicId = clinic.id;
    console.log(`  Created clinic: UCM Test Clinic (ID: ${clinicId})`);
  }

  let pharmacyId: number;
  if (existingPharmacies.length > 0) {
    pharmacyId = existingPharmacies[0].id;
    console.log(`  Using existing pharmacy: ${existingPharmacies[0].name} (ID: ${pharmacyId})`);
  } else {
    const [pharmacy] = await db.insert(pharmacies).values({
      publicId: await generatePublicId(), companyId, cityId,
      name: "UCM Test Pharmacy", address: "200 Pharmacy Blvd, Las Vegas, NV 89101",
      phone: "(702) 555-0002", contactName: "Pharmacist Test", active: true,
    }).returning();
    pharmacyId = pharmacy.id;
    console.log(`  Created pharmacy: UCM Test Pharmacy (ID: ${pharmacyId})`);
  }

  let brokerId: number;
  if (existingBrokers.length > 0) {
    brokerId = existingBrokers[0].id;
    console.log(`  Using existing broker: ${existingBrokers[0].name} (ID: ${brokerId})`);
  } else {
    const [broker] = await db.insert(brokers).values({
      publicId: await generatePublicId(),
      name: "UCM Test Broker", type: "PRIVATE_PAYER", status: "APPROVED",
      email: "broker@ucm-test.com", phone: "(702) 555-0003", contactName: "Broker Contact",
    }).returning();
    brokerId = broker.id;
    console.log(`  Created broker: UCM Test Broker (ID: ${brokerId})`);
  }
  console.log();

  // ── STEP 3: Create test driver record ──
  console.log("📋 Step 3: Creating driver record...\n");

  let testDriverId: number;
  const existingDrivers = await db.select().from(drivers).limit(1);
  if (existingDrivers.length > 0) {
    testDriverId = existingDrivers[0].id;
    console.log(`  Using existing driver: ${existingDrivers[0].firstName} ${existingDrivers[0].lastName} (ID: ${testDriverId})`);
  } else {
    const driver = await storage.createDriver({
      publicId: await generatePublicId(), companyId, cityId,
      firstName: "Test", lastName: "Driver",
      phone: "(702) 555-0100", licenseNumber: "NV-DL-TEST001",
      status: "ACTIVE", userId: null,
    } as any);
    testDriverId = driver.id;
    console.log(`  Created driver: Test Driver (ID: ${testDriverId})`);
  }
  console.log();

  // ── STEP 4: Hash password once ──
  const hashedPassword = await hashPassword(PASSWORD);
  console.log("🔐 Password hashed (bcrypt, 10 rounds)\n");

  // ── STEP 5: Create all test users ──
  console.log("📋 Step 4: Creating test users...\n");

  const results: { email: string; role: string; status: string; portal: string }[] = [];

  for (const tu of TEST_USERS) {
    const existing = await storage.getUserByEmail(tu.email);
    if (existing) {
      results.push({ email: tu.email, role: tu.role, status: "⚠️  Already existed", portal: tu.portal });
      console.log(`  ⚠️  ${tu.email} (${tu.role}) — already exists`);
      continue;
    }

    try {
      const userData: any = {
        publicId: await generatePublicId(),
        email: tu.email,
        password: hashedPassword,
        firstName: tu.firstName,
        lastName: tu.lastName,
        role: tu.role,
        phone: null,
        active: true,
      };

      // Set companyId for non-SUPER_ADMIN roles
      if (tu.role !== "SUPER_ADMIN") {
        userData.companyId = companyId;
      }

      // Link entity references
      if (tu.entityLink === "driver") userData.driverId = testDriverId;
      if (tu.entityLink === "clinic") userData.clinicId = clinicId;
      if (tu.entityLink === "pharmacy") userData.pharmacyId = pharmacyId;
      if (tu.entityLink === "broker") userData.brokerId = brokerId;

      const created = await storage.createUser(userData);

      // Set city access
      if (tu.role === "DISPATCH") {
        // Dispatchers use dispatcherCityPermissions table
        await db.insert(dispatcherCityPermissions).values({
          userId: created.id, companyId, cityId,
        }).onConflictDoNothing();
      } else if (tu.role !== "SUPER_ADMIN") {
        await storage.setUserCityAccess(created.id, [cityId]);
      }

      // Link driver record back to user
      if (tu.entityLink === "driver") {
        await db.update(drivers).set({ userId: created.id }).where(eq(drivers.id, testDriverId));
      }

      results.push({ email: tu.email, role: tu.role, status: "✅ Created", portal: tu.portal });
      console.log(`  ✅ ${tu.email} (${tu.role}) — created`);
    } catch (err: any) {
      results.push({ email: tu.email, role: tu.role, status: `❌ Failed: ${err.message}`, portal: tu.portal });
      console.log(`  ❌ ${tu.email} (${tu.role}) — FAILED: ${err.message}`);
    }
  }
  console.log();

  // ── STEP 6: Create test patient ──
  console.log("📋 Step 5: Creating test seed data...\n");

  let testPatientId: number;
  const existingPatients = await db.select().from(patients).limit(1);
  if (existingPatients.length > 0) {
    testPatientId = existingPatients[0].id;
    console.log(`  Using existing patient: ${existingPatients[0].firstName} ${existingPatients[0].lastName}`);
  } else {
    const patient = await storage.createPatient({
      publicId: await generatePublicId(), companyId, cityId,
      clinicId, firstName: "John", lastName: "Test Patient",
      phone: "+15551234567", address: "300 Patient Ave, Las Vegas, NV 89101",
      active: true, wheelchairRequired: false,
    } as any);
    testPatientId = patient.id;
    console.log(`  ✅ Created test patient: John Test Patient`);
  }

  // ── STEP 7: Create test trips ──
  const existingTrips = await db.select().from(trips).limit(1);
  if (existingTrips.length > 0) {
    console.log(`  Trips already exist (${existingTrips.length}+), skipping trip creation`);
  } else {
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const fmt = (d: Date) => d.toISOString().split("T")[0];

    const tripConfigs = [
      { status: "SCHEDULED", date: fmt(tomorrow), time: "09:00", driverId: testDriverId, notes: "Future scheduled trip" },
      { status: "IN_PROGRESS", date: fmt(today), time: "10:00", driverId: testDriverId, notes: "Active trip — driver en route" },
      { status: "COMPLETED", date: fmt(yesterday), time: "14:00", driverId: testDriverId, notes: "Completed yesterday" },
      { status: "CANCELLED", date: fmt(yesterday), time: "16:00", driverId: null, notes: "Cancelled trip" },
      { status: "SCHEDULED", date: fmt(tomorrow), time: "11:00", driverId: null, notes: "Unassigned — needs dispatch" },
    ];

    for (const tc of tripConfigs) {
      await storage.createTrip({
        publicId: await generatePublicId(), companyId, cityId,
        patientId: testPatientId, driverId: tc.driverId, vehicleId: null, clinicId,
        pickupAddress: "300 Patient Ave, Las Vegas, NV 89101",
        dropoffAddress: "100 Test St, Las Vegas, NV 89101",
        scheduledDate: tc.date, scheduledTime: tc.time, pickupTime: tc.time,
        status: tc.status, notes: tc.notes,
      } as any);
    }
    console.log(`  ✅ Created 5 test trips (SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED, unassigned)`);
  }
  console.log();

  // ── STEP 8: Verify logins ──
  console.log("📋 Step 6: Verifying password hashes...\n");
  const bcrypt = await import("bcryptjs");
  for (const tu of TEST_USERS) {
    const user = await storage.getUserByEmail(tu.email);
    if (!user) {
      console.log(`  ❌ ${tu.email} — user not found!`);
      continue;
    }
    const match = await bcrypt.compare(PASSWORD, user.password);
    console.log(`  ${match ? "✅" : "❌"} ${tu.email} — password ${match ? "OK" : "MISMATCH!"}`);
  }
  console.log();

  // ── STEP 9: Output credentials document ──
  const clinicName = existingClinics[0]?.name || "UCM Test Clinic";
  const pharmacyName = existingPharmacies[0]?.name || "UCM Test Pharmacy";
  const brokerName = existingBrokers[0]?.name || "UCM Test Broker";

  console.log(`
════════════════════════════════════════════════════════════
UCM TEST CREDENTIALS — ALL PORTALS
Generated: ${new Date().toISOString()}
Password for ALL users: ${PASSWORD}
════════════════════════════════════════════════════════════

🔐 SUPER ADMIN (full platform access)
   URL:      app.unitedcaremobility.com/login
   Email:    superadmin@ucm-test.com
   Password: ${PASSWORD}
   Can see:  Everything — all companies, all cities, system health
   Status:   ${results.find(r => r.email === "superadmin@ucm-test.com")?.status}

🔐 COMPANY ADMIN (ADMIN role)
   URL:      app.unitedcaremobility.com/login
   Email:    admin@ucm-test.com
   Password: ${PASSWORD}
   Can see:  All company operations, billing, users
   Status:   ${results.find(r => r.email === "admin@ucm-test.com")?.status}

🔐 COMPANY ADMIN (COMPANY_ADMIN role)
   URL:      app.unitedcaremobility.com/login
   Email:    companyadmin@ucm-test.com
   Password: ${PASSWORD}
   Can see:  Company-scoped administration
   Status:   ${results.find(r => r.email === "companyadmin@ucm-test.com")?.status}

🔐 DISPATCHER
   URL:      app.unitedcaremobility.com/dispatch-board OR /live-map
   Email:    dispatch@ucm-test.com
   Password: ${PASSWORD}
   Can see:  Live map, trip assignment, driver management
   Status:   ${results.find(r => r.email === "dispatch@ucm-test.com")?.status}

🔐 DRIVER (mobile app + web)
   URL:      driver.unitedcaremobility.com OR app.unitedcaremobility.com/driver
   Email:    driver@ucm-test.com
   Password: ${PASSWORD}
   Can see:  Driver dashboard, trip offers, earnings
   Status:   ${results.find(r => r.email === "driver@ucm-test.com")?.status}

🔐 VIEWER (read-only)
   URL:      app.unitedcaremobility.com/login
   Email:    viewer@ucm-test.com
   Password: ${PASSWORD}
   Can see:  Dashboard and reports (no create/edit/delete)
   Status:   ${results.find(r => r.email === "viewer@ucm-test.com")?.status}

🔐 CLINIC ADMIN
   URL:      clinic.unitedcaremobility.com OR app.unitedcaremobility.com/clinic
   Email:    clinic.admin@ucm-test.com
   Password: ${PASSWORD}
   Clinic:   ${clinicName}
   Can see:  All clinic features, users, billing
   Status:   ${results.find(r => r.email === "clinic.admin@ucm-test.com")?.status}

🔐 CLINIC USER
   URL:      clinic.unitedcaremobility.com
   Email:    clinic.user@ucm-test.com
   Password: ${PASSWORD}
   Can see:  Request trips, view status (cannot manage users/billing)
   Status:   ${results.find(r => r.email === "clinic.user@ucm-test.com")?.status}

🔐 CLINIC VIEWER
   URL:      clinic.unitedcaremobility.com
   Email:    clinic.viewer@ucm-test.com
   Password: ${PASSWORD}
   Can see:  Trip history only (read-only, cannot create trips)
   Status:   ${results.find(r => r.email === "clinic.viewer@ucm-test.com")?.status}

🔐 PHARMACY ADMIN
   URL:      pharmacy.unitedcaremobility.com OR app.unitedcaremobility.com/pharmacy
   Email:    pharmacy.admin@ucm-test.com
   Password: ${PASSWORD}
   Pharmacy: ${pharmacyName}
   Can see:  All pharmacy features, orders, billing
   Status:   ${results.find(r => r.email === "pharmacy.admin@ucm-test.com")?.status}

🔐 PHARMACY USER
   URL:      pharmacy.unitedcaremobility.com
   Email:    pharmacy.user@ucm-test.com
   Password: ${PASSWORD}
   Can see:  Create/track orders (cannot manage settings/billing)
   Status:   ${results.find(r => r.email === "pharmacy.user@ucm-test.com")?.status}

🔐 BROKER ADMIN
   URL:      broker.unitedcaremobility.com OR app.unitedcaremobility.com/broker
   Email:    broker.admin@ucm-test.com
   Password: ${PASSWORD}
   Broker:   ${brokerName}
   Can see:  All broker features, contracts, settlements, analytics
   Status:   ${results.find(r => r.email === "broker.admin@ucm-test.com")?.status}

🔐 BROKER USER
   URL:      broker.unitedcaremobility.com
   Email:    broker.user@ucm-test.com
   Password: ${PASSWORD}
   Can see:  Submit trips, view marketplace (cannot manage contracts)
   Status:   ${results.find(r => r.email === "broker.user@ucm-test.com")?.status}

════════════════════════════════════════════════════════════
PORTAL URLS SUMMARY
════════════════════════════════════════════════════════════
Main/Admin:     app.unitedcaremobility.com
Dispatch:       app.unitedcaremobility.com/dispatch-board
Clinic Portal:  clinic.unitedcaremobility.com
Pharmacy Portal:pharmacy.unitedcaremobility.com
Broker Portal:  broker.unitedcaremobility.com
Driver App:     driver.unitedcaremobility.com

════════════════════════════════════════════════════════════
AUTH SYSTEM NOTES
════════════════════════════════════════════════════════════
• Password hashing: bcrypt (10 rounds)
• Login: email + password → JWT token (24h) + HTTP-only cookie
• Magic link login also supported (but password login works)
• No email verification required — users can login immediately
• No 2FA or IP allowlist
• Driver device binding: optional (env DRIVER_DEVICE_BINDING)
• Token includes: userId, role, companyId, clinicId, driverId,
  pharmacyId, brokerId

════════════════════════════════════════════════════════════
HOW TO RUN:
  npx tsx scripts/create-test-users.ts
  (Safe to run multiple times — skips existing users)
════════════════════════════════════════════════════════════
`);

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
