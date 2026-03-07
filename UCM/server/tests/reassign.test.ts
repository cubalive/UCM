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

const vehicleMap = new Map<number, any>([
  [100, { id: 100, name: "Van A", licensePlate: "ABC123" }],
  [200, { id: 200, name: "Van B", licensePlate: "DEF456" }],
  [300, { id: 300, name: "Van C", licensePlate: "GHI789" }],
]);

describe("scoreReassignCandidates – eligibility filters", () => {
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
    const result = scoreReassignCandidates(
      [makeDriver({ id: 1, vehicleId: null })],
      new Map(), vehicleMap, 29.76, -95.37, 1,
    );
    expect(result).toEqual([]);
  });

  it("excludes drivers from different city", () => {
    const result = scoreReassignCandidates(
      [makeDriver({ id: 1, cityId: 2 })],
      new Map(), vehicleMap, 29.76, -95.37, 1,
    );
    expect(result).toEqual([]);
  });

  it("excludes stale drivers (GPS >120s)", () => {
    const stale = new Date(Date.now() - ONLINE_CUTOFF_MS - 60000).toISOString();
    const result = scoreReassignCandidates(
      [makeDriver({ id: 1, lastSeenAt: stale })],
      new Map(), vehicleMap, 29.76, -95.37, 1,
    );
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
});

describe("scoreReassignCandidates – proximity_score", () => {
  it("proximity_score = 1.0 for driver at pickup location (0 mi)", () => {
    const now = new Date().toISOString();
    const drivers = [makeDriver({ id: 1, lastSeenAt: now, lastLat: 29.76, lastLng: -95.37, vehicleId: 100 })];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result[0].proximity_score).toBeCloseTo(1.0, 1);
  });

  it("proximity_score = 0 for driver >=10 miles away", () => {
    const now = new Date().toISOString();
    const drivers = [makeDriver({ id: 1, lastSeenAt: now, lastLat: 30.0, lastLng: -95.37, vehicleId: 100 })];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result[0].distance_miles!).toBeGreaterThanOrEqual(10);
    expect(result[0].proximity_score).toBe(0);
  });

  it("proximity_score = 0.4 (neutral) when driver has no GPS coords", () => {
    const now = new Date().toISOString();
    const drivers = [makeDriver({ id: 1, lastSeenAt: now, lastLat: null, lastLng: null, vehicleId: 100 })];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result[0].proximity_score).toBe(0.4);
    expect(result[0].distance_miles).toBeNull();
  });

  it("proximity_score = 0.4 (neutral) when pickup has no coords", () => {
    const now = new Date().toISOString();
    const drivers = [makeDriver({ id: 1, lastSeenAt: now, vehicleId: 100 })];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, null, null, 1);
    expect(result[0].proximity_score).toBe(0.4);
    expect(result[0].distance_miles).toBeNull();
  });

  it("closer driver has higher proximity_score", () => {
    const now = new Date().toISOString();
    const drivers = [
      makeDriver({ id: 1, lastSeenAt: now, lastLat: 29.80, lastLng: -95.37, vehicleId: 100 }),
      makeDriver({ id: 2, publicId: "01UCM000011", lastSeenAt: now, lastLat: 29.77, lastLng: -95.37, vehicleId: 200 }),
    ];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    const d1 = result.find(c => c.id === 1)!;
    const d2 = result.find(c => c.id === 2)!;
    expect(d2.proximity_score).toBeGreaterThan(d1.proximity_score);
  });
});

describe("scoreReassignCandidates – load_score", () => {
  it("load_score = 0.0 for driver with active trip", () => {
    const now = new Date().toISOString();
    const drivers = [makeDriver({ id: 1, lastSeenAt: now, vehicleId: 100 })];
    const activeTripsMap = new Map<number, any>([[1, { id: 50, status: "EN_ROUTE_TO_PICKUP" }]]);
    const result = scoreReassignCandidates(drivers, activeTripsMap, vehicleMap, 29.76, -95.37, 1);
    expect(result[0].load_score).toBe(0);
    expect(result[0].has_active_trip).toBe(true);
  });

  it("load_score = 1.0 for driver with no active trip and no upcoming trips", () => {
    const now = new Date().toISOString();
    const drivers = [makeDriver({ id: 1, lastSeenAt: now, vehicleId: 100 })];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result[0].load_score).toBe(1);
    expect(result[0].has_active_trip).toBe(false);
  });

  it("load_score between 0.2 and 0.6 for driver with upcoming trips in 2h", () => {
    const now = new Date().toISOString();
    const drivers = [makeDriver({ id: 1, lastSeenAt: now, vehicleId: 100 })];
    const upcoming = new Map<number, number>([[1, 2]]);
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1, upcoming);
    expect(result[0].load_score).toBeGreaterThanOrEqual(0.2);
    expect(result[0].load_score).toBeLessThanOrEqual(0.6);
  });

  it("load_score = 0.6 for driver with exactly 1 upcoming trip", () => {
    const now = new Date().toISOString();
    const drivers = [makeDriver({ id: 1, lastSeenAt: now, vehicleId: 100 })];
    const upcoming = new Map<number, number>([[1, 1]]);
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1, upcoming);
    expect(result[0].load_score).toBe(0.6);
  });

  it("load_score floors at 0.2 for driver with many upcoming trips", () => {
    const now = new Date().toISOString();
    const drivers = [makeDriver({ id: 1, lastSeenAt: now, vehicleId: 100 })];
    const upcoming = new Map<number, number>([[1, 10]]);
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1, upcoming);
    expect(result[0].load_score).toBe(0.2);
  });
});

