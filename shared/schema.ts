import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, pgEnum, doublePrecision, numeric, uniqueIndex, index, jsonb, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userRoleEnum = pgEnum("user_role", [
  "SUPER_ADMIN",
  "ADMIN",
  "DISPATCH",
  "DRIVER",
  "VIEWER",
  "COMPANY_ADMIN",
  "CLINIC_USER",
  "CLINIC_ADMIN",
  "CLINIC_VIEWER",
]);

export const companies = pgTable("companies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  dispatchPhone: text("dispatch_phone"),
  dispatchChatEnabled: boolean("dispatch_chat_enabled").notNull().default(true),
  dispatchCallEnabled: boolean("dispatch_call_enabled").notNull().default(true),
  autoAssignV2Enabled: boolean("auto_assign_v2_enabled").notNull().default(false),
  autoAssignOfferTimeoutSeconds: integer("auto_assign_offer_timeout_seconds").notNull().default(120),
  autoAssignMaxRounds: integer("auto_assign_max_rounds").notNull().default(6),
  autoAssignMaxDistanceMeters: integer("auto_assign_max_distance_meters").notNull().default(20000),
  autoAssignWeightDistance: integer("auto_assign_weight_distance").notNull().default(45),
  autoAssignWeightReliability: integer("auto_assign_weight_reliability").notNull().default(25),
  autoAssignWeightLoad: integer("auto_assign_weight_load").notNull().default(20),
  autoAssignWeightFatigue: integer("auto_assign_weight_fatigue").notNull().default(10),
  zeroTouchDialysisEnabled: boolean("zero_touch_dialysis_enabled").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
  deleteReason: text("delete_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tripStatusEnum = pgEnum("trip_status", [
  "SCHEDULED",
  "ASSIGNED",
  "EN_ROUTE_TO_PICKUP",
  "ARRIVED_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_TO_DROPOFF",
  "ARRIVED_DROPOFF",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export const tripApprovalStatusEnum = pgEnum("trip_approval_status", [
  "pending",
  "approved",
  "cancel_requested",
  "cancelled",
]);

export const tripCancelTypeEnum = pgEnum("trip_cancel_type", [
  "soft",
  "hard",
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
  "dialysis",
]);

export const assignmentStatusEnum = pgEnum("assignment_status", [
  "active",
  "reassigned",
  "cancelled",
]);

export const usStates = pgTable("us_states", {
  code: varchar("code", { length: 2 }).primaryKey(),
  name: text("name").notNull(),
});

export const usCities = pgTable("us_cities", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  stateCode: varchar("state_code", { length: 2 }).notNull().references(() => usStates.code),
  city: text("city").notNull(),
  cityNormalized: text("city_normalized").notNull(),
  population: integer("population"),
  isMajor: boolean("is_major").notNull().default(true),
}, (table) => [
  uniqueIndex("us_cities_state_city_idx").on(table.stateCode, table.cityNormalized),
]);

export const cities = pgTable("cities", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  state: text("state").notNull(),
  timezone: text("timezone").notNull().default("America/New_York"),
  active: boolean("active").notNull().default(true),
  usCityId: integer("us_city_id").references(() => usCities.id),
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
  patientId: integer("patient_id"),
  companyId: integer("company_id").references(() => companies.id),
  workingCityId: integer("working_city_id").references(() => cities.id),
  workingCityScope: text("working_city_scope").default("CITY"),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
  deleteReason: text("delete_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userCityAccess = pgTable("user_city_access", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id),
  cityId: integer("city_id").notNull().references(() => cities.id),
});

export const dispatcherCityPermissions = pgTable("dispatcher_city_permissions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id),
  companyId: integer("company_id").notNull().references(() => companies.id),
  cityId: integer("city_id").notNull().references(() => cities.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("dispatcher_city_perms_user_city_idx").on(table.userId, table.cityId),
  index("dispatcher_city_perms_company_user_idx").on(table.companyId, table.userId),
]);

export const vehicleMakes = pgTable("vehicle_makes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const vehicleModels = pgTable("vehicle_models", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  makeId: integer("make_id").notNull().references(() => vehicleMakes.id),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
  makeId: integer("make_id").references(() => vehicleMakes.id),
  modelId: integer("model_id").references(() => vehicleModels.id),
  makeText: text("make_text"),
  modelText: text("model_text"),
  year: integer("year"),
  capacity: integer("capacity").notNull().default(4),
  wheelchairAccessible: boolean("wheelchair_accessible").notNull().default(false),
  capability: text("capability").notNull().default("SEDAN"),
  status: vehicleStatusEnum("status").notNull().default("ACTIVE"),
  lastServiceDate: timestamp("last_service_date"),
  maintenanceNotes: text("maintenance_notes"),
  companyId: integer("company_id").notNull().references(() => companies.id),
  active: boolean("active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
  deleteReason: text("delete_reason"),
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
  lastActiveAt: timestamp("last_active_at"),
  connected: boolean("connected").notNull().default(false),
  connectedAt: timestamp("connected_at"),
  companyId: integer("company_id").notNull().references(() => companies.id),
  vehicleCapability: text("vehicle_capability").notNull().default("sedan"),
  photoUrl: text("photo_url"),
  active: boolean("active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
  deleteReason: text("delete_reason"),
  updatedAt: timestamp("updated_at").defaultNow(),
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
  addressPlaceId: text("address_place_id"),
  email: text("email").unique(),
  authUserId: text("auth_user_id"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  phone: text("phone"),
  contactName: text("contact_name"),
  facilityType: facilityTypeEnum("facility_type").notNull().default("clinic"),
  companyId: integer("company_id").references(() => companies.id),
  active: boolean("active").notNull().default(true),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeDefaultPaymentMethodId: text("stripe_default_payment_method_id"),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
  deleteReason: text("delete_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const patients = pgTable("patients", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  publicId: varchar("public_id", { length: 20 }).notNull().unique(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone"),
  address: text("address"),
  addressStreet: text("address_street"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  addressZip: text("address_zip"),
  addressPlaceId: text("address_place_id"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  dateOfBirth: text("date_of_birth"),
  insuranceId: text("insurance_id"),
  email: text("email"),
  notes: text("notes"),
  wheelchairRequired: boolean("wheelchair_required").notNull().default(false),
  source: text("source").notNull().default("internal"),
  companyId: integer("company_id").notNull().references(() => companies.id),
  active: boolean("active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
  deleteReason: text("delete_reason"),
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
  pickupPlaceId: text("pickup_place_id"),
  pickupLat: doublePrecision("pickup_lat"),
  pickupLng: doublePrecision("pickup_lng"),
  dropoffAddress: text("dropoff_address").notNull(),
  dropoffStreet: text("dropoff_street"),
  dropoffCity: text("dropoff_city"),
  dropoffState: text("dropoff_state"),
  dropoffZip: text("dropoff_zip"),
  dropoffPlaceId: text("dropoff_place_id"),
  dropoffLat: doublePrecision("dropoff_lat"),
  dropoffLng: doublePrecision("dropoff_lng"),
  scheduledDate: text("scheduled_date").notNull(),
  scheduledTime: text("scheduled_time"),
  pickupTime: text("pickup_time").notNull(),
  estimatedArrivalTime: text("estimated_arrival_time").notNull().default("TBD"),
  tripType: tripTypeEnum("trip_type").notNull().default("one_time"),
  recurringDays: text("recurring_days").array(),
  status: tripStatusEnum("status").notNull().default("SCHEDULED"),
  lastEtaMinutes: integer("last_eta_minutes"),
  distanceMiles: numeric("distance_miles"),
  durationMinutes: integer("duration_minutes"),
  routePolyline: text("route_polyline"),
  routeDistanceMeters: integer("route_distance_meters"),
  routeDurationSeconds: integer("route_duration_seconds"),
  routeFingerprint: text("route_fingerprint"),
  routeProvider: text("route_provider").default("google"),
  routeStatus: text("route_status").default("missing"),
  routeVersion: integer("route_version").default(1),
  routeUpdatedAt: timestamp("route_updated_at"),
  actualDistanceMeters: integer("actual_distance_meters"),
  actualDistanceSource: text("actual_distance_source").default("estimated"),
  lastEtaUpdatedAt: timestamp("last_eta_updated_at"),
  fiveMinAlertSent: boolean("five_min_alert_sent").notNull().default(false),
  staticMapThumbUrl: text("static_map_thumb_url"),
  staticMapFullUrl: text("static_map_full_url"),
  staticMapGeneratedAt: timestamp("static_map_generated_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
  approvalStatus: tripApprovalStatusEnum("approval_status").notNull().default("approved"),
  approvedAt: timestamp("approved_at"),
  approvedBy: integer("approved_by"),
  cancelledBy: integer("cancelled_by"),
  cancelledReason: text("cancelled_reason"),
  cancelType: tripCancelTypeEnum("cancel_type"),
  cancelledAt: timestamp("cancelled_at"),
  tripSeriesId: integer("trip_series_id"),
  confirmationStatus: text("confirmation_status").default("unconfirmed"),
  noShowRisk: boolean("no_show_risk").notNull().default(false),
  confirmationTime: timestamp("confirmation_time"),
  routeBatchId: integer("route_batch_id"),
  routeOrder: integer("route_order"),
  assignedAt: timestamp("assigned_at"),
  assignedBy: integer("assigned_by"),
  assignmentBatchId: integer("assignment_batch_id"),
  assignmentSource: text("assignment_source"),
  assignmentReason: text("assignment_reason"),
  startedAt: timestamp("started_at"),
  arrivedPickupAt: timestamp("arrived_pickup_at"),
  pickedUpAt: timestamp("picked_up_at"),
  enRouteDropoffAt: timestamp("en_route_dropoff_at"),
  arrivedDropoffAt: timestamp("arrived_dropoff_at"),
  completedAt: timestamp("completed_at"),
  companyId: integer("company_id").notNull().references(() => companies.id),
  invoiceId: integer("invoice_id").references((): AnyPgColumn => invoices.id),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
  deleteReason: text("delete_reason"),
  requestSource: text("request_source").notNull().default("internal"),
  notes: text("notes"),
  billable: boolean("billable").notNull().default(true),
  faultParty: text("fault_party"),
  cancelStage: text("cancel_stage"),
  parentTripId: integer("parent_trip_id"),
  cancelFee: numeric("cancel_fee", { precision: 10, scale: 2 }),
  cancelFeeOverride: numeric("cancel_fee_override", { precision: 10, scale: 2 }),
  cancelFeeOverrideNote: text("cancel_fee_override_note"),
  mobilityRequirement: text("mobility_requirement").notNull().default("STANDARD"),
  passengerCount: integer("passenger_count").notNull().default(1),
  billingOutcome: text("billing_outcome"),
  billingReason: text("billing_reason"),
  billingSetBy: integer("billing_set_by"),
  billingSetAt: timestamp("billing_set_at"),
  billingOverride: boolean("billing_override").notNull().default(false),
  cancelWindow: text("cancel_window"),
  priceTotalCents: integer("price_total_cents"),
  pricingSnapshot: jsonb("pricing_snapshot"),
  verificationToken: text("verification_token"),
  pdfHash: text("pdf_hash"),
  sharedGroupId: text("shared_group_id"),
  sharedPassengerCount: integer("shared_passenger_count").notNull().default(1),
  sharedPricingMode: text("shared_pricing_mode").notNull().default("PER_PATIENT"),
  primaryTripId: integer("primary_trip_id"),
  waitingStartedAt: timestamp("waiting_started_at"),
  waitingMinutes: integer("waiting_minutes").notNull().default(10),
  waitingEndedAt: timestamp("waiting_ended_at"),
  waitingReason: text("waiting_reason"),
  waitingOverride: boolean("waiting_override").notNull().default(false),
  waitingExtendCount: integer("waiting_extend_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  archivedAt: timestamp("archived_at"),
  archivedBy: integer("archived_by"),
  archiveReason: text("archive_reason"),
  autoAssignStatus: text("auto_assign_status").notNull().default("IDLE"),
  autoAssignLastRunAt: timestamp("auto_assign_last_run_at"),
  autoAssignFailureReason: text("auto_assign_failure_reason"),
  autoAssignSelectedDriverId: integer("auto_assign_selected_driver_id"),
  autoAssignRunId: integer("auto_assign_run_id"),
  originalEtaSeconds: integer("original_eta_seconds"),
  etaLastCheckedAt: timestamp("eta_last_checked_at"),
  etaVarianceSeconds: integer("eta_variance_seconds"),
  etaEscalationLevel: text("eta_escalation_level").notNull().default("NONE"),
  etaEscalationLastAt: timestamp("eta_escalation_last_at"),
});

export const tripSignatures = pgTable("trip_signatures", {
  tripId: integer("trip_id").primaryKey().references(() => trips.id),
  driverSigBase64: text("driver_sig_base64"),
  clinicSigBase64: text("clinic_sig_base64"),
  driverSignedAt: timestamp("driver_signed_at"),
  clinicSignedAt: timestamp("clinic_signed_at"),
  signatureRefused: boolean("signature_refused").notNull().default(false),
  refusedReason: text("refused_reason"),
  signatureStage: text("signature_stage").default("dropoff"),
});

export const insertTripSignatureSchema = createInsertSchema(tripSignatures);
export type InsertTripSignature = z.infer<typeof insertTripSignatureSchema>;
export type TripSignature = typeof tripSignatures.$inferSelect;

export const tripMessages = pgTable("trip_messages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  senderId: integer("sender_id").notNull().references(() => users.id),
  senderRole: text("sender_role").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTripMessageSchema = createInsertSchema(tripMessages).omit({ createdAt: true });
export type InsertTripMessage = z.infer<typeof insertTripMessageSchema>;
export type TripMessage = typeof tripMessages.$inferSelect;

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
  notes: text("notes"),
  pdfUrl: text("pdf_url"),
  reason: text("reason"),
  faultParty: text("fault_party"),
  relatedTripId: integer("related_trip_id"),
  emailTo: text("email_to"),
  emailStatus: text("email_status").notNull().default("not_sent"),
  emailSentAt: timestamp("email_sent_at"),
  emailError: text("email_error"),
  stripePaymentLink: text("stripe_payment_link"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeChargeId: text("stripe_charge_id"),
  receiptUrl: text("receipt_url"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const companyStripeAccounts = pgTable("company_stripe_accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().unique().references(() => companies.id),
  stripeAccountId: text("stripe_account_id").notNull(),
  chargesEnabled: boolean("charges_enabled").notNull().default(false),
  payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
  detailsSubmitted: boolean("details_submitted").notNull().default(false),
  onboardingStatus: text("onboarding_status").notNull().default("PENDING"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanyStripeAccountSchema = createInsertSchema(companyStripeAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export type CompanyStripeAccount = typeof companyStripeAccounts.$inferSelect;
export type InsertCompanyStripeAccount = z.infer<typeof insertCompanyStripeAccountSchema>;

export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  type: text("type").notNull(),
  status: text("status").notNull().default("RECEIVED"),
  error: text("error"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;

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
  driverGoTimeMinutes: integer("driver_go_time_minutes").notNull().default(20),
  driverGoTimeRepeatMinutes: integer("driver_go_time_repeat_minutes").notNull().default(5),
  offerTtlSeconds: integer("offer_ttl_seconds").notNull().default(90),
});

export const driverVehicleAssignments = pgTable("driver_vehicle_assignments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  date: text("date").notNull(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  shiftStartTime: text("shift_start_time").notNull(),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id),
  assignedBy: assignedByEnum("assigned_by").notNull().default("system"),
  status: assignmentStatusEnum("status").notNull().default("active"),
  notes: text("notes"),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at"),
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

export const seriesPatternEnum = pgEnum("series_pattern", [
  "mwf",
  "tths",
  "daily",
  "custom",
]);

export const tripSeries = pgTable("trip_series", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  pattern: seriesPatternEnum("pattern").notNull(),
  daysMask: text("days_mask").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  occurrences: integer("occurrences"),
  pickupTime: text("pickup_time").notNull(),
  estimatedArrivalTime: text("estimated_arrival_time").notNull().default("TBD"),
  pickupAddress: text("pickup_address").notNull(),
  pickupStreet: text("pickup_street"),
  pickupCity: text("pickup_city"),
  pickupState: text("pickup_state"),
  pickupZip: text("pickup_zip"),
  pickupPlaceId: text("pickup_place_id"),
  pickupLat: doublePrecision("pickup_lat"),
  pickupLng: doublePrecision("pickup_lng"),
  dropoffAddress: text("dropoff_address").notNull(),
  dropoffStreet: text("dropoff_street"),
  dropoffCity: text("dropoff_city"),
  dropoffState: text("dropoff_state"),
  dropoffZip: text("dropoff_zip"),
  dropoffPlaceId: text("dropoff_place_id"),
  dropoffLat: doublePrecision("dropoff_lat"),
  dropoffLng: doublePrecision("dropoff_lng"),
  active: boolean("active").notNull().default(true),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tripShareTokens = pgTable("trip_share_tokens", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  revoked: boolean("revoked").notNull().default(false),
});

export const tripSmsLog = pgTable("trip_sms_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  kind: text("kind").notNull(),
  toPhone: text("to_phone"),
  providerSid: text("provider_sid"),
  error: text("error"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("trip_sms_log_trip_kind_unique").on(table.tripId, table.kind),
]);

export const smsEvents = pgTable("sms_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: integer("company_id").notNull(),
  tripId: integer("trip_id"),
  patientId: integer("patient_id"),
  driverId: integer("driver_id"),
  toPhone: text("to_phone").notNull(),
  fromPhone: text("from_phone"),
  purpose: text("purpose").notNull(),
  status: text("status").notNull(),
  twilioSid: text("twilio_sid"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  metadata: jsonb("metadata"),
});

export const auditLog = pgTable("audit_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id"),
  details: text("details"),
  cityId: integer("city_id").references(() => cities.id),
  actorRole: text("actor_role"),
  companyId: integer("company_id"),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  metadataJson: jsonb("metadata_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tripEventTypeEnum = pgEnum("trip_event_type", [
  "late_driver",
  "late_patient",
  "no_show_driver",
  "no_show_patient",
  "complaint",
  "incident",
  "assigned",
  "enroute_pickup",
  "arrived_pickup",
  "start_trip",
  "enroute_dropoff",
  "arrived_dropoff",
  "complete",
  "reroute",
]);

export const tripEvents = pgTable("trip_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  eventType: tripEventTypeEnum("event_type").notNull(),
  minutesLate: integer("minutes_late"),
  notes: text("notes"),
  payload: jsonb("payload"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tripRoutes = pgTable("trip_routes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  version: integer("version").notNull().default(1),
  polyline: text("polyline").notNull(),
  distanceMeters: integer("distance_meters"),
  durationSeconds: integer("duration_seconds"),
  provider: text("provider").default("google"),
  reason: text("reason"),
  fingerprint: text("fingerprint"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: integer("created_by").references(() => users.id),
});

export const insertTripRouteSchema = createInsertSchema(tripRoutes).omit({ createdAt: true });
export type TripRoute = typeof tripRoutes.$inferSelect;
export type InsertTripRoute = typeof tripRoutes.$inferInsert;

export const driverBonusRules = pgTable("driver_bonus_rules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  cityId: integer("city_id").notNull().references(() => cities.id).unique(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  weeklyAmountCents: integer("weekly_amount_cents").notNull().default(0),
  criteriaJson: jsonb("criteria_json"),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: integer("updated_by").references(() => users.id),
});

export const companyCities = pgTable("company_cities", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  cityId: integer("city_id").notNull().references(() => cities.id),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("company_cities_unique_idx").on(table.companyId, table.cityId),
]);

export const clinicCompanies = pgTable("clinic_companies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  companyId: integer("company_id").notNull().references(() => companies.id),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("clinic_companies_unique_idx").on(table.clinicId, table.companyId),
]);

export const insertCompanyCitySchema = createInsertSchema(companyCities).omit({ createdAt: true });
export const insertClinicCompanySchema = createInsertSchema(clinicCompanies).omit({ createdAt: true });

export const insertTripEventSchema = createInsertSchema(tripEvents).omit({ createdAt: true });
export const insertDriverBonusRuleSchema = createInsertSchema(driverBonusRules);

export const insertCompanySchema = createInsertSchema(companies).omit({ createdAt: true });
export const insertCitySchema = createInsertSchema(cities).omit({ createdAt: true });
export const insertUsStateSchema = createInsertSchema(usStates);
export const insertUsCitySchema = createInsertSchema(usCities);
export const insertUserSchema = createInsertSchema(users).omit({ createdAt: true });
export const insertVehicleSchema = createInsertSchema(vehicles).omit({ createdAt: true });
export const insertDriverSchema = createInsertSchema(drivers).omit({ createdAt: true });
export const insertClinicSchema = createInsertSchema(clinics).omit({ createdAt: true });
export const insertPatientSchema = createInsertSchema(patients).omit({ createdAt: true });
export const insertTripSchema = createInsertSchema(trips).omit({ createdAt: true, approvalStatus: true, approvedAt: true, approvedBy: true, cancelledBy: true, cancelledReason: true, cancelType: true, cancelledAt: true, deletedAt: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ createdAt: true });
export const insertCitySettingsSchema = createInsertSchema(citySettings);
export const insertDriverVehicleAssignmentSchema = createInsertSchema(driverVehicleAssignments).omit({ createdAt: true });
export const insertVehicleAssignmentHistorySchema = createInsertSchema(vehicleAssignmentHistory);
export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ createdAt: true });
export const insertTripSeriesSchema = createInsertSchema(tripSeries).omit({ createdAt: true });
export const insertTripShareTokenSchema = createInsertSchema(tripShareTokens).omit({ createdAt: true });
export const insertTripSmsLogSchema = createInsertSchema(tripSmsLog).omit({ sentAt: true });

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type InsertCity = z.infer<typeof insertCitySchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type InsertDriver = z.infer<typeof insertDriverSchema>;
export type InsertClinic = z.infer<typeof insertClinicSchema>;
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type InsertTrip = z.infer<typeof insertTripSchema>;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

export type Company = typeof companies.$inferSelect;
export type City = typeof cities.$inferSelect;
export type CompanyCity = typeof companyCities.$inferSelect;
export type ClinicCompany = typeof clinicCompanies.$inferSelect;
export type InsertCompanyCity = z.infer<typeof insertCompanyCitySchema>;
export type InsertClinicCompany = z.infer<typeof insertClinicCompanySchema>;
export type UsState = typeof usStates.$inferSelect;
export type UsCity = typeof usCities.$inferSelect;
export type InsertUsState = z.infer<typeof insertUsStateSchema>;
export type InsertUsCity = z.infer<typeof insertUsCitySchema>;
export type User = typeof users.$inferSelect;
export type UserCityAccess = typeof userCityAccess.$inferSelect;
export type DispatcherCityPermission = typeof dispatcherCityPermissions.$inferSelect;
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
export type TripSeries = typeof tripSeries.$inferSelect;
export type InsertTripSeries = z.infer<typeof insertTripSeriesSchema>;
export type TripShareToken = typeof tripShareTokens.$inferSelect;
export type InsertTripShareToken = z.infer<typeof insertTripShareTokenSchema>;
export type TripSmsLog = typeof tripSmsLog.$inferSelect;
export type InsertTripSmsLog = z.infer<typeof insertTripSmsLogSchema>;

export type TripEvent = typeof tripEvents.$inferSelect;
export type InsertTripEvent = z.infer<typeof insertTripEventSchema>;
export type DriverBonusRule = typeof driverBonusRules.$inferSelect;
export type InsertDriverBonusRule = z.infer<typeof insertDriverBonusRuleSchema>;

export type VehicleMake = typeof vehicleMakes.$inferSelect;
export type VehicleModel = typeof vehicleModels.$inferSelect;

export const scheduleChangeRequestTypeEnum = pgEnum("schedule_change_request_type", [
  "DAY_CHANGE", "TIME_CHANGE", "UNAVAILABLE", "SWAP_REQUEST",
]);

export const scheduleChangeRequestStatusEnum = pgEnum("schedule_change_request_status", [
  "PENDING", "APPROVED", "REJECTED", "CANCELLED",
]);

export const scheduleChangeRequests = pgTable("schedule_change_requests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").references(() => companies.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  cityId: integer("city_id").references(() => cities.id),
  requestType: scheduleChangeRequestTypeEnum("request_type").notNull(),
  currentDate: text("current_schedule_date"),
  requestedDate: text("requested_date"),
  currentShiftStart: text("current_shift_start"),
  currentShiftEnd: text("current_shift_end"),
  requestedShiftStart: text("requested_shift_start"),
  requestedShiftEnd: text("requested_shift_end"),
  reason: text("reason").notNull(),
  status: scheduleChangeRequestStatusEnum("status").notNull().default("PENDING"),
  dispatcherUserId: integer("dispatcher_user_id").references(() => users.id),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  decidedAt: timestamp("decided_at"),
}, (table) => [
  index("idx_scr_status_created").on(table.status, table.createdAt),
  index("idx_scr_driver_created").on(table.driverId, table.createdAt),
  index("idx_scr_company_status").on(table.companyId, table.status),
]);

export const insertScheduleChangeRequestSchema = createInsertSchema(scheduleChangeRequests).omit({ createdAt: true, updatedAt: true, dispatcherUserId: true, decidedAt: true, status: true, decisionNote: true });
export type ScheduleChangeRequest = typeof scheduleChangeRequests.$inferSelect;
export type InsertScheduleChangeRequest = z.infer<typeof insertScheduleChangeRequestSchema>;

export const shiftSwapStatusEnum = pgEnum("shift_swap_status", [
  "PENDING_TARGET", "DECLINED_TARGET", "ACCEPTED_TARGET", "PENDING_DISPATCH", "APPROVED_DISPATCH", "REJECTED_DISPATCH", "CANCELLED",
]);

export const driverShiftSwapRequests = pgTable("driver_shift_swap_requests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").references(() => companies.id),
  cityId: integer("city_id").references(() => cities.id),
  requesterDriverId: integer("requester_driver_id").notNull().references(() => drivers.id),
  targetDriverId: integer("target_driver_id").notNull().references(() => drivers.id),
  shiftDate: text("shift_date").notNull(),
  shiftStart: text("shift_start"),
  shiftEnd: text("shift_end"),
  reason: text("reason").notNull(),
  status: shiftSwapStatusEnum("status").notNull().default("PENDING_TARGET"),
  targetDecisionNote: text("target_decision_note"),
  dispatchUserId: integer("dispatch_user_id").references(() => users.id),
  dispatchDecisionNote: text("dispatch_decision_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  targetDecidedAt: timestamp("target_decided_at"),
  dispatchDecidedAt: timestamp("dispatch_decided_at"),
}, (table) => [
  index("idx_swap_target_status").on(table.targetDriverId, table.status),
  index("idx_swap_requester_created").on(table.requesterDriverId, table.createdAt),
  index("idx_swap_company_status").on(table.companyId, table.status),
  index("idx_swap_shift_date").on(table.shiftDate),
]);

export const insertDriverShiftSwapSchema = createInsertSchema(driverShiftSwapRequests).omit({ createdAt: true, updatedAt: true, status: true,
  targetDecisionNote: true, dispatchUserId: true, dispatchDecisionNote: true,
  targetDecidedAt: true, dispatchDecidedAt: true, });
export type DriverShiftSwapRequest = typeof driverShiftSwapRequests.$inferSelect;
export type InsertDriverShiftSwapRequest = z.infer<typeof insertDriverShiftSwapSchema>;

export const loginTokens = pgTable("login_tokens", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tokenHash: text("token_hash").notNull().unique(),
  userId: integer("user_id"),
  clinicId: integer("clinic_id"),
  driverId: integer("driver_id"),
  role: text("role").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type LoginToken = typeof loginTokens.$inferSelect;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const opsAlertLog = pgTable("ops_alert_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  date: text("date").notNull(),
  alertFingerprint: text("alert_fingerprint").notNull(),
  overall: text("overall").notNull(),
  criticalCodes: text("critical_codes").array(),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  sentTo: text("sent_to"),
  providerSid: text("provider_sid"),
  error: text("error"),
});

export const clinicAlertLog = pgTable("clinic_alert_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  alertFingerprint: text("alert_fingerprint").notNull(),
  alertType: text("alert_type").notNull(),
  overall: text("overall").notNull(),
  criticalCodes: text("critical_codes").array(),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  sentTo: text("sent_to"),
  providerSid: text("provider_sid"),
  error: text("error"),
});

export const clinicHelpRequests = pgTable("clinic_help_requests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  message: text("message").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertOpsAlertLogSchema = createInsertSchema(opsAlertLog).omit({ sentAt: true });
export const insertClinicAlertLogSchema = createInsertSchema(clinicAlertLog).omit({ sentAt: true });
export const insertClinicHelpRequestSchema = createInsertSchema(clinicHelpRequests).omit({ createdAt: true, resolved: true, resolvedBy: true, resolvedAt: true });

export type OpsAlertLog = typeof opsAlertLog.$inferSelect;
export type InsertOpsAlertLog = z.infer<typeof insertOpsAlertLogSchema>;
export type ClinicAlertLog = typeof clinicAlertLog.$inferSelect;
export type InsertClinicAlertLog = z.infer<typeof insertClinicAlertLogSchema>;
export type ClinicHelpRequest = typeof clinicHelpRequests.$inferSelect;
export type InsertClinicHelpRequest = z.infer<typeof insertClinicHelpRequestSchema>;

export const assignmentBatchStatusEnum = pgEnum("assignment_batch_status", [
  "proposed",
  "applied",
  "cancelled",
]);

export const assignmentBatches = pgTable("assignment_batches", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  runAt: timestamp("run_at").notNull().defaultNow(),
  date: text("date").notNull(),
  status: text("status").notNull().default("proposed"),
  createdBy: integer("created_by").references(() => users.id),
  notes: text("notes"),
  tripCount: integer("trip_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const routeBatches = pgTable("route_batches", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  date: text("date").notNull(),
  batchLabel: text("batch_label"),
  tripIds: integer("trip_ids").array().notNull(),
  driverAssigned: integer("driver_assigned").references(() => drivers.id),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const driverScores = pgTable("driver_scores", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  cityId: integer("city_id").notNull().references(() => cities.id),
  weekStart: text("week_start").notNull(),
  weekEnd: text("week_end").notNull(),
  onTimeRate: doublePrecision("on_time_rate").notNull().default(0),
  completedTrips: integer("completed_trips").notNull().default(0),
  totalTrips: integer("total_trips").notNull().default(0),
  noShowAvoided: integer("no_show_avoided").notNull().default(0),
  cancellations: integer("cancellations").notNull().default(0),
  lateCount: integer("late_count").notNull().default(0),
  score: integer("score").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const driverSupportEvents = pgTable("driver_support_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  tripId: integer("trip_id").references(() => trips.id),
  eventType: text("event_type").notNull(),
  notes: text("notes"),
  resolved: boolean("resolved").notNull().default(false),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDriverSupportEventSchema = createInsertSchema(driverSupportEvents).omit({ createdAt: true, resolved: true, resolvedBy: true, resolvedAt: true });
export type DriverSupportEvent = typeof driverSupportEvents.$inferSelect;
export type InsertDriverSupportEvent = z.infer<typeof insertDriverSupportEventSchema>;

export const insertRouteBatchSchema = createInsertSchema(routeBatches).omit({ createdAt: true });
export const insertDriverScoreSchema = createInsertSchema(driverScores).omit({ createdAt: true });

export type RouteBatch = typeof routeBatches.$inferSelect;
export type InsertRouteBatch = z.infer<typeof insertRouteBatchSchema>;
export type DriverScore = typeof driverScores.$inferSelect;
export type InsertDriverScore = z.infer<typeof insertDriverScoreSchema>;

export const insertAssignmentBatchSchema = createInsertSchema(assignmentBatches).omit({ createdAt: true });
export type AssignmentBatch = typeof assignmentBatches.$inferSelect;
export type InsertAssignmentBatch = z.infer<typeof insertAssignmentBatchSchema>;

export const recurringSchedules = pgTable("recurring_schedules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  cityId: integer("city_id").notNull().references(() => cities.id),
  days: text("days").array().notNull(),
  pickupTime: text("pickup_time").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRecurringScheduleSchema = createInsertSchema(recurringSchedules).omit({ createdAt: true });
export type RecurringSchedule = typeof recurringSchedules.$inferSelect;
export type InsertRecurringSchedule = z.infer<typeof insertRecurringScheduleSchema>;

export const driverTripAlertKindEnum = pgEnum("driver_trip_alert_kind", [
  "go_time",
]);

export const driverTripAlerts = pgTable("driver_trip_alerts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  kind: driverTripAlertKindEnum("kind").notNull(),
  firstShownAt: timestamp("first_shown_at").notNull().defaultNow(),
  lastShownAt: timestamp("last_shown_at").notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
});

export const insertDriverTripAlertSchema = createInsertSchema(driverTripAlerts);
export type DriverTripAlert = typeof driverTripAlerts.$inferSelect;
export type InsertDriverTripAlert = z.infer<typeof insertDriverTripAlertSchema>;

export const offerStatusEnum = pgEnum("offer_status", [
  "pending",
  "accepted",
  "expired",
  "cancelled",
]);

export const driverOffers = pgTable("driver_offers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  offeredAt: timestamp("offered_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  status: offerStatusEnum("status").notNull().default("pending"),
  acceptedAt: timestamp("accepted_at"),
  createdBy: integer("created_by").references(() => users.id),
});

export const insertDriverOfferSchema = createInsertSchema(driverOffers);
export type DriverOffer = typeof driverOffers.$inferSelect;
export type InsertDriverOffer = z.infer<typeof insertDriverOfferSchema>;

export const driverWeeklySchedules = pgTable("driver_weekly_schedules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  cityId: integer("city_id").notNull().references(() => cities.id),
  monEnabled: boolean("mon_enabled").notNull().default(false),
  monStart: text("mon_start").default("06:00"),
  monEnd: text("mon_end").default("18:00"),
  tueEnabled: boolean("tue_enabled").notNull().default(false),
  tueStart: text("tue_start").default("06:00"),
  tueEnd: text("tue_end").default("18:00"),
  wedEnabled: boolean("wed_enabled").notNull().default(false),
  wedStart: text("wed_start").default("06:00"),
  wedEnd: text("wed_end").default("18:00"),
  thuEnabled: boolean("thu_enabled").notNull().default(false),
  thuStart: text("thu_start").default("06:00"),
  thuEnd: text("thu_end").default("18:00"),
  friEnabled: boolean("fri_enabled").notNull().default(false),
  friStart: text("fri_start").default("06:00"),
  friEnd: text("fri_end").default("18:00"),
  satEnabled: boolean("sat_enabled").notNull().default(false),
  satStart: text("sat_start").default("06:00"),
  satEnd: text("sat_end").default("18:00"),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const sundayRosters = pgTable("sunday_rosters", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  rosterDate: text("roster_date").notNull(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  enabled: boolean("enabled").notNull().default(false),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const sundayRosterDrivers = pgTable("sunday_roster_drivers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  rosterId: integer("roster_id").notNull().references(() => sundayRosters.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
});

export const substitutePool = pgTable("substitute_pool", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  poolDate: text("pool_date").notNull(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  addedBy: integer("added_by").references(() => users.id),
  addedAt: timestamp("added_at").defaultNow(),
});

export const driverReplacements = pgTable("driver_replacements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  replacementDate: text("replacement_date").notNull(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  outDriverId: integer("out_driver_id").notNull().references(() => drivers.id),
  substituteDriverId: integer("substitute_driver_id").notNull().references(() => drivers.id),
  status: text("status").notNull().default("active"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDriverWeeklyScheduleSchema = createInsertSchema(driverWeeklySchedules);
export type DriverWeeklySchedule = typeof driverWeeklySchedules.$inferSelect;
export type InsertDriverWeeklySchedule = z.infer<typeof insertDriverWeeklyScheduleSchema>;

export const insertSundayRosterSchema = createInsertSchema(sundayRosters);
export type SundayRoster = typeof sundayRosters.$inferSelect;
export type InsertSundayRoster = z.infer<typeof insertSundayRosterSchema>;

export const insertSubstitutePoolSchema = createInsertSchema(substitutePool);
export type SubstitutePoolEntry = typeof substitutePool.$inferSelect;
export type InsertSubstitutePool = z.infer<typeof insertSubstitutePoolSchema>;

export const insertDriverReplacementSchema = createInsertSchema(driverReplacements);
export type DriverReplacement = typeof driverReplacements.$inferSelect;
export type InsertDriverReplacement = z.infer<typeof insertDriverReplacementSchema>;

export const pricingProfiles = pgTable("pricing_profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  appliesTo: text("applies_to").notNull().default("private"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const pricingRules = pgTable("pricing_rules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  profileId: integer("profile_id").notNull().references(() => pricingProfiles.id),
  key: text("key").notNull(),
  valueNumeric: numeric("value_numeric", { precision: 12, scale: 4 }),
  valueText: text("value_text"),
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("pricing_rules_profile_key_idx").on(table.profileId, table.key),
]);

export const pricingAuditLog = pgTable("pricing_audit_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  profileId: integer("profile_id").notNull().references(() => pricingProfiles.id),
  key: text("key").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedBy: integer("changed_by").references(() => users.id),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  note: text("note"),
});

export const insertPricingProfileSchema = createInsertSchema(pricingProfiles).omit({ createdAt: true, updatedAt: true });
export type PricingProfile = typeof pricingProfiles.$inferSelect;
export type InsertPricingProfile = z.infer<typeof insertPricingProfileSchema>;

export const insertPricingRuleSchema = createInsertSchema(pricingRules).omit({ updatedAt: true });
export type PricingRule = typeof pricingRules.$inferSelect;
export type InsertPricingRule = z.infer<typeof insertPricingRuleSchema>;

export type PricingAuditEntry = typeof pricingAuditLog.$inferSelect;

export const billingAuditLog = pgTable("billing_audit_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  oldOutcome: text("old_outcome"),
  newOutcome: text("new_outcome"),
  oldReason: text("old_reason"),
  newReason: text("new_reason"),
  changedBy: integer("changed_by").references(() => users.id),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

export const clinicBillingProfiles = pgTable("clinic_billing_profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  cityId: integer("city_id").notNull().references(() => cities.id),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  cancelAdvanceHours: integer("cancel_advance_hours").notNull().default(24),
  cancelLateMinutes: integer("cancel_late_minutes").notNull().default(0),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("cbp_clinic_city_idx").on(table.clinicId, table.cityId),
]);

export const clinicBillingRules = pgTable("clinic_billing_rules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  profileId: integer("profile_id").notNull().references(() => clinicBillingProfiles.id),
  outcome: text("outcome").notNull(),
  passengerCount: integer("passenger_count").notNull(),
  legType: text("leg_type").notNull(),
  cancelWindow: text("cancel_window"),
  unitRate: numeric("unit_rate", { precision: 10, scale: 2 }).notNull().default("0.00"),
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("cbr_profile_rule_idx").on(table.profileId, table.outcome, table.passengerCount, table.legType, table.cancelWindow),
]);

export const clinicBillingInvoices = pgTable("clinic_billing_invoices", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  cityId: integer("city_id").notNull().references(() => cities.id),
  weekStart: text("week_start").notNull(),
  weekEnd: text("week_end").notNull(),
  status: text("status").notNull().default("draft"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  completedTotal: numeric("completed_total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  noShowTotal: numeric("no_show_total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  cancelledTotal: numeric("cancelled_total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  companyErrorTotal: numeric("company_error_total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  outboundTotal: numeric("outbound_total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  returnTotal: numeric("return_total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  notes: text("notes"),
  finalizedAt: timestamp("finalized_at"),
  finalizedBy: integer("finalized_by").references(() => users.id),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("cbi_clinic_week_idx").on(table.clinicId, table.cityId, table.weekStart),
]);

export const clinicBillingInvoiceLines = pgTable("clinic_billing_invoice_lines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  invoiceId: integer("invoice_id").notNull().references(() => clinicBillingInvoices.id),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  serviceDate: text("service_date").notNull(),
  legType: text("leg_type").notNull(),
  outcome: text("outcome").notNull(),
  cancelWindow: text("cancel_window"),
  passengerCount: integer("passenger_count").notNull().default(1),
  unitRateSnapshot: numeric("unit_rate_snapshot", { precision: 10, scale: 2 }).notNull(),
  lineTotal: numeric("line_total", { precision: 10, scale: 2 }).notNull(),
  pickupAddress: text("pickup_address"),
  dropoffAddress: text("dropoff_address"),
  distanceMiles: numeric("distance_miles"),
  tripPublicId: text("trip_public_id"),
  pickupTime: text("pickup_time"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertClinicBillingProfileSchema = createInsertSchema(clinicBillingProfiles).omit({ createdAt: true, updatedAt: true });
export type ClinicBillingProfile = typeof clinicBillingProfiles.$inferSelect;
export type InsertClinicBillingProfile = z.infer<typeof insertClinicBillingProfileSchema>;

export const insertClinicBillingRuleSchema = createInsertSchema(clinicBillingRules).omit({ updatedAt: true });
export type ClinicBillingRule = typeof clinicBillingRules.$inferSelect;
export type InsertClinicBillingRule = z.infer<typeof insertClinicBillingRuleSchema>;

export const insertClinicBillingInvoiceSchema = createInsertSchema(clinicBillingInvoices).omit({ createdAt: true, updatedAt: true });
export type ClinicBillingInvoice = typeof clinicBillingInvoices.$inferSelect;
export type InsertClinicBillingInvoice = z.infer<typeof insertClinicBillingInvoiceSchema>;

export const insertClinicBillingInvoiceLineSchema = createInsertSchema(clinicBillingInvoiceLines).omit({ createdAt: true });
export type ClinicBillingInvoiceLine = typeof clinicBillingInvoiceLines.$inferSelect;
export type InsertClinicBillingInvoiceLine = z.infer<typeof insertClinicBillingInvoiceLineSchema>;

export type BillingAuditEntry = typeof billingAuditLog.$inferSelect;

export const driverDevices = pgTable("driver_devices", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  companyId: integer("company_id").references(() => companies.id),
  deviceFingerprintHash: text("device_fingerprint_hash").notNull(),
  deviceLabel: text("device_label"),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sessionRevocations = pgTable("session_revocations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id),
  companyId: integer("company_id").references(() => companies.id),
  revokedAfter: timestamp("revoked_after").notNull(),
  reason: text("reason"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDriverDeviceSchema = createInsertSchema(driverDevices).omit({ createdAt: true });
export type DriverDevice = typeof driverDevices.$inferSelect;
export type InsertDriverDevice = z.infer<typeof insertDriverDeviceSchema>;

export const insertSessionRevocationSchema = createInsertSchema(sessionRevocations).omit({ createdAt: true });
export type SessionRevocation = typeof sessionRevocations.$inferSelect;
export type InsertSessionRevocation = z.infer<typeof insertSessionRevocationSchema>;

export const pushPlatformEnum = pgEnum("push_platform", ["ios", "android", "web"]);

export const driverPushTokens = pgTable("driver_push_tokens", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  companyId: integer("company_id").references(() => companies.id),
  platform: pushPlatformEnum("platform").notNull(),
  token: text("token").notNull(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_push_tokens_unique").on(table.driverId, table.token),
]);

export const insertDriverPushTokenSchema = createInsertSchema(driverPushTokens).omit({ createdAt: true });
export type DriverPushToken = typeof driverPushTokens.$inferSelect;
export type InsertDriverPushToken = z.infer<typeof insertDriverPushTokenSchema>;

export const clinicTariffs = pgTable("clinic_tariffs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").references(() => companies.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  cityId: integer("city_id").references(() => cities.id),
  name: text("name").notNull().default("Default"),
  pricingModel: text("pricing_model").notNull().default("MILES_TIME"),
  baseFeeCents: integer("base_fee_cents").notNull().default(0),
  perMileCents: integer("per_mile_cents").notNull().default(0),
  perMinuteCents: integer("per_minute_cents").notNull().default(0),
  waitMinuteCents: integer("wait_minute_cents").notNull().default(0),
  wheelchairExtraCents: integer("wheelchair_extra_cents").notNull().default(0),
  sharedTripMode: text("shared_trip_mode").notNull().default("PER_PATIENT"),
  sharedTripDiscountPct: numeric("shared_trip_discount_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  noShowFeeCents: integer("no_show_fee_cents").notNull().default(0),
  cancelFeeCents: integer("cancel_fee_cents").notNull().default(0),
  minimumFareCents: integer("minimum_fare_cents").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ct_company_clinic_active_idx").on(table.companyId, table.clinicId, table.active),
]);

export const tripBilling = pgTable("trip_billing", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  companyId: integer("company_id").references(() => companies.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  patientId: integer("patient_id").references(() => patients.id),
  cityId: integer("city_id").references(() => cities.id),
  serviceDate: text("service_date"),
  statusAtBill: text("status_at_bill").notNull().default("COMPLETED"),
  pricingMode: text("pricing_mode").notNull().default("TARIFF"),
  tariffId: integer("tariff_id").references(() => clinicTariffs.id),
  contractPriceCents: integer("contract_price_cents"),
  mobilityRequirement: text("mobility_requirement").notNull().default("STANDARD"),
  distanceMiles: numeric("distance_miles", { precision: 10, scale: 2 }),
  waitMinutes: integer("wait_minutes").notNull().default(0),
  baseFeeCents: integer("base_fee_cents").notNull().default(0),
  perMileCents: integer("per_mile_cents").notNull().default(0),
  mileageCents: integer("mileage_cents").notNull().default(0),
  perMinuteCents: integer("per_minute_cents").notNull().default(0),
  minutesCents: integer("minutes_cents").notNull().default(0),
  waitCents: integer("wait_cents").notNull().default(0),
  wheelchairCents: integer("wheelchair_cents").notNull().default(0),
  sharedPassengers: integer("shared_passengers").notNull().default(1),
  sharedDiscountCents: integer("shared_discount_cents").notNull().default(0),
  noShowFeeCents: integer("no_show_fee_cents").notNull().default(0),
  cancelFeeCents: integer("cancel_fee_cents").notNull().default(0),
  adjustmentsCents: integer("adjustments_cents").notNull().default(0),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  components: jsonb("components").notNull().default({}),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("tb_trip_patient_idx").on(table.tripId, table.patientId),
  index("tb_company_clinic_idx").on(table.companyId, table.clinicId),
  index("tb_service_date_idx").on(table.serviceDate),
]);

export const clinicInvoicesMonthly = pgTable("clinic_invoices_monthly", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  cityId: integer("city_id").references(() => cities.id),
  periodMonth: text("period_month").notNull(),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  adjustmentsCents: integer("adjustments_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  status: text("status").notNull().default("draft"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
  paidAt: timestamp("paid_at"),
});

export const clinicInvoiceItems = pgTable("clinic_invoice_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  invoiceId: integer("invoice_id").notNull().references(() => clinicInvoicesMonthly.id),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  amountCents: integer("amount_cents").notNull().default(0),
  lineJson: text("line_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertClinicTariffSchema = createInsertSchema(clinicTariffs).omit({ createdAt: true });
export type ClinicTariff = typeof clinicTariffs.$inferSelect;
export type InsertClinicTariff = z.infer<typeof insertClinicTariffSchema>;

export const insertTripBillingSchema = createInsertSchema(tripBilling).omit({ createdAt: true });
export type TripBilling = typeof tripBilling.$inferSelect;
export type InsertTripBilling = z.infer<typeof insertTripBillingSchema>;

export const insertClinicInvoiceMonthlySchema = createInsertSchema(clinicInvoicesMonthly).omit({ generatedAt: true });
export type ClinicInvoiceMonthly = typeof clinicInvoicesMonthly.$inferSelect;
export type InsertClinicInvoiceMonthly = z.infer<typeof insertClinicInvoiceMonthlySchema>;

export const insertClinicInvoiceItemSchema = createInsertSchema(clinicInvoiceItems).omit({ createdAt: true });
export type ClinicInvoiceItem = typeof clinicInvoiceItems.$inferSelect;
export type InsertClinicInvoiceItem = z.infer<typeof insertClinicInvoiceItemSchema>;

export const accountDeletionRequests = pgTable("account_deletion_requests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id),
  role: text("role").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("requested"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  notes: text("notes"),
});

export const insertAccountDeletionRequestSchema = createInsertSchema(accountDeletionRequests).omit({ createdAt: true, reviewedBy: true, reviewedAt: true, notes: true });
export type AccountDeletionRequest = typeof accountDeletionRequests.$inferSelect;
export type InsertAccountDeletionRequest = z.infer<typeof insertAccountDeletionRequestSchema>;

export const driverEmergencyEvents = pgTable("driver_emergency_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  companyId: integer("company_id"),
  lat: text("lat"),
  lng: text("lng"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DriverEmergencyEvent = typeof driverEmergencyEvents.$inferSelect;

export const billingCycleEnum = pgEnum("billing_cycle_type", [
  "weekly",
  "biweekly",
  "monthly",
]);

export const biweeklyModeEnum = pgEnum("biweekly_mode_type", [
  "1_15",
  "anchor_14",
]);

export const cycleInvoiceStatusEnum = pgEnum("cycle_invoice_status", [
  "draft",
  "finalized",
  "void",
]);

export const invoicePaymentStatusEnum = pgEnum("invoice_payment_status", [
  "unpaid",
  "partial",
  "paid",
  "overdue",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "stripe",
  "ach",
  "manual",
]);

export const clinicBillingSettings = pgTable("clinic_billing_settings", {
  clinicId: integer("clinic_id").primaryKey().references(() => clinics.id),
  billingCycle: billingCycleEnum("billing_cycle").notNull().default("weekly"),
  anchorDow: integer("anchor_dow"),
  anchorDom: integer("anchor_dom"),
  biweeklyMode: biweeklyModeEnum("biweekly_mode").notNull().default("1_15"),
  anchorDate: text("anchor_date"),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  autoGenerate: boolean("auto_generate").notNull().default(false),
  graceDays: integer("grace_days").notNull().default(0),
  lateFeePct: numeric("late_fee_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertClinicBillingSettingsSchema = createInsertSchema(clinicBillingSettings);
export type ClinicBillingSettingsType = typeof clinicBillingSettings.$inferSelect;
export type InsertClinicBillingSettings = z.infer<typeof insertClinicBillingSettingsSchema>;

export const billingCycleInvoices = pgTable("billing_cycle_invoices", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").references(() => companies.id),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  status: cycleInvoiceStatusEnum("status").notNull().default("draft"),
  currency: text("currency").notNull().default("USD"),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  feesCents: integer("fees_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  finalizedAt: timestamp("finalized_at"),
  invoiceNumber: text("invoice_number").unique(),
  paymentStatus: invoicePaymentStatusEnum("payment_status").notNull().default("unpaid"),
  amountPaidCents: integer("amount_paid_cents").notNull().default(0),
  balanceDueCents: integer("balance_due_cents").notNull().default(0),
  dueDate: timestamp("due_date"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeCheckoutUrl: text("stripe_checkout_url"),
  lastPaymentAt: timestamp("last_payment_at"),
  locked: boolean("locked").notNull().default(false),
  receiptUrl: text("receipt_url"),
  platformFeeCents: integer("platform_fee_cents").notNull().default(0),
  platformFeeType: text("platform_fee_type"),
  platformFeeRate: numeric("platform_fee_rate"),
  netToCompanyCents: integer("net_to_company_cents"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("bci_clinic_period_idx").on(table.clinicId, table.periodStart, table.periodEnd, table.status),
  index("bci_payment_status_idx").on(table.paymentStatus, table.dueDate),
  index("bci_company_idx").on(table.companyId),
]);

export const insertBillingCycleInvoiceSchema = createInsertSchema(billingCycleInvoices).omit({ createdAt: true, updatedAt: true });
export type BillingCycleInvoice = typeof billingCycleInvoices.$inferSelect;
export type InsertBillingCycleInvoice = z.infer<typeof insertBillingCycleInvoiceSchema>;

export const billingCycleInvoiceItems = pgTable("billing_cycle_invoice_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  invoiceId: integer("invoice_id").notNull().references(() => billingCycleInvoices.id, { onDelete: "cascade" }),
  tripId: integer("trip_id").references(() => trips.id),
  patientId: integer("patient_id").references(() => patients.id),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("bcii_invoice_trip_idx").on(table.invoiceId, table.tripId),
  index("bcii_trip_idx").on(table.tripId),
]);

export const insertBillingCycleInvoiceItemSchema = createInsertSchema(billingCycleInvoiceItems).omit({ createdAt: true });
export type BillingCycleInvoiceItem = typeof billingCycleInvoiceItems.$inferSelect;
export type InsertBillingCycleInvoiceItem = z.infer<typeof insertBillingCycleInvoiceItemSchema>;

export const invoicePayments = pgTable("invoice_payments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  invoiceId: integer("invoice_id").notNull().references(() => billingCycleInvoices.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  method: paymentMethodEnum("method").notNull(),
  reference: text("reference"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeChargeId: text("stripe_charge_id"),
  paidAt: timestamp("paid_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ip_invoice_paid_idx").on(table.invoiceId, table.paidAt),
]);

export const insertInvoicePaymentSchema = createInsertSchema(invoicePayments).omit({ createdAt: true });
export type InvoicePayment = typeof invoicePayments.$inferSelect;
export type InsertInvoicePayment = z.infer<typeof insertInvoicePaymentSchema>;

export const invoiceSequences = pgTable("invoice_sequences", {
  id: integer("id").primaryKey().default(1),
  lastNumber: integer("last_number").notNull().default(0),
  prefix: text("prefix").notNull().default("INV"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InvoiceSequence = typeof invoiceSequences.$inferSelect;

export const platformFeeTypeEnum = pgEnum("platform_fee_type", ["PERCENT", "FIXED"]);

export const platformBillingSettings = pgTable("platform_billing_settings", {
  id: integer("id").primaryKey().default(1),
  enabled: boolean("enabled").notNull().default(false),
  defaultFeeType: platformFeeTypeEnum("default_fee_type").notNull().default("PERCENT"),
  defaultFeePercent: numeric("default_fee_percent").notNull().default("0"),
  defaultFeeCents: integer("default_fee_cents").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  monthlySubscriptionEnabled: boolean("monthly_subscription_enabled").notNull().default(false),
  monthlySubscriptionPriceId: text("monthly_subscription_price_id"),
  subscriptionRequiredForAccess: boolean("subscription_required_for_access").notNull().default(false),
  gracePeriodDays: integer("grace_period_days").notNull().default(0),
});

export type PlatformBillingSettings = typeof platformBillingSettings.$inferSelect;

export const companyPlatformFees = pgTable("company_platform_fees", {
  companyId: integer("company_id").primaryKey().references(() => companies.id),
  enabled: boolean("enabled"),
  feeType: platformFeeTypeEnum("fee_type"),
  feePercent: numeric("fee_percent"),
  feeCents: integer("fee_cents"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CompanyPlatformFee = typeof companyPlatformFees.$inferSelect;

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "working",
  "succeeded",
  "failed",
]);

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id),
  type: text("type").notNull(),
  status: jobStatusEnum("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  priority: integer("priority").notNull().default(0),
  payload: jsonb("payload").notNull().default({}),
  result: jsonb("result"),
  lastError: text("last_error"),
  lockedUntil: timestamp("locked_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("jobs_status_priority_idx").on(table.status, table.priority, table.createdAt),
  index("jobs_company_type_idx").on(table.companyId, table.type),
  index("jobs_type_status_idx").on(table.type, table.status),
]);

export const insertJobSchema = createInsertSchema(jobs).omit({ createdAt: true, updatedAt: true });
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;

export const systemEvents = pgTable("system_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").references(() => companies.id),
  actorUserId: integer("actor_user_id").references(() => users.id),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("sysevt_company_type_idx").on(table.companyId, table.eventType, table.createdAt),
  index("sysevt_entity_idx").on(table.entityType, table.entityId),
]);

export const insertSystemEventSchema = createInsertSchema(systemEvents).omit({ createdAt: true });
export type SystemEvent = typeof systemEvents.$inferSelect;
export type InsertSystemEvent = z.infer<typeof insertSystemEventSchema>;

export const companySettings = pgTable("company_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id).unique(),
  maxDrivers: integer("max_drivers").notNull().default(100),
  maxActiveTrips: integer("max_active_trips").notNull().default(500),
  rpmLimit: integer("rpm_limit").notNull().default(300),
  pdfRpmLimit: integer("pdf_rpm_limit").notNull().default(30),
  mapsRpmLimit: integer("maps_rpm_limit").notNull().default(60),
  driverProfileEnabled: boolean("driver_profile_enabled").notNull().default(true),
  lockDriverCapability: boolean("lock_driver_capability").notNull().default(false),
  driverV3: jsonb("driver_v3").$type<{
    performance?: boolean;
    smartPrompts?: boolean;
    offlineOutbox?: boolean;
    sounds?: boolean;
    scoring?: {
      graceMinutes?: number;
      weights?: { punctuality?: number; acceptance?: number; idle?: number; cancellations?: number; compliance?: number };
    };
    prompts?: { tMinusLeaveNow?: number; geofenceMeters?: number; cooldownMin?: number };
    tracking?: { fgSec?: number; bgSec?: number; accuracyMaxM?: number };
    waiting?: { minutes?: number; allowExtend?: boolean; maxExtends?: number };
  }>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanySettingsSchema = createInsertSchema(companySettings).omit({ createdAt: true, updatedAt: true });
export type CompanySettingsType = typeof companySettings.$inferSelect;
export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;

export const tripPdfs = pgTable("trip_pdfs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").references(() => companies.id),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  jobId: text("job_id").references(() => jobs.id),
  contentType: text("content_type").notNull().default("application/pdf"),
  bytes: text("bytes").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("trip_pdfs_trip_idx").on(table.tripId),
  index("trip_pdfs_company_idx").on(table.companyId),
  index("trip_pdfs_created_idx").on(table.createdAt),
]);

export type TripPdf = typeof tripPdfs.$inferSelect;

export const aiEngineSnapshots = pgTable("ai_engine_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
  runtimeMs: integer("runtime_ms").notNull(),
  engineStatus: text("engine_status").notNull().default("OK"),
  tripsAnalyzed: integer("trips_analyzed").notNull().default(0),
  driversAnalyzed: integer("drivers_analyzed").notNull().default(0),
  metrics: jsonb("metrics").notNull(),
  topRisks: jsonb("top_risks").notNull(),
  forecast: jsonb("forecast").notNull(),
}, (table) => [
  index("ai_engine_snapshots_computed_idx").on(table.computedAt),
]);

export type AiEngineSnapshot = typeof aiEngineSnapshots.$inferSelect;
export type InsertAiEngineSnapshot = typeof aiEngineSnapshots.$inferInsert;

export const driverPerfScores = pgTable("driver_perf_scores", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  window: text("window").notNull(),
  score: integer("score").notNull().default(0),
  components: jsonb("components").notNull().default({}),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
}, (table) => [
  index("dps_company_idx").on(table.companyId),
  index("dps_driver_idx").on(table.driverId),
  uniqueIndex("dps_company_driver_window_uniq").on(table.companyId, table.driverId, table.window),
]);

export const insertDriverPerfScoreSchema = createInsertSchema(driverPerfScores);
export type DriverPerfScore = typeof driverPerfScores.$inferSelect;
export type InsertDriverPerfScore = z.infer<typeof insertDriverPerfScoreSchema>;

export const opsAnomalies = pgTable("ops_anomalies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  severity: text("severity").notNull().default("info"),
  code: text("code").notNull(),
  title: text("title").notNull(),
  details: jsonb("details").notNull().default({}),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
}, (table) => [
  index("opsanom_company_idx").on(table.companyId),
  index("opsanom_active_idx").on(table.companyId, table.isActive),
  index("opsanom_entity_idx").on(table.entityType, table.entityId),
]);

export const insertOpsAnomalySchema = createInsertSchema(opsAnomalies);
export type OpsAnomaly = typeof opsAnomalies.$inferSelect;
export type InsertOpsAnomaly = z.infer<typeof insertOpsAnomalySchema>;

export function isVehicleCompatible(mobilityRequirement: string, vehicleCapability: string): boolean {
  if (mobilityRequirement === "WHEELCHAIR") {
    return vehicleCapability === "WHEELCHAIR";
  }
  return true;
}

export const dailyMetricsRollup = pgTable("daily_metrics_rollup", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  metricDate: text("metric_date").notNull(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  driverId: integer("driver_id").references(() => drivers.id),
  tripsTotal: integer("trips_total").notNull().default(0),
  tripsCompleted: integer("trips_completed").notNull().default(0),
  tripsCancelled: integer("trips_cancelled").notNull().default(0),
  tripsNoShow: integer("trips_no_show").notNull().default(0),
  onTimePickupCount: integer("on_time_pickup_count").notNull().default(0),
  latePickupCount: integer("late_pickup_count").notNull().default(0),
  avgPickupDelayMinutes: numeric("avg_pickup_delay_minutes"),
  gpsVerifiedCount: integer("gps_verified_count").notNull().default(0),
  pricingMissingCount: integer("pricing_missing_count").notNull().default(0),
  invoicesMissingCount: integer("invoices_missing_count").notNull().default(0),
  revenueCents: integer("revenue_cents").notNull().default(0),
  estCostCents: integer("est_cost_cents").notNull().default(0),
  marginCents: integer("margin_cents").notNull().default(0),
  emptyMiles: numeric("empty_miles").notNull().default("0"),
  idleMinutes: numeric("idle_minutes").notNull().default("0"),
  paidMiles: numeric("paid_miles").notNull().default("0"),
  activeMinutes: numeric("active_minutes").notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("dmr_unique_idx").on(table.metricDate, table.cityId, table.clinicId, table.driverId),
  index("dmr_city_date_idx").on(table.cityId, table.metricDate),
]);

export const insertDailyMetricsRollupSchema = createInsertSchema(dailyMetricsRollup).omit({ createdAt: true });
export type DailyMetricsRollup = typeof dailyMetricsRollup.$inferSelect;
export type InsertDailyMetricsRollup = z.infer<typeof insertDailyMetricsRollupSchema>;

export const weeklyScoreSnapshots = pgTable("weekly_score_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  weekStart: text("week_start").notNull(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  driverId: integer("driver_id").references(() => drivers.id),
  dpiScore: numeric("dpi_score"),
  criScore: numeric("cri_score"),
  triScore: numeric("tri_score"),
  costBleedScore: numeric("cost_bleed_score"),
  components: jsonb("components").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("wss_unique_idx").on(table.weekStart, table.cityId, table.clinicId, table.driverId),
  index("wss_city_week_idx").on(table.cityId, table.weekStart),
]);

export const insertWeeklyScoreSnapshotSchema = createInsertSchema(weeklyScoreSnapshots).omit({ createdAt: true });
export type WeeklyScoreSnapshot = typeof weeklyScoreSnapshots.$inferSelect;
export type InsertWeeklyScoreSnapshot = z.infer<typeof insertWeeklyScoreSnapshotSchema>;

export const triScores = pgTable("tri_scores", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  triScore: numeric("tri_score").notNull(),
  components: jsonb("components").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("tri_period_city_idx").on(table.periodStart, table.cityId, table.clinicId),
]);

export const insertTriScoreSchema = createInsertSchema(triScores).omit({ createdAt: true });
export type TriScore = typeof triScores.$inferSelect;
export type InsertTriScore = z.infer<typeof insertTriScoreSchema>;

export const costLeakAlertStatusEnum = pgEnum("cost_leak_alert_status", [
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
]);

export const costLeakAlertSeverityEnum = pgEnum("cost_leak_alert_severity", [
  "YELLOW",
  "RED",
]);

export const costLeakAlerts = pgTable("cost_leak_alerts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  driverId: integer("driver_id").references(() => drivers.id),
  alertType: text("alert_type").notNull(),
  severity: costLeakAlertSeverityEnum("severity").notNull(),
  status: costLeakAlertStatusEnum("status").notNull().default("OPEN"),
  metricDate: text("metric_date").notNull(),
  details: jsonb("details").notNull().default({}),
  acknowledgedBy: integer("acknowledged_by").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("cla_status_sev_idx").on(table.status, table.severity, table.createdAt),
  index("cla_city_date_idx").on(table.cityId, table.createdAt),
]);

export const insertCostLeakAlertSchema = createInsertSchema(costLeakAlerts).omit({ createdAt: true });
export type CostLeakAlert = typeof costLeakAlerts.$inferSelect;
export type InsertCostLeakAlert = z.infer<typeof insertCostLeakAlertSchema>;

export const ucmCertifications = pgTable("ucm_certifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  cityId: integer("city_id").notNull().references(() => cities.id),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  status: text("certification_status").notNull(),
  triScore: numeric("tri_score"),
  gpsRate: numeric("gps_rate"),
  noShowRate: numeric("no_show_rate"),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  reason: text("reason"),
  certifiedBy: integer("certified_by").references(() => users.id),
  certifiedAt: timestamp("certified_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ucm_cert_unique_idx").on(table.cityId, table.clinicId),
]);

export const insertUcmCertificationSchema = createInsertSchema(ucmCertifications).omit({ createdAt: true });
export type UcmCertification = typeof ucmCertifications.$inferSelect;
export type InsertUcmCertification = z.infer<typeof insertUcmCertificationSchema>;

export const intelligencePublications = pgTable("intelligence_publications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  module: text("module").notNull(),
  quarterKey: text("quarter_key"),
  scope: text("scope"),
  state: text("state"),
  city: text("city"),
  metricKey: text("metric_key"),
  configJson: jsonb("config_json").notNull().default({}),
  published: boolean("published").notNull().default(false),
  publishedAt: timestamp("published_at"),
  publishedBy: integer("published_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const intelligencePublicationTargets = pgTable("intelligence_publication_targets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  publicationId: integer("publication_id").notNull().references(() => intelligencePublications.id),
  targetType: text("target_type").notNull(),
  clinicId: integer("clinic_id").references(() => clinics.id),
  enabled: boolean("enabled").notNull().default(true),
}, (table) => [
  uniqueIndex("pub_target_unique_idx").on(table.publicationId, table.targetType, table.clinicId),
]);

export const insertIntelligencePublicationSchema = createInsertSchema(intelligencePublications).omit({ createdAt: true });
export type IntelligencePublication = typeof intelligencePublications.$inferSelect;
export type InsertIntelligencePublication = z.infer<typeof insertIntelligencePublicationSchema>;

export const insertIntelligencePublicationTargetSchema = createInsertSchema(intelligencePublicationTargets);
export type IntelligencePublicationTarget = typeof intelligencePublicationTargets.$inferSelect;
export type InsertIntelligencePublicationTarget = z.infer<typeof insertIntelligencePublicationTargetSchema>;

export const certLevelEnum = pgEnum("cert_level", ["PLATINUM", "GOLD", "SILVER", "AT_RISK"]);

export const clinicCertifications = pgTable("clinic_certifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  quarterKey: text("quarter_key").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  certLevel: text("cert_level").notNull(),
  score: numeric("score").notNull(),
  breakdownJson: jsonb("breakdown_json").notNull().default({}),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
  computedBy: integer("computed_by").references(() => users.id),
  pdfUrl: text("pdf_url"),
}, (table) => [
  uniqueIndex("clinic_cert_quarter_idx").on(table.clinicId, table.quarterKey),
]);

export const insertClinicCertificationSchema = createInsertSchema(clinicCertifications).omit({ computedAt: true });
export type ClinicCertification = typeof clinicCertifications.$inferSelect;
export type InsertClinicCertification = z.infer<typeof insertClinicCertificationSchema>;

export const quarterlyRankings = pgTable("quarterly_rankings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  quarterKey: text("quarter_key").notNull(),
  scope: text("scope").notNull(),
  state: text("state"),
  city: text("city"),
  metricKey: text("metric_key").notNull().default("tri"),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("qr_scope_idx").on(table.quarterKey, table.scope, table.state, table.city, table.metricKey),
]);

export const quarterlyRankingEntries = pgTable("quarterly_ranking_entries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  rankingId: integer("ranking_id").notNull().references(() => quarterlyRankings.id),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  rank: integer("rank").notNull(),
  score: numeric("score").notNull(),
  percentile: numeric("percentile").notNull(),
  payloadJson: jsonb("payload_json").notNull().default({}),
}, (table) => [
  uniqueIndex("qre_unique_idx").on(table.rankingId, table.clinicId),
]);

export const insertQuarterlyRankingSchema = createInsertSchema(quarterlyRankings).omit({ computedAt: true });
export type QuarterlyRanking = typeof quarterlyRankings.$inferSelect;
export type InsertQuarterlyRanking = z.infer<typeof insertQuarterlyRankingSchema>;

export const insertQuarterlyRankingEntrySchema = createInsertSchema(quarterlyRankingEntries);
export type QuarterlyRankingEntry = typeof quarterlyRankingEntries.$inferSelect;
export type InsertQuarterlyRankingEntry = z.infer<typeof insertQuarterlyRankingEntrySchema>;

export const auditReadinessSnapshots = pgTable("audit_readiness_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  snapshotDate: text("snapshot_date").notNull(),
  score: numeric("score").notNull(),
  missingBreakdownJson: jsonb("missing_breakdown_json").notNull().default({}),
  totalTrips: integer("total_trips").notNull().default(0),
  completeTrips: integer("complete_trips").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("audit_snap_idx").on(table.clinicId, table.snapshotDate),
]);

export const insertAuditReadinessSnapshotSchema = createInsertSchema(auditReadinessSnapshots).omit({ createdAt: true });
export type AuditReadinessSnapshot = typeof auditReadinessSnapshots.$inferSelect;
export type InsertAuditReadinessSnapshot = z.infer<typeof insertAuditReadinessSnapshotSchema>;

export const clinicQuarterlyReports = pgTable("clinic_quarterly_reports", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  quarterKey: text("quarter_key").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
  pdfUrl: text("pdf_url"),
}, (table) => [
  uniqueIndex("cqr_unique_idx").on(table.clinicId, table.quarterKey),
]);

export const clinicQuarterlyReportMetrics = pgTable("clinic_quarterly_report_metrics", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reportId: integer("report_id").notNull().references(() => clinicQuarterlyReports.id),
  metricKey: text("metric_key").notNull(),
  metricValue: numeric("metric_value"),
  payloadJson: jsonb("payload_json").notNull().default({}),
}, (table) => [
  uniqueIndex("cqrm_unique_idx").on(table.reportId, table.metricKey),
]);

export const importJobs = pgTable("import_jobs", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  companyId: integer("company_id").notNull().references(() => companies.id),
  cityId: integer("city_id"),
  sourceSystem: text("source_system").notNull(),
  status: text("status").notNull().default("draft"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  consentConfirmed: boolean("consent_confirmed").notNull().default(true),
  summaryJson: jsonb("summary_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertImportJobSchema = createInsertSchema(importJobs).omit({ createdAt: true, updatedAt: true });
export type ImportJob = typeof importJobs.$inferSelect;
export type InsertImportJob = z.infer<typeof insertImportJobSchema>;

export const importJobFiles = pgTable("import_job_files", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  importJobId: varchar("import_job_id", { length: 36 }).notNull().references(() => importJobs.id),
  entity: text("entity").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  storageJson: jsonb("storage_json").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertImportJobFileSchema = createInsertSchema(importJobFiles).omit({ createdAt: true });
export type ImportJobFile = typeof importJobFiles.$inferSelect;
export type InsertImportJobFile = z.infer<typeof insertImportJobFileSchema>;

export const externalIdMap = pgTable("external_id_map", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  companyId: integer("company_id").notNull(),
  entity: text("entity").notNull(),
  sourceSystem: text("source_system").notNull(),
  externalId: text("external_id").notNull(),
  ucmId: integer("ucm_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ext_id_map_unique_idx").on(table.companyId, table.entity, table.sourceSystem, table.externalId),
]);

export const insertExternalIdMapSchema = createInsertSchema(externalIdMap).omit({ createdAt: true });
export type ExternalIdMap = typeof externalIdMap.$inferSelect;
export type InsertExternalIdMap = z.infer<typeof insertExternalIdMapSchema>;

export const importJobEvents = pgTable("import_job_events", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  importJobId: varchar("import_job_id", { length: 36 }).notNull().references(() => importJobs.id),
  level: text("level").notNull(),
  message: text("message").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertImportJobEventSchema = createInsertSchema(importJobEvents).omit({ createdAt: true });
export type ImportJobEvent = typeof importJobEvents.$inferSelect;
export type InsertImportJobEvent = z.infer<typeof insertImportJobEventSchema>;

export const payrollCadenceEnum = pgEnum("payroll_cadence", ["WEEKLY", "BIWEEKLY", "MONTHLY"]);
export const payrollPayModeEnum = pgEnum("payroll_pay_mode", ["PER_TRIP", "HOURLY"]);

export const companyPayrollSettings = pgTable("company_payroll_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().unique().references(() => companies.id),
  cadence: payrollCadenceEnum("cadence").notNull(),
  paydayWeekday: integer("payday_weekday"),
  paydayDayOfMonth: integer("payday_day_of_month"),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  payMode: payrollPayModeEnum("pay_mode").notNull(),
  hourlyRateCents: integer("hourly_rate_cents"),
  perTripFlatCents: integer("per_trip_flat_cents"),
  perTripPercentBps: integer("per_trip_percent_bps"),
  requireTripFinalized: boolean("require_trip_finalized").notNull().default(true),
  requireClinicPaid: boolean("require_clinic_paid").notNull().default(false),
  minimumPayoutCents: integer("minimum_payout_cents").notNull().default(0),
  holdbackDays: integer("holdback_days").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCompanyPayrollSettingsSchema = createInsertSchema(companyPayrollSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type CompanyPayrollSettings = typeof companyPayrollSettings.$inferSelect;
export type InsertCompanyPayrollSettings = z.infer<typeof insertCompanyPayrollSettingsSchema>;

export const staffPayTypeEnum = pgEnum("staff_pay_type", ["HOURLY", "FIXED", "PER_TRIP"]);

export const staffPayConfigs = pgTable("staff_pay_configs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  driverId: integer("driver_id").references(() => drivers.id),
  payType: staffPayTypeEnum("pay_type").notNull().default("HOURLY"),
  hourlyRateCents: integer("hourly_rate_cents"),
  fixedSalaryCents: integer("fixed_salary_cents"),
  fixedPeriod: text("fixed_period").default("MONTHLY"),
  perTripFlatCents: integer("per_trip_flat_cents"),
  perTripPercentBps: integer("per_trip_percent_bps"),
  notes: text("notes").default(""),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("spc_company_driver_idx").on(table.companyId, table.driverId),
]);

export const insertStaffPayConfigSchema = createInsertSchema(staffPayConfigs).omit({ id: true, createdAt: true, updatedAt: true });
export type StaffPayConfig = typeof staffPayConfigs.$inferSelect;
export type InsertStaffPayConfig = z.infer<typeof insertStaffPayConfigSchema>;

export const driverStripeAccountStatusEnum = pgEnum("driver_stripe_account_status", ["PENDING", "RESTRICTED", "ACTIVE"]);

export const driverStripeAccounts = pgTable("driver_stripe_accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  stripeAccountId: text("stripe_account_id").notNull(),
  status: driverStripeAccountStatusEnum("status").notNull().default("PENDING"),
  payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
  detailsSubmitted: boolean("details_submitted").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("driver_stripe_company_driver_idx").on(table.companyId, table.driverId),
]);

export const insertDriverStripeAccountSchema = createInsertSchema(driverStripeAccounts).omit({ id: true, createdAt: true });
export type DriverStripeAccount = typeof driverStripeAccounts.$inferSelect;
export type InsertDriverStripeAccount = z.infer<typeof insertDriverStripeAccountSchema>;

export const earningTypeEnum = pgEnum("earning_type", ["TRIP", "HOURLY", "ADJUSTMENT"]);
export const earningStatusEnum = pgEnum("earning_status", ["EARNED", "ELIGIBLE", "IN_PAYRUN", "PAID", "VOID"]);

export const driverEarningsLedger = pgTable("driver_earnings_ledger", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  tripId: integer("trip_id").references(() => trips.id),
  earningType: earningTypeEnum("earning_type").notNull(),
  units: numeric("units"),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  earnedAt: timestamp("earned_at").notNull(),
  eligibleAt: timestamp("eligible_at").notNull(),
  status: earningStatusEnum("status").notNull().default("EARNED"),
  payrunId: integer("payrun_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ledger_trip_driver_type_idx").on(table.companyId, table.driverId, table.tripId, table.earningType),
  index("ledger_company_driver_status_idx").on(table.companyId, table.driverId, table.status),
  index("ledger_eligible_at_idx").on(table.eligibleAt),
]);

export const insertDriverEarningsLedgerSchema = createInsertSchema(driverEarningsLedger).omit({ id: true, createdAt: true });
export type DriverEarningsLedger = typeof driverEarningsLedger.$inferSelect;
export type InsertDriverEarningsLedger = z.infer<typeof insertDriverEarningsLedgerSchema>;

export const payrunStatusEnum = pgEnum("payrun_status", ["DRAFT", "APPROVED", "PROCESSING", "PAID", "FAILED", "VOID"]);

export const payrollPayruns = pgTable("payroll_payruns", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  payMode: payrollPayModeEnum("pay_mode").notNull(),
  cadence: payrollCadenceEnum("cadence").notNull(),
  scheduledPayday: text("scheduled_payday").notNull(),
  status: payrunStatusEnum("status").notNull().default("DRAFT"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  processedAt: timestamp("processed_at"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPayrollPayrunSchema = createInsertSchema(payrollPayruns).omit({ id: true, createdAt: true });
export type PayrollPayrun = typeof payrollPayruns.$inferSelect;
export type InsertPayrollPayrun = z.infer<typeof insertPayrollPayrunSchema>;

export const payrollPayrunItems = pgTable("payroll_payrun_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  payrunId: integer("payrun_id").notNull().references(() => payrollPayruns.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  amountCents: integer("amount_cents").notNull(),
  stripeTransferId: text("stripe_transfer_id"),
  paidAt: timestamp("paid_at"),
}, (table) => [
  uniqueIndex("payrun_item_driver_idx").on(table.payrunId, table.driverId),
]);

export const insertPayrollPayrunItemSchema = createInsertSchema(payrollPayrunItems).omit({ id: true });
export type PayrollPayrunItem = typeof payrollPayrunItems.$inferSelect;
export type InsertPayrollPayrunItem = z.infer<typeof insertPayrollPayrunItemSchema>;

export const onTimeBonusModeEnum = pgEnum("on_time_bonus_mode", ["PER_TRIP", "WEEKLY"]);
export const earningsAdjustmentTypeEnum = pgEnum("earnings_adjustment_type", [
  "DAILY_MIN_TOPUP", "ON_TIME_BONUS", "NO_SHOW_PENALTY", "MANUAL_ADJUSTMENT"
]);

export const driverPayRules = pgTable("driver_pay_rules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().unique().references(() => companies.id),
  dailyMinEnabled: boolean("daily_min_enabled").notNull().default(false),
  dailyMinCents: integer("daily_min_cents"),
  dailyMinAppliesDays: text("daily_min_applies_days").array(),
  onTimeBonusEnabled: boolean("on_time_bonus_enabled").notNull().default(false),
  onTimeBonusMode: onTimeBonusModeEnum("on_time_bonus_mode"),
  onTimeBonusCents: integer("on_time_bonus_cents"),
  onTimeThresholdMinutes: integer("on_time_threshold_minutes").default(5),
  onTimeRequiresConfirmedPickup: boolean("on_time_requires_confirmed_pickup").notNull().default(true),
  noShowPenaltyEnabled: boolean("no_show_penalty_enabled").notNull().default(false),
  noShowPenaltyCents: integer("no_show_penalty_cents"),
  noShowPenaltyReasonCodes: text("no_show_penalty_reason_codes").array(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDriverPayRulesSchema = createInsertSchema(driverPayRules).omit({ id: true, createdAt: true, updatedAt: true });
export type DriverPayRules = typeof driverPayRules.$inferSelect;
export type InsertDriverPayRules = z.infer<typeof insertDriverPayRulesSchema>;

export const driverEarningsAdjustments = pgTable("driver_earnings_adjustments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  relatedTripId: integer("related_trip_id").references(() => trips.id),
  periodDate: text("period_date"),
  weekStart: text("week_start"),
  type: earningsAdjustmentTypeEnum("type").notNull(),
  amountCents: integer("amount_cents").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("dea_company_driver_created_idx").on(table.companyId, table.driverId, table.createdAt),
  index("dea_company_driver_week_idx").on(table.companyId, table.driverId, table.weekStart),
  index("dea_idempotency_idx").on(table.idempotencyKey),
]);

export const insertDriverEarningsAdjustmentSchema = createInsertSchema(driverEarningsAdjustments).omit({ id: true, createdAt: true });
export type DriverEarningsAdjustment = typeof driverEarningsAdjustments.$inferSelect;
export type InsertDriverEarningsAdjustment = z.infer<typeof insertDriverEarningsAdjustmentSchema>;

export const timeEntryStatusEnum = pgEnum("time_entry_status", ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "PAID"]);
export const timeEntrySourceEnum = pgEnum("time_entry_source", ["MANUAL", "CSV", "SHIFT"]);
export const timeImportStatusEnum = pgEnum("time_import_status", ["DRAFT", "PROCESSED", "FAILED"]);
export const tpPayrollRunStatusEnum = pgEnum("tp_payroll_run_status", ["DRAFT", "FINALIZED", "PAID"]);
export const tpPayrollItemStatusEnum = pgEnum("tp_payroll_item_status", ["DRAFT", "PAID"]);

export const timeEntries = pgTable("time_entries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  workDate: text("work_date").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  breakMinutes: integer("break_minutes").notNull().default(0),
  hoursNumeric: numeric("hours_numeric").notNull().default("0"),
  payType: text("pay_type").notNull().default("HOURLY"),
  hourlyRateCents: integer("hourly_rate_cents"),
  notes: text("notes").notNull().default(""),
  sourceType: timeEntrySourceEnum("source_type").notNull(),
  sourceRef: text("source_ref").notNull().default(""),
  status: timeEntryStatusEnum("status").notNull().default("DRAFT"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("te_company_driver_date_src_ref_idx").on(table.companyId, table.driverId, table.workDate, table.sourceType, table.sourceRef),
  index("te_company_status_idx").on(table.companyId, table.status),
  index("te_driver_date_idx").on(table.driverId, table.workDate),
]);

export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({ id: true, createdAt: true, updatedAt: true });
export type TimeEntry = typeof timeEntries.$inferSelect;
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;

export const timeImportBatches = pgTable("time_import_batches", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  uploadedBy: integer("uploaded_by").notNull().references(() => users.id),
  filename: text("filename").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  createdCount: integer("created_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  status: timeImportStatusEnum("status").notNull().default("DRAFT"),
  errorSummary: text("error_summary").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("tib_company_idx").on(table.companyId),
]);

export const insertTimeImportBatchSchema = createInsertSchema(timeImportBatches).omit({ id: true, createdAt: true });
export type TimeImportBatch = typeof timeImportBatches.$inferSelect;
export type InsertTimeImportBatch = z.infer<typeof insertTimeImportBatchSchema>;

export const tpPayrollRuns = pgTable("tp_payroll_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  status: tpPayrollRunStatusEnum("status").notNull().default("DRAFT"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("tpr_company_status_idx").on(table.companyId, table.status),
]);

export const insertTpPayrollRunSchema = createInsertSchema(tpPayrollRuns).omit({ id: true, createdAt: true });
export type TpPayrollRun = typeof tpPayrollRuns.$inferSelect;
export type InsertTpPayrollRun = z.infer<typeof insertTpPayrollRunSchema>;

export const tpPayrollItems = pgTable("tp_payroll_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  runId: integer("run_id").notNull().references(() => tpPayrollRuns.id),
  companyId: integer("company_id").notNull().references(() => companies.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  totalHours: numeric("total_hours").notNull().default("0"),
  totalCents: integer("total_cents").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  status: tpPayrollItemStatusEnum("status").notNull().default("DRAFT"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tpi_run_driver_idx").on(table.runId, table.driverId),
  index("tpi_company_idx").on(table.companyId),
]);

export const supportThreads = pgTable("support_threads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  subject: text("subject").notNull().default(""),
  status: text("status").notNull().default("OPEN"),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("st_company_status_idx").on(table.companyId, table.status),
  index("st_clinic_idx").on(table.clinicId),
]);

export const insertSupportThreadSchema = createInsertSchema(supportThreads).omit({ id: true, createdAt: true });
export type SupportThread = typeof supportThreads.$inferSelect;
export type InsertSupportThread = z.infer<typeof insertSupportThreadSchema>;

export const supportMessages = pgTable("support_messages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  threadId: integer("thread_id").notNull().references(() => supportThreads.id),
  companyId: integer("company_id").notNull().references(() => companies.id),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  senderRole: text("sender_role").notNull(),
  senderUserId: integer("sender_user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("sm_thread_idx").on(table.threadId),
]);

export const insertSupportMessageSchema = createInsertSchema(supportMessages).omit({ id: true, createdAt: true });
export type SupportMessage = typeof supportMessages.$inferSelect;
export type InsertSupportMessage = z.infer<typeof insertSupportMessageSchema>;

export const recurringPricingOverrides = pgTable("recurring_pricing_overrides", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  scheduleId: integer("schedule_id").references(() => recurringSchedules.id),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("rpo_unique_idx").on(table.companyId, table.clinicId, table.patientId, table.scheduleId, table.effectiveFrom),
]);

export const insertRecurringPricingOverrideSchema = createInsertSchema(recurringPricingOverrides).omit({ id: true, createdAt: true });
export type RecurringPricingOverride = typeof recurringPricingOverrides.$inferSelect;
export type InsertRecurringPricingOverride = z.infer<typeof insertRecurringPricingOverrideSchema>;

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: jsonb("value_json").notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;

export const clinicMembershipStatusEnum = pgEnum("clinic_membership_status", [
  "inactive", "trialing", "active", "past_due", "canceled",
]);

export const clinicMembershipPlanEnum = pgEnum("clinic_membership_plan", [
  "basic", "pro", "enterprise",
]);

export const clinicMemberships = pgTable("clinic_memberships", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id).unique(),
  companyId: integer("company_id").references(() => companies.id),
  status: clinicMembershipStatusEnum("status").notNull().default("inactive"),
  planCode: clinicMembershipPlanEnum("plan_code").notNull().default("basic"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  currentPeriodEnd: timestamp("current_period_end"),
  includedDiscountPercent: numeric("included_discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  monthlyFeeCents: integer("monthly_fee_cents").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertClinicMembershipSchema = createInsertSchema(clinicMemberships).omit({ id: true, createdAt: true, updatedAt: true });
export type ClinicMembership = typeof clinicMemberships.$inferSelect;
export type InsertClinicMembership = z.infer<typeof insertClinicMembershipSchema>;

export const opsSmokeRuns = pgTable("ops_smoke_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  environment: text("environment").notNull().default("development"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  status: text("status").notNull().default("running"),
  resultsJson: jsonb("results_json"),
  triggeredBy: integer("triggered_by").references(() => users.id),
});

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active", "trialing", "past_due", "canceled", "incomplete", "unpaid", "paused", "incomplete_expired",
]);

export const stripeCustomers = pgTable("stripe_customers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id).unique(),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type StripeCustomer = typeof stripeCustomers.$inferSelect;

export const companySubscriptions = pgTable("company_subscriptions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id).unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  stripePriceId: text("stripe_price_id").notNull(),
  status: text("status").notNull().default("incomplete"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  canceledAt: timestamp("canceled_at"),
  lastEventId: text("last_event_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("cs_status_idx").on(table.status),
  index("cs_company_idx").on(table.companyId),
]);

export type CompanySubscription = typeof companySubscriptions.$inferSelect;

export const companySubscriptionSettings = pgTable("company_subscription_settings", {
  companyId: integer("company_id").primaryKey().references(() => companies.id),
  subscriptionEnabled: boolean("subscription_enabled").notNull().default(false),
  subscriptionRequiredForAccess: boolean("subscription_required_for_access").notNull().default(true),
  monthlyFeeCents: integer("monthly_fee_cents").notNull().default(120000),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CompanySubscriptionSettings = typeof companySubscriptionSettings.$inferSelect;

export const driverShiftStatusEnum = pgEnum("driver_shift_status", ["ACTIVE", "COMPLETED", "AUTO_ENDED"]);

export const driverShifts = pgTable("driver_shifts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  companyId: integer("company_id"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  status: driverShiftStatusEnum("status").notNull().default("ACTIVE"),
  totalMinutes: doublePrecision("total_minutes"),
  breakMinutes: doublePrecision("break_minutes").default(0),
  source: text("source").notNull().default("manual"),
  autoEnded: boolean("auto_ended").notNull().default(false),
  notes: text("notes"),
}, (table) => [
  index("idx_driver_shifts_driver").on(table.driverId),
  index("idx_driver_shifts_started").on(table.startedAt),
  index("idx_driver_shifts_status").on(table.status),
]);

export const insertDriverShiftSchema = createInsertSchema(driverShifts).omit({ id: true, totalMinutes: true });
export type DriverShift = typeof driverShifts.$inferSelect;
export type InsertDriverShift = z.infer<typeof insertDriverShiftSchema>;

export const noShowEvidence = pgTable("no_show_evidence", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  arrivedAt: timestamp("arrived_at"),
  waitedMinutes: doublePrecision("waited_minutes"),
  callAttempted: boolean("call_attempted").notNull().default(false),
  smsAttempted: boolean("sms_attempted").notNull().default(false),
  dispatchNotified: boolean("dispatch_notified").notNull().default(false),
  reason: text("reason"),
  notes: text("notes"),
  overrideUsed: boolean("override_used").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_no_show_evidence_trip").on(table.tripId),
]);

export const insertNoShowEvidenceSchema = createInsertSchema(noShowEvidence).omit({ id: true, createdAt: true });
export type NoShowEvidence = typeof noShowEvidence.$inferSelect;
export type InsertNoShowEvidence = z.infer<typeof insertNoShowEvidenceSchema>;

export const routeCache = pgTable("route_cache", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  keyHash: text("key_hash").notNull(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  mode: text("mode").notNull().default("driving"),
  distanceMiles: doublePrecision("distance_miles"),
  durationMinutes: doublePrecision("duration_minutes"),
  responseJson: jsonb("response_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  uniqueIndex("rc_key_hash_idx").on(table.keyHash),
  index("rc_expires_idx").on(table.expiresAt),
]);

export const driverSettings = pgTable("driver_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverId: integer("driver_id").notNull().references(() => drivers.id).unique(),
  soundsOn: boolean("sounds_on").notNull().default(true),
  hapticsOn: boolean("haptics_on").notNull().default(true),
  promptsEnabled: boolean("prompts_enabled").notNull().default(true),
  performanceVisible: boolean("performance_visible").notNull().default(true),
  preferredNavApp: text("preferred_nav_app").notNull().default("google"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("driver_settings_driver_idx").on(table.driverId),
]);

export const insertDriverSettingsSchema = createInsertSchema(driverSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type DriverSettingsType = typeof driverSettings.$inferSelect;
export type InsertDriverSettings = z.infer<typeof insertDriverSettingsSchema>;

export const driverTelemetryEvents = pgTable("driver_telemetry_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  companyId: integer("company_id").notNull().references(() => companies.id),
  tripId: integer("trip_id").references(() => trips.id),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  speedMph: doublePrecision("speed_mph"),
  heading: doublePrecision("heading"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("dte_driver_idx").on(table.driverId),
  index("dte_company_idx").on(table.companyId),
  index("dte_trip_idx").on(table.tripId),
  index("dte_type_idx").on(table.eventType),
  index("dte_created_idx").on(table.createdAt),
]);

export const insertDriverTelemetryEventSchema = createInsertSchema(driverTelemetryEvents).omit({ id: true, createdAt: true });
export type DriverTelemetryEvent = typeof driverTelemetryEvents.$inferSelect;
export type InsertDriverTelemetryEvent = z.infer<typeof insertDriverTelemetryEventSchema>;

// ── Enterprise Billing vNext ──────────────────────────────────────

export const billingAdjustmentKindEnum = pgEnum("billing_adjustment_kind", [
  "credit",
  "debit",
  "refund",
  "fee_override",
]);

export const billingAdjustments = pgTable("billing_adjustments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  invoiceId: integer("invoice_id").notNull().references(() => billingCycleInvoices.id, { onDelete: "cascade" }),
  kind: billingAdjustmentKindEnum("kind").notNull(),
  reason: text("reason").notNull(),
  amountCents: integer("amount_cents").notNull(),
  createdBy: integer("created_by").references(() => users.id),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ba_invoice_idx").on(table.invoiceId),
  index("ba_created_idx").on(table.createdAt),
]);

export const insertBillingAdjustmentSchema = createInsertSchema(billingAdjustments).omit({ id: true, createdAt: true });
export type BillingAdjustment = typeof billingAdjustments.$inferSelect;
export type InsertBillingAdjustment = z.infer<typeof insertBillingAdjustmentSchema>;

export const ledgerDirectionEnum = pgEnum("ledger_direction", ["debit", "credit"]);

export const ledgerEntries = pgTable("ledger_entries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  journalId: text("journal_id").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  clinicId: integer("clinic_id").references(() => clinics.id),
  companyId: integer("company_id").references(() => companies.id),
  account: text("account").notNull(),
  direction: ledgerDirectionEnum("direction").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("le_journal_idx").on(table.journalId),
  index("le_ref_idx").on(table.refType, table.refId),
  index("le_clinic_idx").on(table.clinicId),
  index("le_company_idx").on(table.companyId),
  index("le_account_idx").on(table.account),
  index("le_created_idx").on(table.createdAt),
]);

export const insertLedgerEntrySchema = createInsertSchema(ledgerEntries).omit({ id: true, createdAt: true });
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type InsertLedgerEntry = z.infer<typeof insertLedgerEntrySchema>;

export const payoutReconciliation = pgTable("payout_reconciliation", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  stripeAccountId: text("stripe_account_id").notNull(),
  stripeBalanceTransactionId: text("stripe_balance_transaction_id").notNull().unique(),
  stripeTransferId: text("stripe_transfer_id"),
  stripePayoutId: text("stripe_payout_id"),
  stripeChargeId: text("stripe_charge_id"),
  amountCents: integer("amount_cents").notNull(),
  feeCents: integer("fee_cents").notNull().default(0),
  netCents: integer("net_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  type: text("type"),
  status: text("status"),
  availableOn: timestamp("available_on"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("pr_company_idx").on(table.companyId),
  index("pr_stripe_acct_idx").on(table.stripeAccountId),
  index("pr_payout_idx").on(table.stripePayoutId),
  index("pr_available_idx").on(table.availableOn),
]);

export const insertPayoutReconciliationSchema = createInsertSchema(payoutReconciliation).omit({ id: true, createdAt: true });
export type PayoutReconciliation = typeof payoutReconciliation.$inferSelect;
export type InsertPayoutReconciliation = z.infer<typeof insertPayoutReconciliationSchema>;

export const billingAuditEvents = pgTable("billing_audit_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  actorUserId: integer("actor_user_id").references(() => users.id),
  actorRole: text("actor_role"),
  scopeClinicId: integer("scope_clinic_id").references(() => clinics.id),
  scopeCompanyId: integer("scope_company_id").references(() => companies.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  details: jsonb("details"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("bae_actor_idx").on(table.actorUserId),
  index("bae_entity_idx").on(table.entityType, table.entityId),
  index("bae_clinic_idx").on(table.scopeClinicId),
  index("bae_company_idx").on(table.scopeCompanyId),
  index("bae_action_idx").on(table.action),
  index("bae_created_idx").on(table.createdAt),
]);

export const insertBillingAuditEventSchema = createInsertSchema(billingAuditEvents).omit({ id: true, createdAt: true });
export type BillingAuditEvent = typeof billingAuditEvents.$inferSelect;
export type InsertBillingAuditEvent = z.infer<typeof insertBillingAuditEventSchema>;

export const feeRuleScopeEnum = pgEnum("fee_rule_scope_type", [
  "global",
  "company",
  "clinic",
  "company_clinic",
]);

export const feeRuleFeeTypeEnum = pgEnum("fee_rule_fee_type", [
  "percent",
  "fixed",
  "percent_plus_fixed",
]);

export const feeRuleCalcBaseEnum = pgEnum("fee_rule_calc_base", [
  "trip_total",
  "clinic_invoice",
  "driver_payout",
]);

export const feeRuleDirectionEnum = pgEnum("fee_rule_direction", [
  "add",
  "subtract",
]);

export const feeRuleBeneficiaryEnum = pgEnum("fee_rule_beneficiary", [
  "platform",
  "clinic",
  "driver",
  "company",
]);

export const feeRuleSettlementStageEnum = pgEnum("fee_rule_settlement_stage", [
  "invoice_generation",
  "driver_payout",
  "payment_capture",
]);

export const feeRules = pgTable("fee_rules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  scopeType: feeRuleScopeEnum("scope_type").notNull(),
  companyId: integer("company_id").references(() => companies.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  serviceLevel: text("service_level"),
  feeType: feeRuleFeeTypeEnum("fee_type").notNull(),
  percentBps: integer("percent_bps").notNull().default(0),
  fixedFeeCents: integer("fixed_fee_cents").notNull().default(0),
  minFeeCents: integer("min_fee_cents"),
  maxFeeCents: integer("max_fee_cents"),
  calculationBase: feeRuleCalcBaseEnum("calculation_base").notNull().default("clinic_invoice"),
  feeDirection: feeRuleDirectionEnum("fee_direction").notNull().default("subtract"),
  beneficiary: feeRuleBeneficiaryEnum("beneficiary").notNull().default("platform"),
  settlementStage: feeRuleSettlementStageEnum("settlement_stage").notNull().default("invoice_generation"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  priority: integer("priority").notNull().default(100),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("fr_scope_idx").on(table.scopeType),
  index("fr_company_idx").on(table.companyId),
  index("fr_clinic_idx").on(table.clinicId),
  index("fr_enabled_idx").on(table.isEnabled),
  index("fr_priority_idx").on(table.priority),
  index("fr_effective_idx").on(table.effectiveFrom, table.effectiveTo),
  index("fr_calc_base_idx").on(table.calculationBase),
  index("fr_beneficiary_idx").on(table.beneficiary),
  index("fr_settlement_idx").on(table.settlementStage),
]);

export const insertFeeRuleSchema = createInsertSchema(feeRules).omit({ id: true, createdAt: true, updatedAt: true });
export type FeeRule = typeof feeRules.$inferSelect;
export type InsertFeeRule = z.infer<typeof insertFeeRuleSchema>;

export const feeRuleAudit = pgTable("fee_rule_audit", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ruleId: integer("rule_id").references(() => feeRules.id),
  actorUserId: integer("actor_user_id").references(() => users.id),
  actorRole: text("actor_role"),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("fra_rule_idx").on(table.ruleId),
  index("fra_actor_idx").on(table.actorUserId),
  index("fra_action_idx").on(table.action),
  index("fra_created_idx").on(table.createdAt),
]);

export const insertFeeRuleAuditSchema = createInsertSchema(feeRuleAudit).omit({ id: true, createdAt: true });
export type FeeRuleAudit = typeof feeRuleAudit.$inferSelect;
export type InsertFeeRuleAudit = z.infer<typeof insertFeeRuleAuditSchema>;

export const alertAcknowledgments = pgTable("alert_acknowledgments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  alertCode: text("alert_code").notNull(),
  note: text("note"),
  acknowledgedById: integer("acknowledged_by_id").notNull().references(() => users.id),
  acknowledgedByName: text("acknowledged_by_name").notNull(),
  acknowledgedByRole: text("acknowledged_by_role").notNull(),
  originSubdomain: text("origin_subdomain"),
  expiresAt: timestamp("expires_at").notNull(),
  dismissed: boolean("dismissed").notNull().default(false),
  dismissedById: integer("dismissed_by_id").references(() => users.id),
  dismissedByName: text("dismissed_by_name"),
  dismissedAt: timestamp("dismissed_at"),
  companyId: integer("company_id").references(() => companies.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("aa_alert_code_idx").on(table.alertCode),
  index("aa_ack_by_idx").on(table.acknowledgedById),
  index("aa_expires_idx").on(table.expiresAt),
  index("aa_dismissed_idx").on(table.dismissed),
]);

export const insertAlertAckSchema = createInsertSchema(alertAcknowledgments).omit({ id: true, createdAt: true, dismissed: true, dismissedById: true, dismissedByName: true, dismissedAt: true });
export type AlertAcknowledgment = typeof alertAcknowledgments.$inferSelect;
export type InsertAlertAck = z.infer<typeof insertAlertAckSchema>;

export const autoAssignRuns = pgTable("auto_assign_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  companyId: integer("company_id").notNull().references(() => companies.id),
  cityId: integer("city_id").notNull().references(() => cities.id),
  round: integer("round").notNull().default(1),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  result: text("result").notNull().default("RUNNING"),
  selectedDriverId: integer("selected_driver_id"),
  reason: text("reason"),
  configSnapshot: jsonb("config_snapshot"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("aar_trip_idx").on(table.tripId),
  index("aar_company_idx").on(table.companyId),
  index("aar_result_idx").on(table.result),
]);

export const autoAssignRunCandidates = pgTable("auto_assign_run_candidates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  runId: integer("run_id").notNull().references(() => autoAssignRuns.id),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  distanceMeters: integer("distance_meters"),
  distanceScore: doublePrecision("distance_score").notNull().default(0),
  reliabilityScore: doublePrecision("reliability_score").notNull().default(0),
  loadScore: doublePrecision("load_score").notNull().default(0),
  fatigueScore: doublePrecision("fatigue_score").notNull().default(0),
  finalScore: doublePrecision("final_score").notNull().default(0),
  rank: integer("rank").notNull().default(0),
  eligible: boolean("eligible").notNull().default(true),
  ineligibleReason: text("ineligible_reason"),
  offeredAt: timestamp("offered_at"),
  response: text("response"),
  respondedAt: timestamp("responded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("aarc_run_idx").on(table.runId),
  index("aarc_driver_idx").on(table.driverId),
  index("aarc_rank_idx").on(table.rank),
]);

export const insertAutoAssignRunSchema = createInsertSchema(autoAssignRuns).omit({ id: true, createdAt: true });
export type AutoAssignRun = typeof autoAssignRuns.$inferSelect;
export type InsertAutoAssignRun = z.infer<typeof insertAutoAssignRunSchema>;

export const insertAutoAssignRunCandidateSchema = createInsertSchema(autoAssignRunCandidates).omit({ id: true, createdAt: true });
export type AutoAssignRunCandidate = typeof autoAssignRunCandidates.$inferSelect;
export type InsertAutoAssignRunCandidate = z.infer<typeof insertAutoAssignRunCandidateSchema>;

export const automationEvents = pgTable("automation_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  eventType: text("event_type").notNull(),
  tripId: integer("trip_id").references(() => trips.id),
  driverId: integer("driver_id").references(() => drivers.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  companyId: integer("company_id").references(() => companies.id),
  runId: integer("run_id").references(() => autoAssignRuns.id),
  payload: jsonb("payload"),
  actorUserId: integer("actor_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ae_event_type_idx").on(table.eventType),
  index("ae_trip_idx").on(table.tripId),
  index("ae_company_idx").on(table.companyId),
  index("ae_created_idx").on(table.createdAt),
]);

export const insertAutomationEventSchema = createInsertSchema(automationEvents).omit({ id: true, createdAt: true });
export type AutomationEvent = typeof automationEvents.$inferSelect;
export type InsertAutomationEvent = z.infer<typeof insertAutomationEventSchema>;

export const driverRiskScores = pgTable("driver_risk_scores", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  companyId: integer("company_id").notNull().references(() => companies.id),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  riskScore: doublePrecision("risk_score").notNull(),
  riskLevel: text("risk_level").notNull().default("low"),
  factors: jsonb("factors"),
  speedingCount: integer("speeding_count").notNull().default(0),
  hardBrakeCount: integer("hard_brake_count").notNull().default(0),
  idlingMinutes: doublePrecision("idling_minutes").notNull().default(0),
  totalMiles: doublePrecision("total_miles").notNull().default(0),
  totalTrips: integer("total_trips").notNull().default(0),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("drs_driver_idx").on(table.driverId),
  index("drs_company_idx").on(table.companyId),
  index("drs_period_idx").on(table.periodStart, table.periodEnd),
  index("drs_risk_level_idx").on(table.riskLevel),
]);

export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "trip_revenue",
  "platform_fee",
  "driver_payout",
  "clinic_charge",
  "adjustment",
  "cancellation_fee",
  "bonus",
  "penalty",
]);

export const ledgerStatusEnum = pgEnum("ledger_status", [
  "pending",
  "settled",
  "voided",
  "reversed",
]);

export const financialLedger = pgTable("financial_ledger", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  tripId: integer("trip_id").references(() => trips.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  driverId: integer("driver_id").references(() => drivers.id),
  invoiceId: integer("invoice_id").references((): AnyPgColumn => invoices.id),
  feeRuleId: integer("fee_rule_id").references(() => feeRules.id),
  entryType: ledgerEntryTypeEnum("entry_type").notNull(),
  direction: ledgerDirectionEnum("direction").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  counterpartyType: text("counterparty_type"),
  counterpartyId: integer("counterparty_id"),
  status: ledgerStatusEnum("status").notNull().default("pending"),
  settlementStage: text("settlement_stage"),
  description: text("description"),
  metadata: jsonb("metadata"),
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  settledAt: timestamp("settled_at"),
  voidedAt: timestamp("voided_at"),
  voidedBy: integer("voided_by").references(() => users.id),
  voidReason: text("void_reason"),
}, (table) => [
  index("fl_company_idx").on(table.companyId),
  index("fl_trip_idx").on(table.tripId),
  index("fl_clinic_idx").on(table.clinicId),
  index("fl_driver_idx").on(table.driverId),
  index("fl_invoice_idx").on(table.invoiceId),
  index("fl_entry_type_idx").on(table.entryType),
  index("fl_status_idx").on(table.status),
  index("fl_created_idx").on(table.createdAt),
  index("fl_idempotency_idx").on(table.idempotencyKey),
]);

export const insertFinancialLedgerSchema = createInsertSchema(financialLedger).omit({ id: true, createdAt: true });
export type FinancialLedgerEntry = typeof financialLedger.$inferSelect;
export type InsertFinancialLedgerEntry = z.infer<typeof insertFinancialLedgerSchema>;

export const tripRequestStatusEnum = pgEnum("trip_request_status", [
  "PENDING",
  "NEEDS_INFO",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
]);

export const tripRequests = pgTable("trip_requests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  publicId: varchar("public_id", { length: 20 }).notNull().unique(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  cityId: integer("city_id").notNull().references(() => cities.id),
  patientId: integer("patient_id").references(() => patients.id),
  requestedByUserId: integer("requested_by_user_id").references(() => users.id),
  status: tripRequestStatusEnum("status").notNull().default("PENDING"),
  pickupAddress: text("pickup_address").notNull(),
  pickupLat: doublePrecision("pickup_lat"),
  pickupLng: doublePrecision("pickup_lng"),
  dropoffAddress: text("dropoff_address").notNull(),
  dropoffLat: doublePrecision("dropoff_lat"),
  dropoffLng: doublePrecision("dropoff_lng"),
  scheduledDate: text("scheduled_date").notNull(),
  scheduledTime: text("scheduled_time").notNull(),
  serviceLevel: text("service_level").notNull().default("ambulatory"),
  isRoundTrip: boolean("is_round_trip").notNull().default(false),
  recurrenceRule: text("recurrence_rule"),
  passengerCount: integer("passenger_count").notNull().default(1),
  notes: text("notes"),
  dispatchNotes: text("dispatch_notes"),
  approvedTripId: integer("approved_trip_id").references(() => trips.id),
  rejectedReason: text("rejected_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("tr_company_idx").on(table.companyId),
  index("tr_clinic_idx").on(table.clinicId),
  index("tr_status_idx").on(table.status),
  index("tr_created_idx").on(table.createdAt),
  index("tr_patient_idx").on(table.patientId),
]);

export const insertTripRequestSchema = createInsertSchema(tripRequests).omit({ id: true, createdAt: true, updatedAt: true, approvedTripId: true });
export type TripRequest = typeof tripRequests.$inferSelect;
export type InsertTripRequest = z.infer<typeof insertTripRequestSchema>;

export const chatThreads = pgTable("chat_threads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  scopeType: text("scope_type").notNull(),
  scopeId: integer("scope_id").notNull(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  lastMessageAt: timestamp("last_message_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ct_scope_unique").on(table.scopeType, table.scopeId),
  index("ct_company_idx").on(table.companyId),
  index("ct_clinic_idx").on(table.clinicId),
]);

export const chatMessages = pgTable("chat_messages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  threadId: integer("thread_id").notNull().references(() => chatThreads.id),
  senderUserId: integer("sender_user_id").references(() => users.id),
  senderRole: text("sender_role").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("cm_thread_idx").on(table.threadId),
  index("cm_created_idx").on(table.createdAt),
]);

export const insertChatThreadSchema = createInsertSchema(chatThreads).omit({ id: true, createdAt: true });
export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });
export type ChatThread = typeof chatThreads.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatThread = z.infer<typeof insertChatThreadSchema>;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
