import { db, pool } from "../db";
import { sql, eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as s from "@shared/schema";

const SEED_TAG = "SEED_UCM";
let pidCounter = 0;

async function initPidCounter(): Promise<void> {
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
  pidCounter = parseInt((result as any).rows?.[0]?.max_num || "0") + 100;
  log(`  PID counter initialized at ${pidCounter}`);
}

function nextPid(): string {
  pidCounter++;
  return `01UCM${String(pidCounter).padStart(6, "0")}`;
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

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const LV_CENTER = { lat: 36.1699, lng: -115.1398 };
function lvCoord(latOff: number, lngOff: number) {
  return { lat: LV_CENTER.lat + latOff, lng: LV_CENTER.lng + lngOff };
}

const COMPANY_DEFS = [
  { name: "United Care Mobility", dispatchPhone: "702-555-0100" },
  { name: "Metro Health Transport", dispatchPhone: "702-555-0200" },
  { name: "Valley Care Transit", dispatchPhone: "702-555-0300" },
  { name: "Desert Star Medical Transport", dispatchPhone: "702-555-0400" },
  { name: "Silver State NEMT", dispatchPhone: "702-555-0500" },
];

const CLINIC_DEFS = [
  { name: "Sunrise Hospital & Medical Center", address: "3186 S Maryland Pkwy, Las Vegas, NV 89109", facilityType: "hospital" as const, phone: "702-961-5000", contact: "Dr. Angela Torres", ...lvCoord(0.012, 0.016) },
  { name: "Valley Health Dialysis Center", address: "1800 W Charleston Blvd, Las Vegas, NV 89102", facilityType: "clinic" as const, phone: "702-388-4000", contact: "Patricia Nguyen", ...lvCoord(-0.002, -0.032) },
  { name: "Southern Hills Hospital", address: "9300 W Sunset Rd, Las Vegas, NV 89148", facilityType: "hospital" as const, phone: "702-880-2100", contact: "Dr. Robert Chen", ...lvCoord(-0.068, -0.074) },
  { name: "Desert Springs Behavioral Health", address: "2075 E Flamingo Rd, Las Vegas, NV 89119", facilityType: "mental" as const, phone: "702-369-7600", contact: "Dr. Maria Santos", ...lvCoord(-0.018, 0.023) },
  { name: "Mountain View Hospital", address: "3100 N Tenaya Way, Las Vegas, NV 89128", facilityType: "hospital" as const, phone: "702-255-5065", contact: "Dr. James Park", ...lvCoord(0.042, -0.065) },
];

const FIRST_NAMES = [
  "James","Mary","Robert","Patricia","John","Jennifer","Michael","Linda","David","Elizabeth",
  "William","Barbara","Richard","Susan","Joseph","Jessica","Thomas","Sarah","Charles","Karen",
  "Christopher","Lisa","Daniel","Nancy","Matthew","Betty","Anthony","Margaret","Mark","Sandra",
  "Donald","Ashley","Steven","Kimberly","Paul","Emily","Andrew","Donna","Joshua","Michelle",
  "Kenneth","Carol","Kevin","Amanda","Brian","Dorothy","George","Melissa","Timothy","Deborah",
  "Ronald","Stephanie","Edward","Rebecca","Jason","Sharon","Jeffrey","Laura","Ryan","Cynthia",
  "Jacob","Kathleen","Gary","Amy","Nicholas","Angela","Eric","Shirley","Jonathan","Anna",
  "Stephen","Brenda","Larry","Pamela","Justin","Emma","Scott","Nicole","Brandon","Helen",
  "Benjamin","Samantha","Samuel","Katherine","Raymond","Christine","Gregory","Debra","Frank","Rachel",
  "Alexander","Carolyn","Patrick","Janet","Jack","Catherine","Dennis","Maria","Jerry","Heather",
  "Tyler","Diane","Aaron","Ruth","Jose","Julie","Adam","Olivia","Nathan","Joyce",
  "Henry","Virginia","Peter","Victoria","Zachary","Kelly","Douglas","Lauren","Harold","Christina",
  "Carl","Joan","Arthur","Evelyn","Gerald","Judith","Roger","Megan","Keith","Andrea",
  "Lawrence","Cheryl","Albert","Hannah","Wayne","Jacqueline","Roy","Martha","Eugene","Gloria",
  "Russell","Teresa","Bobby","Ann","Mason","Sara","Philip","Madison","Louis","Frances",
];

const LAST_NAMES = [
  "Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez",
  "Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin",
  "Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson",
  "Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores",
  "Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts",
  "Gomez","Phillips","Evans","Turner","Diaz","Parker","Cruz","Edwards","Collins","Reyes",
  "Stewart","Morris","Morales","Murphy","Cook","Rogers","Gutierrez","Ortiz","Morgan","Cooper",
  "Peterson","Bailey","Reed","Kelly","Howard","Ramos","Kim","Cox","Ward","Richardson",
];

const LV_STREETS = [
  "Las Vegas Blvd S","E Flamingo Rd","W Sahara Ave","S Decatur Blvd","E Tropicana Ave",
  "N Rancho Dr","W Charleston Blvd","S Eastern Ave","E Desert Inn Rd","N Lamb Blvd",
  "W Lake Mead Blvd","S Pecos Rd","E Bonanza Rd","N Martin L King Blvd","W Spring Mountain Rd",
  "S Maryland Pkwy","E Harmon Ave","N Nellis Blvd","W Flamingo Rd","S Jones Blvd",
  "E Sunset Rd","N Las Vegas Blvd","W Craig Rd","S Rainbow Blvd","E Sahara Ave",
  "N Civic Center Dr","W Owens Ave","S Durango Dr","E Stewart Ave","N Bruce St",
];

const LV_ZIPS = ["89101","89102","89103","89104","89106","89107","89108","89109","89110","89113",
  "89117","89119","89120","89121","89122","89128","89129","89130","89131","89134","89138","89139","89141","89142","89143","89144","89146","89147","89148","89149"];

const VEHICLE_MAKES = ["Toyota","Ford","Chevrolet","Honda","Dodge","Chrysler","Kia","Hyundai"];
const SEDAN_MODELS: Record<string, string[]> = {
  Toyota: ["Camry","RAV4","Corolla"], Ford: ["Fusion","Escape","Explorer"],
  Chevrolet: ["Equinox","Malibu","Traverse"], Honda: ["Accord","CR-V","Civic"],
  Dodge: ["Durango","Charger"], Chrysler: ["Pacifica","300"],
  Kia: ["Forte","Sorento"], Hyundai: ["Sonata","Tucson"],
};
const WHEELCHAIR_MODELS: Record<string, string[]> = {
  Toyota: ["Sienna"], Ford: ["Transit","Transit Connect"], Chevrolet: ["Express"],
  Honda: ["Odyssey"], Dodge: ["Grand Caravan"], Chrysler: ["Pacifica"],
  Kia: ["Sedona (Carnival)"], Hyundai: ["Staria"],
};

const COLORS = ["#6366F1","#10B981","#F59E0B","#EF4444","#3B82F6","#8B5CF6","#EC4899","#14B8A6","#F97316","#84CC16"];

function randItem<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }

function genLvAddress(idx: number) {
  const num = 1000 + (idx * 37) % 9000;
  const street = LV_STREETS[idx % LV_STREETS.length];
  const zip = LV_ZIPS[idx % LV_ZIPS.length];
  return {
    full: `${num} ${street}, Las Vegas, NV ${zip}`,
    street: `${num} ${street}`,
    city: "Las Vegas",
    state: "NV",
    zip,
    ...lvCoord(
      -0.08 + (idx % 30) * 0.006,
      -0.08 + Math.floor(idx / 30) * 0.02 + (idx % 7) * 0.008
    ),
  };
}

async function seedCompanies() {
  log("Seeding companies...");
  const existing = await db.select().from(s.companies);
  const results: any[] = [];
  for (const def of COMPANY_DEFS) {
    let co = existing.find(e => e.name === def.name);
    if (!co) {
      [co] = await db.insert(s.companies).values({ name: def.name, dispatchPhone: def.dispatchPhone }).returning();
    }
    results.push(co);
  }
  log(`  Companies: ${results.length}`);
  return results;
}

async function seedCity() {
  log("Seeding Las Vegas city...");
  const existing = await db.select().from(s.cities);
  let lv = existing.find(c => c.name === "Las Vegas" && c.state === "NV");
  if (!lv) {
    [lv] = await db.insert(s.cities).values({ name: "Las Vegas", state: "NV", timezone: "America/Los_Angeles", active: true }).returning();
  }
  log(`  City: Las Vegas (id=${lv!.id})`);
  return lv!;
}

async function seedVehicleMakesModels() {
  log("Seeding vehicle makes/models...");
  const existing = await db.select().from(s.vehicleMakes);
  for (const makeName of VEHICLE_MAKES) {
    let make = existing.find(e => e.name === makeName);
    if (!make) {
      [make] = await db.insert(s.vehicleMakes).values({ name: makeName }).onConflictDoNothing().returning();
      if (!make) continue;
    }
    const allModels = [...(SEDAN_MODELS[makeName] || []), ...(WHEELCHAIR_MODELS[makeName] || [])];
    const existingModels = await db.select().from(s.vehicleModels).where(eq(s.vehicleModels.makeId, make.id));
    for (const modelName of allModels) {
      if (!existingModels.find(m => m.name === modelName)) {
        await db.insert(s.vehicleModels).values({ makeId: make.id, name: modelName }).onConflictDoNothing();
      }
    }
  }
  log("  Vehicle makes/models done");
}

async function seedVehicles(companies: any[], city: any) {
  log("Seeding vehicles (150)...");
  const existing = await db.select().from(s.vehicles);
  const results: any[] = [];
  const PER_COMPANY = 30;

  for (let ci = 0; ci < companies.length; ci++) {
    const co = companies[ci];
    const prefix = ["UCM","MHT","VCT","DSM","SSN"][ci];
    for (let vi = 0; vi < PER_COMPANY; vi++) {
      const lp = `${prefix}-LV${String(vi + 1).padStart(2, "0")}`;
      const ex = existing.find(e => e.licensePlate === lp);
      if (ex) { results.push(ex); continue; }

      const isWheelchair = vi % 4 === 3;
      const make = VEHICLE_MAKES[(ci * PER_COMPANY + vi) % VEHICLE_MAKES.length];
      const modelPool = isWheelchair ? (WHEELCHAIR_MODELS[make] || ["Transit"]) : (SEDAN_MODELS[make] || ["Camry"]);
      const model = modelPool[vi % modelPool.length];

      const pid = nextPid();
      try {
        const [row] = await db.insert(s.vehicles).values({
          publicId: pid,
          cityId: city.id,
          name: `V-LV-${prefix}-${String(vi + 1).padStart(2, "0")}`,
          licensePlate: lp,
          colorHex: COLORS[(ci * PER_COMPANY + vi) % COLORS.length],
          makeText: make,
          modelText: model,
          year: 2021 + (vi % 4),
          capacity: isWheelchair ? 2 : 4,
          wheelchairAccessible: isWheelchair,
          capability: isWheelchair ? "WHEELCHAIR" : "SEDAN",
          status: vi < 28 ? "ACTIVE" : (vi === 28 ? "MAINTENANCE" : "OUT_OF_SERVICE"),
          companyId: co.id,
          active: vi < 29,
        }).returning();
        results.push(row);
      } catch (e: any) {
        if (!e.message?.includes("duplicate")) throw e;
      }
    }
  }
  log(`  Vehicles: ${results.length}`);
  return results;
}

async function seedClinics(companies: any[], city: any) {
  log("Seeding clinics (5)...");
  const existing = await db.select().from(s.clinics);
  const results: any[] = [];
  const hashedPw = await hashPw("ClinicPass123!");

  for (let ci = 0; ci < CLINIC_DEFS.length; ci++) {
    const def = CLINIC_DEFS[ci];
    const co = companies[ci];
    let clinic = existing.find(e => e.name === def.name);
    if (clinic) { results.push(clinic); continue; }

    const clinicPid = nextPid();
    const clinicEmail = `seed.clinic.lv${ci + 1}@ucm.test`;

    try {
      [clinic] = await db.insert(s.clinics).values({
        publicId: clinicPid,
        cityId: city.id,
        name: def.name,
        address: def.address,
        addressStreet: def.address.split(",")[0],
        addressCity: "Las Vegas",
        addressState: "NV",
        addressZip: def.address.match(/\d{5}/)?.[0] || "89109",
        email: clinicEmail,
        phone: def.phone,
        contactName: def.contact,
        facilityType: def.facilityType,
        companyId: co.id,
        lat: def.lat,
        lng: def.lng,
        active: true,
      }).returning();

      const userPid = nextPid();
      const nameParts = def.contact.replace("Dr. ", "").split(" ");
      await db.insert(s.users).values({
        publicId: userPid,
        email: clinicEmail,
        password: hashedPw,
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(" ") || "Admin",
        role: "CLINIC_USER",
        companyId: co.id,
        clinicId: clinic!.id,
        phone: def.phone,
        active: true,
        mustChangePassword: false,
      });

      const clinicUser = await db.select().from(s.users).where(eq(s.users.email, clinicEmail)).then(r => r[0]);
      if (clinicUser) {
        await db.insert(s.userCityAccess).values({ userId: clinicUser.id, cityId: city.id }).onConflictDoNothing();
      }

      results.push(clinic);
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
      const fallback = existing.find(e2 => e2.name === def.name);
      if (fallback) results.push(fallback);
    }
  }
  log(`  Clinics: ${results.length}`);
  return results;
}

async function seedDispatchUsers(companies: any[], city: any) {
  log("Seeding dispatch/admin users...");
  const hashedPw = await hashPw("SeedPass123!");
  const existingUsers = await db.select().from(s.users);

  const superEmail = "superadmin@ucm.test";
  if (!existingUsers.find(u => u.email === superEmail)) {
    const pid = nextPid();
    await db.insert(s.users).values({
      publicId: pid, email: superEmail, password: hashedPw,
      firstName: "Super", lastName: "Admin", role: "SUPER_ADMIN",
      companyId: companies[0].id, active: true, mustChangePassword: false,
    });
  }

  for (let ci = 0; ci < companies.length; ci++) {
    const co = companies[ci];
    const slug = slugify(co.name);

    const roles = [
      { suffix: "admin", role: "COMPANY_ADMIN" as const, first: "Admin", last: co.name.split(" ")[0] },
      { suffix: "dispatch1", role: "DISPATCH" as const, first: "Dispatch", last: `${co.name.split(" ")[0]}-1` },
      { suffix: "dispatch2", role: "DISPATCH" as const, first: "Dispatch", last: `${co.name.split(" ")[0]}-2` },
      { suffix: "dispatch3", role: "DISPATCH" as const, first: "Dispatch", last: `${co.name.split(" ")[0]}-3` },
    ];

    for (const r of roles) {
      const email = `${slug}.${r.suffix}@ucm.test`;
      if (existingUsers.find(u => u.email === email)) continue;
      const pid = nextPid();
      try {
        const [u] = await db.insert(s.users).values({
          publicId: pid, email, password: hashedPw,
          firstName: r.first, lastName: r.last, role: r.role,
          companyId: co.id, active: true, mustChangePassword: false,
        }).returning();
        await db.insert(s.userCityAccess).values({ userId: u.id, cityId: city.id }).onConflictDoNothing();
      } catch (e: any) {
        if (!e.message?.includes("duplicate")) throw e;
      }
    }
  }

  const superUser = await db.select().from(s.users).where(eq(s.users.email, superEmail)).then(r => r[0]);
  if (superUser) {
    const allCities = await db.select().from(s.cities);
    for (const c of allCities) {
      await db.insert(s.userCityAccess).values({ userId: superUser.id, cityId: c.id }).onConflictDoNothing();
    }
  }

  log("  Dispatch/admin users done");
}

async function seedDrivers(companies: any[], city: any, vehicles: any[]) {
  log("Seeding drivers (150)...");
  const existingDrivers = await db.select().from(s.drivers);
  const existingUsers = await db.select().from(s.users);
  const hashedPw = await hashPw("DriverPass123!");
  const results: any[] = [];
  const PER_COMPANY = 30;
  let globalIdx = 0;

  for (let ci = 0; ci < companies.length; ci++) {
    const co = companies[ci];
    const coVehicles = vehicles.filter(v => v.companyId === co.id);

    for (let di = 0; di < PER_COMPANY; di++) {
      const fnIdx = (ci * PER_COMPANY + di) % FIRST_NAMES.length;
      const lnIdx = (ci * PER_COMPANY + di + ci * 7) % LAST_NAMES.length;
      const firstName = FIRST_NAMES[fnIdx];
      const lastName = LAST_NAMES[lnIdx];
      const email = `seed.driver.${slugify(firstName)}.${slugify(lastName)}.c${ci + 1}@ucm.test`;
      const phone = `702-${String(600 + ci).padStart(3, "0")}-${String(1000 + di).padStart(4, "0")}`;

      const exDriver = existingDrivers.find(d => d.email === email);
      if (exDriver) { results.push(exDriver); globalIdx++; continue; }

      const vehicle = coVehicles[di] || null;
      const driverPid = nextPid();
      const userPid = nextPid();

      const statuses: Array<typeof s.driverStatusEnum.enumValues[number]> = ["ACTIVE","ACTIVE","ACTIVE","ACTIVE","ACTIVE","INACTIVE","ON_LEAVE"];
      const dispatchStatuses: Array<typeof s.dispatchStatusEnum.enumValues[number]> = ["available","available","available","enroute","off"];
      const driverStatus = statuses[di % statuses.length];
      const dispatchStatus = driverStatus === "ACTIVE" ? dispatchStatuses[di % dispatchStatuses.length] : "off";

      const addr = genLvAddress(globalIdx);

      try {
        const [driverUser] = await db.insert(s.users).values({
          publicId: userPid, email, password: hashedPw,
          firstName, lastName, role: "DRIVER",
          companyId: co.id, phone, active: driverStatus !== "INACTIVE",
          mustChangePassword: false,
        }).returning();

        const [driver] = await db.insert(s.drivers).values({
          publicId: driverPid,
          cityId: city.id,
          userId: driverUser.id,
          vehicleId: vehicle?.id ?? null,
          email,
          firstName,
          lastName,
          phone,
          licenseNumber: `NV-DL-${String(ci + 1)}${String(di + 1).padStart(4, "0")}`,
          lastLat: addr.lat,
          lastLng: addr.lng,
          lastSeenAt: driverStatus === "ACTIVE" ? new Date() : null,
          status: driverStatus,
          dispatchStatus,
          companyId: co.id,
          active: driverStatus !== "INACTIVE",
        }).returning();

        await db.update(s.users).set({ driverId: driver.id }).where(eq(s.users.id, driverUser.id));
        await db.insert(s.userCityAccess).values({ userId: driverUser.id, cityId: city.id }).onConflictDoNothing();

        results.push(driver);
      } catch (e: any) {
        if (!e.message?.includes("duplicate")) throw e;
      }
      globalIdx++;
    }
  }
  log(`  Drivers: ${results.length}`);
  return results;
}

async function seedPatients(companies: any[], city: any, clinics: any[]) {
  log("Seeding patients (300)...");
  const existing = await db.select().from(s.patients);
  const results: any[] = [];
  const PER_COMPANY = 60;
  let globalIdx = 0;

  const DOBS_BASE = ["1940","1945","1948","1950","1952","1955","1958","1960","1962","1965","1968","1970","1972","1975"];

  for (let ci = 0; ci < companies.length; ci++) {
    const co = companies[ci];
    const clinic = clinics[ci];

    for (let pi = 0; pi < PER_COMPANY; pi++) {
      const fnIdx = (pi + ci * PER_COMPANY + 50) % FIRST_NAMES.length;
      const lnIdx = (pi + ci * PER_COMPANY + 20) % LAST_NAMES.length;
      const firstName = FIRST_NAMES[fnIdx];
      const lastName = LAST_NAMES[lnIdx];
      const phone = `702-${String(700 + ci).padStart(3, "0")}-${String(1000 + pi).padStart(4, "0")}`;

      const exPatient = existing.find(p =>
        p.firstName === firstName && p.lastName === lastName && p.phone === phone
      );
      if (exPatient) { results.push(exPatient); globalIdx++; continue; }

      const addr = genLvAddress(globalIdx + 200);
      const isWheelchair = pi % 5 === 4;
      const dobYear = DOBS_BASE[pi % DOBS_BASE.length];
      const dobMonth = String(1 + (pi % 12)).padStart(2, "0");
      const dobDay = String(1 + (pi % 28)).padStart(2, "0");

      const pid = nextPid();
      try {
        const [row] = await db.insert(s.patients).values({
          publicId: pid,
          cityId: city.id,
          clinicId: clinic?.id ?? null,
          firstName,
          lastName,
          phone,
          address: addr.full,
          addressStreet: addr.street,
          addressCity: addr.city,
          addressState: addr.state,
          addressZip: addr.zip,
          lat: addr.lat,
          lng: addr.lng,
          dateOfBirth: `${dobYear}-${dobMonth}-${dobDay}`,
          insuranceId: `INS-LV-${String(globalIdx + 1).padStart(4, "0")}`,
          wheelchairRequired: isWheelchair,
          email: `patient.${slugify(firstName)}.${slugify(lastName)}.${ci + 1}@ucm-test.local`,
          companyId: co.id,
          active: true,
          source: "internal",
        }).returning();
        results.push(row);
      } catch (e: any) {
        if (!e.message?.includes("duplicate")) throw e;
      }
      globalIdx++;
    }
  }
  log(`  Patients: ${results.length}`);
  return results;
}

async function seedTrips(companies: any[], city: any, drivers: any[], vehicles: any[], patients: any[], clinics: any[]) {
  log("Seeding trips (varied statuses)...");
  const existing = await db.select().from(s.trips);
  if (existing.length >= 400) { log("  Trips already seeded"); return existing; }

  const STATUS_DIST: Array<typeof s.tripStatusEnum.enumValues[number]> = [
    "COMPLETED","COMPLETED","COMPLETED","COMPLETED","COMPLETED","COMPLETED","COMPLETED",
    "SCHEDULED","SCHEDULED","SCHEDULED",
    "ASSIGNED","ASSIGNED",
    "EN_ROUTE_TO_PICKUP","ARRIVED_PICKUP","PICKED_UP","EN_ROUTE_TO_DROPOFF",
    "CANCELLED","NO_SHOW",
    "COMPLETED","COMPLETED",
  ];

  const results: any[] = [...existing];
  let tripIdx = 0;

  for (const patient of patients) {
    const co = companies.find((c: any) => c.id === patient.companyId);
    if (!co) continue;
    const clinic = clinics.find((c: any) => c.id === patient.clinicId);
    if (!clinic) continue;
    const coDrivers = drivers.filter((d: any) => d.companyId === co.id && d.status === "ACTIVE");
    const coVehicles = vehicles.filter((v: any) => v.companyId === co.id && v.status === "ACTIVE");
    if (coDrivers.length === 0) continue;

    const tripsForPatient = patient.wheelchairRequired ? 3 : 2;

    for (let t = 0; t < tripsForPatient; t++) {
      const status = STATUS_DIST[tripIdx % STATUS_DIST.length];
      const isPast = ["COMPLETED","CANCELLED","NO_SHOW"].includes(status);
      const isFuture = ["SCHEDULED"].includes(status);
      const daysOffset = isPast ? (1 + (tripIdx % 14)) : isFuture ? (1 + (t % 5)) : 0;
      const date = isPast ? pastDate(daysOffset) : isFuture ? futureDate(daysOffset) : futureDate(0);

      const driver = coDrivers[tripIdx % coDrivers.length];
      const vehicle = coVehicles[tripIdx % coVehicles.length] || null;
      const hour = 6 + (tripIdx % 12);
      const mins = (tripIdx % 4) * 15;
      const pickupTime = `${String(hour).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
      const arrivalTime = `${String(hour + 1).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;

      const isAssigned = !["SCHEDULED"].includes(status);
      const isCompleted = status === "COMPLETED";
      const isCancelled = status === "CANCELLED";
      const isNoShow = status === "NO_SHOW";

      const pid = nextPid();
      const scheduledTimestamp = new Date(date + "T" + pickupTime + ":00");

      const tripValues: any = {
        publicId: pid,
        cityId: city.id,
        patientId: patient.id,
        clinicId: clinic.id,
        pickupAddress: patient.address || "123 Las Vegas Blvd S, Las Vegas, NV 89101",
        pickupStreet: patient.addressStreet,
        pickupCity: "Las Vegas",
        pickupState: "NV",
        pickupZip: patient.addressZip || "89101",
        pickupLat: patient.lat,
        pickupLng: patient.lng,
        dropoffAddress: clinic.address,
        dropoffStreet: clinic.address?.split(",")[0],
        dropoffCity: "Las Vegas",
        dropoffState: "NV",
        dropoffZip: clinic.address?.match(/\d{5}/)?.[0] || "89109",
        dropoffLat: clinic.lat,
        dropoffLng: clinic.lng,
        scheduledDate: date,
        pickupTime,
        estimatedArrivalTime: arrivalTime,
        tripType: patient.wheelchairRequired ? "dialysis" : "one_time",
        status,
        companyId: co.id,
        mobilityRequirement: patient.wheelchairRequired ? "WHEELCHAIR" : "STANDARD",
        passengerCount: 1,
        billable: true,
        requestSource: "internal",
        distanceMiles: String(3 + (tripIdx % 18)),
        durationMinutes: 10 + (tripIdx % 35),
      };

      if (isAssigned) {
        tripValues.driverId = driver.id;
        tripValues.vehicleId = vehicle?.id ?? null;
        tripValues.assignedAt = isPast ? pastTimestamp(daysOffset + 1) : new Date();
        tripValues.assignmentSource = tripIdx % 3 === 0 ? "dispatch" : "system";
      }

      if (isCompleted) {
        tripValues.startedAt = scheduledTimestamp;
        tripValues.arrivedPickupAt = new Date(scheduledTimestamp.getTime() + 5 * 60000);
        tripValues.pickedUpAt = new Date(scheduledTimestamp.getTime() + 8 * 60000);
        tripValues.enRouteDropoffAt = new Date(scheduledTimestamp.getTime() + 10 * 60000);
        tripValues.arrivedDropoffAt = new Date(scheduledTimestamp.getTime() + 25 * 60000);
        tripValues.completedAt = new Date(scheduledTimestamp.getTime() + 30 * 60000);
        tripValues.billingOutcome = "completed";
        tripValues.priceTotalCents = 2500 + randInt(0, 5000);
      }

      if (isCancelled) {
        tripValues.cancelledAt = pastTimestamp(daysOffset);
        tripValues.cancelledReason = ["Patient requested cancellation","No driver available","Weather conditions","Appointment rescheduled"][tripIdx % 4];
        tripValues.cancelType = tripIdx % 2 === 0 ? "soft" : "hard";
        tripValues.billingOutcome = "cancelled";
        tripValues.cancelWindow = tripIdx % 3 === 0 ? "late" : "advance";
        tripValues.faultParty = tripIdx % 3 === 0 ? "patient" : tripIdx % 3 === 1 ? "company" : null;
      }

      if (isNoShow) {
        tripValues.billingOutcome = "no_show";
        tripValues.noShowRisk = true;
        tripValues.driverId = driver.id;
        tripValues.vehicleId = vehicle?.id ?? null;
        tripValues.assignedAt = pastTimestamp(daysOffset + 1);
      }

      try {
        const [row] = await db.insert(s.trips).values(tripValues).returning();
        results.push(row);
      } catch (e: any) {
        if (!e.message?.includes("duplicate")) throw e;
      }
      tripIdx++;
    }
  }
  log(`  Trips: ${results.length}`);
  return results;
}

async function seedInvoices(clinics: any[], trips: any[], patients: any[]) {
  log("Seeding invoices...");
  const existing = await db.select().from(s.invoices);
  if (existing.length >= 50) { log("  Invoices already seeded"); return existing; }

  const completedTrips = trips.filter((t: any) => t.status === "COMPLETED");
  const results: any[] = [...existing];

  for (const trip of completedTrips.slice(0, 80)) {
    const clinic = clinics.find((c: any) => c.id === trip.clinicId);
    if (!clinic) continue;
    const patient = patients.find((p: any) => p.id === trip.patientId);
    if (!patient) continue;
    if (results.find((e: any) => e.tripId === trip.id)) continue;

    const statuses: Array<typeof s.invoiceStatusEnum.enumValues[number]> = ["pending","approved","paid"];
    const st = statuses[results.length % statuses.length];

    try {
      const [row] = await db.insert(s.invoices).values({
        clinicId: clinic.id,
        tripId: trip.id,
        patientName: `${patient.firstName} ${patient.lastName}`,
        serviceDate: trip.scheduledDate,
        amount: String(35 + (results.length % 60) * 5),
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

async function seedCitySettings(city: any) {
  log("Seeding city settings...");
  const existing = await db.select().from(s.citySettings).where(eq(s.citySettings.cityId, city.id));
  if (existing.length > 0) { log("  Already exists"); return; }
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
  log("  City settings done");
}

async function seedCompanySettings(companies: any[]) {
  log("Seeding company settings...");
  for (const co of companies) {
    const existing = await db.select().from(s.companySettings).where(eq(s.companySettings.companyId, co.id));
    if (existing.length > 0) continue;
    try {
      await db.insert(s.companySettings).values({
        companyId: co.id,
        maxDrivers: 50,
        maxActiveTrips: 300,
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

async function seedDriverWeeklySchedules(drivers: any[]) {
  log("Seeding driver weekly schedules...");
  const existing = await db.select().from(s.driverWeeklySchedules);
  const existingIds = new Set(existing.map(e => e.driverId));

  for (let i = 0; i < drivers.length; i++) {
    const d = drivers[i];
    if (existingIds.has(d.id)) continue;
    const pattern = i % 4;
    try {
      await db.insert(s.driverWeeklySchedules).values({
        driverId: d.id,
        cityId: d.cityId,
        monEnabled: pattern !== 3,
        monStart: "06:00", monEnd: pattern === 1 ? "14:00" : "18:00",
        tueEnabled: pattern !== 2,
        tueStart: pattern === 1 ? "10:00" : "06:00", tueEnd: "18:00",
        wedEnabled: true,
        wedStart: "06:00", wedEnd: "18:00",
        thuEnabled: pattern !== 3,
        thuStart: "06:00", thuEnd: pattern === 2 ? "14:00" : "18:00",
        friEnabled: true,
        friStart: "06:00", friEnd: "18:00",
        satEnabled: pattern === 0 || pattern === 2,
        satStart: "08:00", satEnd: "14:00",
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Driver schedules done");
}

async function seedDriverScores(drivers: any[], city: any) {
  log("Seeding driver scores...");
  const existing = await db.select().from(s.driverScores);
  if (existing.length >= drivers.length) { log("  Already seeded"); return; }

  for (const d of drivers) {
    try {
      await db.insert(s.driverScores).values({
        driverId: d.id,
        cityId: city.id,
        weekStart: pastDate(7),
        weekEnd: pastDate(1),
        onTimeRate: +(0.75 + Math.random() * 0.25).toFixed(2),
        completedTrips: randInt(8, 30),
        totalTrips: randInt(12, 35),
        noShowAvoided: randInt(0, 4),
        cancellations: randInt(0, 3),
        lateCount: randInt(0, 5),
        score: randInt(60, 100),
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Driver scores done");
}

async function seedDriverPerfScores(companies: any[], drivers: any[]) {
  log("Seeding driver perf scores...");
  const existing = await db.select().from(s.driverPerfScores);
  if (existing.length >= drivers.length) { log("  Already seeded"); return; }

  for (const d of drivers) {
    const co = companies.find((c: any) => c.id === d.companyId);
    if (!co) continue;
    try {
      await db.insert(s.driverPerfScores).values({
        companyId: co.id,
        driverId: d.id,
        window: "7d",
        score: randInt(55, 100),
        components: {
          punctuality: +(0.7 + Math.random() * 0.3).toFixed(2),
          completion: +(0.8 + Math.random() * 0.2).toFixed(2),
          cancellations: +(Math.random() * 0.15).toFixed(2),
          gpsQuality: +(0.85 + Math.random() * 0.15).toFixed(2),
          acceptance: +(0.7 + Math.random() * 0.3).toFixed(2),
        },
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Driver perf scores done");
}

async function seedClinicTariffs(clinics: any[]) {
  log("Seeding clinic tariffs...");
  const existing = await db.select().from(s.clinicTariffs);
  for (const clinic of clinics) {
    if (existing.find((e: any) => e.clinicId === clinic.id)) continue;
    try {
      await db.insert(s.clinicTariffs).values({
        clinicId: clinic.id,
        cityId: clinic.cityId,
        baseFeeCents: 2500 + randInt(0, 1500),
        perMileCents: 150 + randInt(0, 100),
        waitMinuteCents: 50 + randInt(0, 30),
        wheelchairExtraCents: clinic.facilityType === "hospital" ? 500 : 300,
        active: true,
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Clinic tariffs done");
}

async function seedClinicBillingProfiles(clinics: any[]) {
  log("Seeding clinic billing profiles...");
  const existing = await db.select().from(s.clinicBillingProfiles);
  for (const clinic of clinics) {
    if (existing.find((e: any) => e.clinicId === clinic.id && e.cityId === clinic.cityId)) continue;
    try {
      const [profile] = await db.insert(s.clinicBillingProfiles).values({
        clinicId: clinic.id,
        cityId: clinic.cityId,
        name: `${clinic.name} Billing`,
        isActive: true,
        cancelAdvanceHours: 24,
        cancelLateMinutes: 0,
      }).returning();

      for (const outcome of ["completed","no_show","cancelled"]) {
        try {
          await db.insert(s.clinicBillingRules).values({
            profileId: profile.id,
            outcome,
            passengerCount: 1,
            legType: "outbound",
            cancelWindow: outcome === "cancelled" ? "advance" : null,
            unitRate: outcome === "completed" ? "55.00" : outcome === "no_show" ? "30.00" : "20.00",
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

async function seedPricingProfiles(city: any) {
  log("Seeding pricing profiles...");
  const existing = await db.select().from(s.pricingProfiles);
  if (existing.find((e: any) => e.city === "Las Vegas")) { log("  Already exists"); return; }
  try {
    const [profile] = await db.insert(s.pricingProfiles).values({
      name: "Standard Rate - Las Vegas",
      city: "Las Vegas",
      isActive: true,
      appliesTo: "private",
    }).returning();

    const rules = [
      { key: "base_rate", valueNumeric: "25.0000" },
      { key: "per_mile_rate", valueNumeric: "2.7500" },
      { key: "wait_time_per_minute", valueNumeric: "0.8000" },
      { key: "wheelchair_surcharge", valueNumeric: "6.0000" },
    ];
    for (const rule of rules) {
      await db.insert(s.pricingRules).values({
        profileId: profile.id,
        key: rule.key,
        valueNumeric: rule.valueNumeric,
        enabled: true,
      }).onConflictDoNothing();
    }
  } catch (e: any) {
    if (!e.message?.includes("duplicate")) throw e;
  }
  log("  Pricing profiles done");
}

async function seedDailyMetrics(city: any, clinics: any[], drivers: any[]) {
  log("Seeding daily metrics rollup...");
  const existing = await db.select().from(s.dailyMetricsRollup);
  if (existing.length >= 28) { log("  Already seeded"); return; }

  for (let dayOffset = 1; dayOffset <= 14; dayOffset++) {
    const date = pastDate(dayOffset);
    const clinic = clinics[dayOffset % clinics.length];
    const driver = drivers[dayOffset % Math.min(drivers.length, 20)];
    try {
      await db.insert(s.dailyMetricsRollup).values({
        metricDate: date,
        cityId: city.id,
        clinicId: clinic?.id ?? null,
        driverId: driver?.id ?? null,
        tripsTotal: randInt(30, 60),
        tripsCompleted: randInt(25, 50),
        tripsCancelled: randInt(1, 6),
        tripsNoShow: randInt(0, 3),
        onTimePickupCount: randInt(20, 45),
        latePickupCount: randInt(1, 8),
        gpsVerifiedCount: randInt(20, 50),
        revenueCents: randInt(50000, 120000),
        estCostCents: randInt(30000, 70000),
        marginCents: randInt(15000, 50000),
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Daily metrics done");
}

async function seedDriverVehicleAssignments(drivers: any[], vehicles: any[], city: any) {
  log("Seeding driver-vehicle assignments...");
  const existing = await db.select().from(s.driverVehicleAssignments);
  if (existing.length >= 50) { log("  Already seeded"); return; }

  const today = futureDate(0);
  const activeDrivers = drivers.filter((d: any) => d.status === "ACTIVE" && d.vehicleId);

  for (const d of activeDrivers.slice(0, 80)) {
    const vehicle = vehicles.find((v: any) => v.id === d.vehicleId);
    if (!vehicle) continue;
    try {
      await db.insert(s.driverVehicleAssignments).values({
        date: today,
        cityId: city.id,
        shiftStartTime: "06:00",
        driverId: d.id,
        vehicleId: vehicle.id,
        assignedBy: "system",
        status: "active",
      });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }
  log("  Driver-vehicle assignments done");
}

async function seedInvoiceSequence() {
  log("Seeding invoice sequence...");
  const existing = await db.select().from(s.invoiceSequences);
  if (existing.length > 0) return;
  try {
    await db.insert(s.invoiceSequences).values({ id: 1, lastNumber: 0, prefix: "INV" });
  } catch (e: any) {
    if (!e.message?.includes("duplicate")) throw e;
  }
  log("  Invoice sequence done");
}

async function seedOpsAnomalies(companies: any[]) {
  log("Seeding ops anomalies...");
  const existing = await db.select().from(s.opsAnomalies);
  if (existing.length >= 10) { log("  Already seeded"); return; }

  const anomalies = [
    { code: "DRIVER_GPS_STALE", title: "Driver GPS data stale >30 min", severity: "warning", entityType: "driver" },
    { code: "HIGH_CANCEL_RATE", title: "Cancellation rate above 15%", severity: "critical", entityType: "company" },
    { code: "TRIP_UNASSIGNED", title: "Trips unassigned within 2 hours", severity: "warning", entityType: "trip" },
    { code: "DRIVER_LOW_SCORE", title: "Driver performance below threshold", severity: "info", entityType: "driver" },
    { code: "INVOICE_OVERDUE", title: "Invoice overdue by 14+ days", severity: "warning", entityType: "clinic" },
  ];

  for (let ci = 0; ci < companies.length; ci++) {
    const co = companies[ci];
    for (const a of anomalies.slice(0, 2 + ci)) {
      try {
        await db.insert(s.opsAnomalies).values({
          companyId: co.id,
          entityType: a.entityType,
          entityId: ci + 1,
          severity: a.severity,
          code: a.code,
          title: a.title,
          details: { triggeredAt: new Date().toISOString(), metric: randInt(10, 90) },
          isActive: true,
        });
      } catch (e: any) {
        if (!e.message?.includes("duplicate")) throw e;
      }
    }
  }
  log("  Ops anomalies done");
}

interface CredentialRecord {
  email: string;
  role: string;
  company: string;
  password: string;
}

async function seedDeterministicCredentials(companies: any[], city: any, clinics: any[], drivers: any[]) {
  log("Ensuring deterministic credential accounts...");
  const credentials: CredentialRecord[] = [];
  const allUsers = await db.select().from(s.users);

  credentials.push({ email: "superadmin@ucm.test", role: "SUPER_ADMIN", company: "(global)", password: "SeedPass123!" });

  for (const co of companies) {
    const slug = slugify(co.name);
    credentials.push({ email: `${slug}.admin@ucm.test`, role: "COMPANY_ADMIN", company: co.name, password: "SeedPass123!" });
    credentials.push({ email: `${slug}.dispatch1@ucm.test`, role: "DISPATCH", company: co.name, password: "SeedPass123!" });
  }

  for (let i = 0; i < clinics.length; i++) {
    credentials.push({ email: `seed.clinic.lv${i + 1}@ucm.test`, role: "CLINIC_USER", company: companies[i]?.name || "", password: "ClinicPass123!" });
  }

  const sampleDrivers = drivers.slice(0, 5);
  for (const d of sampleDrivers) {
    if (d.email) {
      credentials.push({ email: d.email, role: "DRIVER", company: companies.find((c: any) => c.id === d.companyId)?.name || "", password: "DriverPass123!" });
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log("  SEED CREDENTIALS TABLE (key accounts)");
  console.log("=".repeat(100));
  console.log("EMAIL".padEnd(55) + "ROLE".padEnd(16) + "COMPANY".padEnd(30) + "PASSWORD");
  console.log("-".repeat(100));
  for (const c of credentials) {
    console.log(c.email.padEnd(55) + c.role.padEnd(16) + c.company.padEnd(30) + c.password);
  }
  console.log("=".repeat(100));

  const fs = await import("fs");
  const path = await import("path");
  const outPath = path.join(path.dirname(new URL(import.meta.url).pathname), "seed-credentials.json");
  fs.writeFileSync(outPath, JSON.stringify(credentials, null, 2));
  log(`Credentials written to ${outPath}`);
}

async function preflightSchemaCheck() {
  log("Running preflight schema check...");
  const alterStatements = [
    `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS discount_percent numeric DEFAULT 0`,
    `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS membership_tier varchar(50)`,
    `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS membership_started_at timestamp`,
    `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS membership_expires_at timestamp`,
  ];
  for (const stmt of alterStatements) {
    try {
      await db.execute(sql.raw(stmt));
    } catch (e: any) {
      log(`  Schema fix skipped: ${e.message?.substring(0, 80)}`);
    }
  }
  log("  Schema preflight done");
}

async function main() {
  console.log("=".repeat(70));
  log("Starting Las Vegas Field Test Seed (5 companies, 150 drivers, 300 patients)");
  console.log("=".repeat(70));

  try {
    await preflightSchemaCheck();
    await initPidCounter();

    const companies = await seedCompanies();
    const city = await seedCity();
    await seedVehicleMakesModels();
    await seedDispatchUsers(companies, city);
    const vehicles = await seedVehicles(companies, city);
    const clinics = await seedClinics(companies, city);
    const drivers = await seedDrivers(companies, city, vehicles);
    const patients = await seedPatients(companies, city, clinics);
    const trips = await seedTrips(companies, city, drivers, vehicles, patients, clinics);
    await seedInvoices(clinics, trips, patients);
    await seedCitySettings(city);
    await seedCompanySettings(companies);
    await seedDriverWeeklySchedules(drivers);
    await seedDriverScores(drivers, city);
    await seedDriverPerfScores(companies, drivers);
    await seedClinicTariffs(clinics);
    await seedClinicBillingProfiles(clinics);
    await seedClinicBillingSettings(clinics);
    await seedPricingProfiles(city);
    await seedDailyMetrics(city, clinics, drivers);
    await seedDriverVehicleAssignments(drivers, vehicles, city);
    await seedInvoiceSequence();
    await seedOpsAnomalies(companies);
    await seedDeterministicCredentials(companies, city, clinics, drivers);

    console.log("\n" + "=".repeat(70));
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
      UNION ALL SELECT 'driver_perf_scores', count(*) FROM driver_perf_scores
      UNION ALL SELECT 'driver_weekly_schedules', count(*) FROM driver_weekly_schedules
      UNION ALL SELECT 'clinic_tariffs', count(*) FROM clinic_tariffs
      UNION ALL SELECT 'clinic_billing_profiles', count(*) FROM clinic_billing_profiles
      UNION ALL SELECT 'clinic_billing_settings', count(*) FROM clinic_billing_settings
      UNION ALL SELECT 'pricing_profiles', count(*) FROM pricing_profiles
      UNION ALL SELECT 'daily_metrics_rollup', count(*) FROM daily_metrics_rollup
      UNION ALL SELECT 'driver_vehicle_assignments', count(*) FROM driver_vehicle_assignments
      UNION ALL SELECT 'invoice_sequences', count(*) FROM invoice_sequences
      UNION ALL SELECT 'ops_anomalies', count(*) FROM ops_anomalies
      ORDER BY entity
    `);
    for (const row of (counts as any).rows) {
      console.log(`  ${row.entity}: ${row.c}`);
    }
    console.log("=".repeat(70));
  } catch (error) {
    console.error(`[${SEED_TAG}] ERROR:`, error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
