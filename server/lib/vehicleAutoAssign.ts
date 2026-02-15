import { storage } from "../storage";
import type { CitySettings, City } from "@shared/schema";
import { getScheduledDriverIdsForDay } from "./scheduleRoutes";
import { isDriverOnline } from "./driverClassification";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function getCityLocalDate(timezone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}

function getCityLocalDayName(timezone: string): string {
  const dow = new Date().toLocaleDateString("en-US", { timeZone: timezone, weekday: "short" });
  return dow.substring(0, 3);
}

function getCityLocalTime(timezone: string): string {
  return new Date().toLocaleTimeString("en-US", { timeZone: timezone, hour12: false, hour: "2-digit", minute: "2-digit" });
}

function getYesterdayDate(timezone: string): string {
  const now = new Date();
  const cityNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  cityNow.setDate(cityNow.getDate() - 1);
  const y = cityNow.getFullYear();
  const m = String(cityNow.getMonth() + 1).padStart(2, "0");
  const d = String(cityNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function runVehicleAutoAssignForCity(city: City, settings: CitySettings): Promise<{ assigned: number; skipped: number; reused: number; noSchedule?: boolean; tripsAssigned?: number; tripsIssues?: number }> {
  const timezone = city.timezone || "America/New_York";
  const today = getCityLocalDate(timezone);
  const yesterday = getYesterdayDate(timezone);

  const scheduledDriverIds = await getScheduledDriverIdsForDay(city.id, today);
  const allDrivers = (await storage.getDrivers(city.id)).filter(d => d.status === "ACTIVE");
  const activeVehicles = (await storage.getVehicles(city.id)).filter(v => v.status === "ACTIVE");

  if (scheduledDriverIds.size === 0) {
    return { assigned: 0, skipped: 0, reused: 0, noSchedule: true };
  }

  const activeDrivers = allDrivers.filter(d => {
    if (!scheduledDriverIds.has(d.id)) return false;
    if (!isDriverOnline(d)) return false;
    if (d.dispatchStatus === "hold") return false;
    return true;
  });

  if (activeDrivers.length === 0 || activeVehicles.length === 0) {
    return { assigned: 0, skipped: activeDrivers.length, reused: 0 };
  }

  const existingToday = await storage.getDriverVehicleAssignments(city.id, today);
  const alreadyAssignedDriverIds = new Set(existingToday.map(a => a.driverId));
  const alreadyAssignedVehicleIds = new Set(existingToday.map(a => a.vehicleId));

  const driversToAssign = activeDrivers.filter(d => !alreadyAssignedDriverIds.has(d.id));

  if (driversToAssign.length === 0) {
    return { assigned: 0, skipped: 0, reused: 0 };
  }

  let assigned = 0;
  let skipped = 0;
  let reused = 0;
  const usedVehicleIds = new Set(alreadyAssignedVehicleIds);

  for (const driver of driversToAssign) {
    const yesterdayAssignment = await storage.getYesterdayAssignment(driver.id, yesterday);

    if (yesterdayAssignment) {
      const prevVehicle = activeVehicles.find(v => v.id === yesterdayAssignment.vehicleId);
      if (
        prevVehicle &&
        prevVehicle.status === "ACTIVE" &&
        prevVehicle.cityId === city.id &&
        !usedVehicleIds.has(prevVehicle.id)
      ) {
        await storage.createDriverVehicleAssignment({
          date: today,
          cityId: city.id,
          shiftStartTime: settings.shiftStartTime,
          driverId: driver.id,
          vehicleId: prevVehicle.id,
          assignedBy: "system",
        });
        await storage.updateDriver(driver.id, { vehicleId: prevVehicle.id });
        usedVehicleIds.add(prevVehicle.id);
        assigned++;
        reused++;
        continue;
      }
    }

    const availableVehicle = activeVehicles.find(v =>
      v.cityId === city.id && v.status === "ACTIVE" && !usedVehicleIds.has(v.id)
    );

    if (availableVehicle) {
      await storage.createDriverVehicleAssignment({
        date: today,
        cityId: city.id,
        shiftStartTime: settings.shiftStartTime,
        driverId: driver.id,
        vehicleId: availableVehicle.id,
        assignedBy: "system",
      });
      await storage.updateDriver(driver.id, { vehicleId: availableVehicle.id });
      usedVehicleIds.add(availableVehicle.id);
      assigned++;
    } else {
      skipped++;
    }
  }

  if (assigned > 0) {
    await storage.createAuditLog({
      userId: null,
      action: "AUTO_VEHICLE_ASSIGN",
      entity: "driver_vehicle_assignments",
      entityId: null,
      details: `Auto-assigned ${assigned} vehicles (${reused} reused from yesterday, ${skipped} skipped) in ${city.name} for ${today}`,
      cityId: city.id,
    });
  }

  const tripAssignResult = await autoAssignTripsToDrivers(city, today);

  return { assigned, skipped, reused, tripsAssigned: tripAssignResult.assigned, tripsIssues: tripAssignResult.issues };
}

async function autoAssignTripsToDrivers(city: City, date: string): Promise<{ assigned: number; issues: number }> {
  const allTrips = await storage.getTrips(city.id);
  const unassignedTrips = allTrips.filter(t =>
    t.scheduledDate === date &&
    !t.deletedAt &&
    !t.driverId &&
    t.status === "SCHEDULED" &&
    t.approvalStatus === "approved"
  ).sort((a, b) => (a.pickupTime || "").localeCompare(b.pickupTime || ""));

  if (unassignedTrips.length === 0) return { assigned: 0, issues: 0 };

  const scheduledDriverIds = await getScheduledDriverIdsForDay(city.id, date);
  const cityDrivers = (await storage.getDrivers(city.id)).filter(d => d.status === "ACTIVE");
  const eligibleDriverIds = new Set(
    cityDrivers
      .filter(d => scheduledDriverIds.has(d.id) && isDriverOnline(d) && d.dispatchStatus !== "hold")
      .map(d => d.id)
  );

  const assignments = await storage.getDriverVehicleAssignments(city.id, date);
  const assignedDriverIds = assignments
    .filter(a => a.status === "active" && eligibleDriverIds.has(a.driverId))
    .map(a => a.driverId);

  const driverTripCount: Map<number, number> = new Map();
  for (const dId of assignedDriverIds) {
    const driverTrips = allTrips.filter(t => t.driverId === dId && t.scheduledDate === date && !t.deletedAt);
    driverTripCount.set(dId, driverTrips.length);
  }

  let assigned = 0;
  let issues = 0;

  for (const trip of unassignedTrips) {
    if (assignedDriverIds.length === 0) {
      issues++;
      continue;
    }

    let bestDriver = assignedDriverIds[0];
    let minTrips = driverTripCount.get(bestDriver) || 0;
    for (const dId of assignedDriverIds) {
      const cnt = driverTripCount.get(dId) || 0;
      if (cnt < minTrips) {
        minTrips = cnt;
        bestDriver = dId;
      }
    }

    const assignment = assignments.find(a => a.driverId === bestDriver && a.status === "active");
    const vehicleId = assignment?.vehicleId;

    await storage.updateTrip(trip.id, {
      driverId: bestDriver,
      vehicleId: vehicleId || null,
      status: "ASSIGNED",
    } as any);

    driverTripCount.set(bestDriver, (driverTripCount.get(bestDriver) || 0) + 1);
    assigned++;
  }

  if (assigned > 0 || issues > 0) {
    await storage.createAuditLog({
      userId: null,
      action: "AUTO_TRIP_ASSIGN",
      entity: "trips",
      entityId: null,
      details: `Auto-assigned ${assigned} trips to drivers (${issues} issues) in ${city.name} for ${date}`,
      cityId: city.id,
    });
  }

  return { assigned, issues };
}

let schedulerInterval: NodeJS.Timeout | null = null;
let lastRunAt: Date | null = null;

export function isAutoAssignSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}

export function getLastRunTimestamp(): string | null {
  return lastRunAt ? lastRunAt.toISOString() : null;
}

export function startVehicleAutoAssignScheduler() {
  console.log("[VehicleAutoAssign] Scheduler started (checks every 60s)");

  schedulerInterval = setInterval(async () => {
    try {
      const allCities = await storage.getCities();
      const allSettings = await storage.getAllCitySettings();

      for (const city of allCities) {
        if (!city.active) continue;

        const settings = allSettings.find(s => s.cityId === city.id);
        if (!settings || !settings.autoAssignEnabled) continue;

        const timezone = city.timezone || "America/New_York";
        const dayName = getCityLocalDayName(timezone);
        const currentTime = getCityLocalTime(timezone);

        if (!settings.autoAssignDays?.includes(dayName)) continue;

        const [shiftH, shiftM] = settings.shiftStartTime.split(":").map(Number);
        const triggerMinutes = (shiftH * 60 + shiftM) - settings.autoAssignMinutesBefore;
        const triggerH = Math.floor(triggerMinutes / 60);
        const triggerM = triggerMinutes % 60;
        const triggerTime = `${String(triggerH).padStart(2, "0")}:${String(triggerM).padStart(2, "0")}`;

        if (currentTime !== triggerTime) continue;

        const today = getCityLocalDate(timezone);
        const existing = await storage.getDriverVehicleAssignments(city.id, today);
        const activeDriverCount = (await storage.getDrivers(city.id)).filter(d => d.status === "ACTIVE").length;

        if (existing.length >= activeDriverCount) continue;

        console.log(`[VehicleAutoAssign] Running for ${city.name} (${today} ${triggerTime})`);
        const result = await runVehicleAutoAssignForCity(city, settings);
        lastRunAt = new Date();
        console.log(`[VehicleAutoAssign] ${city.name}: assigned=${result.assigned}, reused=${result.reused}, skipped=${result.skipped}`);
      }
    } catch (err: any) {
      console.error("[VehicleAutoAssign] Scheduler error:", err.message);
    }
  }, 60_000);
}

export function stopVehicleAutoAssignScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
