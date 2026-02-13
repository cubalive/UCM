import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, pgEnum, doublePrecision, numeric } from "drizzle-orm/pg-core";
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

export const facilityTypeEnum = pgEnum("facility_type", [
  "clinic",
  "hospital",
  "mental",
  "private",
]);

export const dispatchStatusEnum = pgEnum("dispatch_status", [
  "available",
  "enroute",
  "off",
  "hold",
]);

export const tripTypeEnum = pgEnum("trip_type", [
  "one_time",
  "recurring",
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
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  driverId: integer("driver_id"),
  clinicId: integer("clinic_id"),
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
  colorHex: text("color_hex").notNull().default("#6366F1"),
  make: text("make"),
  model: text("model"),
  year: integer("year"),
  capacity: integer("capacity").notNull().default(4),
  wheelchairAccessible: boolean("wheelchair_accessible").notNull().default(false),
  status: vehicleStatusEnum("status").notNull().default("ACTIVE"),
  lastServiceDate: timestamp("last_service_date"),
  maintenanceNotes: text("maintenance_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const drivers = pgTable("drivers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  publicId: varchar("public_id", { length: 20 }).notNull().unique(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  userId: integer("user_id").references(() => users.id),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  authUserId: text("auth_user_id"),
  email: text("email").unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull(),
  licenseNumber: text("license_number"),
  lastLat: doublePrecision("last_lat"),
  lastLng: doublePrecision("last_lng"),
  lastSeenAt: timestamp("last_seen_at"),
  status: driverStatusEnum("status").notNull().default("ACTIVE"),
  dispatchStatus: dispatchStatusEnum("dispatch_status").notNull().default("off"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const clinics = pgTable("clinics", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  publicId: varchar("public_id", { length: 20 }).notNull().unique(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  name: text("name").notNull(),
  address: text("address").notNull(),
  addressStreet: text("address_street"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  addressZip: text("address_zip"),
  email: text("email").unique(),
  authUserId: text("auth_user_id"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  phone: text("phone"),
  contactName: text("contact_name"),
  facilityType: facilityTypeEnum("facility_type").notNull().default("clinic"),
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
  addressStreet: text("address_street"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  addressZip: text("address_zip"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  dateOfBirth: text("date_of_birth"),
  insuranceId: text("insurance_id"),
  notes: text("notes"),
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
  pickupStreet: text("pickup_street"),
  pickupCity: text("pickup_city"),
  pickupState: text("pickup_state"),
  pickupZip: text("pickup_zip"),
  pickupLat: doublePrecision("pickup_lat"),
  pickupLng: doublePrecision("pickup_lng"),
  dropoffAddress: text("dropoff_address").notNull(),
  dropoffStreet: text("dropoff_street"),
  dropoffCity: text("dropoff_city"),
  dropoffState: text("dropoff_state"),
  dropoffZip: text("dropoff_zip"),
  dropoffLat: doublePrecision("dropoff_lat"),
  dropoffLng: doublePrecision("dropoff_lng"),
  scheduledDate: text("scheduled_date").notNull(),
  scheduledTime: text("scheduled_time"),
  pickupTime: text("pickup_time").notNull(),
  estimatedArrivalTime: text("estimated_arrival_time").notNull(),
  tripType: tripTypeEnum("trip_type").notNull().default("one_time"),
  recurringDays: text("recurring_days").array(),
  status: tripStatusEnum("status").notNull().default("SCHEDULED"),
  lastEtaMinutes: integer("last_eta_minutes"),
  distanceMiles: numeric("distance_miles"),
  durationMinutes: integer("duration_minutes"),
  routePolyline: text("route_polyline"),
  lastEtaUpdatedAt: timestamp("last_eta_updated_at"),
  fiveMinAlertSent: boolean("five_min_alert_sent").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const smsOptOut = pgTable("sms_opt_out", {
  phone: text("phone").primaryKey(),
  optedOut: boolean("opted_out").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "pending",
  "approved",
  "paid",
]);

export const invoices = pgTable("invoices", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  tripId: integer("trip_id").references(() => trips.id),
  patientName: text("patient_name").notNull(),
  serviceDate: text("service_date").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: invoiceStatusEnum("status").notNull().default("pending"),
  pdfUrl: text("pdf_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const assignedByEnum = pgEnum("assigned_by", [
  "system",
  "dispatch",
]);

export const citySettings = pgTable("city_settings", {
  cityId: integer("city_id").primaryKey().references(() => cities.id),
  shiftStartTime: text("shift_start_time").notNull().default("06:00"),
  autoAssignEnabled: boolean("auto_assign_enabled").notNull().default(true),
  autoAssignDays: text("auto_assign_days").array().notNull().default(sql`ARRAY['Mon','Tue','Wed','Thu','Fri','Sat']`),
  autoAssignMinutesBefore: integer("auto_assign_minutes_before").notNull().default(60),
});

export const driverVehicleAssignments = pgTable("driver_vehicle_assignments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  date: text("date").notNull(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  shiftStartTime: text("shift_start_time").notNull(),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id),
  assignedBy: assignedByEnum("assigned_by").notNull().default("system"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const vehicleAssignmentHistory = pgTable("vehicle_assignment_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id),
  cityId: integer("city_id").notNull().references(() => cities.id),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  unassignedAt: timestamp("unassigned_at"),
  assignedBy: text("assigned_by").notNull().default("system"),
  reason: text("reason"),
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
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true });
export const insertCitySettingsSchema = createInsertSchema(citySettings);
export const insertDriverVehicleAssignmentSchema = createInsertSchema(driverVehicleAssignments).omit({ id: true, createdAt: true });
export const insertVehicleAssignmentHistorySchema = createInsertSchema(vehicleAssignmentHistory).omit({ id: true });
export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ id: true, createdAt: true });

export type InsertCity = z.infer<typeof insertCitySchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type InsertDriver = z.infer<typeof insertDriverSchema>;
export type InsertClinic = z.infer<typeof insertClinicSchema>;
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type InsertTrip = z.infer<typeof insertTripSchema>;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

export type City = typeof cities.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserCityAccess = typeof userCityAccess.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type Driver = typeof drivers.$inferSelect;
export type Clinic = typeof clinics.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type SmsOptOut = typeof smsOptOut.$inferSelect;
export type CitySettings = typeof citySettings.$inferSelect;
export type DriverVehicleAssignment = typeof driverVehicleAssignments.$inferSelect;
export type InsertCitySettings = z.infer<typeof insertCitySettingsSchema>;
export type InsertDriverVehicleAssignment = z.infer<typeof insertDriverVehicleAssignmentSchema>;
export type VehicleAssignmentHistory = typeof vehicleAssignmentHistory.$inferSelect;
export type InsertVehicleAssignmentHistory = z.infer<typeof insertVehicleAssignmentHistorySchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
