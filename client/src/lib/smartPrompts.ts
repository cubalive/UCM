export type PromptType = "LEAVE_NOW" | "ARRIVE_NOW" | "LATE_RISK";

export interface SmartPrompt {
  type: PromptType;
  tripId: number;
  message: string;
  actions: PromptAction[];
  priority: "normal" | "critical";
  createdAt: number;
}

export interface PromptAction {
  label: string;
  action: "navigate" | "mark_arrived" | "snooze" | "dismiss";
}

interface PromptConfig {
  tMinusLeaveNow: number;
  geofenceMeters: number;
  cooldownMin: number;
  graceMin: number;
}

const DEFAULT_CONFIG: PromptConfig = {
  tMinusLeaveNow: 25,
  geofenceMeters: 150,
  cooldownMin: 10,
  graceMin: 5,
};

const FIRED_KEY = "ucm_smart_prompts_fired";

interface FiredRecord {
  [tripId: string]: { [promptType: string]: number };
}

function getFired(): FiredRecord {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) || "{}");
  } catch {
    return {};
  }
}

function setFired(record: FiredRecord): void {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(record));
  } catch {}
}

function hasFired(tripId: number, type: PromptType): boolean {
  const record = getFired();
  return !!record[tripId]?.[type];
}

function markFired(tripId: number, type: PromptType): void {
  const record = getFired();
  if (!record[tripId]) record[tripId] = {};
  record[tripId][type] = Date.now();
  setFired(record);
}

function isInCooldown(tripId: number, type: PromptType, cooldownMin: number): boolean {
  const record = getFired();
  const lastFired = record[tripId]?.[type];
  if (!lastFired) return false;
  return Date.now() - lastFired < cooldownMin * 60 * 1000;
}

export function cleanOldPromptRecords(activeTripIds: number[]): void {
  const record = getFired();
  const activeSet = new Set(activeTripIds.map(String));
  for (const key of Object.keys(record)) {
    if (!activeSet.has(key)) delete record[key];
  }
  setFired(record);
}

interface TripInfo {
  id: number;
  status: string;
  scheduledPickupAt: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
}

interface DriverLocation {
  lat: number;
  lng: number;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function evaluatePrompts(
  trip: TripInfo,
  driverLocation: DriverLocation | null,
  etaMinutes: number | null,
  config: Partial<PromptConfig> = {},
): SmartPrompt[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const prompts: SmartPrompt[] = [];
  const now = Date.now();

  if (!trip.scheduledPickupAt) return prompts;
  const scheduledMs = new Date(trip.scheduledPickupAt).getTime();
  const minutesUntilPickup = (scheduledMs - now) / 60000;

  const preEnRoute = ["ASSIGNED", "SCHEDULED", "PENDING"].includes(trip.status);
  if (preEnRoute && minutesUntilPickup <= cfg.tMinusLeaveNow && minutesUntilPickup > 0) {
    if (!hasFired(trip.id, "LEAVE_NOW")) {
      prompts.push({
        type: "LEAVE_NOW",
        tripId: trip.id,
        message: `Pickup in ${Math.round(minutesUntilPickup)} min. Time to head out!`,
        actions: [
          { label: "Navigate to Pickup", action: "navigate" },
          { label: "Snooze", action: "snooze" },
        ],
        priority: minutesUntilPickup <= 10 ? "critical" : "normal",
        createdAt: now,
      });
    }
  }

  if (driverLocation && trip.pickupLat && trip.pickupLng) {
    const enRouteToPickup = ["EN_ROUTE_TO_PICKUP", "EN_ROUTE"].includes(trip.status);
    if (enRouteToPickup) {
      const dist = haversineMeters(driverLocation.lat, driverLocation.lng, trip.pickupLat, trip.pickupLng);
      if (dist <= cfg.geofenceMeters && !hasFired(trip.id, "ARRIVE_NOW")) {
        prompts.push({
          type: "ARRIVE_NOW",
          tripId: trip.id,
          message: `You're ${Math.round(dist)}m from pickup. Mark arrived?`,
          actions: [
            { label: "Mark Arrived", action: "mark_arrived" },
            { label: "Dismiss", action: "dismiss" },
          ],
          priority: "normal",
          createdAt: now,
        });
      }
    }
  }

  if (etaMinutes != null && trip.scheduledPickupAt) {
    const graceMs = cfg.graceMin * 60000;
    const lateThresholdMs = scheduledMs + graceMs;
    const etaMs = now + etaMinutes * 60000;
    if (etaMs > lateThresholdMs && !isInCooldown(trip.id, "LATE_RISK", cfg.cooldownMin)) {
      const lateBy = Math.round((etaMs - scheduledMs) / 60000);
      prompts.push({
        type: "LATE_RISK",
        tripId: trip.id,
        message: `ETA shows ${lateBy} min late for pickup. Consider faster route.`,
        actions: [
          { label: "Navigate to Pickup", action: "navigate" },
          { label: "Dismiss", action: "dismiss" },
        ],
        priority: "critical",
        createdAt: now,
      });
    }
  }

  return prompts;
}

export function acknowledgePrompt(tripId: number, type: PromptType): void {
  markFired(tripId, type);
}
