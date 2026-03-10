import { db } from "../db";
import { trips, drivers } from "@shared/schema";
import { sql } from "drizzle-orm";

export interface SLAMetrics {
  pickupOnTimePercent: number;
  avgResponseTimeMinutes: number | null;
  tripCompletionRate: number;
  avgEtaAccuracyMinutes: number | null;
  driverUtilizationRate: number;
  totalTrips: number;
  completedTrips: number;
  cancelledTrips: number;
  noShowTrips: number;
}

export interface SLADashboard {
  today: SLAMetrics;
  thisWeek: SLAMetrics;
  thisMonth: SLAMetrics;
}

interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

/**
 * Calculate SLA metrics for a given company/city within a date range.
 *
 * Pickup on-time: trip picked up (pickedUpAt) within 15 minutes of scheduled pickupTime.
 * Response time: time from trip creation (createdAt) to driver assignment (assignedAt).
 * Completion rate: COMPLETED / (total - SCHEDULED - ASSIGNED that are still pending).
 * ETA accuracy: difference between lastEtaMinutes and actual duration.
 * Driver utilization: drivers with at least one completed trip / total active drivers.
 */
export async function calculateSLAMetrics(
  companyId: number,
  cityId?: number,
  dateRange?: DateRange,
): Promise<SLAMetrics> {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const fromDate = dateRange?.from ?? todayStr;
  const toDate = dateRange?.to ?? todayStr;

  const cityFilter = cityId ? sql`AND t.city_id = ${cityId}` : sql``;

  // Core trip metrics
  const metricsResult = await db.execute(sql`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE t.status = 'COMPLETED') AS completed,
      COUNT(*) FILTER (WHERE t.status = 'CANCELLED') AS cancelled,
      COUNT(*) FILTER (WHERE t.status = 'NO_SHOW') AS no_show,
      COUNT(*) FILTER (
        WHERE t.status = 'COMPLETED'
        AND t.picked_up_at IS NOT NULL
        AND t.pickup_time IS NOT NULL
        AND t.scheduled_date IS NOT NULL
      ) AS pickup_eligible,
      COUNT(*) FILTER (
        WHERE t.status = 'COMPLETED'
        AND t.picked_up_at IS NOT NULL
        AND t.pickup_time IS NOT NULL
        AND t.scheduled_date IS NOT NULL
        AND t.picked_up_at <= (t.scheduled_date || ' ' || t.pickup_time)::timestamp + INTERVAL '15 minutes'
      ) AS pickup_on_time,
      AVG(
        CASE
          WHEN t.assigned_at IS NOT NULL AND t.created_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (t.assigned_at - t.created_at)) / 60.0
        END
      ) AS avg_response_minutes,
      AVG(
        CASE
          WHEN t.status = 'COMPLETED'
          AND t.last_eta_minutes IS NOT NULL
          AND t.duration_minutes IS NOT NULL
          THEN ABS(t.last_eta_minutes - t.duration_minutes)
        END
      ) AS avg_eta_accuracy_minutes
    FROM ${trips} t
    WHERE t.company_id = ${companyId}
    AND t.deleted_at IS NULL
    AND t.scheduled_date >= ${fromDate}
    AND t.scheduled_date <= ${toDate}
    ${cityFilter}
  `);

  const row = (metricsResult as any).rows?.[0] || {};
  const total = Number(row.total) || 0;
  const completed = Number(row.completed) || 0;
  const cancelled = Number(row.cancelled) || 0;
  const noShow = Number(row.no_show) || 0;
  const pickupEligible = Number(row.pickup_eligible) || 0;
  const pickupOnTime = Number(row.pickup_on_time) || 0;
  const avgResponseMinutes = row.avg_response_minutes != null
    ? Math.round(Number(row.avg_response_minutes) * 10) / 10
    : null;
  const avgEtaAccuracyMinutes = row.avg_eta_accuracy_minutes != null
    ? Math.round(Number(row.avg_eta_accuracy_minutes) * 10) / 10
    : null;

  // Terminal trips = completed + cancelled + no_show
  const terminalTrips = completed + cancelled + noShow;
  const completionRate = terminalTrips > 0
    ? Math.round((completed / terminalTrips) * 1000) / 10
    : 0;

  const pickupOnTimePercent = pickupEligible > 0
    ? Math.round((pickupOnTime / pickupEligible) * 1000) / 10
    : 0;

  // Driver utilization: active drivers in this company/city with at least one completed trip
  const driverFilter = cityId ? sql`AND d.city_id = ${cityId}` : sql``;
  const utilizationResult = await db.execute(sql`
    SELECT
      COUNT(DISTINCT d.id) AS total_active,
      COUNT(DISTINCT CASE
        WHEN EXISTS (
          SELECT 1 FROM ${trips} t2
          WHERE t2.driver_id = d.id
          AND t2.status = 'COMPLETED'
          AND t2.scheduled_date >= ${fromDate}
          AND t2.scheduled_date <= ${toDate}
          AND t2.deleted_at IS NULL
        ) THEN d.id
      END) AS utilized
    FROM ${drivers} d
    WHERE d.company_id = ${companyId}
    AND d.status = 'ACTIVE'
    AND d.deleted_at IS NULL
    ${driverFilter}
  `);

  const dRow = (utilizationResult as any).rows?.[0] || {};
  const totalActive = Number(dRow.total_active) || 0;
  const utilized = Number(dRow.utilized) || 0;
  const driverUtilizationRate = totalActive > 0
    ? Math.round((utilized / totalActive) * 1000) / 10
    : 0;

  return {
    pickupOnTimePercent,
    avgResponseTimeMinutes: avgResponseMinutes,
    tripCompletionRate: completionRate,
    avgEtaAccuracyMinutes: avgEtaAccuracyMinutes,
    driverUtilizationRate,
    totalTrips: total,
    completedTrips: completed,
    cancelledTrips: cancelled,
    noShowTrips: noShow,
  };
}

/**
 * Returns SLA dashboard with today, this week, and this month metrics.
 */
export async function getSLADashboard(
  companyId: number,
  cityId?: number,
): Promise<SLADashboard> {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  // Start of week (Monday)
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - mondayOffset);
  const weekStartStr = weekStart.toISOString().split("T")[0];

  // Start of month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().split("T")[0];

  const [today, thisWeek, thisMonth] = await Promise.all([
    calculateSLAMetrics(companyId, cityId, { from: todayStr, to: todayStr }),
    calculateSLAMetrics(companyId, cityId, { from: weekStartStr, to: todayStr }),
    calculateSLAMetrics(companyId, cityId, { from: monthStartStr, to: todayStr }),
  ]);

  return { today, thisWeek, thisMonth };
}
