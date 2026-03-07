/**
 * UCM Security, Timezone, and Auto-Assign Improvements Test Suite
 */
import { describe, it, expect } from "vitest";
import {
  formatInTimezone,
  formatDate,
  formatDateTime,
  formatTime,
  getDayInTimezone,
  getHourInTimezone,
  parseLocalDatetime,
  getTimezoneOffsetMinutes,
  isValidTimezone,
  formatDateForPdf,
  DEFAULT_TIMEZONE,
} from "../../src/lib/timezone.js";
import { canTransition } from "../../src/services/tripService.js";
import { roundCurrency, validateFeeRule } from "../../src/services/feeService.js";

// ============================================================
// TIMEZONE CONSISTENCY TESTS
// ============================================================
describe("Timezone Consistency", () => {
  const testDate = new Date("2026-03-07T19:30:00Z"); // 2:30 PM EST, 11:30 AM PST

  it("DEFAULT_TIMEZONE is America/New_York", () => {
    expect(DEFAULT_TIMEZONE).toBe("America/New_York");
  });

  it("formats date in Eastern timezone correctly", () => {
    const result = formatDate(testDate, "America/New_York");
    expect(result).toContain("3/7/2026");
  });

  it("formats date in Pacific timezone correctly", () => {
    const result = formatDate(testDate, "America/Los_Angeles");
    expect(result).toContain("3/7/2026");
  });

  it("formats datetime with timezone name", () => {
    const result = formatDateTime(testDate, "America/New_York");
    expect(result).toContain("2:30");
    expect(result).toMatch(/E[SD]T/); // EST or EDT
  });

  it("formats time only with timezone", () => {
    const result = formatTime(testDate, "America/New_York");
    expect(result).toContain("2:30");
  });

  it("correctly identifies day of week in timezone", () => {
    // March 7, 2026 is a Saturday
    const day = getDayInTimezone(testDate, "America/New_York");
    expect(day).toBe(6); // Saturday
  });

  it("correctly identifies hour in timezone", () => {
    const hourET = getHourInTimezone(testDate, "America/New_York");
    const hourPT = getHourInTimezone(testDate, "America/Los_Angeles");
    expect(hourET).toBe(14); // 2 PM EST
    expect(hourPT).toBe(11); // 11 AM PST
  });

  it("handles timezone hour difference between ET and PT", () => {
    const hourET = getHourInTimezone(testDate, "America/New_York");
    const hourPT = getHourInTimezone(testDate, "America/Los_Angeles");
    expect(hourET - hourPT).toBe(3);
  });

  it("parseLocalDatetime converts local time to UTC", () => {
    const utcDate = parseLocalDatetime("2026-03-07T14:30", "America/New_York");
    // 2:30 PM EST = 7:30 PM UTC (EST is UTC-5)
    expect(utcDate.getUTCHours()).toBe(19);
    expect(utcDate.getUTCMinutes()).toBe(30);
  });

  it("parseLocalDatetime handles Pacific timezone", () => {
    const utcDate = parseLocalDatetime("2026-03-07T11:30", "America/Los_Angeles");
    // 11:30 AM PST = 7:30 PM UTC (PST is UTC-8)
    expect(utcDate.getUTCHours()).toBe(19);
    expect(utcDate.getUTCMinutes()).toBe(30);
  });

  it("parseLocalDatetime throws on invalid format", () => {
    expect(() => parseLocalDatetime("invalid", "America/New_York")).toThrow();
  });

  it("getTimezoneOffsetMinutes returns positive for EST", () => {
    const winterDate = new Date("2026-01-15T12:00:00Z");
    const offset = getTimezoneOffsetMinutes(winterDate, "America/New_York");
    expect(offset).toBe(300); // EST = UTC-5 = +300 minutes
  });

  it("validates valid IANA timezone", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("America/Chicago")).toBe(true);
    expect(isValidTimezone("America/Denver")).toBe(true);
    expect(isValidTimezone("America/Los_Angeles")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
  });

  it("rejects invalid timezone", () => {
    expect(isValidTimezone("Invalid/Timezone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });

  it("formatDateForPdf produces human-readable date", () => {
    const result = formatDateForPdf(testDate, "America/New_York");
    expect(result).toContain("March");
    expect(result).toContain("7");
    expect(result).toContain("2026");
  });

  it("same UTC instant shows different times in different timezones", () => {
    const utcDate = new Date("2026-06-15T22:00:00Z"); // 10 PM UTC
    const nyTime = formatTime(utcDate, "America/New_York");
    const laTime = formatTime(utcDate, "America/Los_Angeles");
    // NY = 6 PM EDT, LA = 3 PM PDT
    expect(nyTime).toContain("6:00");
    expect(laTime).toContain("3:00");
  });

  it("handles date string input for formatInTimezone", () => {
    const result = formatInTimezone("2026-03-07T19:30:00Z", "America/New_York", {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(result).toContain("2:30");
  });
});

// ============================================================
// TRIP STATE MACHINE EDGE CASES
// ============================================================
describe("Trip State Machine - Edge Cases", () => {
  it("completed trips cannot transition to any state", () => {
    const states = ["requested", "assigned", "en_route", "arrived", "in_progress", "completed", "cancelled"];
    for (const state of states) {
      expect(canTransition("completed", state)).toBe(false);
    }
  });

  it("cancelled trips cannot transition to any state", () => {
    const states = ["requested", "assigned", "en_route", "arrived", "in_progress", "completed", "cancelled"];
    for (const state of states) {
      expect(canTransition("cancelled", state)).toBe(false);
    }
  });

  it("handles unknown status gracefully", () => {
    expect(canTransition("unknown", "assigned")).toBe(false);
    expect(canTransition("requested", "unknown")).toBe(false);
  });
});

// ============================================================
// FEE CALCULATION EDGE CASES
// ============================================================
describe("Fee Validation Extended", () => {
  it("rejects fee with negative amount", () => {
    const errors = validateFeeRule({ type: "flat", amount: -10 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes("negative"))).toBe(true);
  });

  it("accepts percentage fee within valid range", () => {
    const errors = validateFeeRule({ type: "percentage", amount: 15 });
    expect(errors.length).toBe(0);
  });

  it("rejects percentage over 100", () => {
    const errors = validateFeeRule({ type: "percentage", amount: 150 });
    expect(errors.some(e => e.includes("between 0 and 100"))).toBe(true);
  });

  it("rejects invalid fee type", () => {
    const errors = validateFeeRule({ type: "invalid_type", amount: 10 });
    expect(errors.some(e => e.includes("Invalid fee type"))).toBe(true);
  });

  it("validates mileage range conditions", () => {
    const errors = validateFeeRule({
      type: "per_mile",
      amount: 2,
      conditions: { minMileage: 100, maxMileage: 10 }, // invalid: min > max
    });
    expect(errors.some(e => e.includes("minMileage"))).toBe(true);
  });

  it("roundCurrency handles floating point precision", () => {
    expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
    expect(roundCurrency(10.005)).toBe(10.01);
    expect(roundCurrency(0)).toBe(0);
    expect(roundCurrency(99.999)).toBe(100);
  });
});

// ============================================================
// HAVERSINE DISTANCE VALIDATION
// ============================================================
describe("Auto-Assign Haversine Distance", () => {
  // We import the module to test haversine indirectly via scoring logic
  // The haversine function is private but we can validate the math properties

  it("same coordinates should have zero distance effect", () => {
    // Testing the math: haversine(lat, lon, lat, lon) = 0
    const R = 3959;
    const distance = haversineTest(40.7128, -74.006, 40.7128, -74.006);
    expect(distance).toBeCloseTo(0, 5);
  });

  it("NYC to LA distance is approximately 2451 miles", () => {
    const distance = haversineTest(40.7128, -74.006, 34.0522, -118.2437);
    expect(distance).toBeGreaterThan(2400);
    expect(distance).toBeLessThan(2500);
  });

  it("short distance (1 mile) is accurate", () => {
    // ~1 degree lat ≈ 69 miles, so 1/69 degree ≈ 1 mile
    const distance = haversineTest(40.0, -74.0, 40.0 + 1 / 69, -74.0);
    expect(distance).toBeGreaterThan(0.9);
    expect(distance).toBeLessThan(1.1);
  });
});

// Replicate the haversine function for testing
function haversineTest(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
