import { describe, it, expect } from "vitest";
import { scoreReassignCandidates } from "../lib/dispatchRoutes";
import { ONLINE_CUTOFF_MS } from "../lib/driverClassification";

function makeDriver(overrides: Partial<{
  id: number;
  firstName: string;
  lastName: string;
  publicId: string;
  phone: string;
  dispatchStatus: string;
  lastSeenAt: string | null;
  lastLat: number | null;
  lastLng: number | null;
  vehicleId: number | null;
  cityId: number;
  active: boolean;
  deletedAt: string | null;
  status: string;
}> = {}) {
  return {
    id: 1,
    firstName: "Test",
    lastName: "Driver",
    publicId: "01UCM000010",
    phone: "+15551234567",
    dispatchStatus: "available",
    lastSeenAt: new Date().toISOString(),
    lastLat: 29.7604,
    lastLng: -95.3698,
    vehicleId: 100,
    cityId: 1,
    active: true,
    deletedAt: null,
    status: "ACTIVE",
    ...overrides,
  };
}

describe("scoreReassignCandidates", () => {
  const vehicleMap = new Map<number, any>([
    [100, { id: 100, name: "Van A", licensePlate: "ABC123" }],
    [200, { id: 200, name: "Van B", licensePlate: "DEF456" }],
  ]);

  it("returns empty array when no eligible drivers", () => {
    const drivers = [
      makeDriver({ id: 1, dispatchStatus: "off" }),
      makeDriver({ id: 2, dispatchStatus: "hold" }),
      makeDriver({ id: 3, lastSeenAt: null }),
    ];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result).toEqual([]);
  });

  it("excludes drivers without vehicles", () => {
    const drivers = [
      makeDriver({ id: 1, vehicleId: null }),
    ];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result).toEqual([]);
  });

  it("excludes drivers from different city", () => {
    const drivers = [
      makeDriver({ id: 1, cityId: 2 }),
    ];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result).toEqual([]);
  });

  it("excludes stale drivers (GPS >120s)", () => {
    const stale = new Date(Date.now() - ONLINE_CUTOFF_MS - 60000).toISOString();
    const drivers = [
      makeDriver({ id: 1, lastSeenAt: stale }),
    ];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result).toEqual([]);
  });

  it("excludes inactive and deleted drivers", () => {
    const drivers = [
      makeDriver({ id: 1, active: false }),
      makeDriver({ id: 2, deletedAt: new Date().toISOString() }),
      makeDriver({ id: 3, status: "INACTIVE" }),
    ];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result).toEqual([]);
  });

  it("ranks available driver above enroute driver", () => {
    const now = new Date().toISOString();
    const drivers = [
      makeDriver({ id: 1, dispatchStatus: "enroute", lastSeenAt: now, vehicleId: 100 }),
      makeDriver({ id: 2, dispatchStatus: "available", lastSeenAt: now, vehicleId: 200 }),
    ];
    const activeTripsMap = new Map<number, any>();
    activeTripsMap.set(1, { id: 50, status: "EN_ROUTE_TO_PICKUP" });

    const result = scoreReassignCandidates(drivers, activeTripsMap, vehicleMap, 29.76, -95.37, 1);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe(2);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it("ranks driver without active trip above driver with active trip", () => {
    const now = new Date().toISOString();
    const drivers = [
      makeDriver({ id: 1, dispatchStatus: "available", lastSeenAt: now, vehicleId: 100 }),
      makeDriver({ id: 2, dispatchStatus: "available", lastSeenAt: now, vehicleId: 200 }),
    ];
    const activeTripsMap = new Map<number, any>();
    activeTripsMap.set(1, { id: 50, status: "ASSIGNED" });

    const result = scoreReassignCandidates(drivers, activeTripsMap, vehicleMap, 29.76, -95.37, 1);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe(2);
    expect(result[0].has_active_trip).toBe(false);
    expect(result[1].has_active_trip).toBe(true);
  });

  it("ranks nearer driver above farther driver (all else equal)", () => {
    const now = new Date().toISOString();
    const drivers = [
      makeDriver({ id: 1, dispatchStatus: "available", lastSeenAt: now, vehicleId: 100, lastLat: 30.0, lastLng: -95.0 }),
      makeDriver({ id: 2, dispatchStatus: "available", lastSeenAt: now, vehicleId: 200, lastLat: 29.77, lastLng: -95.37 }),
    ];

    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe(2);
    expect(result[0].distance_miles!).toBeLessThan(result[1].distance_miles!);
  });

  it("returns max 5 candidates even with more eligible drivers", () => {
    const now = new Date().toISOString();
    const drivers = [];
    for (let i = 1; i <= 8; i++) {
      drivers.push(makeDriver({
        id: i,
        publicId: `01UCM0000${10 + i}`,
        dispatchStatus: "available",
        lastSeenAt: now,
        vehicleId: 100,
      }));
    }
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result.length).toBe(5);
  });

  it("includes distance_miles in results when pickup coords available", () => {
    const now = new Date().toISOString();
    const drivers = [
      makeDriver({ id: 1, dispatchStatus: "available", lastSeenAt: now, vehicleId: 100 }),
    ];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result.length).toBe(1);
    expect(result[0].distance_miles).not.toBeNull();
    expect(typeof result[0].distance_miles).toBe("number");
  });

  it("distance_miles is null when driver has no GPS coords", () => {
    const now = new Date().toISOString();
    const drivers = [
      makeDriver({ id: 1, dispatchStatus: "available", lastSeenAt: now, vehicleId: 100, lastLat: null, lastLng: null }),
    ];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result.length).toBe(1);
    expect(result[0].distance_miles).toBeNull();
  });

  it("distance_miles is null when pickup has no coords", () => {
    const now = new Date().toISOString();
    const drivers = [
      makeDriver({ id: 1, dispatchStatus: "available", lastSeenAt: now, vehicleId: 100 }),
    ];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, null, null, 1);
    expect(result.length).toBe(1);
    expect(result[0].distance_miles).toBeNull();
  });

  it("vehicle_name is populated from vehicleMap", () => {
    const now = new Date().toISOString();
    const drivers = [
      makeDriver({ id: 1, dispatchStatus: "available", lastSeenAt: now, vehicleId: 100 }),
    ];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result[0].vehicle_name).toBe("Van A (ABC123)");
  });
});
