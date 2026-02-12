import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userRoleEnum = pgEnum("user_role", [
  "SUPER_ADMIN",
  "ADMIN",
  "DISPATCH",
  "DRIVER",
  "VIEWER",
]);

export const tripStatusEnum = pgEnum("trip_status", [
  "SCHEDULED",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export const vehicleStatusEnum = pgEnum("vehicle_status", [
  "ACTIVE",
  "MAINTENANCE",
  "OUT_OF_SERVICE",
]);

export const driverStatusEnum = pgEnum("driver_status", [
  "ACTIVE",
  "INACTIVE",
  "ON_LEAVE",
]);

export const cities = pgTable("cities", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  state: text("state").notNull(),
  timezone: text("timezone").notNull().default("America/New_York"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  publicId: varchar("public_id", { length: 20 }).notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  role: userRoleEnum("role").notNull().default("VIEWER"),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userCityAccess = pgTable("user_city_access", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id),
  cityId: integer("city_id").notNull().references(() => cities.id),
});

export const vehicles = pgTable("vehicles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  publicId: varchar("public_id", { length: 20 }).notNull().unique(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  name: text("name").notNull(),
  licensePlate: text("license_plate").notNull(),
  make: text("make"),
  model: text("model"),
  year: integer("year"),
  capacity: integer("capacity").notNull().default(4),
  wheelchairAccessible: boolean("wheelchair_accessible").notNull().default(false),
  status: vehicleStatusEnum("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const drivers = pgTable("drivers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  publicId: varchar("public_id", { length: 20 }).notNull().unique(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  userId: integer("user_id").references(() => users.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull(),
  licenseNumber: text("license_number"),
  status: driverStatusEnum("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const clinics = pgTable("clinics", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  publicId: varchar("public_id", { length: 20 }).notNull().unique(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  name: text("name").notNull(),
  address: text("address").notNull(),
  phone: text("phone"),
  contactName: text("contact_name"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const patients = pgTable("patients", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  publicId: varchar("public_id", { length: 20 }).notNull().unique(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone"),
  address: text("address"),
  dateOfBirth: text("date_of_birth"),
  insuranceId: text("insurance_id"),
  wheelchairRequired: boolean("wheelchair_required").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const trips = pgTable("trips", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  publicId: varchar("public_id", { length: 20 }).notNull().unique(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  driverId: integer("driver_id").references(() => drivers.id),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  pickupAddress: text("pickup_address").notNull(),
  dropoffAddress: text("dropoff_address").notNull(),
  scheduledDate: text("scheduled_date").notNull(),
  scheduledTime: text("scheduled_time").notNull(),
  status: tripStatusEnum("status").notNull().default("SCHEDULED"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id"),
  details: text("details"),
  cityId: integer("city_id").references(() => cities.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCitySchema = createInsertSchema(cities).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertVehicleSchema = createInsertSchema(vehicles).omit({ id: true, createdAt: true });
export const insertDriverSchema = createInsertSchema(drivers).omit({ id: true, createdAt: true });
export const insertClinicSchema = createInsertSchema(clinics).omit({ id: true, createdAt: true });
export const insertPatientSchema = createInsertSchema(patients).omit({ id: true, createdAt: true });
export const insertTripSchema = createInsertSchema(trips).omit({ id: true, createdAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ id: true, createdAt: true });

export type InsertCity = z.infer<typeof insertCitySchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type InsertDriver = z.infer<typeof insertDriverSchema>;
export type InsertClinic = z.infer<typeof insertClinicSchema>;
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type InsertTrip = z.infer<typeof insertTripSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

export type City = typeof cities.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserCityAccess = typeof userCityAccess.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type Driver = typeof drivers.$inferSelect;
export type Clinic = typeof clinics.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
