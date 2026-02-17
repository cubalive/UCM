import {
  startOfDay,
  addDays,
  addMonths,
  subDays,
  subMonths,
  setDate,
  getDay,
  getDate,
  differenceInDays,
  parseISO,
  format,
} from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import type { ClinicBillingSettingsType } from "@shared/schema";

export interface BillingWindow {
  periodStart: string;
  periodEnd: string;
}

function clampDom(dom: number): number {
  return Math.max(1, Math.min(28, dom));
}

function dowToJs(dow: number): number {
  return dow === 7 ? 0 : dow;
}

export function computeBillingWindow(
  settings: ClinicBillingSettingsType,
  asOf?: Date
): BillingWindow {
  const tz = settings.timezone || "America/Los_Angeles";
  const now = asOf || new Date();
  const zonedNow = toZonedTime(now, tz);

  switch (settings.billingCycle) {
    case "weekly":
      return computeWeeklyWindow(zonedNow, settings.anchorDow ?? 1, tz);
    case "biweekly":
      return computeBiweeklyWindow(zonedNow, settings, tz);
    case "monthly":
      return computeMonthlyWindow(zonedNow, settings.anchorDom ?? 1, tz);
    default:
      return computeWeeklyWindow(zonedNow, 1, tz);
  }
}

function computeWeeklyWindow(
  zonedNow: Date,
  anchorDow: number,
  tz: string
): BillingWindow {
  const jsDow = dowToJs(anchorDow);
  const currentDow = getDay(zonedNow);
  let diff = currentDow - jsDow;
  if (diff < 0) diff += 7;
  const start = startOfDay(subDays(zonedNow, diff));
  const end = addDays(start, 7);
  return {
    periodStart: format(start, "yyyy-MM-dd"),
    periodEnd: format(end, "yyyy-MM-dd"),
  };
}

function computeBiweeklyWindow(
  zonedNow: Date,
  settings: ClinicBillingSettingsType,
  tz: string
): BillingWindow {
  if (settings.biweeklyMode === "1_15") {
    const dom = getDate(zonedNow);
    const year = zonedNow.getFullYear();
    const month = zonedNow.getMonth();
    if (dom < 16) {
      const start = new Date(year, month, 1);
      const end = new Date(year, month, 16);
      return {
        periodStart: format(start, "yyyy-MM-dd"),
        periodEnd: format(end, "yyyy-MM-dd"),
      };
    } else {
      const start = new Date(year, month, 16);
      const end = new Date(year, month + 1, 1);
      return {
        periodStart: format(start, "yyyy-MM-dd"),
        periodEnd: format(end, "yyyy-MM-dd"),
      };
    }
  }

  const anchorStr = settings.anchorDate;
  if (!anchorStr) {
    return computeWeeklyWindow(zonedNow, 1, tz);
  }
  const anchor = parseISO(anchorStr);
  const daysSinceAnchor = differenceInDays(startOfDay(zonedNow), startOfDay(anchor));
  const cycleIndex = Math.floor(daysSinceAnchor / 14);
  const start = addDays(startOfDay(anchor), cycleIndex * 14);
  const end = addDays(start, 14);
  return {
    periodStart: format(start, "yyyy-MM-dd"),
    periodEnd: format(end, "yyyy-MM-dd"),
  };
}

function computeMonthlyWindow(
  zonedNow: Date,
  anchorDom: number,
  tz: string
): BillingWindow {
  const dom = clampDom(anchorDom);
  const currentDom = getDate(zonedNow);
  const year = zonedNow.getFullYear();
  const month = zonedNow.getMonth();

  let start: Date;
  if (currentDom >= dom) {
    start = new Date(year, month, dom);
  } else {
    start = new Date(year, month - 1, dom);
  }
  const end = addMonths(start, 1);
  return {
    periodStart: format(start, "yyyy-MM-dd"),
    periodEnd: format(end, "yyyy-MM-dd"),
  };
}
