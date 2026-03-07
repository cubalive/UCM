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
  subscriptionExpiresAt: timestamp("subscription_expires_at"),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
    stripeAccountId: text("stripe_account_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
    scheduledAt: timestamp("scheduled_at").notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    mileage: decimal("mileage", { precision: 10, scale: 2 }),
    notes: text("notes"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index("trips_tenant_idx").on(table.tenantId),
    driverIdx: index("trips_driver_idx").on(table.driverId),
    statusIdx: index("trips_status_idx").on(table.status),
    scheduledIdx: index("trips_scheduled_idx").on(table.scheduledAt),
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
    effectiveFrom: timestamp("effective_from"),
    effectiveTo: timestamp("effective_to"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
    billingPeriodStart: timestamp("billing_period_start"),
    billingPeriodEnd: timestamp("billing_period_end"),
    dueDate: timestamp("due_date"),
    paidAt: timestamp("paid_at"),
    sentAt: timestamp("sent_at"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
    invoiceId: uuid("invoice_id").references(() => invoices.id).notNull(),
    tripId: uuid("trip_id").references(() => trips.id),
    feeRuleId: uuid("fee_rule_id").references(() => feeRules.id),
    description: text("description").notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 2 }).default("1"),
    unitPrice: decimal("unit_price", { precision: 10, scale: 4 }).notNull(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
    processedAt: timestamp("processed_at"),
    lastAttemptAt: timestamp("last_attempt_at"),
    deadLetteredAt: timestamp("dead_lettered_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    status: text("status").default("open").notNull(), // open, closed, invoiced
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
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
    lastLocationAt: timestamp("last_location_at"),
    lastManualOverride: timestamp("last_manual_override"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  },
  (table) => ({
    driverIdx: index("driver_locations_driver_idx").on(table.driverId),
    recordedIdx: index("driver_locations_recorded_idx").on(table.recordedAt),
  })
);
