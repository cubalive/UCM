import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  decimal,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

// Enums
export const userRoleEnum = pgEnum("user_role", ["admin", "dispatcher", "driver", "clinic", "billing"]);
export const tripStatusEnum = pgEnum("trip_status", ["requested", "assigned", "en_route", "arrived", "in_progress", "completed", "cancelled"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "pending", "sent", "paid", "overdue", "void", "partially_paid"]);
export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", ["charge", "payment", "adjustment", "refund", "writeoff"]);
export const webhookStatusEnum = pgEnum("webhook_status", ["received", "processing", "processed", "failed", "dead_letter"]);
export const subscriptionTierEnum = pgEnum("subscription_tier", ["starter", "professional", "enterprise"]);

// Tenants
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeAccountId: text("stripe_account_id"),
  stripeOnboardingComplete: boolean("stripe_onboarding_complete").default(false),
  subscriptionTier: subscriptionTierEnum("subscription_tier").default("starter"),
  subscriptionStatus: text("subscription_status").default("active"),
  subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
  timezone: text("timezone").default("America/New_York").notNull(),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Users
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("dispatcher"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    active: boolean("active").default(true),
    mustResetPassword: boolean("must_reset_password").default(false),
    stripeAccountId: text("stripe_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    emailTenantIdx: uniqueIndex("users_email_tenant_idx").on(table.email, table.tenantId),
    tenantIdx: index("users_tenant_idx").on(table.tenantId),
  })
);

// Patients / Members
export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    dateOfBirth: text("date_of_birth"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    insuranceId: text("insurance_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index("patients_tenant_idx").on(table.tenantId),
  })
);

// Trips
export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    patientId: uuid("patient_id").references(() => patients.id).notNull(),
    driverId: uuid("driver_id").references(() => users.id),
    status: tripStatusEnum("status").default("requested").notNull(),
    pickupAddress: text("pickup_address").notNull(),
    dropoffAddress: text("dropoff_address").notNull(),
    pickupLat: decimal("pickup_lat", { precision: 10, scale: 7 }),
    pickupLng: decimal("pickup_lng", { precision: 10, scale: 7 }),
    dropoffLat: decimal("dropoff_lat", { precision: 10, scale: 7 }),
    dropoffLng: decimal("dropoff_lng", { precision: 10, scale: 7 }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    timezone: text("timezone").default("America/New_York").notNull(),
    mileage: decimal("mileage", { precision: 10, scale: 2 }),
    estimatedMiles: decimal("estimated_miles", { precision: 10, scale: 2 }),
    estimatedMinutes: integer("estimated_minutes"),
    notes: text("notes"),
    metadata: jsonb("metadata").default({}),
    // Route intelligence (cached from Google Directions)
    routePolyline: text("route_polyline"),
    routeDistanceMiles: decimal("route_distance_miles", { precision: 10, scale: 2 }),
    routeDurationMinutes: integer("route_duration_minutes"),
    routeFetchedAt: timestamp("route_fetched_at", { withTimezone: true }),
    // ETA tracking
    etaMinutes: integer("eta_minutes"),
    etaUpdatedAt: timestamp("eta_updated_at", { withTimezone: true }),
    // Vehicle preference
    vehicleType: text("vehicle_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index("trips_tenant_idx").on(table.tenantId),
    driverIdx: index("trips_driver_idx").on(table.driverId),
    statusIdx: index("trips_status_idx").on(table.status),
    scheduledIdx: index("trips_scheduled_idx").on(table.scheduledAt),
    tenantStatusScheduledIdx: index("trips_tenant_status_scheduled_idx").on(table.tenantId, table.status, table.scheduledAt),
    driverStatusIdx: index("trips_driver_status_idx").on(table.driverId, table.status),
  })
);

// Fee Rules
export const feeRules = pgTable(
  "fee_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").notNull(), // 'per_mile', 'flat', 'per_trip', 'surcharge', 'percentage'
    amount: decimal("amount", { precision: 10, scale: 4 }).notNull(),
    currency: text("currency").default("usd").notNull(),
    conditions: jsonb("conditions").default({}),
    priority: integer("priority").default(0),
    active: boolean("active").default(true),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index("fee_rules_tenant_idx").on(table.tenantId),
    activeIdx: index("fee_rules_active_idx").on(table.active),
  })
);

// Invoices
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    patientId: uuid("patient_id").references(() => patients.id),
    status: invoiceStatusEnum("status").default("draft").notNull(),
    subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
    tax: decimal("tax", { precision: 10, scale: 2 }).default("0"),
    total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0"),
    amountPaid: decimal("amount_paid", { precision: 10, scale: 2 }).default("0"),
    currency: text("currency").default("usd").notNull(),
    stripeInvoiceId: text("stripe_invoice_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    billingPeriodStart: timestamp("billing_period_start", { withTimezone: true }),
    billingPeriodEnd: timestamp("billing_period_end", { withTimezone: true }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index("invoices_tenant_idx").on(table.tenantId),
    numberTenantIdx: uniqueIndex("invoices_number_tenant_idx").on(table.invoiceNumber, table.tenantId),
    statusIdx: index("invoices_status_idx").on(table.status),
    stripeIdx: index("invoices_stripe_idx").on(table.stripeInvoiceId),
  })
);

