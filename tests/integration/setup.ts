import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../src/db/schema.js";
import { sql } from "drizzle-orm";

const { Pool } = pg;

let testPool: pg.Pool | null = null;

export function getTestPool(): pg.Pool {
  if (!testPool) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error("DATABASE_URL required for integration tests");
    }
    testPool = new Pool({ connectionString: dbUrl, max: 5 });
  }
  return testPool;
}

export function getTestDb() {
  return drizzle(getTestPool(), { schema });
}

export async function cleanTestData() {
  const db = getTestDb();
  // Delete in dependency order
  await db.execute(sql`DELETE FROM audit_log`);
  await db.execute(sql`DELETE FROM ledger_entries`);
  await db.execute(sql`DELETE FROM invoice_line_items`);
  await db.execute(sql`DELETE FROM billing_cycles`);
  await db.execute(sql`DELETE FROM webhook_events`);
  await db.execute(sql`DELETE FROM invoices`);
  await db.execute(sql`DELETE FROM trips`);
  await db.execute(sql`DELETE FROM fee_rules`);
  await db.execute(sql`DELETE FROM patients`);
  await db.execute(sql`DELETE FROM users`);
  await db.execute(sql`DELETE FROM tenants`);
}

export async function seedTestTenant() {
  const db = getTestDb();
  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name: "Test Clinic",
      slug: "test-clinic",
      subscriptionTier: "professional",
      subscriptionStatus: "active",
    })
    .returning();

  const [user] = await db
    .insert(schema.users)
    .values({
      tenantId: tenant.id,
      email: "admin@test.com",
      passwordHash: "hashed",
      role: "admin",
      firstName: "Test",
      lastName: "Admin",
    })
    .returning();

  const [patient] = await db
    .insert(schema.patients)
    .values({
      tenantId: tenant.id,
      firstName: "Jane",
      lastName: "Doe",
      phone: "555-0100",
      email: "jane@test.com",
    })
    .returning();

  return { tenant, user, patient };
}

export async function seedFeeRules(tenantId: string) {
  const db = getTestDb();
  const rules = await db
    .insert(schema.feeRules)
    .values([
      {
        tenantId,
        name: "Base Fare",
        type: "flat",
        amount: "5.00",
        priority: 0,
        active: true,
      },
      {
        tenantId,
        name: "Per Mile",
        type: "per_mile",
        amount: "2.50",
        priority: 1,
        active: true,
      },
      {
        tenantId,
        name: "Weekend Surcharge",
        type: "surcharge",
        amount: "10.00",
        priority: 2,
        active: true,
        conditions: { dayOfWeek: [0, 6] },
      },
      {
        tenantId,
        name: "Service Fee",
        type: "percentage",
        amount: "5.00",
        priority: 10,
        active: true,
      },
    ])
    .returning();

  return rules;
}

export async function seedCompletedTrips(tenantId: string, patientId: string, driverId: string, count: number = 3) {
  const db = getTestDb();
  const now = new Date();
  const trips = [];

  for (let i = 0; i < count; i++) {
    const scheduledAt = new Date(now.getTime() - (i + 1) * 24 * 60 * 60 * 1000);
    // Ensure weekday for predictable fee calculation
    while (scheduledAt.getDay() === 0 || scheduledAt.getDay() === 6) {
      scheduledAt.setDate(scheduledAt.getDate() - 1);
    }

    const [trip] = await db
      .insert(schema.trips)
      .values({
        tenantId,
        patientId,
        driverId,
        status: "completed",
        pickupAddress: `${100 + i} Main St`,
        dropoffAddress: `${200 + i} Oak Ave`,
        scheduledAt,
        completedAt: new Date(scheduledAt.getTime() + 60 * 60 * 1000),
        mileage: (10 + i * 5).toFixed(2),
      })
      .returning();

    trips.push(trip);
  }

  return trips;
}
