import { describe, it, expect } from "vitest";

// ── Inline types and functions mirroring driver earnings screen ─────

interface TripEarning {
  tripId: number;
  fare: number;
  tip: number;
  platformFee: number;
  date: string;
}

function calculateDailyEarnings(trips: TripEarning[]): {
  totalFare: number;
  totalTips: number;
  totalFees: number;
  netEarnings: number;
  tripCount: number;
} {
  const totalFare = trips.reduce((sum, t) => sum + t.fare, 0);
  const totalTips = trips.reduce((sum, t) => sum + t.tip, 0);
  const totalFees = trips.reduce((sum, t) => sum + t.platformFee, 0);
  const netEarnings = Math.round((totalFare + totalTips - totalFees) * 100) / 100;
  return { totalFare, totalTips, totalFees, netEarnings, tripCount: trips.length };
}

function calculateWeeklyEarnings(dailyEarnings: { date: string; net: number }[]): {
  weekTotal: number;
  dailyAverage: number;
  bestDay: string;
  worstDay: string;
} {
  const weekTotal = dailyEarnings.reduce((sum, d) => sum + d.net, 0);
  const dailyAverage =
    dailyEarnings.length > 0
      ? Math.round((weekTotal / dailyEarnings.length) * 100) / 100
      : 0;
  const sorted = [...dailyEarnings].sort((a, b) => b.net - a.net);
  return {
    weekTotal: Math.round(weekTotal * 100) / 100,
    dailyAverage,
    bestDay: sorted[0]?.date || "",
    worstDay: sorted[sorted.length - 1]?.date || "",
  };
}

function groupTripsByDate(trips: TripEarning[]): Map<string, TripEarning[]> {
  const groups = new Map<string, TripEarning[]>();
  for (const trip of trips) {
    const existing = groups.get(trip.date) || [];
    existing.push(trip);
    groups.set(trip.date, existing);
  }
  return groups;
}

// ── Test data ───────────────────────────────────────────────────────

const sampleTrips: TripEarning[] = [
  { tripId: 1, fare: 25.0, tip: 5.0, platformFee: 3.0, date: "2026-03-10" },
  { tripId: 2, fare: 30.0, tip: 0, platformFee: 3.5, date: "2026-03-10" },
  { tripId: 3, fare: 40.0, tip: 10.0, platformFee: 5.0, date: "2026-03-11" },
  { tripId: 4, fare: 20.0, tip: 3.0, platformFee: 2.5, date: "2026-03-11" },
  { tripId: 5, fare: 35.0, tip: 7.0, platformFee: 4.0, date: "2026-03-12" },
];

// ── Tests ───────────────────────────────────────────────────────────

