import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStorage: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
  clear: vi.fn(() => { for (const k of Object.keys(mockStorage)) delete mockStorage[k]; }),
};
vi.stubGlobal("localStorage", localStorageMock);

import {
  evaluatePrompts,
  acknowledgePrompt,
  cleanOldPromptRecords,
  type SmartPrompt,
} from "../client/src/lib/smartPrompts";

function makeTrip(overrides: Partial<{
  id: number; status: string; scheduledPickupAt: string | null;
  pickupLat: number | null; pickupLng: number | null;
  dropoffLat: number | null; dropoffLng: number | null;
}> = {}) {
  return {
    id: 100,
    status: "ASSIGNED",
    scheduledPickupAt: new Date(Date.now() + 20 * 60000).toISOString(),
    pickupLat: 40.7128,
    pickupLng: -74.006,
    dropoffLat: 40.73,
    dropoffLng: -73.99,
    ...overrides,
  };
}

describe("smartPrompts", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe("evaluatePrompts - LEAVE_NOW", () => {
    it("fires when pickup is within tMinusLeaveNow window", () => {
      const trip = makeTrip({
        status: "ASSIGNED",
        scheduledPickupAt: new Date(Date.now() + 20 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip, null, null, { tMinusLeaveNow: 25 });
      expect(prompts.length).toBe(1);
      expect(prompts[0].type).toBe("LEAVE_NOW");
      expect(prompts[0].tripId).toBe(100);
    });

    it("does not fire when pickup is far away", () => {
      const trip = makeTrip({
        scheduledPickupAt: new Date(Date.now() + 60 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip, null, null, { tMinusLeaveNow: 25 });
      expect(prompts.length).toBe(0);
    });

    it("does not fire for EN_ROUTE_TO_PICKUP status", () => {
      const trip = makeTrip({
        status: "EN_ROUTE_TO_PICKUP",
        scheduledPickupAt: new Date(Date.now() + 10 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip, null, null);
      expect(prompts.filter((p) => p.type === "LEAVE_NOW").length).toBe(0);
    });

    it("does not fire when scheduledPickupAt is null", () => {
      const trip = makeTrip({ scheduledPickupAt: null });
      const prompts = evaluatePrompts(trip, null, null);
      expect(prompts.length).toBe(0);
    });

    it("does not re-fire after acknowledgment", () => {
      const trip = makeTrip({
        scheduledPickupAt: new Date(Date.now() + 15 * 60000).toISOString(),
      });
      const first = evaluatePrompts(trip, null, null);
      expect(first.length).toBe(1);
      acknowledgePrompt(100, "LEAVE_NOW");
      const second = evaluatePrompts(trip, null, null);
      expect(second.filter((p) => p.type === "LEAVE_NOW").length).toBe(0);
    });

    it("marks critical when <= 10 min to pickup", () => {
      const trip = makeTrip({
        scheduledPickupAt: new Date(Date.now() + 8 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip, null, null);
      expect(prompts[0].priority).toBe("critical");
    });

    it("marks normal when > 10 min to pickup", () => {
      const trip = makeTrip({
        scheduledPickupAt: new Date(Date.now() + 20 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip, null, null);
      expect(prompts[0].priority).toBe("normal");
    });

    it("works for SCHEDULED status", () => {
      const trip = makeTrip({
        status: "SCHEDULED",
        scheduledPickupAt: new Date(Date.now() + 15 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip, null, null);
      expect(prompts.length).toBe(1);
      expect(prompts[0].type).toBe("LEAVE_NOW");
    });

    it("works for PENDING status", () => {
      const trip = makeTrip({
        status: "PENDING",
        scheduledPickupAt: new Date(Date.now() + 15 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip, null, null);
      expect(prompts.length).toBe(1);
    });
  });

  describe("evaluatePrompts - ARRIVE_NOW", () => {
    it("fires when driver is within geofence radius of pickup", () => {
      const trip = makeTrip({ status: "EN_ROUTE_TO_PICKUP" });
      const driverLoc = { lat: trip.pickupLat! + 0.0001, lng: trip.pickupLng! };
      const prompts = evaluatePrompts(trip, driverLoc, null, { geofenceMeters: 150 });
      expect(prompts.length).toBe(1);
      expect(prompts[0].type).toBe("ARRIVE_NOW");
    });

    it("does not fire when driver is far from pickup", () => {
      const trip = makeTrip({ status: "EN_ROUTE_TO_PICKUP" });
      const driverLoc = { lat: trip.pickupLat! + 0.1, lng: trip.pickupLng! };
      const prompts = evaluatePrompts(trip, driverLoc, null, { geofenceMeters: 150 });
      expect(prompts.filter((p) => p.type === "ARRIVE_NOW").length).toBe(0);
    });

    it("does not fire for ASSIGNED status", () => {
      const trip = makeTrip({ status: "ASSIGNED" });
      const driverLoc = { lat: trip.pickupLat!, lng: trip.pickupLng! };
      const prompts = evaluatePrompts(trip, driverLoc, null, { geofenceMeters: 150 });
      expect(prompts.filter((p) => p.type === "ARRIVE_NOW").length).toBe(0);
    });

    it("does not fire when pickupLat/Lng is null", () => {
      const trip = makeTrip({ status: "EN_ROUTE_TO_PICKUP", pickupLat: null, pickupLng: null });
      const driverLoc = { lat: 40.7128, lng: -74.006 };
      const prompts = evaluatePrompts(trip, driverLoc, null);
      expect(prompts.filter((p) => p.type === "ARRIVE_NOW").length).toBe(0);
    });

    it("works for EN_ROUTE status alias", () => {
      const trip = makeTrip({ status: "EN_ROUTE" });
      const driverLoc = { lat: trip.pickupLat!, lng: trip.pickupLng! };
      const prompts = evaluatePrompts(trip, driverLoc, null, { geofenceMeters: 500 });
      expect(prompts.filter((p) => p.type === "ARRIVE_NOW").length).toBe(1);
    });
  });

  describe("evaluatePrompts - LATE_RISK", () => {
    it("fires when ETA exceeds scheduled pickup + grace", () => {
      const trip = makeTrip({
        status: "EN_ROUTE_TO_PICKUP",
        scheduledPickupAt: new Date(Date.now() + 5 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip, null, 30, { cooldownMin: 10, graceMin: 5 });
      expect(prompts.filter((p) => p.type === "LATE_RISK").length).toBe(1);
    });

    it("does not fire when ETA is before scheduled pickup", () => {
      const trip = makeTrip({
        status: "EN_ROUTE_TO_PICKUP",
        scheduledPickupAt: new Date(Date.now() + 60 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip, null, 5);
      expect(prompts.filter((p) => p.type === "LATE_RISK").length).toBe(0);
    });

    it("LATE_RISK is always critical priority", () => {
      const trip = makeTrip({
        status: "EN_ROUTE_TO_PICKUP",
        scheduledPickupAt: new Date(Date.now() + 5 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip, null, 30, { cooldownMin: 10, graceMin: 5 });
      const lateRisk = prompts.find((p) => p.type === "LATE_RISK");
      expect(lateRisk?.priority).toBe("critical");
    });

    it("does not fire when etaMinutes is null", () => {
      const trip = makeTrip({
        status: "EN_ROUTE_TO_PICKUP",
        scheduledPickupAt: new Date(Date.now() + 5 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip, null, null);
      expect(prompts.filter((p) => p.type === "LATE_RISK").length).toBe(0);
    });
  });

  describe("cleanOldPromptRecords", () => {
    it("removes records for trips not in active list", () => {
      acknowledgePrompt(100, "LEAVE_NOW");
      acknowledgePrompt(200, "ARRIVE_NOW");

      cleanOldPromptRecords([100]);

      const trip200 = makeTrip({
        id: 200,
        status: "ASSIGNED",
        scheduledPickupAt: new Date(Date.now() + 15 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip200, null, null);
      expect(prompts.length).toBe(1);
    });

    it("preserves records for active trips", () => {
      acknowledgePrompt(100, "LEAVE_NOW");
      cleanOldPromptRecords([100]);

      const trip = makeTrip({
        scheduledPickupAt: new Date(Date.now() + 15 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip, null, null);
      expect(prompts.filter((p) => p.type === "LEAVE_NOW").length).toBe(0);
    });
  });

  describe("multiple prompt types for same trip", () => {
    it("can fire both LEAVE_NOW and LATE_RISK simultaneously", () => {
      const trip = makeTrip({
        status: "ASSIGNED",
        scheduledPickupAt: new Date(Date.now() + 10 * 60000).toISOString(),
      });
      const prompts = evaluatePrompts(trip, null, 30, { tMinusLeaveNow: 25, cooldownMin: 10 });
      const types = prompts.map((p) => p.type);
      expect(types).toContain("LEAVE_NOW");
      expect(types).toContain("LATE_RISK");
    });
  });
});
