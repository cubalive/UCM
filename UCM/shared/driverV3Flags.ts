export interface DriverV3CompanyFlags {
  performance: boolean;
  smartPrompts: boolean;
  offlineOutbox: boolean;
  sounds: boolean;
  scoring: {
    graceMinutes: number;
    weights: { punctuality: number; acceptance: number; idle: number; cancellations: number; compliance: number };
  };
  prompts: { tMinusLeaveNow: number; geofenceMeters: number; cooldownMin: number };
  tracking: { fgSec: number; bgSec: number; accuracyMaxM: number };
}

export const DRIVER_V3_DEFAULTS: DriverV3CompanyFlags = {
  performance: false,
  smartPrompts: false,
  offlineOutbox: false,
  sounds: false,
  scoring: {
    graceMinutes: 5,
    weights: { punctuality: 45, acceptance: 20, idle: 15, cancellations: 10, compliance: 10 },
  },
  prompts: { tMinusLeaveNow: 25, geofenceMeters: 150, cooldownMin: 10 },
  tracking: { fgSec: 5, bgSec: 15, accuracyMaxM: 80 },
};

export function resolveDriverV3Flags(raw: unknown): DriverV3CompanyFlags {
  const base = { ...DRIVER_V3_DEFAULTS };
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, any>;

  if (typeof obj.performance === "boolean") base.performance = obj.performance;
  if (typeof obj.smartPrompts === "boolean") base.smartPrompts = obj.smartPrompts;
  if (typeof obj.offlineOutbox === "boolean") base.offlineOutbox = obj.offlineOutbox;
  if (typeof obj.sounds === "boolean") base.sounds = obj.sounds;

  if (obj.scoring && typeof obj.scoring === "object") {
    if (typeof obj.scoring.graceMinutes === "number") base.scoring.graceMinutes = obj.scoring.graceMinutes;
    if (obj.scoring.weights && typeof obj.scoring.weights === "object") {
      base.scoring.weights = { ...base.scoring.weights, ...obj.scoring.weights };
    }
  }
  if (obj.prompts && typeof obj.prompts === "object") {
    base.prompts = { ...base.prompts, ...obj.prompts };
  }
  if (obj.tracking && typeof obj.tracking === "object") {
    base.tracking = { ...base.tracking, ...obj.tracking };
  }

  return base;
}

export interface DriverV3EffectiveFlags {
  performanceEnabled: boolean;
  smartPromptsEnabled: boolean;
  offlineOutboxEnabled: boolean;
  soundsEnabled: boolean;
  scoring: DriverV3CompanyFlags["scoring"];
  prompts: DriverV3CompanyFlags["prompts"];
  tracking: DriverV3CompanyFlags["tracking"];
  driverPrefs: {
    soundsOn: boolean;
    hapticsOn: boolean;
    promptsEnabled: boolean;
    performanceVisible: boolean;
    preferredNavApp: string;
  };
}
