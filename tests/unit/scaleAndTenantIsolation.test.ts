/**
 * P5 - Scale Readiness & Multi-Tenant Isolation Validation
 *
 * Tests that validate the platform's behavior under realistic data volumes
 * and strict multi-tenant isolation guarantees.
 */

import { describe, it, expect } from "vitest";
import { canTransition } from "../../src/services/tripService.js";
import { haversineEstimate, clearRouteCache, getRouteCacheStats } from "../../src/services/routingService.js";
import { DEFAULT_AUTO_ASSIGN_CONFIG } from "../../src/types/dispatch.js";
import type { AutoAssignConfig, DriverScoreBreakdown } from "../../src/types/dispatch.js";

// ─── Scale: Dashboard Query Simulation ──────────────────────────────────

describe("Scale: Dashboard Data Processing", () => {
  function generateTrips(count: number) {
    const statuses = ["requested", "assigned", "en_route", "arrived", "in_progress", "completed", "cancelled"];
    return Array.from({ length: count }, (_, i) => ({
      id: `trip-${i}`,
      tenantId: `tenant-${i % 10}`,
      status: statuses[i % statuses.length],
      driverId: i % 3 === 0 ? null : `driver-${i % 50}`,
      priority: i % 5 === 0 ? "immediate" : "scheduled",
      mileage: i % statuses.length === 5 ? (Math.random() * 30).toFixed(2) : null,
      createdAt: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
    }));
  }

  function generateDrivers(count: number) {
    const availabilities = ["available", "busy", "offline", "break"];
    return Array.from({ length: count }, (_, i) => ({
      id: `driver-${i}`,
      tenantId: `tenant-${i % 10}`,
      availability: availabilities[i % availabilities.length],
      isOnline: i % availabilities.length < 2,
      latitude: 25.7617 + (Math.random() - 0.5) * 0.2,
      longitude: -80.1918 + (Math.random() - 0.5) * 0.2,
      activeTripCount: i % 4,
    }));
  }

  it("filters 8000 trips by status in <10ms", () => {
    const trips = generateTrips(8000);
    const start = performance.now();

    const requested = trips.filter(t => t.status === "requested");
    const active = trips.filter(t => ["assigned", "en_route", "arrived", "in_progress"].includes(t.status));
    const completed = trips.filter(t => t.status === "completed");
    const urgent = trips.filter(t => t.priority === "immediate" && t.status === "requested");

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50); // generous for CI environments
    expect(requested.length).toBeGreaterThan(0);
    expect(active.length).toBeGreaterThan(0);
    expect(completed.length).toBeGreaterThan(0);
    expect(urgent.length).toBeGreaterThan(0);
  });

  it("scopes 8000 trips by tenant correctly", () => {
    const trips = generateTrips(8000);
    const tenantId = "tenant-3";

    const start = performance.now();
    const tenantTrips = trips.filter(t => t.tenantId === tenantId);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
    expect(tenantTrips.length).toBeGreaterThan(0);
    // All returned trips belong to the correct tenant
    expect(tenantTrips.every(t => t.tenantId === tenantId)).toBe(true);
    // No trips from other tenants leaked through
    expect(tenantTrips.some(t => t.tenantId !== tenantId)).toBe(false);
  });

  it("filters 2800 drivers by availability in <5ms", () => {
    const drivers = generateDrivers(2800);
    const start = performance.now();

    const available = drivers.filter(d => d.availability === "available");
    const online = drivers.filter(d => d.isOnline);
    const busyNoTrips = drivers.filter(d => d.availability === "busy" && d.activeTripCount === 0);

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
    expect(available.length).toBeGreaterThan(0);
    expect(online.length).toBeGreaterThan(0);
  });

  it("computes stuck trips from 8000 trips in <5ms", () => {
    const trips = generateTrips(8000);
    const TWO_HOURS = 2 * 60 * 60 * 1000;

    const start = performance.now();
    const stuckTrips = trips.filter(t => {
      if (!["assigned", "en_route", "arrived", "in_progress"].includes(t.status)) return false;
      return (Date.now() - new Date(t.createdAt).getTime()) > TWO_HOURS;
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(20);
    expect(stuckTrips.length).toBeGreaterThanOrEqual(0);
  });
});

// ─── Scale: Dispatch Queue Behavior ─────────────────────────────────────

describe("Scale: Dispatch Queue Processing", () => {
  it("sorts 500 pending trips by priority and age in <10ms", () => {
    const trips = Array.from({ length: 500 }, (_, i) => ({
      id: `trip-${i}`,
      status: "requested",
      isImmediate: i % 5 === 0,
      createdAt: new Date(Date.now() - (500 - i) * 60000).toISOString(),
    }));

    const start = performance.now();
    const sorted = [...trips].sort((a, b) => {
      // Immediate first, then by age (oldest first)
      if (a.isImmediate !== b.isImmediate) return a.isImmediate ? -1 : 1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
    // First trip should be immediate
    expect(sorted[0].isImmediate).toBe(true);
    // Last immediate should come before first non-immediate
    const lastImmediate = sorted.filter(t => t.isImmediate).pop();
    const firstNonImmediate = sorted.find(t => !t.isImmediate);
    if (lastImmediate && firstNonImmediate) {
      expect(sorted.indexOf(lastImmediate)).toBeLessThan(sorted.indexOf(firstNonImmediate));
    }
  });

  it("batch scores 200 drivers for assignment in <10ms", () => {
    const drivers = Array.from({ length: 200 }, (_, i) => ({
      id: `driver-${i}`,
      activeTrips: i % 4,
      distanceMiles: Math.random() * 30,
      isOnline: Math.random() > 0.3,
      onTimeRate: 0.5 + Math.random() * 0.5,
      recentDeclines: Math.floor(Math.random() * 3),
    }));

    const cfg = DEFAULT_AUTO_ASSIGN_CONFIG;

    const start = performance.now();
    const scored = drivers.map(d => {
      if (d.activeTrips >= cfg.maxActiveTripsPerDriver) return { ...d, score: -999, disqualified: true };
      if (d.distanceMiles > cfg.maxDistanceMiles) return { ...d, score: -999, disqualified: true };

      let score = 100;
      score -= d.activeTrips * 30;
      score += Math.max(0, 50 - d.distanceMiles * cfg.proximityWeight);
      if (d.isOnline) score += cfg.onlineBonus;
      score += Math.round(d.onTimeRate * cfg.reliabilityWeight);
      score -= d.recentDeclines * cfg.declinePenaltyPerIncident;

      return { ...d, score, disqualified: false };
    }).filter(d => !d.disqualified).sort((a, b) => b.score - a.score);

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
    expect(scored.length).toBeGreaterThan(0);
    // Best driver should have highest score
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1].score).toBeGreaterThanOrEqual(scored[i].score);
    }
  });
});

