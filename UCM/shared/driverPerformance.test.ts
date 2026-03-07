import { describe, it, expect } from "vitest";
import {
  computeTurnScore,
  getGrade,
  getGradeColor,
  DEFAULT_WEIGHTS,
  type PerformanceKPIs,
  type ScoringWeights,
} from "./driverPerformance";

describe("driverPerformance", () => {
  describe("computeTurnScore", () => {
    it("perfect KPIs yield score of 100", () => {
      const kpis: PerformanceKPIs = {
        onTimeRate: 1,
        lateCount: 0,
        totalTrips: 10,
        acceptanceRate: 1,
        idleMinutes: 0,
        cancelCount: 0,
        complianceRate: 1,
      };
      expect(computeTurnScore(kpis)).toBe(100);
    });

    it("worst KPIs yield score of 0", () => {
      const kpis: PerformanceKPIs = {
        onTimeRate: 0,
        lateCount: 10,
        totalTrips: 10,
        acceptanceRate: 0,
        idleMinutes: 120,
        cancelCount: 5,
        complianceRate: 0,
      };
      expect(computeTurnScore(kpis)).toBe(0);
    });

    it("mixed KPIs produce expected weighted score", () => {
      const kpis: PerformanceKPIs = {
        onTimeRate: 0.8,
        lateCount: 2,
        totalTrips: 10,
        acceptanceRate: 0.9,
        idleMinutes: 30,
        cancelCount: 1,
        complianceRate: 1,
      };
      const score = computeTurnScore(kpis);
      expect(score).toBeGreaterThan(50);
      expect(score).toBeLessThan(95);
    });

    it("idle minutes above 120 cap at 0 for idle score", () => {
      const kpis: PerformanceKPIs = {
        onTimeRate: 1,
        lateCount: 0,
        totalTrips: 10,
        acceptanceRate: 1,
        idleMinutes: 200,
        cancelCount: 0,
        complianceRate: 1,
      };
      const score = computeTurnScore(kpis);
      expect(score).toBeLessThan(100);
      expect(score).toBeGreaterThan(80);
    });

    it("cancellations above 5 cap at 0 for cancel score", () => {
      const kpis: PerformanceKPIs = {
        onTimeRate: 1,
        lateCount: 0,
        totalTrips: 10,
        acceptanceRate: 1,
        idleMinutes: 0,
        cancelCount: 10,
        complianceRate: 1,
      };
      const score = computeTurnScore(kpis);
      expect(score).toBe(90);
    });

    it("custom weights change the outcome", () => {
      const kpis: PerformanceKPIs = {
        onTimeRate: 0.5,
        lateCount: 5,
        totalTrips: 10,
        acceptanceRate: 1,
        idleMinutes: 0,
        cancelCount: 0,
        complianceRate: 1,
      };
      const heavyPunctuality: ScoringWeights = {
        punctuality: 100,
        acceptance: 0,
        idle: 0,
        cancellations: 0,
        compliance: 0,
      };
      expect(computeTurnScore(kpis, heavyPunctuality)).toBe(50);
    });

    it("zero total weight returns 0", () => {
      const kpis: PerformanceKPIs = {
        onTimeRate: 1,
        lateCount: 0,
        totalTrips: 10,
        acceptanceRate: 1,
        idleMinutes: 0,
        cancelCount: 0,
        complianceRate: 1,
      };
      const zeroWeights: ScoringWeights = {
        punctuality: 0,
        acceptance: 0,
        idle: 0,
        cancellations: 0,
        compliance: 0,
      };
      expect(computeTurnScore(kpis, zeroWeights)).toBe(0);
    });

    it("score is always clamped between 0 and 100", () => {
      const terrible: PerformanceKPIs = {
        onTimeRate: -0.5,
        lateCount: 100,
        totalTrips: 10,
        acceptanceRate: -1,
        idleMinutes: 500,
        cancelCount: 50,
        complianceRate: -2,
      };
      expect(computeTurnScore(terrible)).toBe(0);
    });

    it("default weights sum to 100", () => {
      const sum =
        DEFAULT_WEIGHTS.punctuality +
        DEFAULT_WEIGHTS.acceptance +
        DEFAULT_WEIGHTS.idle +
        DEFAULT_WEIGHTS.cancellations +
        DEFAULT_WEIGHTS.compliance;
      expect(sum).toBe(100);
    });

    it("partial idle time reduces score proportionally", () => {
      const noIdle: PerformanceKPIs = {
        onTimeRate: 1, lateCount: 0, totalTrips: 10,
        acceptanceRate: 1, idleMinutes: 0, cancelCount: 0, complianceRate: 1,
      };
      const halfIdle: PerformanceKPIs = { ...noIdle, idleMinutes: 60 };
      const scoreNoIdle = computeTurnScore(noIdle);
      const scoreHalfIdle = computeTurnScore(halfIdle);
      expect(scoreNoIdle).toBeGreaterThan(scoreHalfIdle);
    });
  });

  describe("getGrade", () => {
    it("A for >= 90", () => {
      expect(getGrade(90)).toBe("A");
      expect(getGrade(100)).toBe("A");
      expect(getGrade(95)).toBe("A");
    });

    it("B for 80-89", () => {
      expect(getGrade(80)).toBe("B");
      expect(getGrade(89)).toBe("B");
    });

    it("C for 70-79", () => {
      expect(getGrade(70)).toBe("C");
      expect(getGrade(79)).toBe("C");
    });

    it("D for 60-69", () => {
      expect(getGrade(60)).toBe("D");
      expect(getGrade(69)).toBe("D");
    });

    it("F for < 60", () => {
      expect(getGrade(59)).toBe("F");
      expect(getGrade(0)).toBe("F");
    });
  });

  describe("getGradeColor", () => {
    it("returns correct color for each grade", () => {
      expect(getGradeColor("A")).toBe("text-emerald-600");
      expect(getGradeColor("B")).toBe("text-blue-600");
      expect(getGradeColor("C")).toBe("text-amber-600");
      expect(getGradeColor("D")).toBe("text-orange-600");
      expect(getGradeColor("F")).toBe("text-red-600");
    });

    it("unknown grade returns red", () => {
      expect(getGradeColor("X")).toBe("text-red-600");
    });
  });
});
