import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isDriverOnline,
  isDriverVisibleOnMap,
  isDriverAssignable,
  classifyDriverGroup,
  classifyDrivers,
  ONLINE_CUTOFF_MS,
} from "../lib/driverClassification";

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
    vehicleId: null,
    cityId: 1,
    active: true,
    deletedAt: null,
    status: "ACTIVE",
    ...overrides,
  };
}

describe("isDriverOnline", () => {
  it("returns true for available driver with recent lastSeenAt", () => {
    const d = makeDriver({ dispatchStatus: "available", lastSeenAt: new Date().toISOString() });
    expect(isDriverOnline(d)).toBe(true);
  });

  it("returns false for dispatch_status=off regardless of lastSeenAt", () => {
    const d = makeDriver({ dispatchStatus: "off", lastSeenAt: new Date().toISOString() });
    expect(isDriverOnline(d)).toBe(false);
  });

  it("returns false when lastSeenAt is null", () => {
    const d = makeDriver({ dispatchStatus: "available", lastSeenAt: null });
    expect(isDriverOnline(d)).toBe(false);
  });

  it("returns false when lastSeenAt is older than threshold", () => {
    const stale = new Date(Date.now() - ONLINE_CUTOFF_MS - 10000).toISOString();
    const d = makeDriver({ dispatchStatus: "available", lastSeenAt: stale });
    expect(isDriverOnline(d)).toBe(false);
  });

  it("returns true when lastSeenAt is exactly at the threshold boundary", () => {
    const d = makeDriver({ dispatchStatus: "available", lastSeenAt: new Date(Date.now() - ONLINE_CUTOFF_MS).toISOString() });
    expect(isDriverOnline(d)).toBe(true);
  });
});

describe("classifyDriverGroup", () => {
  it("classifies online + available driver as available", () => {
    const d = makeDriver({ dispatchStatus: "available" });
    expect(classifyDriverGroup(d, false)).toBe("available");
  });

  it("classifies online + enroute driver as on_trip", () => {
    const d = makeDriver({ dispatchStatus: "enroute" });
    expect(classifyDriverGroup(d, false)).toBe("on_trip");
  });

  it("classifies online + available driver WITH active trip as on_trip", () => {
    const d = makeDriver({ dispatchStatus: "available" });
    expect(classifyDriverGroup(d, true)).toBe("on_trip");
  });

  it("classifies online + hold driver as hold", () => {
    const d = makeDriver({ dispatchStatus: "hold" });
    expect(classifyDriverGroup(d, false)).toBe("hold");
  });

  it("classifies offline driver (dispatch=off) as logged_out", () => {
    const d = makeDriver({ dispatchStatus: "off" });
    expect(classifyDriverGroup(d, false)).toBe("logged_out");
  });

  it("classifies stale driver as paused when dispatch=available", () => {
    const stale = new Date(Date.now() - ONLINE_CUTOFF_MS - 10000).toISOString();
    const d = makeDriver({ dispatchStatus: "available", lastSeenAt: stale });
    expect(classifyDriverGroup(d, false)).toBe("paused");
  });

  it("classifies driver with null lastSeenAt as logged_out", () => {
    const d = makeDriver({ dispatchStatus: "available", lastSeenAt: null });
    expect(classifyDriverGroup(d, false)).toBe("logged_out");
  });
});

describe("classifyDrivers — counts match group lengths", () => {
  it("correctly separates mixed drivers into 5 groups", () => {
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - ONLINE_CUTOFF_MS - 60000).toISOString();

    const drivers = [
      makeDriver({ id: 1, dispatchStatus: "available", lastSeenAt: now }),
      makeDriver({ id: 2, dispatchStatus: "available", lastSeenAt: now }),
      makeDriver({ id: 3, dispatchStatus: "enroute", lastSeenAt: now }),
      makeDriver({ id: 4, dispatchStatus: "hold", lastSeenAt: now }),
      makeDriver({ id: 5, dispatchStatus: "off", lastSeenAt: now }),
      makeDriver({ id: 6, dispatchStatus: "available", lastSeenAt: stale }),
      makeDriver({ id: 7, dispatchStatus: "available", lastSeenAt: null }),
    ];

    const activeTripsMap = new Map<number, any>();
    activeTripsMap.set(3, { id: 100, publicId: "01UCM100", status: "EN_ROUTE_TO_PICKUP" });

    const vehicleMap = new Map<number, any>();

    const groups = classifyDrivers(drivers, activeTripsMap, vehicleMap);

    expect(groups.available.length).toBe(2);
    expect(groups.on_trip.length).toBe(1);
    expect(groups.paused.length).toBe(1);
    expect(groups.hold.length).toBe(1);
    expect(groups.logged_out.length).toBe(2);

    const total = groups.available.length + groups.on_trip.length + groups.paused.length + groups.hold.length + groups.logged_out.length;
    expect(total).toBe(drivers.length);
  });

  it("returns empty groups when no drivers", () => {
    const groups = classifyDrivers([], new Map(), new Map());
    expect(groups.available).toEqual([]);
    expect(groups.on_trip).toEqual([]);
    expect(groups.paused).toEqual([]);
    expect(groups.hold).toEqual([]);
    expect(groups.logged_out).toEqual([]);
  });
});

