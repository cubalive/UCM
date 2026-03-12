import { describe, it, expect } from "vitest";

// =========================================================
// SLA Monitoring Validation Tests — Pure Logic (no DB)
// =========================================================
// Validates SLA metric calculations, threshold logic, and
// alert generation for NEMT service level agreements.

// ─── SLA Metric Calculation Logic ────────────────────────────────────────────

interface SLAMetrics {
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

function calculatePickupOnTimePercent(onTimeCount: number, eligibleCount: number): number {
  if (eligibleCount === 0) return 0;
  return Math.round((onTimeCount / eligibleCount) * 1000) / 10;
}

function calculateCompletionRate(completed: number, cancelled: number, noShow: number): number {
  const terminal = completed + cancelled + noShow;
  if (terminal === 0) return 0;
  return Math.round((completed / terminal) * 1000) / 10;
}

function calculateDriverUtilization(utilizedDrivers: number, activeDrivers: number): number {
  if (activeDrivers === 0) return 0;
  return Math.round((utilizedDrivers / activeDrivers) * 1000) / 10;
}

function isPickupOnTime(scheduledTime: string, actualPickupTime: string, thresholdMinutes: number = 15): boolean {
  const scheduled = new Date(scheduledTime).getTime();
  const actual = new Date(actualPickupTime).getTime();
  const diffMinutes = (actual - scheduled) / 60000;
  return diffMinutes <= thresholdMinutes;
}

function calculateResponseTime(createdAt: string, assignedAt: string): number {
  const created = new Date(createdAt).getTime();
  const assigned = new Date(assignedAt).getTime();
  return Math.round((assigned - created) / 60000 * 10) / 10;
}

// ─── SLA Threshold Definitions ───────────────────────────────────────────────

interface SLAThreshold {
  metric: string;
  target: number;
  warning: number;
  critical: number;
  direction: "above" | "below"; // "above" = higher is better, "below" = lower is better
}

const DEFAULT_SLA_THRESHOLDS: SLAThreshold[] = [
  { metric: "pickupOnTimePercent", target: 95, warning: 90, critical: 85, direction: "above" },
  { metric: "tripCompletionRate", target: 95, warning: 90, critical: 80, direction: "above" },
  { metric: "avgResponseTimeMinutes", target: 10, warning: 20, critical: 30, direction: "below" },
  { metric: "avgEtaAccuracyMinutes", target: 5, warning: 10, critical: 15, direction: "below" },
  { metric: "driverUtilizationRate", target: 70, warning: 50, critical: 30, direction: "above" },
];

type AlertLevel = "ok" | "warning" | "critical";

function evaluateThreshold(value: number | null, threshold: SLAThreshold): AlertLevel {
  if (value === null) return "ok"; // no data = no alert

  if (threshold.direction === "above") {
    if (value >= threshold.target) return "ok";
    if (value >= threshold.warning) return "warning";
    return "critical";
  } else {
    if (value <= threshold.target) return "ok";
    if (value <= threshold.warning) return "warning";
    return "critical";
  }
}

function evaluateAllThresholds(metrics: SLAMetrics): Array<{
  metric: string;
  value: number | null;
  level: AlertLevel;
  target: number;
}> {
  return DEFAULT_SLA_THRESHOLDS.map(threshold => {
    const value = (metrics as Record<string, any>)[threshold.metric] ?? null;
    return {
      metric: threshold.metric,
      value: typeof value === "number" ? value : null,
      level: evaluateThreshold(typeof value === "number" ? value : null, threshold),
      target: threshold.target,
    };
  });
}

// ─── SLA Trend Analysis ─────────────────────────────────────────────────────

interface SLATrend {
  metric: string;
  values: number[];
  direction: "improving" | "declining" | "stable";
  changePercent: number;
}

function analyzeTrend(values: number[]): { direction: "improving" | "declining" | "stable"; changePercent: number } {
  if (values.length < 2) return { direction: "stable", changePercent: 0 };

  const first = values[0];
  const last = values[values.length - 1];

  if (first === 0) return { direction: last > 0 ? "improving" : "stable", changePercent: 0 };

  const changePercent = Math.round(((last - first) / first) * 1000) / 10;

  if (Math.abs(changePercent) < 2) return { direction: "stable", changePercent };
  return { direction: changePercent > 0 ? "improving" : "declining", changePercent };
}

// ─── Date Range Validation ───────────────────────────────────────────────────

function getWeekStartDate(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const offset = day === 0 ? 6 : day - 1; // Monday start
  d.setDate(d.getDate() - offset);
  return d.toISOString().split("T")[0];
}

function getMonthStartDate(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split("T")[0];
}

// =========================================================
// Tests
// =========================================================

describe("SLA Monitoring — Pickup On-Time Calculation", () => {
  it("100% on-time with all eligible trips", () => {
    expect(calculatePickupOnTimePercent(100, 100)).toBe(100);
  });

  it("0% on-time with none on-time", () => {
    expect(calculatePickupOnTimePercent(0, 50)).toBe(0);
  });

  it("calculates percentage with one decimal", () => {
    expect(calculatePickupOnTimePercent(85, 100)).toBe(85);
    expect(calculatePickupOnTimePercent(89, 100)).toBe(89);
  });

  it("handles fractional percentages", () => {
    expect(calculatePickupOnTimePercent(2, 3)).toBe(66.7);
  });

  it("zero eligible returns 0", () => {
    expect(calculatePickupOnTimePercent(0, 0)).toBe(0);
  });

  it("pickup within 15 minutes is on-time", () => {
    expect(isPickupOnTime("2026-03-12T10:00:00Z", "2026-03-12T10:14:00Z")).toBe(true);
  });

  it("pickup at exactly 15 minutes is on-time", () => {
    expect(isPickupOnTime("2026-03-12T10:00:00Z", "2026-03-12T10:15:00Z")).toBe(true);
  });

  it("pickup at 16 minutes is late", () => {
    expect(isPickupOnTime("2026-03-12T10:00:00Z", "2026-03-12T10:16:00Z")).toBe(false);
  });

  it("early pickup is on-time", () => {
    expect(isPickupOnTime("2026-03-12T10:00:00Z", "2026-03-12T09:55:00Z")).toBe(true);
  });

  it("custom threshold of 30 minutes", () => {
    expect(isPickupOnTime("2026-03-12T10:00:00Z", "2026-03-12T10:25:00Z", 30)).toBe(true);
    expect(isPickupOnTime("2026-03-12T10:00:00Z", "2026-03-12T10:35:00Z", 30)).toBe(false);
  });
});

describe("SLA Monitoring — Completion Rate Calculation", () => {
  it("100% completion when all completed", () => {
    expect(calculateCompletionRate(100, 0, 0)).toBe(100);
  });

  it("0% completion when all cancelled", () => {
    expect(calculateCompletionRate(0, 100, 0)).toBe(0);
  });

  it("real-world scenario", () => {
    // 85 completed, 10 cancelled, 5 no-shows = 85/100 = 85%
    expect(calculateCompletionRate(85, 10, 5)).toBe(85);
  });

  it("handles no terminal trips", () => {
    expect(calculateCompletionRate(0, 0, 0)).toBe(0);
  });

  it("high no-show impact", () => {
    // 70 completed, 10 cancelled, 20 no-shows = 70/100 = 70%
    expect(calculateCompletionRate(70, 10, 20)).toBe(70);
  });
});

describe("SLA Monitoring — Driver Utilization", () => {
  it("100% utilization when all drivers utilized", () => {
    expect(calculateDriverUtilization(50, 50)).toBe(100);
  });

  it("50% utilization", () => {
    expect(calculateDriverUtilization(25, 50)).toBe(50);
  });

  it("0% when no drivers utilized", () => {
    expect(calculateDriverUtilization(0, 50)).toBe(0);
  });

  it("handles zero active drivers", () => {
    expect(calculateDriverUtilization(0, 0)).toBe(0);
  });
});

describe("SLA Monitoring — Response Time Calculation", () => {
  it("calculates 10-minute response time", () => {
    expect(calculateResponseTime("2026-03-12T10:00:00Z", "2026-03-12T10:10:00Z")).toBe(10);
  });

  it("calculates sub-minute response time", () => {
    expect(calculateResponseTime("2026-03-12T10:00:00Z", "2026-03-12T10:00:30Z")).toBe(0.5);
  });

  it("handles long response time (1 hour)", () => {
    expect(calculateResponseTime("2026-03-12T10:00:00Z", "2026-03-12T11:00:00Z")).toBe(60);
  });
});

describe("SLA Monitoring — Threshold Evaluation", () => {
  const pickupThreshold: SLAThreshold = {
    metric: "pickupOnTimePercent", target: 95, warning: 90, critical: 85, direction: "above",
  };

  const responseThreshold: SLAThreshold = {
    metric: "avgResponseTimeMinutes", target: 10, warning: 20, critical: 30, direction: "below",
  };

  it("above target = ok (higher-is-better)", () => {
    expect(evaluateThreshold(96, pickupThreshold)).toBe("ok");
  });

  it("at target = ok", () => {
    expect(evaluateThreshold(95, pickupThreshold)).toBe("ok");
  });

  it("between target and warning = warning", () => {
    expect(evaluateThreshold(92, pickupThreshold)).toBe("warning");
  });

  it("between warning and critical = warning", () => {
    expect(evaluateThreshold(90, pickupThreshold)).toBe("warning");
  });

  it("below critical = critical", () => {
    expect(evaluateThreshold(80, pickupThreshold)).toBe("critical");
  });

  it("below target = ok (lower-is-better)", () => {
    expect(evaluateThreshold(8, responseThreshold)).toBe("ok");
  });

  it("at target = ok (lower-is-better)", () => {
    expect(evaluateThreshold(10, responseThreshold)).toBe("ok");
  });

  it("between target and warning = warning (lower-is-better)", () => {
    expect(evaluateThreshold(15, responseThreshold)).toBe("warning");
  });

  it("above critical = critical (lower-is-better)", () => {
    expect(evaluateThreshold(35, responseThreshold)).toBe("critical");
  });

  it("null value returns ok", () => {
    expect(evaluateThreshold(null, pickupThreshold)).toBe("ok");
  });
});

describe("SLA Monitoring — Full Dashboard Evaluation", () => {
  it("healthy metrics produce all ok", () => {
    const metrics: SLAMetrics = {
      pickupOnTimePercent: 97,
      avgResponseTimeMinutes: 8,
      tripCompletionRate: 96,
      avgEtaAccuracyMinutes: 4,
      driverUtilizationRate: 75,
      totalTrips: 500,
      completedTrips: 480,
      cancelledTrips: 10,
      noShowTrips: 10,
    };

    const results = evaluateAllThresholds(metrics);
    expect(results.every(r => r.level === "ok")).toBe(true);
  });

  it("poor metrics produce warnings and criticals", () => {
    const metrics: SLAMetrics = {
      pickupOnTimePercent: 82,
      avgResponseTimeMinutes: 18,
      tripCompletionRate: 75,
      avgEtaAccuracyMinutes: 8,
      driverUtilizationRate: 40,
      totalTrips: 200,
      completedTrips: 150,
      cancelledTrips: 30,
      noShowTrips: 20,
    };

    const results = evaluateAllThresholds(metrics);
    const criticals = results.filter(r => r.level === "critical");
    const warnings = results.filter(r => r.level === "warning");

    expect(criticals.length).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("null metrics treated as ok (no data)", () => {
    const metrics: SLAMetrics = {
      pickupOnTimePercent: 0,
      avgResponseTimeMinutes: null,
      tripCompletionRate: 0,
      avgEtaAccuracyMinutes: null,
      driverUtilizationRate: 0,
      totalTrips: 0,
      completedTrips: 0,
      cancelledTrips: 0,
      noShowTrips: 0,
    };

    const results = evaluateAllThresholds(metrics);
    const nullMetrics = results.filter(r => r.value === null);
    expect(nullMetrics.every(r => r.level === "ok")).toBe(true);
  });
});

describe("SLA Monitoring — Trend Analysis", () => {
  it("improving trend detected", () => {
    const result = analyzeTrend([80, 85, 88, 92, 95]);
    expect(result.direction).toBe("improving");
    expect(result.changePercent).toBeGreaterThan(0);
  });

  it("declining trend detected", () => {
    const result = analyzeTrend([95, 92, 88, 82, 78]);
    expect(result.direction).toBe("declining");
    expect(result.changePercent).toBeLessThan(0);
  });

  it("stable trend when change < 2%", () => {
    const result = analyzeTrend([95, 95, 95.5, 95.2, 95.1]);
    expect(result.direction).toBe("stable");
  });

  it("single value is stable", () => {
    const result = analyzeTrend([95]);
    expect(result.direction).toBe("stable");
    expect(result.changePercent).toBe(0);
  });

  it("empty values is stable", () => {
    const result = analyzeTrend([]);
    expect(result.direction).toBe("stable");
  });

  it("calculates change percentage correctly", () => {
    const result = analyzeTrend([80, 100]);
    expect(result.changePercent).toBe(25); // (100-80)/80 = 25%
  });
});

describe("SLA Monitoring — Date Range Helpers", () => {
  it("gets Monday as week start", () => {
    // Wednesday March 12, 2026
    const date = new Date("2026-03-12T12:00:00Z");
    expect(getWeekStartDate(date)).toBe("2026-03-09"); // Monday
  });

  it("Monday returns itself", () => {
    const date = new Date("2026-03-09T12:00:00Z"); // Monday
    expect(getWeekStartDate(date)).toBe("2026-03-09");
  });

  it("Sunday goes back to previous Monday", () => {
    const date = new Date("2026-03-15T12:00:00Z"); // Sunday
    expect(getWeekStartDate(date)).toBe("2026-03-09");
  });

  it("gets first of month", () => {
    const date = new Date("2026-03-12T12:00:00Z");
    expect(getMonthStartDate(date)).toBe("2026-03-01");
  });

  it("first of month returns itself", () => {
    const date = new Date("2026-03-01T12:00:00Z");
    expect(getMonthStartDate(date)).toBe("2026-03-01");
  });
});
