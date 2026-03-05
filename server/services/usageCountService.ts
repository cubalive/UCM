/**
 * Usage count queries for subscription quota enforcement.
 *
 * Counts active (non-deleted) resources per company.
 * Results are cached via subscriptionEnforcement.getUsageCounts().
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import type { UsageCounts } from "./subscriptionEnforcement";

/** Active trip statuses (not terminal). */
const ACTIVE_TRIP_STATUSES = [
  "SCHEDULED",
  "ASSIGNED",
  "EN_ROUTE_TO_PICKUP",
  "ARRIVED_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_TO_DROPOFF",
  "ARRIVED_DROPOFF",
  "IN_PROGRESS",
];

/**
 * Query actual usage counts from the database.
 * Excludes soft-deleted records (deleted_at IS NULL).
 */
export async function queryCompanyUsageCounts(companyId: number): Promise<UsageCounts> {
  const [result] = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM drivers WHERE company_id = ${companyId} AND deleted_at IS NULL) AS drivers_count,
      (SELECT COUNT(*)::int FROM trips WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = ANY(${ACTIVE_TRIP_STATUSES})) AS active_trips_count,
      (SELECT COUNT(*)::int FROM clinics WHERE company_id = ${companyId} AND deleted_at IS NULL) AS clinics_count
  `);

  const row = result as any;
  return {
    driversCount: row?.drivers_count ?? 0,
    activeTripsCount: row?.active_trips_count ?? 0,
    clinicsCount: row?.clinics_count ?? 0,
  };
}