describe("isDriverVisibleOnMap — logged_out never appears", () => {
  it("excludes dispatch_status=off", () => {
    const d = makeDriver({ dispatchStatus: "off" });
    expect(isDriverVisibleOnMap(d)).toBe(false);
  });

  it("excludes stale drivers", () => {
    const stale = new Date(Date.now() - ONLINE_CUTOFF_MS - 10000).toISOString();
    const d = makeDriver({ dispatchStatus: "available", lastSeenAt: stale });
    expect(isDriverVisibleOnMap(d)).toBe(false);
  });

  it("excludes drivers with no GPS coords", () => {
    const d = makeDriver({ dispatchStatus: "available", lastLat: null, lastLng: null });
    expect(isDriverVisibleOnMap(d)).toBe(false);
  });

  it("includes online driver with GPS coords", () => {
    const d = makeDriver({ dispatchStatus: "available" });
    expect(isDriverVisibleOnMap(d)).toBe(true);
  });

  it("includes enroute driver with GPS", () => {
    const d = makeDriver({ dispatchStatus: "enroute" });
    expect(isDriverVisibleOnMap(d)).toBe(true);
  });

  it("includes hold driver with GPS (still shows on map while online)", () => {
    const d = makeDriver({ dispatchStatus: "hold" });
    expect(isDriverVisibleOnMap(d)).toBe(true);
  });

  it("logged_out drivers NEVER visible on map", () => {
    const stale = new Date(Date.now() - ONLINE_CUTOFF_MS - 60000).toISOString();
    const offDrivers = [
      makeDriver({ id: 1, dispatchStatus: "off" }),
      makeDriver({ id: 2, dispatchStatus: "available", lastSeenAt: stale }),
      makeDriver({ id: 3, dispatchStatus: "available", lastSeenAt: null }),
    ];
    for (const d of offDrivers) {
      expect(isDriverVisibleOnMap(d)).toBe(false);
    }
  });
});

describe("isDriverAssignable — rejects logged_out/hold/stale", () => {
  it("accepts available + online driver", () => {
    const d = makeDriver({ dispatchStatus: "available" });
    const result = isDriverAssignable(d);
    expect(result.ok).toBe(true);
  });

  it("accepts enroute + online driver", () => {
    const d = makeDriver({ dispatchStatus: "enroute" });
    const result = isDriverAssignable(d);
    expect(result.ok).toBe(true);
  });

  it("rejects dispatch_status=off", () => {
    const d = makeDriver({ dispatchStatus: "off" });
    const result = isDriverAssignable(d);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("logged out");
  });

  it("rejects dispatch_status=hold", () => {
    const d = makeDriver({ dispatchStatus: "hold" });
    const result = isDriverAssignable(d);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("hold");
  });

  it("allows paused driver with warning (old lastSeenAt)", () => {
    const stale = new Date(Date.now() - ONLINE_CUTOFF_MS - 60000).toISOString();
    const d = makeDriver({ dispatchStatus: "available", lastSeenAt: stale });
    const result = isDriverAssignable(d);
    expect(result.ok).toBe(true);
    expect(result.warning).toContain("paused");
  });

  it("rejects driver with no lastSeenAt (never checked in)", () => {
    const d = makeDriver({ dispatchStatus: "available", lastSeenAt: null });
    const result = isDriverAssignable(d);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("never checked in");
  });

  it("logged_out and hold drivers NEVER assignable", () => {
    const offDrivers = [
      makeDriver({ id: 1, dispatchStatus: "off" }),
      makeDriver({ id: 2, dispatchStatus: "hold" }),
      makeDriver({ id: 3, dispatchStatus: "available", lastSeenAt: null }),
    ];
    for (const d of offDrivers) {
      expect(isDriverAssignable(d).ok).toBe(false);
    }
  });
});

describe("available drivers list — only includes AVAILABLE group", () => {
  it("classifyDrivers available group only contains available+online drivers", () => {
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - ONLINE_CUTOFF_MS - 60000).toISOString();

    const drivers = [
      makeDriver({ id: 1, dispatchStatus: "available", lastSeenAt: now }),
      makeDriver({ id: 2, dispatchStatus: "enroute", lastSeenAt: now }),
      makeDriver({ id: 3, dispatchStatus: "hold", lastSeenAt: now }),
      makeDriver({ id: 4, dispatchStatus: "off", lastSeenAt: now }),
      makeDriver({ id: 5, dispatchStatus: "available", lastSeenAt: stale }),
    ];

    const groups = classifyDrivers(drivers, new Map(), new Map());

    expect(groups.available.length).toBe(1);
    expect(groups.available[0].id).toBe(1);
    expect(groups.available.every(d => d.dispatch_status === "available" && d.is_online)).toBe(true);

    for (const d of groups.logged_out) {
      expect(isDriverAssignable({ dispatchStatus: d.dispatch_status, lastSeenAt: d.last_seen_at }).ok).toBe(false);
    }
  });
});
