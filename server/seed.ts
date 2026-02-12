import { db } from "./db";
import { storage } from "./storage";
import { hashPassword } from "./auth";
import { generatePublicId } from "./public-id";
import { users, cities } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function seedSuperAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log("ADMIN_EMAIL or ADMIN_PASSWORD not set, skipping SUPER_ADMIN creation");
    return;
  }

  const existing = await storage.getUserByEmail(email);
  if (existing) {
    console.log(`SUPER_ADMIN already exists: ${email}`);
    return;
  }

  const hashed = await hashPassword(password);
  const publicId = await generatePublicId();

  await storage.createUser({
    publicId,
    email,
    password: hashed,
    firstName: "Super",
    lastName: "Admin",
    role: "SUPER_ADMIN",
    phone: null,
    active: true,
  });

  console.log(`SUPER_ADMIN created: ${email}`);
}

export async function seedData() {
  const existingCities = await storage.getCities();
  if (existingCities.length > 0) {
    console.log("Seed data already exists, skipping");
    return;
  }

  console.log("Seeding initial data...");

  const houston = await storage.createCity({ name: "Houston", state: "TX", timezone: "America/Chicago", active: true });
  const dallas = await storage.createCity({ name: "Dallas", state: "TX", timezone: "America/Chicago", active: true });
  const sanAntonio = await storage.createCity({ name: "San Antonio", state: "TX", timezone: "America/Chicago", active: true });

  const v1 = await storage.createVehicle({ publicId: await generatePublicId(), cityId: houston.id, name: "Van H-01", licensePlate: "HTX-4521", make: "Ford", model: "Transit", year: 2023, capacity: 6, wheelchairAccessible: true, status: "ACTIVE" });
  const v2 = await storage.createVehicle({ publicId: await generatePublicId(), cityId: houston.id, name: "Sedan H-02", licensePlate: "HTX-7843", make: "Toyota", model: "Camry", year: 2024, capacity: 3, wheelchairAccessible: false, status: "ACTIVE" });
  const v3 = await storage.createVehicle({ publicId: await generatePublicId(), cityId: dallas.id, name: "Van D-01", licensePlate: "DFW-1290", make: "Dodge", model: "Grand Caravan", year: 2022, capacity: 5, wheelchairAccessible: true, status: "ACTIVE" });
  await storage.createVehicle({ publicId: await generatePublicId(), cityId: sanAntonio.id, name: "Van SA-01", licensePlate: "SAT-5567", make: "Chevrolet", model: "Express", year: 2023, capacity: 8, wheelchairAccessible: true, status: "ACTIVE" });

  const d1 = await storage.createDriver({ publicId: await generatePublicId(), cityId: houston.id, firstName: "Marcus", lastName: "Johnson", phone: "(713) 555-0101", licenseNumber: "TX-DL-8834521", status: "ACTIVE", userId: null });
  const d2 = await storage.createDriver({ publicId: await generatePublicId(), cityId: houston.id, firstName: "Linda", lastName: "Martinez", phone: "(713) 555-0202", licenseNumber: "TX-DL-6621789", status: "ACTIVE", userId: null });
  const d3 = await storage.createDriver({ publicId: await generatePublicId(), cityId: dallas.id, firstName: "James", lastName: "Williams", phone: "(214) 555-0301", licenseNumber: "TX-DL-9912345", status: "ACTIVE", userId: null });

  const c1 = await storage.createClinic({ publicId: await generatePublicId(), cityId: houston.id, name: "Memorial Hermann Clinic", address: "6411 Fannin St, Houston, TX 77030", phone: "(713) 704-4000", contactName: "Dr. Sarah Chen", active: true });
  const c2 = await storage.createClinic({ publicId: await generatePublicId(), cityId: houston.id, name: "Houston Methodist Primary Care", address: "6565 Fannin St, Houston, TX 77030", phone: "(713) 441-3800", contactName: "Nancy Wilson", active: true });
  const c3 = await storage.createClinic({ publicId: await generatePublicId(), cityId: dallas.id, name: "Baylor Scott & White - Dallas", address: "3500 Gaston Ave, Dallas, TX 75246", phone: "(214) 820-0111", contactName: "Dr. Robert Park", active: true });

  const p1 = await storage.createPatient({ publicId: await generatePublicId(), cityId: houston.id, firstName: "Eleanor", lastName: "Thompson", phone: "(713) 555-1001", address: "1234 Main St, Houston, TX 77002", dateOfBirth: "1945-03-15", insuranceId: "MC-884521001", wheelchairRequired: true, active: true });
  const p2 = await storage.createPatient({ publicId: await generatePublicId(), cityId: houston.id, firstName: "Robert", lastName: "Davis", phone: "(713) 555-1002", address: "5678 Westheimer Rd, Houston, TX 77057", dateOfBirth: "1952-08-22", insuranceId: "MC-773629002", wheelchairRequired: false, active: true });
  const p3 = await storage.createPatient({ publicId: await generatePublicId(), cityId: dallas.id, firstName: "Dorothy", lastName: "Garcia", phone: "(214) 555-2001", address: "910 Elm St, Dallas, TX 75202", dateOfBirth: "1948-11-05", insuranceId: "MC-991345003", wheelchairRequired: false, active: true });
  const p4 = await storage.createPatient({ publicId: await generatePublicId(), cityId: houston.id, firstName: "William", lastName: "Brown", phone: "(713) 555-1003", address: "2200 Post Oak Blvd, Houston, TX 77056", dateOfBirth: "1940-06-30", insuranceId: "MC-557812004", wheelchairRequired: true, active: true });

  await storage.createTrip({ publicId: await generatePublicId(), cityId: houston.id, patientId: p1.id, driverId: d1.id, vehicleId: v1.id, clinicId: c1.id, pickupAddress: "1234 Main St, Houston, TX 77002", dropoffAddress: "6411 Fannin St, Houston, TX 77030", scheduledDate: "2026-02-13", scheduledTime: "09:00", status: "SCHEDULED", notes: "Wheelchair patient - needs ramp access" });
  await storage.createTrip({ publicId: await generatePublicId(), cityId: houston.id, patientId: p2.id, driverId: d2.id, vehicleId: v2.id, clinicId: c2.id, pickupAddress: "5678 Westheimer Rd, Houston, TX 77057", dropoffAddress: "6565 Fannin St, Houston, TX 77030", scheduledDate: "2026-02-13", scheduledTime: "10:30", status: "ASSIGNED", notes: null });
  await storage.createTrip({ publicId: await generatePublicId(), cityId: houston.id, patientId: p4.id, driverId: null, vehicleId: null, clinicId: c1.id, pickupAddress: "2200 Post Oak Blvd, Houston, TX 77056", dropoffAddress: "6411 Fannin St, Houston, TX 77030", scheduledDate: "2026-02-14", scheduledTime: "08:00", status: "SCHEDULED", notes: "Morning appointment - dialysis" });
  await storage.createTrip({ publicId: await generatePublicId(), cityId: dallas.id, patientId: p3.id, driverId: d3.id, vehicleId: v3.id, clinicId: c3.id, pickupAddress: "910 Elm St, Dallas, TX 75202", dropoffAddress: "3500 Gaston Ave, Dallas, TX 75246", scheduledDate: "2026-02-13", scheduledTime: "14:00", status: "IN_PROGRESS", notes: null });
  await storage.createTrip({ publicId: await generatePublicId(), cityId: houston.id, patientId: p1.id, driverId: d1.id, vehicleId: v1.id, clinicId: c1.id, pickupAddress: "6411 Fannin St, Houston, TX 77030", dropoffAddress: "1234 Main St, Houston, TX 77002", scheduledDate: "2026-02-12", scheduledTime: "11:00", status: "COMPLETED", notes: "Return trip" });

  console.log("Seed data created successfully");
}