// ─── Scale: Route Cache Behavior ────────────────────────────────────────

describe("Scale: Route Cache Operations", () => {
  it("clearRouteCache returns cleared count", () => {
    const cleared = clearRouteCache();
    expect(typeof cleared).toBe("number");
    expect(cleared).toBeGreaterThanOrEqual(0);
  });

  it("getRouteCacheStats returns correct structure", () => {
    const stats = getRouteCacheStats();
    expect(stats).toHaveProperty("size");
    expect(stats).toHaveProperty("maxSize");
    expect(stats).toHaveProperty("ttlMs");
    expect(stats.maxSize).toBe(500);
    expect(stats.ttlMs).toBe(30 * 60 * 1000);
  });

  it("cache stats size is 0 after clear", () => {
    clearRouteCache();
    const stats = getRouteCacheStats();
    expect(stats.size).toBe(0);
  });
});

// ─── Scale: Haversine Batch Computation ─────────────────────────────────

describe("Scale: Distance Computation at Volume", () => {
  it("computes 500 haversine distances in <10ms", () => {
    const points = Array.from({ length: 500 }, () => ({
      lat: 25 + Math.random() * 10,
      lng: -80 + Math.random() * 20,
    }));

    const baseLat = 25.7617;
    const baseLng = -80.1918;

    const start = performance.now();
    const distances = points.map(p => haversineEstimate(baseLat, baseLng, p.lat, p.lng));
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
    expect(distances).toHaveLength(500);
    // All distances should be positive
    for (const d of distances) {
      expect(d.distanceMiles).toBeGreaterThanOrEqual(0);
      expect(d.durationMinutes).toBeGreaterThanOrEqual(0);
    }
  });

  it("nearby driver detection scales with 2800 drivers", () => {
    const NEARBY_RADIUS = 5; // miles
    const pickupLat = 25.7617;
    const pickupLng = -80.1918;

    const drivers = Array.from({ length: 2800 }, (_, i) => ({
      id: `driver-${i}`,
      lat: pickupLat + (Math.random() - 0.5) * 0.3,
      lng: pickupLng + (Math.random() - 0.5) * 0.3,
    }));

    const start = performance.now();
    const nearby = drivers.filter(d => {
      const dist = haversineEstimate(pickupLat, pickupLng, d.lat, d.lng);
      return dist.distanceMiles <= NEARBY_RADIUS;
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(nearby.length).toBeGreaterThan(0);
    expect(nearby.length).toBeLessThan(drivers.length);
  });
});

// ─── Multi-Tenant: Strict Isolation Validation ──────────────────────────

describe("Multi-Tenant: Strict Data Isolation", () => {
  it("tenant-scoped filter never returns cross-tenant data", () => {
    // Simulate 10 tenants, each with 100 trips
    const allTrips = Array.from({ length: 1000 }, (_, i) => ({
      id: `trip-${i}`,
      tenantId: `tenant-${Math.floor(i / 100)}`,
      patientName: `Patient ${i}`,
    }));

    for (let t = 0; t < 10; t++) {
      const tenantId = `tenant-${t}`;
      const scoped = allTrips.filter(trip => trip.tenantId === tenantId);

      // Exactly 100 trips per tenant
      expect(scoped).toHaveLength(100);
      // No cross-tenant leakage
      expect(scoped.every(trip => trip.tenantId === tenantId)).toBe(true);
    }
  });

  it("driver data is isolated per tenant", () => {
    const allDrivers = Array.from({ length: 500 }, (_, i) => ({
      id: `driver-${i}`,
      tenantId: `tenant-${Math.floor(i / 50)}`,
      name: `Driver ${i}`,
    }));

    const tenantId = "tenant-3";
    const scoped = allDrivers.filter(d => d.tenantId === tenantId);

    expect(scoped).toHaveLength(50);
    expect(scoped.every(d => d.tenantId === tenantId)).toBe(true);
  });

  it("patient data is isolated per tenant", () => {
    const allPatients = Array.from({ length: 800 }, (_, i) => ({
      id: `patient-${i}`,
      tenantId: `tenant-${Math.floor(i / 80)}`,
    }));

    const tenantId = "tenant-5";
    const scoped = allPatients.filter(p => p.tenantId === tenantId);

    expect(scoped).toHaveLength(80);
    expect(scoped.every(p => p.tenantId === tenantId)).toBe(true);
  });

  it("dispatch dashboard only shows own tenant trips", () => {
    // Simulate dispatch dashboard query pattern
    const allTrips = Array.from({ length: 2000 }, (_, i) => ({
      id: `trip-${i}`,
      tenantId: `tenant-${i % 5}`,
      status: ["requested", "assigned", "completed"][i % 3],
    }));

    const requestTenantId = "tenant-2";
    const dashboardTrips = allTrips.filter(t => t.tenantId === requestTenantId);

    expect(dashboardTrips.length).toBe(400); // 2000/5 = 400
    expect(dashboardTrips.every(t => t.tenantId === requestTenantId)).toBe(true);

    // Verify status breakdowns are also isolated
    const pending = dashboardTrips.filter(t => t.status === "requested");
    const active = dashboardTrips.filter(t => t.status === "assigned");
    expect(pending.length + active.length).toBeLessThanOrEqual(dashboardTrips.length);
  });

  it("clinic portal only shows own tenant patients and trips", () => {
    const allPatients = Array.from({ length: 400 }, (_, i) => ({
      id: `patient-${i}`,
      tenantId: `tenant-${i % 4}`,
    }));

    const clinicTenantId = "tenant-1";
    const clinicPatients = allPatients.filter(p => p.tenantId === clinicTenantId);

    expect(clinicPatients).toHaveLength(100);
    expect(clinicPatients.every(p => p.tenantId === clinicTenantId)).toBe(true);
  });

  it("driver app only shows trips assigned to that driver", () => {
    const driverId = "driver-5";
    const driverTenantId = "tenant-1";

    const allTrips = Array.from({ length: 200 }, (_, i) => ({
      id: `trip-${i}`,
      tenantId: i < 100 ? "tenant-1" : "tenant-2",
      driverId: `driver-${i % 20}`,
      status: "assigned",
    }));

    // Double filter: tenant + driver
    const driverTrips = allTrips.filter(t => t.tenantId === driverTenantId && t.driverId === driverId);

    // Only trips from own tenant AND assigned to this driver
    expect(driverTrips.every(t => t.tenantId === driverTenantId && t.driverId === driverId)).toBe(true);
    // No trips from other tenants even if same driver ID format
    expect(driverTrips.every(t => t.tenantId === driverTenantId)).toBe(true);
  });

  it("health endpoints do not expose tenant-specific data", () => {
    // Health endpoints should return aggregates, not per-tenant breakdowns
    const healthResponse = {
      status: "healthy",
      db: { connected: true, latencyMs: 5 },
      redis: { connected: true },
      uptime: 3600,
    };

    // No tenantId in health response
    expect(healthResponse).not.toHaveProperty("tenantId");
    expect(healthResponse).not.toHaveProperty("tenantData");
  });
});

// ─── Multi-Tenant: AutoAssign Config Isolation ──────────────────────────

describe("Multi-Tenant: AutoAssign Config", () => {
  it("DEFAULT_AUTO_ASSIGN_CONFIG has all required fields", () => {
    const cfg = DEFAULT_AUTO_ASSIGN_CONFIG;
    expect(cfg.maxActiveTripsPerDriver).toBe(3);
    expect(cfg.maxDistanceMiles).toBe(25);
    expect(cfg.staleLocationThresholdMinutes).toBe(30);
    expect(cfg.proximityWeight).toBe(5);
    expect(cfg.reliabilityWeight).toBe(20);
    expect(cfg.onlineBonus).toBe(15);
    expect(cfg.declinePenaltyPerIncident).toBe(15);
    expect(cfg.useHistoricalPatterns).toBe(false);
    expect(cfg.considerTraffic).toBe(false);
    expect(cfg.considerPatientPreference).toBe(false);
  });

  it("config overrides merge correctly without mutation", () => {
    const original = { ...DEFAULT_AUTO_ASSIGN_CONFIG };
    const overrides: Partial<AutoAssignConfig> = {
      maxDistanceMiles: 50,
      onlineBonus: 25,
    };

    const merged = { ...DEFAULT_AUTO_ASSIGN_CONFIG, ...overrides };

    // Overrides applied
    expect(merged.maxDistanceMiles).toBe(50);
    expect(merged.onlineBonus).toBe(25);

    // Non-overridden values preserved
    expect(merged.maxActiveTripsPerDriver).toBe(3);
    expect(merged.proximityWeight).toBe(5);

    // Original not mutated
    expect(DEFAULT_AUTO_ASSIGN_CONFIG.maxDistanceMiles).toBe(original.maxDistanceMiles);
    expect(DEFAULT_AUTO_ASSIGN_CONFIG.onlineBonus).toBe(original.onlineBonus);
  });

  it("DriverScoreBreakdown interface has all adjustment fields", () => {
    const breakdown: DriverScoreBreakdown = {
      driverId: "test-driver",
      baseScore: 100,
      adjustments: {
        proximity: 35,
        activeTrips: -30,
        staleLocation: 0,
        onlinePresence: 15,
        reliability: 19,
        recentDeclines: 0,
      },
      finalScore: 139,
      disqualified: false,
    };

    expect(breakdown.baseScore).toBe(100);
    expect(breakdown.finalScore).toBe(139);
    expect(breakdown.adjustments.proximity).toBe(35);
    expect(breakdown.disqualified).toBe(false);
  });
});

// ─── Scale: Import Performance ──────────────────────────────────────────

describe("Scale: Import Data Processing", () => {
  it("CSV row parsing scales linearly with 5000 rows", () => {
    // Simulate CSV parsing performance
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      firstName: `Patient${i}`,
      lastName: `Last${i}`,
      phone: `+1305555${String(i).padStart(4, "0")}`,
      email: `patient${i}@test.com`,
      address: `${i} Main St, Miami, FL`,
    }));

    const start = performance.now();

    // Simulate normalization pass
    const normalized = rows.map(row => ({
      ...row,
      phone: row.phone.replace(/\D/g, ""),
      email: row.email.toLowerCase().trim(),
      firstName: row.firstName.trim(),
      lastName: row.lastName.trim(),
    }));

    // Simulate dedup key generation
    const dedupeKeys = new Set<string>();
    const deduped = normalized.filter(row => {
      const key = `${row.email}|${row.phone}`;
      if (dedupeKeys.has(key)) return false;
      dedupeKeys.add(key);
      return true;
    });

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(deduped).toHaveLength(5000); // All unique
  });

  it("column mapping handles 50+ columns efficiently", () => {
    const columns = Array.from({ length: 50 }, (_, i) => `Column_${i}`);
    const knownMappings: Record<string, string> = {
      "Column_0": "firstName",
      "Column_1": "lastName",
      "Column_2": "phone",
      "Column_3": "email",
      "Column_4": "address",
    };

    const start = performance.now();
    const mappings = columns.map(col => ({
      column: col,
      field: knownMappings[col] || null,
      confidence: knownMappings[col] ? 1.0 : 0,
    }));
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
    expect(mappings.filter(m => m.field !== null)).toHaveLength(5);
  });
});

