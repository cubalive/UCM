import { getDb } from "../db/index.js";
import { driverEarnings, trips, users } from "../db/schema.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { transferToDriver } from "./driverPayoutService.js";
import { recordAudit } from "./auditService.js";
import logger from "../lib/logger.js";

export async function recordTripEarning(
  driverId: string,
  tenantId: string,
  tripId: string,
  amount: number,
  description?: string
) {
  const db = getDb();

  const [earning] = await db.insert(driverEarnings).values({
    driverId,
    tenantId,
    tripId,
    type: "trip_earning",
    amount: amount.toFixed(2),
    description: description || "Trip completed",
  }).returning();

  await recordAudit({
    tenantId,
    userId: driverId,
    action: "driver.earning_recorded",
    resource: "driver_earnings",
    resourceId: earning.id,
    details: { tripId, amount },
  });

  logger.info("Driver earning recorded", { driverId, tripId, amount });
  return earning;
}

export async function getDriverBalance(driverId: string, tenantId: string) {
  const db = getDb();

  const [result] = await db
    .select({
      totalEarnings: sql<number>`coalesce(sum(case when type != 'payout' then cast(amount as numeric) else 0 end), 0)`,
      totalPayouts: sql<number>`coalesce(sum(case when type = 'payout' then abs(cast(amount as numeric)) else 0 end), 0)`,
    })
    .from(driverEarnings)
    .where(and(eq(driverEarnings.driverId, driverId), eq(driverEarnings.tenantId, tenantId)));

  const totalEarnings = Number(result.totalEarnings);
  const totalPayouts = Number(result.totalPayouts);
  const balance = totalEarnings - totalPayouts;

  return {
    balance: Math.round(balance * 100) / 100,
    totalEarnings: Math.round(totalEarnings * 100) / 100,
    totalPayouts: Math.round(totalPayouts * 100) / 100,
  };
}

export async function getDriverEarningsHistory(driverId: string, tenantId: string, limit: number = 50) {
  const db = getDb();

  const earnings = await db
    .select()
    .from(driverEarnings)
    .where(and(eq(driverEarnings.driverId, driverId), eq(driverEarnings.tenantId, tenantId)))
    .orderBy(desc(driverEarnings.createdAt))
    .limit(limit);

  return earnings;
}

export async function requestPayout(driverId: string, tenantId: string) {
  const db = getDb();

  // Check driver has Stripe account
  const [driver] = await db.select().from(users).where(and(eq(users.id, driverId), eq(users.tenantId, tenantId)));
  if (!driver) throw new Error("Driver not found");
  if (!driver.stripeAccountId) throw new Error("Driver has no Stripe account — complete onboarding first");

  // Check balance
  const { balance } = await getDriverBalance(driverId, tenantId);
  if (balance < 5) throw new Error("Minimum payout is $5.00");

  const amountCents = Math.round(balance * 100);

  // Create Stripe transfer
  const transferId = await transferToDriver(
    driver.stripeAccountId,
    amountCents,
    "usd",
    { driverId, tenantId }
  );

  // Record payout in ledger (negative amount)
  const [payout] = await db.insert(driverEarnings).values({
    driverId,
    tenantId,
    type: "payout",
    amount: (-balance).toFixed(2),
    stripeTransferId: transferId,
    description: `Payout of $${balance.toFixed(2)}`,
  }).returning();

  await recordAudit({
    tenantId,
    userId: driverId,
    action: "driver.payout_requested",
    resource: "driver_earnings",
    resourceId: payout.id,
    details: { amount: balance, transferId },
  });

  logger.info("Driver payout processed", { driverId, amount: balance, transferId });

  return { payoutId: payout.id, amount: balance, transferId };
}