describe("scoreReassignCandidates – combined 50/50 scoring", () => {
  it("score = 0.5 * proximity + 0.5 * load", () => {
    const now = new Date().toISOString();
    const drivers = [makeDriver({ id: 1, lastSeenAt: now, lastLat: 29.76, lastLng: -95.37, vehicleId: 100 })];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result[0].proximity_score).toBeCloseTo(1.0, 1);
    expect(result[0].load_score).toBe(1.0);
    expect(result[0].score).toBeCloseTo(0.5 * result[0].proximity_score + 0.5 * result[0].load_score, 2);
  });

  it("VERIFY: picks closer driver when both have low load (free)", () => {
    const now = new Date().toISOString();
    const farDriver = makeDriver({ id: 1, lastSeenAt: now, lastLat: 29.85, lastLng: -95.50, vehicleId: 100 });
    const nearDriver = makeDriver({ id: 2, publicId: "01UCM000011", lastSeenAt: now, lastLat: 29.761, lastLng: -95.371, vehicleId: 200 });
    const result = scoreReassignCandidates([farDriver, nearDriver], new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result[0].id).toBe(2);
    expect(result[0].proximity_score).toBeGreaterThan(result[1].proximity_score);
    expect(result[0].load_score).toBe(result[1].load_score);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it("VERIFY: picks free driver when one is busy (active trip)", () => {
    const now = new Date().toISOString();
    const busyDriver = makeDriver({ id: 1, lastSeenAt: now, lastLat: 29.761, lastLng: -95.371, vehicleId: 100 });
    const freeDriver = makeDriver({ id: 2, publicId: "01UCM000011", lastSeenAt: now, lastLat: 29.80, lastLng: -95.40, vehicleId: 200 });
    const activeTripsMap = new Map<number, any>([[1, { id: 50, status: "EN_ROUTE_TO_PICKUP" }]]);
    const result = scoreReassignCandidates([busyDriver, freeDriver], activeTripsMap, vehicleMap, 29.76, -95.37, 1);
    expect(result[0].id).toBe(2);
    expect(result[0].has_active_trip).toBe(false);
    expect(result[0].load_score).toBe(1.0);
    expect(result[1].load_score).toBe(0.0);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it("heavy-loaded close driver beaten by free far driver", () => {
    const now = new Date().toISOString();
    const closeLoadedDriver = makeDriver({ id: 1, lastSeenAt: now, lastLat: 29.761, lastLng: -95.371, vehicleId: 100 });
    const farFreeDriver = makeDriver({ id: 2, publicId: "01UCM000011", lastSeenAt: now, lastLat: 29.82, lastLng: -95.42, vehicleId: 200 });
    const activeTripsMap = new Map<number, any>([[1, { id: 50, status: "ASSIGNED" }]]);
    const result = scoreReassignCandidates([closeLoadedDriver, farFreeDriver], activeTripsMap, vehicleMap, 29.76, -95.37, 1);
    expect(result[0].id).toBe(2);
  });
});

describe("scoreReassignCandidates – tie-breakers", () => {
  it("tie-break: prefers dispatch_status=available over enroute at equal score", () => {
    const now = new Date().toISOString();
    const enrouteDriver = makeDriver({ id: 1, dispatchStatus: "enroute", lastSeenAt: now, lastLat: 29.761, lastLng: -95.371, vehicleId: 100 });
    const availableDriver = makeDriver({ id: 2, publicId: "01UCM000011", dispatchStatus: "available", lastSeenAt: now, lastLat: 29.761, lastLng: -95.371, vehicleId: 200 });
    const result = scoreReassignCandidates([enrouteDriver, availableDriver], new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result[0].score).toBe(result[1].score);
    expect(result[0].id).toBe(2);
    expect(result[0].dispatch_status).toBe("available");
  });

  it("tie-break: prefers more recently seen driver when scores and status equal", () => {
    const older = new Date(Date.now() - 30000).toISOString();
    const newer = new Date().toISOString();
    const oldDriver = makeDriver({ id: 1, lastSeenAt: older, lastLat: 29.761, lastLng: -95.371, vehicleId: 100 });
    const newDriver = makeDriver({ id: 2, publicId: "01UCM000011", lastSeenAt: newer, lastLat: 29.761, lastLng: -95.371, vehicleId: 200 });
    const result = scoreReassignCandidates([oldDriver, newDriver], new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result[0].score).toBe(result[1].score);
    expect(result[0].id).toBe(2);
  });
});

describe("scoreReassignCandidates – output fields", () => {
  it("vehicle_name is populated from vehicleMap", () => {
    const now = new Date().toISOString();
    const drivers = [makeDriver({ id: 1, lastSeenAt: now, vehicleId: 100 })];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result[0].vehicle_name).toBe("Van A (ABC123)");
  });

  it("assigned_trips_2h is populated from upcoming map", () => {
    const now = new Date().toISOString();
    const drivers = [makeDriver({ id: 1, lastSeenAt: now, vehicleId: 100 })];
    const upcoming = new Map<number, number>([[1, 3]]);
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1, upcoming);
    expect(result[0].assigned_trips_2h).toBe(3);
  });

  it("all score components are present in output", () => {
    const now = new Date().toISOString();
    const drivers = [makeDriver({ id: 1, lastSeenAt: now, vehicleId: 100 })];
    const result = scoreReassignCandidates(drivers, new Map(), vehicleMap, 29.76, -95.37, 1);
    expect(result[0]).toHaveProperty("proximity_score");
    expect(result[0]).toHaveProperty("load_score");
    expect(result[0]).toHaveProperty("score");
    expect(result[0]).toHaveProperty("assigned_trips_2h");
    expect(result[0]).toHaveProperty("has_active_trip");
  });
});
