/**
 * Dispatch Intelligence Types
 * Extension points for ETA prediction, delay detection, anomaly scoring,
 * and richer auto-assign logic.
 */

export interface ETAEstimate {
  tripId: string;
  estimatedArrivalMinutes: number;
  distanceMiles: number;
  trafficMultiplier: number;
  weatherFactor: number;
  confidence: "high" | "medium" | "low";
  source: "google_directions" | "haversine" | "historical_average";
  calculatedAt: Date;
}

export interface DelayPrediction {
  tripId: string;
  predictedDelayMinutes: number;
  reason: "traffic" | "weather" | "driver_pattern" | "route_complexity" | "time_of_day";
  confidence: number; // 0-1
  suggestedAction?: "notify_patient" | "reassign" | "none";
}

export interface DriverScoreBreakdown {
  driverId: string;
  baseScore: number;
  adjustments: {
    proximity: number;
    activeTrips: number;
    staleLocation: number;
    onlinePresence: number;
    reliability: number;
    recentDeclines: number;
    // Future extension points
    patientPreference?: number;
    vehicleMatch?: number;
    shiftFatigue?: number;
    areaFamiliarity?: number;
  };
  finalScore: number;
  disqualified: boolean;
  disqualifyReason?: string;
}

export interface OperationalAnomaly {
  type: "stuck_trip" | "unusual_duration" | "route_deviation" | "driver_idle" | "high_cancel_rate" | "surge_demand";
  severity: "info" | "warning" | "critical";
  entityId: string;
  entityType: "trip" | "driver" | "tenant";
  message: string;
  detectedAt: Date;
  metadata: Record<string, unknown>;
}

export interface DispatchEvent {
  type:
    | "trip_created"
    | "trip_assigned"
    | "trip_accepted"
    | "trip_declined"
    | "trip_status_changed"
    | "trip_completed"
    | "trip_cancelled"
    | "driver_location_updated"
    | "driver_status_changed"
    | "eta_updated"
    | "delay_predicted"
    | "anomaly_detected";
  timestamp: Date;
  tenantId: string;
  payload: Record<string, unknown>;
}

export interface AutoAssignConfig {
  maxActiveTripsPerDriver: number;
  maxDistanceMiles: number;
  staleLocationThresholdMinutes: number;
  proximityWeight: number;
  reliabilityWeight: number;
  onlineBonus: number;
  declinePenaltyPerIncident: number;
  // Future: ML-based scoring
  useHistoricalPatterns: boolean;
  considerTraffic: boolean;
  considerPatientPreference: boolean;
}

export const DEFAULT_AUTO_ASSIGN_CONFIG: AutoAssignConfig = {
  maxActiveTripsPerDriver: 3,
  maxDistanceMiles: 25,
  staleLocationThresholdMinutes: 30,
  proximityWeight: 5,
  reliabilityWeight: 20,
  onlineBonus: 15,
  declinePenaltyPerIncident: 15,
  useHistoricalPatterns: false,
  considerTraffic: false,
  considerPatientPreference: false,
};