describe("Earnings Calculation Logic", () => {
  // ── Daily earnings ────────────────────────────────────────────────
  describe("calculateDailyEarnings", () => {
    it("calculates totals correctly for multiple trips", () => {
      const result = calculateDailyEarnings(sampleTrips.slice(0, 2));
      expect(result.totalFare).toBe(55); // 25 + 30
      expect(result.totalTips).toBe(5); // 5 + 0
      expect(result.totalFees).toBe(6.5); // 3 + 3.5
      expect(result.netEarnings).toBe(53.5); // 55 + 5 - 6.5
      expect(result.tripCount).toBe(2);
    });

    it("returns all zeros for empty trips array", () => {
      const result = calculateDailyEarnings([]);
      expect(result.totalFare).toBe(0);
      expect(result.totalTips).toBe(0);
      expect(result.totalFees).toBe(0);
      expect(result.netEarnings).toBe(0);
      expect(result.tripCount).toBe(0);
    });

    it("calculates correctly for single trip", () => {
      const result = calculateDailyEarnings([sampleTrips[0]]);
      expect(result.totalFare).toBe(25);
      expect(result.totalTips).toBe(5);
      expect(result.totalFees).toBe(3);
      expect(result.netEarnings).toBe(27); // 25 + 5 - 3
      expect(result.tripCount).toBe(1);
    });

    it("handles trips with zero tips", () => {
      const trips: TripEarning[] = [
        { tripId: 1, fare: 50, tip: 0, platformFee: 5, date: "2026-03-10" },
      ];
      const result = calculateDailyEarnings(trips);
      expect(result.totalTips).toBe(0);
      expect(result.netEarnings).toBe(45);
    });

    it("handles trips with zero fees", () => {
      const trips: TripEarning[] = [
        { tripId: 1, fare: 50, tip: 10, platformFee: 0, date: "2026-03-10" },
      ];
      const result = calculateDailyEarnings(trips);
      expect(result.totalFees).toBe(0);
      expect(result.netEarnings).toBe(60);
    });

    it("rounds net earnings to 2 decimal places", () => {
      const trips: TripEarning[] = [
        { tripId: 1, fare: 10.1, tip: 0.1, platformFee: 0.1, date: "2026-03-10" },
        { tripId: 2, fare: 10.1, tip: 0.1, platformFee: 0.1, date: "2026-03-10" },
        { tripId: 3, fare: 10.1, tip: 0.1, platformFee: 0.1, date: "2026-03-10" },
      ];
      const result = calculateDailyEarnings(trips);
      // Should not have floating point artifacts
      const decimalPlaces = result.netEarnings.toString().split(".")[1]?.length || 0;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });

    it("handles large number of trips", () => {
      const manyTrips: TripEarning[] = Array.from({ length: 100 }, (_, i) => ({
        tripId: i,
        fare: 25,
        tip: 5,
        platformFee: 3,
        date: "2026-03-10",
      }));
      const result = calculateDailyEarnings(manyTrips);
      expect(result.tripCount).toBe(100);
      expect(result.totalFare).toBe(2500);
      expect(result.totalTips).toBe(500);
      expect(result.totalFees).toBe(300);
      expect(result.netEarnings).toBe(2700);
    });
  });

  // ── Weekly earnings ───────────────────────────────────────────────
  describe("calculateWeeklyEarnings", () => {
    it("calculates weekly total and daily average", () => {
      const daily = [
        { date: "2026-03-10", net: 100 },
        { date: "2026-03-11", net: 150 },
        { date: "2026-03-12", net: 80 },
      ];
      const result = calculateWeeklyEarnings(daily);
      expect(result.weekTotal).toBe(330);
      expect(result.dailyAverage).toBe(110);
    });

    it("identifies best and worst day", () => {
      const daily = [
        { date: "2026-03-10", net: 100 },
        { date: "2026-03-11", net: 200 },
        { date: "2026-03-12", net: 50 },
      ];
      const result = calculateWeeklyEarnings(daily);
      expect(result.bestDay).toBe("2026-03-11");
      expect(result.worstDay).toBe("2026-03-12");
    });

    it("handles empty array", () => {
      const result = calculateWeeklyEarnings([]);
      expect(result.weekTotal).toBe(0);
      expect(result.dailyAverage).toBe(0);
      expect(result.bestDay).toBe("");
      expect(result.worstDay).toBe("");
    });

    it("single day: average equals total", () => {
      const daily = [{ date: "2026-03-10", net: 150 }];
      const result = calculateWeeklyEarnings(daily);
      expect(result.weekTotal).toBe(150);
      expect(result.dailyAverage).toBe(150);
      expect(result.bestDay).toBe("2026-03-10");
      expect(result.worstDay).toBe("2026-03-10");
    });

    it("rounds weekly total to 2 decimal places", () => {
      const daily = [
        { date: "2026-03-10", net: 33.33 },
        { date: "2026-03-11", net: 33.33 },
        { date: "2026-03-12", net: 33.33 },
      ];
      const result = calculateWeeklyEarnings(daily);
      expect(result.weekTotal).toBe(99.99);
    });

    it("rounds daily average to 2 decimal places", () => {
      const daily = [
        { date: "2026-03-10", net: 100 },
        { date: "2026-03-11", net: 100 },
        { date: "2026-03-12", net: 100 },
      ];
      const result = calculateWeeklyEarnings(daily);
      const decimalPlaces = result.dailyAverage.toString().split(".")[1]?.length || 0;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });

    it("handles all same amounts", () => {
      const daily = [
        { date: "2026-03-10", net: 100 },
        { date: "2026-03-11", net: 100 },
        { date: "2026-03-12", net: 100 },
      ];
      const result = calculateWeeklyEarnings(daily);
      expect(result.weekTotal).toBe(300);
      expect(result.dailyAverage).toBe(100);
    });

    it("handles zero earnings days", () => {
      const daily = [
        { date: "2026-03-10", net: 0 },
        { date: "2026-03-11", net: 200 },
      ];
      const result = calculateWeeklyEarnings(daily);
      expect(result.weekTotal).toBe(200);
      expect(result.worstDay).toBe("2026-03-10");
    });
  });

  // ── Trip grouping by date ─────────────────────────────────────────
  describe("groupTripsByDate", () => {
    it("groups trips correctly by date", () => {
      const groups = groupTripsByDate(sampleTrips);
      expect(groups.size).toBe(3);
      expect(groups.get("2026-03-10")!.length).toBe(2);
      expect(groups.get("2026-03-11")!.length).toBe(2);
      expect(groups.get("2026-03-12")!.length).toBe(1);
    });

    it("returns empty map for empty array", () => {
      const groups = groupTripsByDate([]);
      expect(groups.size).toBe(0);
    });

    it("single trip creates single group", () => {
      const groups = groupTripsByDate([sampleTrips[0]]);
      expect(groups.size).toBe(1);
      expect(groups.get("2026-03-10")!.length).toBe(1);
    });

    it("preserves trip data in groups", () => {
      const groups = groupTripsByDate(sampleTrips);
      const mar10Trips = groups.get("2026-03-10")!;
      expect(mar10Trips[0].tripId).toBe(1);
      expect(mar10Trips[1].tripId).toBe(2);
    });

    it("all trips on same date go in one group", () => {
      const sameDateTrips: TripEarning[] = [
        { tripId: 1, fare: 25, tip: 5, platformFee: 3, date: "2026-03-10" },
        { tripId: 2, fare: 30, tip: 0, platformFee: 3, date: "2026-03-10" },
        { tripId: 3, fare: 40, tip: 10, platformFee: 5, date: "2026-03-10" },
      ];
      const groups = groupTripsByDate(sameDateTrips);
      expect(groups.size).toBe(1);
      expect(groups.get("2026-03-10")!.length).toBe(3);
    });
  });
});