// Invoice Line Items
export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }),
    feeRuleId: uuid("fee_rule_id").references(() => feeRules.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 2 }).default("1"),
    unitPrice: decimal("unit_price", { precision: 10, scale: 4 }).notNull(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    invoiceIdx: index("line_items_invoice_idx").on(table.invoiceId),
  })
);

// Ledger Entries
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    type: ledgerEntryTypeEnum("type").notNull(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").default("usd").notNull(),
    description: text("description"),
    referenceId: text("reference_id"),
    referenceType: text("reference_type"),
    idempotencyKey: text("idempotency_key"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index("ledger_tenant_idx").on(table.tenantId),
    invoiceIdx: index("ledger_invoice_idx").on(table.invoiceId),
    idempotencyIdx: uniqueIndex("ledger_idempotency_idx").on(table.idempotencyKey),
  })
);

// Webhook Events
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stripeEventId: text("stripe_event_id").notNull(),
    eventType: text("event_type").notNull(),
    status: webhookStatusEnum("status").default("received").notNull(),
    payload: jsonb("payload").notNull(),
    error: text("error"),
    attempts: integer("attempts").default(0),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    stripeEventIdx: uniqueIndex("webhook_stripe_event_idx").on(table.stripeEventId),
    statusIdx: index("webhook_status_idx").on(table.status),
    typeIdx: index("webhook_type_idx").on(table.eventType),
  })
);

// Audit Log
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    resourceId: text("resource_id"),
    details: jsonb("details").default({}),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index("audit_tenant_idx").on(table.tenantId),
    actionIdx: index("audit_action_idx").on(table.action),
    createdIdx: index("audit_created_idx").on(table.createdAt),
  })
);

// Billing Cycles
export const billingCycles = pgTable(
  "billing_cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    status: text("status").default("open").notNull(), // open, closed, invoiced
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => ({
    tenantIdx: index("billing_cycles_tenant_idx").on(table.tenantId),
    statusIdx: index("billing_cycles_status_idx").on(table.status),
  })
);

// Driver Availability Enum
export const driverAvailabilityEnum = pgEnum("driver_availability", ["available", "busy", "offline", "break"]);

// Driver Status (current state + location)
export const driverStatus = pgTable(
  "driver_status",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id").references(() => users.id).notNull().unique(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    availability: driverAvailabilityEnum("availability").default("offline").notNull(),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    heading: integer("heading"),
    speed: integer("speed"),
    lastLocationAt: timestamp("last_location_at", { withTimezone: true }),
    lastManualOverride: timestamp("last_manual_override", { withTimezone: true }),
    // Performance tracking for dispatch intelligence
    avgCompletionMinutes: decimal("avg_completion_minutes", { precision: 10, scale: 1 }),
    completedTrips30d: integer("completed_trips_30d").default(0),
    onTimeRate: decimal("on_time_rate", { precision: 5, scale: 2 }),
    declineRate7d: decimal("decline_rate_7d", { precision: 5, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    driverIdx: index("driver_status_driver_idx").on(table.driverId),
    tenantIdx: index("driver_status_tenant_idx").on(table.tenantId),
    availabilityIdx: index("driver_status_availability_idx").on(table.availability),
  })
);

// Driver Earnings Ledger
export const driverEarnings = pgTable(
  "driver_earnings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id").references(() => users.id).notNull(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    tripId: uuid("trip_id").references(() => trips.id),
    type: text("type").notNull(), // 'trip_earning', 'bonus', 'adjustment', 'payout'
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").default("usd").notNull(),
    description: text("description"),
    stripeTransferId: text("stripe_transfer_id"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    driverIdx: index("driver_earnings_driver_idx").on(table.driverId),
    tenantIdx: index("driver_earnings_tenant_idx").on(table.tenantId),
    tripIdx: index("driver_earnings_trip_idx").on(table.tripId),
    typeIdx: index("driver_earnings_type_idx").on(table.type),
  })
);

// Driver Location History
export const driverLocations = pgTable(
  "driver_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id").references(() => users.id).notNull(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
    longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
    heading: integer("heading"),
    speed: integer("speed"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    driverIdx: index("driver_locations_driver_idx").on(table.driverId),
    recordedIdx: index("driver_locations_recorded_idx").on(table.recordedAt),
    driverRecordedIdx: index("driver_locations_driver_recorded_idx").on(table.driverId, table.recordedAt),
  })
);