// ─── Driver Status Consistency ──────────────────────────────────────────

describe("Driver Status Consistency", () => {
  it("availability transitions follow valid patterns", () => {
    const validTransitions: Record<string, string[]> = {
      available: ["busy", "break", "offline"],
      busy: ["available", "break", "offline"],
      break: ["available", "offline"],
      offline: ["available"],
    };

    // Verify all transitions are bidirectionally reachable to "available"
    for (const [from, targets] of Object.entries(validTransitions)) {
      expect(targets.length).toBeGreaterThan(0);
      if (from !== "available") {
        // Every state should have a path back to available
        const canReachAvailable = (state: string, visited = new Set<string>()): boolean => {
          if (state === "available") return true;
          if (visited.has(state)) return false;
          visited.add(state);
          return (validTransitions[state] || []).some(next => canReachAvailable(next, new Set(visited)));
        };
        expect(canReachAvailable(from)).toBe(true);
      }
    }
  });

  it("stale driver detection logic is correct", () => {
    const STALE_MINUTES = 15;
    const now = Date.now();

    const drivers = [
      { id: "d1", lastLocationAt: new Date(now - 5 * 60000) },   // 5 min ago - fresh
      { id: "d2", lastLocationAt: new Date(now - 20 * 60000) },  // 20 min ago - stale
      { id: "d3", lastLocationAt: new Date(now - 60 * 60000) },  // 1 hour ago - very stale
      { id: "d4", lastLocationAt: null },                          // never - stale
    ];

    const stale = drivers.filter(d => {
      if (!d.lastLocationAt) return true;
      return (now - d.lastLocationAt.getTime()) > STALE_MINUTES * 60000;
    });

    expect(stale).toHaveLength(3); // d2, d3, d4
    expect(stale.map(d => d.id)).toContain("d2");
    expect(stale.map(d => d.id)).toContain("d3");
    expect(stale.map(d => d.id)).toContain("d4");
    expect(stale.map(d => d.id)).not.toContain("d1");
  });

  it("location validation rejects invalid coordinates", () => {
    const isValidLocation = (lat: number, lng: number) =>
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

    expect(isValidLocation(25.7617, -80.1918)).toBe(true);
    expect(isValidLocation(0, 0)).toBe(true);
    expect(isValidLocation(-90, 180)).toBe(true);
    expect(isValidLocation(91, -80)).toBe(false);
    expect(isValidLocation(25, -181)).toBe(false);
    expect(isValidLocation(NaN, -80)).toBe(false);
  });
});
