import { db, pool } from "../db";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as s from "@shared/schema";

const SEED_TAG = "SEED_UCM";

async function generatePublicId(): Promise<string> {
  await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS public_id_seq START WITH 1 INCREMENT BY 1`);
  const result = await db.execute(
    sql`SELECT COALESCE(MAX(num), 0) as max_num FROM (
      SELECT CASE WHEN public_id ~ '^01UCM[0-9]+$'
        THEN CAST(SUBSTRING(public_id FROM 6) AS INTEGER)
        ELSE 0
      END as num FROM (
        SELECT public_id FROM users
        UNION ALL SELECT public_id FROM vehicles
        UNION ALL SELECT public_id FROM drivers
        UNION ALL SELECT public_id FROM clinics
        UNION ALL SELECT public_id FROM patients
        UNION ALL SELECT public_id FROM trips
      ) all_ids
    ) nums`
  );
  const maxNum = parseInt((result as any).rows?.[0]?.max_num || "0");
  if (maxNum > 0) {
    await db.execute(sql`SELECT setval('public_id_seq', ${maxNum})`);
  }
  const r = await db.execute(sql`SELECT nextval('public_id_seq') as val`);
  const val = parseInt((r as any).rows[0].val);
  return `01UCM${String(val).padStart(6, "0")}`;
}

let pidCache: string[] = [];
async function nextPid(): Promise<string> {
  if (pidCache.length === 0) {
    for (let i = 0; i < 100; i++) {
      pidCache.push(await generatePublicId());
    }
  }
  return pidCache.shift()!;
}

async function hashPw(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

function log(msg: string) {
  console.log(`[${SEED_TAG}] ${msg}`);
}

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function pastTimestamp(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

async function seedCompanies() {
  log("Seeding companies...");
  const existing = await db.select().from(s.companies);
  if (existing.length >= 3) return existing;

  const toInsert = [
    { name: "United Care Mobility" },
    { name: "Metro Health Transport" },
    { name: "Valley Care Transit" },
  ];

  const results: any[] = [];
  for (const c of toInsert) {
    const ex = existing.find(e => e.name === c.name);
    if (ex) { results.push(ex); continue; }
    const [row] = await db.insert(s.companies).values(c).returning();
    results.push(row);
  }
  log(`  Companies: ${results.length}`);
  return results;
}

async function seedCities() {
  log("Seeding cities...");
  const existing = await db.select().from(s.cities);
  if (existing.length >= 8) return existing;

  const cityData = [
    { name: "Los Angeles", state: "CA", timezone: "America/Los_Angeles" },
    { name: "San Diego", state: "CA", timezone: "America/Los_Angeles" },
    { name: "Dallas", state: "TX", timezone: "America/Chicago" },
    { name: "Houston", state: "TX", timezone: "America/Chicago" },
    { name: "Phoenix", state: "AZ", timezone: "America/Phoenix" },
    { name: "Denver", state: "CO", timezone: "America/Denver" },
    { name: "Atlanta", state: "GA", timezone: "America/New_York" },
    { name: "Chicago", state: "IL", timezone: "America/Chicago" },
  ];

  const results: any[] = [...existing];
  for (const c of cityData) {
    if (results.find(e => e.name === c.name)) continue;
    const [row] = await db.insert(s.cities).values(c).returning();
    results.push(row);
  }
  log(`  Cities: ${results.length}`);
  return results;
}

async function seedUsers(companies: any[], cities: any[]) {
  log("Seeding users...");
  const existing = await db.select().from(s.users);
  if (existing.length >= 20) return existing;

  const hashedPw = await hashPw("SeedPass123!");

  const userData = [
    { email: "seed.superadmin@ucm.test", firstName: "Sarah", lastName: "Admin", role: "SUPER_ADMIN" as const, companyId: companies[0].id, phone: "555-100-0001" },
    { email: "seed.admin.la@ucm.test", firstName: "Marcus", lastName: "Rodriguez", role: "ADMIN" as const, companyId: companies[0].id, phone: "555-100-0002" },
    { email: "seed.dispatch.la@ucm.test", firstName: "Jennifer", lastName: "Chen", role: "DISPATCH" as const, companyId: companies[0].id, phone: "555-100-0003" },
    { email: "seed.dispatch2.la@ucm.test", firstName: "David", lastName: "Kim", role: "DISPATCH" as const, companyId: companies[0].id, phone: "555-100-0004" },
    { email: "seed.viewer.la@ucm.test", firstName: "Amy", lastName: "Patel", role: "VIEWER" as const, companyId: companies[0].id, phone: "555-100-0005" },
    { email: "seed.companyadmin.metro@ucm.test", firstName: "Robert", lastName: "Martinez", role: "COMPANY_ADMIN" as const, companyId: companies[1].id, phone: "555-200-0001" },
    { email: "seed.dispatch.metro@ucm.test", firstName: "Lisa", lastName: "Thompson", role: "DISPATCH" as const, companyId: companies[1].id, phone: "555-200-0002" },
    { email: "seed.admin.metro@ucm.test", firstName: "James", lastName: "Wilson", role: "ADMIN" as const, companyId: companies[1].id, phone: "555-200-0003" },
    { email: "seed.companyadmin.valley@ucm.test", firstName: "Patricia", lastName: "Brown", role: "COMPANY_ADMIN" as const, companyId: companies[2].id, phone: "555-300-0001" },
    { email: "seed.dispatch.valley@ucm.test", firstName: "Michael", lastName: "Davis", role: "DISPATCH" as const, companyId: companies[2].id, phone: "555-300-0002" },
    { email: "seed.viewer.valley@ucm.test", firstName: "Karen", lastName: "Taylor", role: "VIEWER" as const, companyId: companies[2].id, phone: "555-300-0003" },
  ];

  const results: any[] = [...existing];
  for (const u of userData) {
    if (results.find(e => e.email === u.email)) continue;
    const pid = await nextPid();
    const [row] = await db.insert(s.users).values({
      publicId: pid,
      email: u.email,
      password: hashedPw,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      companyId: u.companyId,
      phone: u.phone,
      active: true,
      mustChangePassword: false,
    }).returning();
    results.push(row);
  }

  log(`  Users: ${results.length}`);
  return results;
}

async function seedUserCityAccess(users: any[], cities: any[]) {
  log("Seeding user city access...");
  const existing = await db.select().from(s.userCityAccess);

  const cityMap: Record<string, number[]> = {
    "seed.superadmin@ucm.test": cities.map(c => c.id),
    "seed.admin.la@ucm.test": cities.filter(c => c.state === "CA").map(c => c.id),
    "seed.dispatch.la@ucm.test": cities.filter(c => c.name === "Los Angeles").map(c => c.id),
    "seed.dispatch2.la@ucm.test": cities.filter(c => c.name === "Los Angeles" || c.name === "San Diego").map(c => c.id),
    "seed.viewer.la@ucm.test": cities.filter(c => c.state === "CA").map(c => c.id),
    "seed.companyadmin.metro@ucm.test": cities.filter(c => c.state === "TX").map(c => c.id),
    "seed.dispatch.metro@ucm.test": cities.filter(c => c.name === "Dallas").map(c => c.id),
    "seed.admin.metro@ucm.test": cities.filter(c => c.state === "TX").map(c => c.id),
    "seed.companyadmin.valley@ucm.test": cities.filter(c => c.state === "AZ" || c.state === "CO").map(c => c.id),
    "seed.dispatch.valley@ucm.test": cities.filter(c => c.name === "Phoenix").map(c => c.id),
    "seed.viewer.valley@ucm.test": cities.filter(c => c.name === "Phoenix" || c.name === "Denver").map(c => c.id),
  };

  let count = 0;
  for (const [email, cityIds] of Object.entries(cityMap)) {
    const user = users.find(u => u.email === email);
    if (!user) continue;
    for (const cityId of cityIds) {
      const ex = existing.find(e => e.userId === user.id && e.cityId === cityId);
      if (ex) continue;
      await db.insert(s.userCityAccess).values({ userId: user.id, cityId });
      count++;
    }
  }
  log(`  City access entries added: ${count}`);
}

async function seedVehicleMakesModels() {
  log("Seeding vehicle makes/models...");
  const existing = await db.select().from(s.vehicleMakes);
  if (existing.length >= 5) return existing;

  const makes = ["Toyota", "Ford", "Chevrolet", "Honda", "Dodge"];
  const modelMap: Record<string, string[]> = {
    "Toyota": ["Sienna", "Camry", "RAV4"],
    "Ford": ["Transit", "Explorer", "Escape"],
    "Chevrolet": ["Express", "Equinox", "Suburban"],
    "Honda": ["Odyssey", "CR-V", "Pilot"],
    "Dodge": ["Grand Caravan", "Durango", "Ram ProMaster"],
  };

  const results: any[] = [];
  for (const name of makes) {
    let make = existing.find(e => e.name === name);
    if (!make) {
      [make] = await db.insert(s.vehicleMakes).values({ name }).returning();
    }
    results.push(make);
    for (const modelName of modelMap[name]) {
      const existingModels = await db.select().from(s.vehicleModels).where(eq(s.vehicleModels.makeId, make!.id));
      if (!existingModels.find(m => m.name === modelName)) {
        await db.insert(s.vehicleModels).values({ makeId: make!.id, name: modelName });
      }
    }
  }
  log(`  Makes: ${results.length}`);
  return results;
}

async function seedVehicles(companies: any[], cities: any[]) {
  log("Seeding vehicles...");
  const existing = await db.select().from(s.vehicles);
  if (existing.length >= 16) return existing;

  const colors = ["#6366F1", "#10B981", "#F59E0B", "#EF4444", "#3B82F6", "#8B5CF6"];
  const vData = [
    { name: "V-LA-001", licensePlate: "UCM-LA01", cityIdx: 0, companyIdx: 0, cap: "SEDAN", wheelchair: false, year: 2022, make: "Toyota", model: "Camry" },
    { name: "V-LA-002", licensePlate: "UCM-LA02", cityIdx: 0, companyIdx: 0, cap: "WHEELCHAIR", wheelchair: true, year: 2023, make: "Toyota", model: "Sienna" },
    { name: "V-LA-003", licensePlate: "UCM-LA03", cityIdx: 0, companyIdx: 0, cap: "SEDAN", wheelchair: false, year: 2021, make: "Honda", model: "Odyssey" },
    { name: "V-LA-004", licensePlate: "UCM-LA04", cityIdx: 0, companyIdx: 0, cap: "SEDAN", wheelchair: false, year: 2023, make: "Ford", model: "Transit" },
    { name: "V-SD-001", licensePlate: "UCM-SD01", cityIdx: 1, companyIdx: 0, cap: "SEDAN", wheelchair: false, year: 2022, make: "Chevrolet", model: "Equinox" },
    { name: "V-SD-002", licensePlate: "UCM-SD02", cityIdx: 1, companyIdx: 0, cap: "WHEELCHAIR", wheelchair: true, year: 2023, make: "Dodge", model: "Grand Caravan" },
    { name: "V-DAL-001", licensePlate: "MHT-D01", cityIdx: 2, companyIdx: 1, cap: "SEDAN", wheelchair: false, year: 2022, make: "Ford", model: "Explorer" },
    { name: "V-DAL-002", licensePlate: "MHT-D02", cityIdx: 2, companyIdx: 1, cap: "WHEELCHAIR", wheelchair: true, year: 2023, make: "Ford", model: "Transit" },
    { name: "V-DAL-003", licensePlate: "MHT-D03", cityIdx: 2, companyIdx: 1, cap: "SEDAN", wheelchair: false, year: 2021, make: "Toyota", model: "RAV4" },
    { name: "V-HOU-001", licensePlate: "MHT-H01", cityIdx: 3, companyIdx: 1, cap: "SEDAN", wheelchair: false, year: 2022, make: "Honda", model: "Pilot" },
    { name: "V-HOU-002", licensePlate: "MHT-H02", cityIdx: 3, companyIdx: 1, cap: "WHEELCHAIR", wheelchair: true, year: 2023, make: "Chevrolet", model: "Express" },
    { name: "V-PHX-001", licensePlate: "VCT-P01", cityIdx: 4, companyIdx: 2, cap: "SEDAN", wheelchair: false, year: 2022, make: "Toyota", model: "Sienna" },
    { name: "V-PHX-002", licensePlate: "VCT-P02", cityIdx: 4, companyIdx: 2, cap: "WHEELCHAIR", wheelchair: true, year: 2023, make: "Dodge", model: "Grand Caravan" },
    { name: "V-PHX-003", licensePlate: "VCT-P03", cityIdx: 4, companyIdx: 2, cap: "SEDAN", wheelchair: false, year: 2021, make: "Honda", model: "CR-V" },
    { name: "V-DEN-001", licensePlate: "VCT-DN01", cityIdx: 5, companyIdx: 2, cap: "SEDAN", wheelchair: false, year: 2022, make: "Ford", model: "Escape" },
    { name: "V-DEN-002", licensePlate: "VCT-DN02", cityIdx: 5, companyIdx: 2, cap: "WHEELCHAIR", wheelchair: true, year: 2023, make: "Chevrolet", model: "Suburban" },
  ];

  const results: any[] = [...existing];
  for (let i = 0; i < vData.length; i++) {
    const v = vData[i];
    if (results.find(e => e.licensePlate === v.licensePlate)) continue;
    const city = cities[v.cityIdx];
    const company = companies[v.companyIdx];
    if (!city || !company) continue;
    const pid = await nextPid();
    const [row] = await db.insert(s.vehicles).values({
      publicId: pid,
      cityId: city.id,
      name: v.name,
      licensePlate: v.licensePlate,
      colorHex: colors[i % colors.length],
      makeText: v.make,
      modelText: v.model,
      year: v.year,
      capacity: v.wheelchair ? 2 : 4,
      wheelchairAccessible: v.wheelchair,
      capability: v.cap,
      status: "ACTIVE",
      companyId: company.id,
      active: true,
    }).returning();
    results.push(row);
  }
  log(`  Vehicles: ${results.length}`);
  return results;
}

async function seedDrivers(companies: any[], cities: any[], vehicles: any[], users: any[]) {
  log("Seeding drivers...");
  const existing = await db.select().from(s.drivers);
  if (existing.length >= 12) return existing;

  const hashedPw = await hashPw("DriverPass123!");

  const dData = [
    { firstName: "Carlos", lastName: "Garcia", email: "seed.driver.carlos@ucm.test", phone: "555-110-0001", cityIdx: 0, companyIdx: 0, vehicleLp: "UCM-LA01", license: "DL-CA-001" },
    { firstName: "Aisha", lastName: "Johnson", email: "seed.driver.aisha@ucm.test", phone: "555-110-0002", cityIdx: 0, companyIdx: 0, vehicleLp: "UCM-LA02", license: "DL-CA-002" },
    { firstName: "Tommy", lastName: "Nguyen", email: "seed.driver.tommy@ucm.test", phone: "555-110-0003", cityIdx: 0, companyIdx: 0, vehicleLp: "UCM-LA03", license: "DL-CA-003" },
    { firstName: "Maria", lastName: "Santos", email: "seed.driver.maria@ucm.test", phone: "555-110-0004", cityIdx: 1, companyIdx: 0, vehicleLp: "UCM-SD01", license: "DL-CA-004" },
    { firstName: "Derek", lastName: "Washington", email: "seed.driver.derek@ucm.test", phone: "555-210-0001", cityIdx: 2, companyIdx: 1, vehicleLp: "MHT-D01", license: "DL-TX-001" },
    { firstName: "Priya", lastName: "Sharma", email: "seed.driver.priya@ucm.test", phone: "555-210-0002", cityIdx: 2, companyIdx: 1, vehicleLp: "MHT-D02", license: "DL-TX-002" },
    { firstName: "Kevin", lastName: "Lee", email: "seed.driver.kevin@ucm.test", phone: "555-210-0003", cityIdx: 3, companyIdx: 1, vehicleLp: "MHT-H01", license: "DL-TX-003" },
    { firstName: "Sandra", lastName: "Jackson", email: "seed.driver.sandra@ucm.test", phone: "555-210-0004", cityIdx: 3, companyIdx: 1, vehicleLp: "MHT-H02", license: "DL-TX-004" },
    { firstName: "Andre", lastName: "Clark", email: "seed.driver.andre@ucm.test", phone: "555-310-0001", cityIdx: 4, companyIdx: 2, vehicleLp: "VCT-P01", license: "DL-AZ-001" },
    { firstName: "Linda", lastName: "White", email: "seed.driver.linda@ucm.test", phone: "555-310-0002", cityIdx: 4, companyIdx: 2, vehicleLp: "VCT-P02", license: "DL-AZ-002" },
    { firstName: "Oscar", lastName: "Ramirez", email: "seed.driver.oscar@ucm.test", phone: "555-310-0003", cityIdx: 5, companyIdx: 2, vehicleLp: "VCT-DN01", license: "DL-CO-001" },
    { firstName: "Helen", lastName: "Moore", email: "seed.driver.helen@ucm.test", phone: "555-310-0004", cityIdx: 5, companyIdx: 2, vehicleLp: "VCT-DN02", license: "DL-CO-002" },
  ];

  const results: any[] = [...existing];
  for (const d of dData) {
    if (results.find(e => e.email === d.email)) continue;
    const city = cities[d.cityIdx];
    const company = companies[d.companyIdx];
    const vehicle = vehicles.find(v => v.licensePlate === d.vehicleLp);
    if (!city || !company) continue;

    const driverPid = await nextPid();
    const userPid = await nextPid();

    const [driverUser] = await db.insert(s.users).values({
      publicId: userPid,
      email: d.email,
      password: hashedPw,
      firstName: d.firstName,
      lastName: d.lastName,
      role: "DRIVER",
      companyId: company.id,
      phone: d.phone,
      active: true,
      mustChangePassword: false,
    }).returning();

    const [driver] = await db.insert(s.drivers).values({
      publicId: driverPid,
      cityId: city.id,
      userId: driverUser.id,
      vehicleId: vehicle?.id ?? null,
      email: d.email,
      firstName: d.firstName,
      lastName: d.lastName,
      phone: d.phone,
      licenseNumber: d.license,
      status: "ACTIVE",
      dispatchStatus: "available",
      companyId: company.id,
      active: true,
    }).returning();

    await db.update(s.users).set({ driverId: driver.id }).where(eq(s.users.id, driverUser.id));

    await db.insert(s.userCityAccess).values({ userId: driverUser.id, cityId: city.id });

    results.push(driver);
  }
  log(`  Drivers: ${results.length}`);
  return results;
}

async function seedClinics(companies: any[], cities: any[], users: any[]) {
  log("Seeding clinics...");
  const existing = await db.select().from(s.clinics);
  if (existing.length >= 12) return existing;

  const hashedPw = await hashPw("ClinicPass123!");

  const cData = [
    { name: "Sunrise Medical Center", address: "1234 Sunset Blvd, Los Angeles, CA 90028", cityIdx: 0, companyIdx: 0, facilityType: "hospital" as const, phone: "555-120-0001", contact: "Dr. Emily Park", lat: 34.0987, lng: -118.3267 },
    { name: "Pacific Dialysis Clinic", address: "5678 Ocean Ave, Los Angeles, CA 90401", cityIdx: 0, companyIdx: 0, facilityType: "clinic" as const, phone: "555-120-0002", contact: "Nancy Reed", lat: 34.0195, lng: -118.4912 },
    { name: "Harbor Mental Health", address: "910 Harbor Dr, Los Angeles, CA 90710", cityIdx: 0, companyIdx: 0, facilityType: "mental" as const, phone: "555-120-0003", contact: "Dr. Steven Grant", lat: 33.7783, lng: -118.2646 },
    { name: "Coastal Care Clinic", address: "321 Coast Hwy, San Diego, CA 92101", cityIdx: 1, companyIdx: 0, facilityType: "clinic" as const, phone: "555-120-0004", contact: "Maria Lopez", lat: 32.7157, lng: -117.1611 },
    { name: "Dallas General Hospital", address: "4000 Medical District Dr, Dallas, TX 75235", cityIdx: 2, companyIdx: 1, facilityType: "hospital" as const, phone: "555-220-0001", contact: "Dr. John Miller", lat: 32.8120, lng: -96.8403 },
    { name: "Lone Star Dialysis", address: "2500 Ross Ave, Dallas, TX 75201", cityIdx: 2, companyIdx: 1, facilityType: "clinic" as const, phone: "555-220-0002", contact: "Brenda Scott", lat: 32.7876, lng: -96.7969 },
    { name: "Houston Care Center", address: "6100 Fannin St, Houston, TX 77030", cityIdx: 3, companyIdx: 1, facilityType: "hospital" as const, phone: "555-220-0003", contact: "Dr. Rachel Adams", lat: 29.7072, lng: -95.3971 },
    { name: "Bayou Mental Health", address: "3200 Montrose Blvd, Houston, TX 77006", cityIdx: 3, companyIdx: 1, facilityType: "mental" as const, phone: "555-220-0004", contact: "Thomas Hill", lat: 29.7420, lng: -95.3925 },
    { name: "Desert Springs Hospital", address: "1400 N Central Ave, Phoenix, AZ 85004", cityIdx: 4, companyIdx: 2, facilityType: "hospital" as const, phone: "555-320-0001", contact: "Dr. Susan Lee", lat: 33.4606, lng: -112.0740 },
    { name: "Cactus Dialysis Center", address: "2800 E Camelback Rd, Phoenix, AZ 85016", cityIdx: 4, companyIdx: 2, facilityType: "clinic" as const, phone: "555-320-0002", contact: "Frank Rivera", lat: 33.5092, lng: -111.9994 },
    { name: "Mile High Clinic", address: "1600 Champa St, Denver, CO 80202", cityIdx: 5, companyIdx: 2, facilityType: "clinic" as const, phone: "555-320-0003", contact: "Dr. Angela Wright", lat: 39.7473, lng: -104.9934 },
    { name: "Rocky Mountain Health", address: "4500 E 9th Ave, Denver, CO 80220", cityIdx: 5, companyIdx: 2, facilityType: "hospital" as const, phone: "555-320-0004", contact: "Chris Morgan", lat: 39.7319, lng: -104.9381 },
  ];

  const results: any[] = [...existing];
  for (const c of cData) {
    if (results.find(e => e.name === c.name)) continue;
    const city = cities[c.cityIdx];
    const company = companies[c.companyIdx];
    if (!city || !company) continue;

    const clinicPid = await nextPid();
    const clinicEmail = `seed.clinic.${c.name.toLowerCase().replace(/\s+/g, ".")}@ucm.test`;

    const [clinic] = await db.insert(s.clinics).values({
      publicId: clinicPid,
      cityId: city.id,
      name: c.name,
      address: c.address,
      email: clinicEmail,
      phone: c.phone,
      contactName: c.contact,
      facilityType: c.facilityType,
      companyId: company.id,
      lat: c.lat,
      lng: c.lng,
      active: true,
    }).returning();

    const userPid = await nextPid();
    const [clinicUser] = await db.insert(s.users).values({
      publicId: userPid,
      email: clinicEmail,
      password: hashedPw,
      firstName: c.contact.split(" ").slice(-1)[0],
      lastName: c.name.split(" ")[0],
      role: "CLINIC_USER",
      companyId: company.id,
      phone: c.phone,
      clinicId: clinic.id,
      active: true,
      mustChangePassword: false,
    }).returning();

    await db.insert(s.userCityAccess).values({ userId: clinicUser.id, cityId: city.id });

    results.push(clinic);
  }
  log(`  Clinics: ${results.length}`);
  return results;
}

async function seedPatients(companies: any[], cities: any[], clinics: any[]) {
  log("Seeding patients...");
  const existing = await db.select().from(s.patients);
  if (existing.length >= 20) return existing;

  const pData = [
    { firstName: "John", lastName: "Smith", phone: "555-400-0001", dob: "1955-03-15", insurance: "INS-001-UCM", wheelchair: false, cityIdx: 0, companyIdx: 0, clinicName: "Sunrise Medical Center", address: "456 Elm St, Los Angeles, CA 90012", lat: 34.0622, lng: -118.2437 },
    { firstName: "Dorothy", lastName: "Williams", phone: "555-400-0002", dob: "1948-07-22", insurance: "INS-002-UCM", wheelchair: true, cityIdx: 0, companyIdx: 0, clinicName: "Pacific Dialysis Clinic", address: "789 Oak Dr, Los Angeles, CA 90015", lat: 34.0398, lng: -118.2657 },
    { firstName: "Robert", lastName: "Jones", phone: "555-400-0003", dob: "1960-11-08", insurance: "INS-003-UCM", wheelchair: false, cityIdx: 0, companyIdx: 0, clinicName: "Harbor Mental Health", address: "321 Pine Ave, Los Angeles, CA 90710", lat: 33.7897, lng: -118.2751 },
    { firstName: "Margaret", lastName: "Brown", phone: "555-400-0004", dob: "1952-01-30", insurance: "INS-004-UCM", wheelchair: false, cityIdx: 0, companyIdx: 0, clinicName: "Sunrise Medical Center", address: "654 Maple Ct, Los Angeles, CA 90036", lat: 34.0695, lng: -118.3515 },
    { firstName: "William", lastName: "Davis", phone: "555-400-0005", dob: "1965-09-12", insurance: "INS-005-UCM", wheelchair: false, cityIdx: 1, companyIdx: 0, clinicName: "Coastal Care Clinic", address: "123 Bay St, San Diego, CA 92109", lat: 32.7927, lng: -117.2427 },
    { firstName: "Betty", lastName: "Miller", phone: "555-400-0006", dob: "1970-04-18", insurance: "INS-006-UCM", wheelchair: true, cityIdx: 1, companyIdx: 0, clinicName: "Coastal Care Clinic", address: "456 Palm Dr, San Diego, CA 92101", lat: 32.7157, lng: -117.1611 },
    { firstName: "James", lastName: "Wilson", phone: "555-400-0007", dob: "1958-12-03", insurance: "INS-007-MHT", wheelchair: false, cityIdx: 2, companyIdx: 1, clinicName: "Dallas General Hospital", address: "789 Oak Ridge Rd, Dallas, TX 75201", lat: 32.7876, lng: -96.7969 },
    { firstName: "Patricia", lastName: "Anderson", phone: "555-400-0008", dob: "1945-06-25", insurance: "INS-008-MHT", wheelchair: true, cityIdx: 2, companyIdx: 1, clinicName: "Lone Star Dialysis", address: "321 Elm Ct, Dallas, TX 75204", lat: 32.7990, lng: -96.7873 },
    { firstName: "Richard", lastName: "Thomas", phone: "555-400-0009", dob: "1962-08-14", insurance: "INS-009-MHT", wheelchair: false, cityIdx: 2, companyIdx: 1, clinicName: "Dallas General Hospital", address: "654 Cedar Ln, Dallas, TX 75226", lat: 32.7763, lng: -96.7668 },
    { firstName: "Susan", lastName: "Jackson", phone: "555-400-0010", dob: "1950-02-28", insurance: "INS-010-MHT", wheelchair: false, cityIdx: 3, companyIdx: 1, clinicName: "Houston Care Center", address: "123 Magnolia St, Houston, TX 77030", lat: 29.7072, lng: -95.3971 },
    { firstName: "Charles", lastName: "White", phone: "555-400-0011", dob: "1968-10-07", insurance: "INS-011-MHT", wheelchair: false, cityIdx: 3, companyIdx: 1, clinicName: "Bayou Mental Health", address: "456 Willow Ave, Houston, TX 77006", lat: 29.7420, lng: -95.3925 },
    { firstName: "Barbara", lastName: "Harris", phone: "555-400-0012", dob: "1953-05-19", insurance: "INS-012-MHT", wheelchair: true, cityIdx: 3, companyIdx: 1, clinicName: "Houston Care Center", address: "789 Pecan Dr, Houston, TX 77054", lat: 29.6865, lng: -95.4022 },
    { firstName: "Joseph", lastName: "Martin", phone: "555-400-0013", dob: "1957-03-11", insurance: "INS-013-VCT", wheelchair: false, cityIdx: 4, companyIdx: 2, clinicName: "Desert Springs Hospital", address: "123 Saguaro Blvd, Phoenix, AZ 85004", lat: 33.4606, lng: -112.0740 },
    { firstName: "Nancy", lastName: "Thompson", phone: "555-400-0014", dob: "1947-11-29", insurance: "INS-014-VCT", wheelchair: true, cityIdx: 4, companyIdx: 2, clinicName: "Cactus Dialysis Center", address: "456 Palo Verde Dr, Phoenix, AZ 85016", lat: 33.5092, lng: -111.9994 },
    { firstName: "Daniel", lastName: "Garcia", phone: "555-400-0015", dob: "1963-07-04", insurance: "INS-015-VCT", wheelchair: false, cityIdx: 4, companyIdx: 2, clinicName: "Desert Springs Hospital", address: "789 Mesquite Ave, Phoenix, AZ 85006", lat: 33.4502, lng: -112.0482 },
    { firstName: "Lisa", lastName: "Martinez", phone: "555-400-0016", dob: "1971-09-16", insurance: "INS-016-VCT", wheelchair: false, cityIdx: 5, companyIdx: 2, clinicName: "Mile High Clinic", address: "123 Aspen St, Denver, CO 80202", lat: 39.7473, lng: -104.9934 },
    { firstName: "Mark", lastName: "Robinson", phone: "555-400-0017", dob: "1955-01-22", insurance: "INS-017-VCT", wheelchair: false, cityIdx: 5, companyIdx: 2, clinicName: "Rocky Mountain Health", address: "456 Spruce Dr, Denver, CO 80220", lat: 39.7319, lng: -104.9381 },
    { firstName: "Sandra", lastName: "Clark", phone: "555-400-0018", dob: "1949-08-05", insurance: "INS-018-VCT", wheelchair: true, cityIdx: 5, companyIdx: 2, clinicName: "Mile High Clinic", address: "789 Pine Rd, Denver, CO 80203", lat: 39.7284, lng: -104.9811 },
    { firstName: "Paul", lastName: "Lewis", phone: "555-400-0019", dob: "1966-04-10", insurance: "INS-019-VCT", wheelchair: false, cityIdx: 4, companyIdx: 2, clinicName: "Cactus Dialysis Center", address: "321 Ironwood Ln, Phoenix, AZ 85018", lat: 33.4942, lng: -111.9583 },
    { firstName: "Elizabeth", lastName: "Walker", phone: "555-400-0020", dob: "1942-12-01", insurance: "INS-020-VCT", wheelchair: true, cityIdx: 5, companyIdx: 2, clinicName: "Rocky Mountain Health", address: "654 Birch Way, Denver, CO 80218", lat: 39.7372, lng: -104.9673 },
  ];

  const results: any[] = [...existing];
  for (const p of pData) {
    if (results.find(e => e.firstName === p.firstName && e.lastName === p.lastName && e.phone === p.phone)) continue;
    const city = cities[p.cityIdx];
    const company = companies[p.companyIdx];
    const clinic = clinics.find(c => c.name === p.clinicName);
    if (!city || !company) continue;

    const pid = await nextPid();
    const [row] = await db.insert(s.patients).values({
      publicId: pid,
      cityId: city.id,
      clinicId: clinic?.id ?? null,
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      address: p.address,
      dateOfBirth: p.dob,
      insuranceId: p.insurance,
      wheelchairRequired: p.wheelchair,
      lat: p.lat,
      lng: p.lng,
      companyId: company.id,
      active: true,
      source: "internal",
    }).returning();
    results.push(row);
  }
  log(`  Patients: ${results.length}`);
  return results;
}

async function seedTrips(companies: any[], cities: any[], drivers: any[], vehicles: any[], patients: any[], clinics: any[]) {
  log("Seeding trips...");
  const existing = await db.select().from(s.trips);
  if (existing.length >= 50) return existing;

  const statuses: Array<typeof s.tripStatusEnum.enumValues[number]> = [
    "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED",
    "COMPLETED", "COMPLETED", "SCHEDULED", "SCHEDULED", "ASSIGNED",
    "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "CANCELLED", "NO_SHOW",
  ];

  const results: any[] = [...existing];
  let tripIndex = 0;

  for (const patient of patients) {
    const city = cities.find(c => c.id === patient.cityId);
    if (!city) continue;
    const clinic = clinics.find(c => c.id === patient.clinicId);
    if (!clinic) continue;
    const companyDrivers = drivers.filter(d => d.companyId === patient.companyId && d.cityId === patient.cityId);
    const companyVehicles = vehicles.filter(v => v.companyId === patient.companyId && v.cityId === patient.cityId);
    if (companyDrivers.length === 0) continue;

    const tripsPerPatient = patient.wheelchairRequired ? 3 : 2;

    for (let t = 0; t < tripsPerPatient; t++) {
      const status = statuses[tripIndex % statuses.length];
      const daysOffset = status === "SCHEDULED" ? (t + 1) : -(tripIndex + 1);
      const date = status === "SCHEDULED" ? futureDate(t + 1) : pastDate(tripIndex + 1);
      const driver = companyDrivers[tripIndex % companyDrivers.length];
      const vehicle = companyVehicles[tripIndex % companyVehicles.length] ?? null;
      const pickupTime = `${8 + (tripIndex % 10)}:${tripIndex % 2 === 0 ? "00" : "30"}`;
      const arrivalHour = parseInt(pickupTime.split(":")[0]) + 1;
      const arrivalTime = `${arrivalHour}:${pickupTime.split(":")[1]}`;

      const isAssigned = status !== "SCHEDULED";
      const isCompleted = status === "COMPLETED";
      const isCancelled = status === "CANCELLED";
      const isNoShow = status === "NO_SHOW";

      const pid = await nextPid();
      const now = new Date();
      const scheduledTimestamp = new Date(date + "T" + pickupTime + ":00");

      const tripValues: any = {
        publicId: pid,
        cityId: city.id,
        patientId: patient.id,
        clinicId: clinic.id,
        pickupAddress: patient.address || "123 Main St",
        pickupLat: patient.lat,
        pickupLng: patient.lng,
        dropoffAddress: clinic.address,
        dropoffLat: clinic.lat,
        dropoffLng: clinic.lng,
        scheduledDate: date,
        pickupTime,
        estimatedArrivalTime: arrivalTime,
        tripType: patient.wheelchairRequired ? "dialysis" : "one_time",
        status,
        companyId: patient.companyId,
        mobilityRequirement: patient.wheelchairRequired ? "WHEELCHAIR" : "STANDARD",
        passengerCount: 1,
        billable: true,
        requestSource: "internal",
        distanceMiles: String(5 + (tripIndex % 20)),
        durationMinutes: 15 + (tripIndex % 30),
      };

      if (isAssigned || isCompleted || isCancelled || isNoShow) {
        tripValues.driverId = driver.id;
        tripValues.vehicleId = vehicle?.id ?? null;
        tripValues.assignedAt = pastTimestamp(Math.abs(daysOffset) + 1);
        tripValues.assignmentSource = "system";
      }

      if (isCompleted) {
        tripValues.startedAt = scheduledTimestamp;
        tripValues.arrivedPickupAt = new Date(scheduledTimestamp.getTime() + 5 * 60000);
        tripValues.pickedUpAt = new Date(scheduledTimestamp.getTime() + 8 * 60000);
        tripValues.enRouteDropoffAt = new Date(scheduledTimestamp.getTime() + 10 * 60000);
        tripValues.arrivedDropoffAt = new Date(scheduledTimestamp.getTime() + 25 * 60000);
        tripValues.completedAt = new Date(scheduledTimestamp.getTime() + 30 * 60000);
        tripValues.billingOutcome = "completed";
      }

      if (isCancelled) {
        tripValues.cancelledAt = pastTimestamp(Math.abs(daysOffset));
        tripValues.cancelledReason = "Patient requested cancellation";
        tripValues.cancelType = "soft";
        tripValues.billingOutcome = "cancelled";
        tripValues.cancelWindow = "advance";
      }

      if (isNoShow) {
        tripValues.billingOutcome = "no_show";
      }

      try {
        const [row] = await db.insert(s.trips).values(tripValues).returning();
        results.push(row);
      } catch (e: any) {
        if (!e.message?.includes("duplicate")) throw e;
      }
      tripIndex++;
    }
  }
  log(`  Trips: ${results.length}`);
  return results;
}

async function seedInvoices(clinics: any[], trips: any[], patients: any[]) {
  log("Seeding invoices...");
  const existing = await db.select().from(s.invoices);
  if (existing.length >= 20) return existing;

  const completedTrips = trips.filter(t => t.status === "COMPLETED");
  const results: any[] = [...existing];

  for (const trip of completedTrips.slice(0, 20)) {
    const clinic = clinics.find(c => c.id === trip.clinicId);
    if (!clinic) continue;
    const patient = patients.find(p => p.id === trip.patientId);
    if (!patient) continue;
    if (results.find(e => e.tripId === trip.id)) continue;

    const statuses: Array<typeof s.invoiceStatusEnum.enumValues[number]> = ["pending", "approved", "paid"];
    const st = statuses[results.length % statuses.length];

    try {
      const [row] = await db.insert(s.invoices).values({
        clinicId: clinic.id,
        tripId: trip.id,
        patientName: `${patient.firstName} ${patient.lastName}`,
        serviceDate: trip.scheduledDate,
        amount: String(45 + (results.length % 50) * 5),
        status: st,
        notes: `Service for trip ${trip.publicId}`,
        emailStatus: st === "paid" ? "sent" : "not_sent",
      }).returning();
      results.push(row);
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log(`  Invoices: ${results.length}`);
  return results;
}

async function seedCitySettings(cities: any[]) {
  log("Seeding city settings...");
  for (const city of cities) {
    const existing = await db.select().from(s.citySettings).where(eq(s.citySettings.cityId, city.id));
    if (existing.length > 0) continue;
    try {
      await db.insert(s.citySettings).values({
        cityId: city.id,
        shiftStartTime: "06:00",
        autoAssignEnabled: true,
        autoAssignMinutesBefore: 60,
        driverGoTimeMinutes: 20,
        driverGoTimeRepeatMinutes: 5,
        offerTtlSeconds: 90,
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  City settings done");
}

async function seedCompanySettings(companies: any[]) {
  log("Seeding company settings...");
  for (const company of companies) {
    const existing = await db.select().from(s.companySettings).where(eq(s.companySettings.companyId, company.id));
    if (existing.length > 0) continue;
    try {
      await db.insert(s.companySettings).values({
        companyId: company.id,
        maxDrivers: 50,
        maxActiveTrips: 200,
        rpmLimit: 300,
        pdfRpmLimit: 30,
        mapsRpmLimit: 60,
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Company settings done");
}

async function seedDriverScores(drivers: any[], cities: any[]) {
  log("Seeding driver scores...");
  const existing = await db.select().from(s.driverScores);
  if (existing.length >= 10) return;

  for (const driver of drivers) {
    const city = cities.find(c => c.id === driver.cityId);
    if (!city) continue;
    const weekStart = pastDate(7);
    const weekEnd = pastDate(1);

    try {
      await db.insert(s.driverScores).values({
        driverId: driver.id,
        cityId: city.id,
        weekStart,
        weekEnd,
        onTimeRate: 0.85 + Math.random() * 0.15,
        completedTrips: 10 + Math.floor(Math.random() * 20),
        totalTrips: 15 + Math.floor(Math.random() * 20),
        noShowAvoided: Math.floor(Math.random() * 3),
        cancellations: Math.floor(Math.random() * 2),
        lateCount: Math.floor(Math.random() * 3),
        score: 70 + Math.floor(Math.random() * 30),
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Driver scores done");
}

async function seedClinicTariffs(clinics: any[]) {
  log("Seeding clinic tariffs...");
  const existing = await db.select().from(s.clinicTariffs);
  if (existing.length >= 6) return;

  for (const clinic of clinics) {
    if (existing.find(e => e.clinicId === clinic.id)) continue;
    try {
      await db.insert(s.clinicTariffs).values({
        clinicId: clinic.id,
        cityId: clinic.cityId,
        baseFeeCents: 2500 + Math.floor(Math.random() * 1500),
        perMileCents: 150 + Math.floor(Math.random() * 100),
        waitMinuteCents: 50 + Math.floor(Math.random() * 30),
        wheelchairExtraCents: clinic.facilityType === "hospital" ? 500 : 300,
        active: true,
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Clinic tariffs done");
}

async function seedClinicBillingProfiles(clinics: any[], users: any[]) {
  log("Seeding clinic billing profiles...");
  const existing = await db.select().from(s.clinicBillingProfiles);
  if (existing.length >= 6) return;

  for (const clinic of clinics) {
    if (existing.find(e => e.clinicId === clinic.id && e.cityId === clinic.cityId)) continue;
    const admin = users.find(u => u.companyId === clinic.companyId && (u.role === "ADMIN" || u.role === "SUPER_ADMIN" || u.role === "COMPANY_ADMIN"));
    try {
      const [profile] = await db.insert(s.clinicBillingProfiles).values({
        clinicId: clinic.id,
        cityId: clinic.cityId,
        name: `${clinic.name} Billing`,
        isActive: true,
        cancelAdvanceHours: 24,
        cancelLateMinutes: 0,
        createdBy: admin?.id ?? null,
      }).returning();

      const outcomes = ["completed", "no_show", "cancelled"];
      for (const outcome of outcomes) {
        try {
          await db.insert(s.clinicBillingRules).values({
            profileId: profile.id,
            outcome,
            passengerCount: 1,
            legType: "outbound",
            cancelWindow: outcome === "cancelled" ? "advance" : null,
            unitRate: outcome === "completed" ? "45.00" : outcome === "no_show" ? "25.00" : "15.00",
            enabled: true,
          });
        } catch (e: any) {
          if (!e.message?.includes("duplicate")) throw e;
        }
      }
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Clinic billing profiles done");
}

async function seedPricingProfiles(cities: any[], users: any[]) {
  log("Seeding pricing profiles...");
  const existing = await db.select().from(s.pricingProfiles);
  if (existing.length >= 4) return;

  const profiles = [
    { name: "Standard Rate - CA", city: "Los Angeles", appliesTo: "private" },
    { name: "Standard Rate - TX", city: "Dallas", appliesTo: "private" },
    { name: "Standard Rate - AZ", city: "Phoenix", appliesTo: "private" },
    { name: "Standard Rate - CO", city: "Denver", appliesTo: "private" },
  ];

  const admin = users.find(u => u.role === "SUPER_ADMIN");

  for (const p of profiles) {
    if (existing.find(e => e.name === p.name)) continue;
    try {
      const [profile] = await db.insert(s.pricingProfiles).values({
        name: p.name,
        city: p.city,
        isActive: true,
        appliesTo: p.appliesTo,
        createdBy: admin?.id ?? null,
      }).returning();

      const rules = [
        { key: "base_rate", valueNumeric: "25.0000" },
        { key: "per_mile_rate", valueNumeric: "2.5000" },
        { key: "wait_time_per_minute", valueNumeric: "0.7500" },
        { key: "wheelchair_surcharge", valueNumeric: "5.0000" },
      ];
      for (const rule of rules) {
        try {
          await db.insert(s.pricingRules).values({
            profileId: profile.id,
            key: rule.key,
            valueNumeric: rule.valueNumeric,
            enabled: true,
          });
        } catch (e: any) {
          if (!e.message?.includes("duplicate")) throw e;
        }
      }
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Pricing profiles done");
}

async function seedDriverWeeklySchedules(drivers: any[]) {
  log("Seeding driver weekly schedules...");
  const existing = await db.select().from(s.driverWeeklySchedules);
  if (existing.length >= 6) return;

  for (const driver of drivers) {
    if (existing.find(e => e.driverId === driver.id)) continue;
    try {
      await db.insert(s.driverWeeklySchedules).values({
        driverId: driver.id,
        cityId: driver.cityId,
        monEnabled: true, monStart: "06:00", monEnd: "18:00",
        tueEnabled: true, tueStart: "06:00", tueEnd: "18:00",
        wedEnabled: true, wedStart: "06:00", wedEnd: "18:00",
        thuEnabled: true, thuStart: "06:00", thuEnd: "18:00",
        friEnabled: true, friStart: "06:00", friEnd: "18:00",
        satEnabled: false,
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Driver schedules done");
}

async function seedDriverPerfScores(companies: any[], drivers: any[]) {
  log("Seeding driver perf scores...");
  const existing = await db.select().from(s.driverPerfScores);
  if (existing.length >= 6) return;

  for (const driver of drivers) {
    const company = companies.find(c => c.id === driver.companyId);
    if (!company) continue;
    try {
      await db.insert(s.driverPerfScores).values({
        companyId: company.id,
        driverId: driver.id,
        window: "7d",
        score: 70 + Math.floor(Math.random() * 30),
        components: {
          punctuality: 0.8 + Math.random() * 0.2,
          completion: 0.85 + Math.random() * 0.15,
          cancellations: Math.random() * 0.1,
          gpsQuality: 0.9 + Math.random() * 0.1,
          acceptance: 0.75 + Math.random() * 0.25,
        },
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Driver perf scores done");
}

async function seedDailyMetrics(cities: any[], clinics: any[], drivers: any[]) {
  log("Seeding daily metrics rollup...");
  const existing = await db.select().from(s.dailyMetricsRollup);
  if (existing.length >= 10) return;

  for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
    const date = pastDate(dayOffset);
    for (const city of cities.slice(0, 4)) {
      const cityClinic = clinics.find(c => c.cityId === city.id);
      const cityDriver = drivers.find(d => d.cityId === city.id);
      try {
        await db.insert(s.dailyMetricsRollup).values({
          metricDate: date,
          cityId: city.id,
          clinicId: cityClinic?.id ?? null,
          driverId: cityDriver?.id ?? null,
          tripsTotal: 10 + Math.floor(Math.random() * 15),
          tripsCompleted: 8 + Math.floor(Math.random() * 10),
          tripsCancelled: Math.floor(Math.random() * 3),
          tripsNoShow: Math.floor(Math.random() * 2),
          onTimePickupCount: 7 + Math.floor(Math.random() * 8),
          latePickupCount: Math.floor(Math.random() * 3),
          gpsVerifiedCount: 6 + Math.floor(Math.random() * 10),
          revenueCents: 25000 + Math.floor(Math.random() * 15000),
          estCostCents: 15000 + Math.floor(Math.random() * 8000),
          marginCents: 8000 + Math.floor(Math.random() * 7000),
        });
      } catch (e: any) {
        if (!e.message?.includes("duplicate")) throw e;
      }
    }
  }
  log("  Daily metrics done");
}

async function seedInvoiceSequence() {
  log("Seeding invoice sequence...");
  const existing = await db.select().from(s.invoiceSequences);
  if (existing.length > 0) return;
  try {
    await db.insert(s.invoiceSequences).values({
      id: 1,
      lastNumber: 0,
      prefix: "INV",
    });
  } catch (e: any) {
    if (!e.message?.includes("duplicate")) throw e;
  }
  log("  Invoice sequence done");
}

async function seedClinicBillingSettings(clinics: any[]) {
  log("Seeding clinic billing settings...");
  for (const clinic of clinics) {
    const existing = await db.select().from(s.clinicBillingSettings).where(eq(s.clinicBillingSettings.clinicId, clinic.id));
    if (existing.length > 0) continue;
    try {
      await db.insert(s.clinicBillingSettings).values({
        clinicId: clinic.id,
        billingCycle: "weekly",
        biweeklyMode: "1_15",
        timezone: "America/Los_Angeles",
        autoGenerate: false,
        graceDays: 7,
        lateFeePct: "1.50",
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Clinic billing settings done");
}

async function seedDriverVehicleAssignments(drivers: any[], vehicles: any[], cities: any[]) {
  log("Seeding driver vehicle assignments...");
  const existing = await db.select().from(s.driverVehicleAssignments);
  if (existing.length >= 6) return;

  const today = futureDate(0);
  for (const driver of drivers) {
    const vehicle = vehicles.find(v => v.id === driver.vehicleId);
    if (!vehicle) continue;
    try {
      await db.insert(s.driverVehicleAssignments).values({
        date: today,
        cityId: driver.cityId,
        shiftStartTime: "06:00",
        driverId: driver.id,
        vehicleId: vehicle.id,
        assignedBy: "system",
        status: "active",
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Driver vehicle assignments done");
}

async function main() {
  console.log("=".repeat(60));
  log("Starting comprehensive UCM seed...");
  console.log("=".repeat(60));

  try {
    const companies = await seedCompanies();
    const cities = await seedCities();
    const users = await seedUsers(companies, cities);
    await seedUserCityAccess(users, cities);
    await seedVehicleMakesModels();
    const vehicles = await seedVehicles(companies, cities);
    const drivers = await seedDrivers(companies, cities, vehicles, users);
    const clinics = await seedClinics(companies, cities, users);
    const patients = await seedPatients(companies, cities, clinics);
    const trips = await seedTrips(companies, cities, drivers, vehicles, patients, clinics);
    await seedInvoices(clinics, trips, patients);
    await seedCitySettings(cities);
    await seedCompanySettings(companies);
    await seedDriverScores(drivers, cities);
    await seedClinicTariffs(clinics);
    await seedClinicBillingProfiles(clinics, users);
    await seedPricingProfiles(cities, users);
    await seedDriverWeeklySchedules(drivers);
    await seedDriverPerfScores(companies, drivers);
    await seedDailyMetrics(cities, clinics, drivers);
    await seedInvoiceSequence();
    await seedClinicBillingSettings(clinics);
    await seedDriverVehicleAssignments(drivers, vehicles, cities);

    console.log("=".repeat(60));
    log("Seed complete! Summary:");

    const counts = await db.execute(sql`
      SELECT 'companies' as entity, count(*) as c FROM companies
      UNION ALL SELECT 'cities', count(*) FROM cities
      UNION ALL SELECT 'users', count(*) FROM users
      UNION ALL SELECT 'user_city_access', count(*) FROM user_city_access
      UNION ALL SELECT 'vehicles', count(*) FROM vehicles
      UNION ALL SELECT 'drivers', count(*) FROM drivers
      UNION ALL SELECT 'clinics', count(*) FROM clinics
      UNION ALL SELECT 'patients', count(*) FROM patients
      UNION ALL SELECT 'trips', count(*) FROM trips
      UNION ALL SELECT 'invoices', count(*) FROM invoices
      UNION ALL SELECT 'city_settings', count(*) FROM city_settings
      UNION ALL SELECT 'company_settings', count(*) FROM company_settings
      UNION ALL SELECT 'driver_scores', count(*) FROM driver_scores
      UNION ALL SELECT 'clinic_tariffs', count(*) FROM clinic_tariffs
      UNION ALL SELECT 'clinic_billing_profiles', count(*) FROM clinic_billing_profiles
      UNION ALL SELECT 'pricing_profiles', count(*) FROM pricing_profiles
      UNION ALL SELECT 'driver_weekly_schedules', count(*) FROM driver_weekly_schedules
      UNION ALL SELECT 'driver_perf_scores', count(*) FROM driver_perf_scores
      UNION ALL SELECT 'daily_metrics_rollup', count(*) FROM daily_metrics_rollup
      UNION ALL SELECT 'clinic_billing_settings', count(*) FROM clinic_billing_settings
      UNION ALL SELECT 'driver_vehicle_assignments', count(*) FROM driver_vehicle_assignments
      ORDER BY entity
    `);
    for (const row of (counts as any).rows) {
      console.log(`  ${row.entity}: ${row.c}`);
    }
    console.log("=".repeat(60));
  } catch (error) {
    console.error(`[${SEED_TAG}] ERROR:`, error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
