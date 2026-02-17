import {
  CheckCircle,
  Timer,
  Route,
  Calendar,
  Truck,
  XCircle,
  AlertTriangle,
} from "lucide-react";

interface ProgressEvent {
  key: string;
  label: string;
  at: string;
  meta?: { reason?: string };
}

const CANONICAL_STEPS = [
  { key: "scheduled", label: "Scheduled Pickup", field: "pickupTime", isTimeOnly: true },
  { key: "created", label: "Created", field: "createdAt" },
  { key: "approved", label: "Approved", field: "approvedAt" },
  { key: "assigned", label: "Assigned to Driver", field: "assignedAt" },
  { key: "accepted", label: "Driver Accepted", field: "acceptedAt" },
  { key: "en_route_pickup", label: "En Route to Pickup", field: "startedAt" },
  { key: "arrived_pickup", label: "Arrived at Pickup", field: "arrivedPickupAt" },
  { key: "picked_up", label: "Picked Up", field: "pickedUpAt" },
  { key: "en_route_dropoff", label: "En Route to Dropoff", field: "enRouteDropoffAt" },
  { key: "arrived_dropoff", label: "Arrived at Dropoff", field: "arrivedDropoffAt" },
  { key: "completed", label: "Completed", field: "completedAt" },
  { key: "cancelled", label: "Cancelled", field: "cancelledAt", reasonField: "cancelledReason" },
  { key: "no_show", label: "No-Show", field: "cancelledAt", reasonField: "cancelledReason" },
  { key: "company_error", label: "Company Error", field: "billingSetAt", reasonField: "billingReason" },
];

function formatTimestamp(dateStr: string | null | undefined, tripDate?: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const timeStr = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    if (tripDate) {
      const eventDate = d.toISOString().slice(0, 10);
      if (eventDate !== tripDate) {
        return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${timeStr}`;
      }
    }
    return timeStr;
  } catch {
    return "";
  }
}

function formatTimeOnly(timeStr: string | null | undefined, scheduledDate?: string): string {
  if (!timeStr) return "";
  try {
    if (timeStr.includes(":") && timeStr.length <= 5) {
      const [h, m] = timeStr.split(":").map(Number);
      const d = new Date(2000, 0, 1, h, m);
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    }
    return formatTimestamp(timeStr, scheduledDate);
  } catch {
    return "";
  }
}

function formatTripDateTime(scheduledDate: string, pickupTime: string): string {
  if (!scheduledDate) return "";
  try {
    const [year, month, day] = scheduledDate.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    const dateStr = d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    if (pickupTime) {
      const [h, m] = pickupTime.split(":").map(Number);
      const timeD = new Date(2000, 0, 1, h, m);
      const timeStr = timeD.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      return `${dateStr} — ${timeStr}`;
    }
    return dateStr;
  } catch {
    return scheduledDate;
  }
}

function computeDurationMinutes(startStr: string | null | undefined, endStr: string | null | undefined): number | null {
  if (!startStr || !endStr) return null;
  try {
    const start = new Date(startStr).getTime();
    const end = new Date(endStr).getTime();
    if (isNaN(start) || isNaN(end)) return null;
    const minutes = Math.floor((end - start) / 60000);
    return minutes >= 0 ? minutes : null;
  } catch {
    return null;
  }
}

function buildEventsFromTrip(trip: any): Array<{key: string; label: string; timestamp: string; reason?: string; isTimeOnly?: boolean}> {
  return CANONICAL_STEPS
    .filter((step) => {
      if (step.key === "no_show" && trip.status !== "NO_SHOW") return false;
      if (step.key === "cancelled" && trip.status !== "CANCELLED") return false;
      if (step.key === "completed" && (trip.status === "CANCELLED" || trip.status === "NO_SHOW")) return false;
      if (step.key === "company_error") {
        return trip.billingOutcome === "company_error" && trip.billingSetAt;
      }
      if (step.key === "scheduled") {
        return !!trip.pickupTime;
      }
      const ts = trip[step.field];
      if (!ts) return false;
      return true;
    })
    .map((step) => ({
      key: step.key,
      label: step.label,
      timestamp: trip[step.field],
      reason: step.reasonField ? trip[step.reasonField] : undefined,
      isTimeOnly: step.isTimeOnly,
    }));
}

interface TripProgressTimelineProps {
  trip: any;
  compact?: boolean;
  showHeader?: boolean;
  showMetrics?: boolean;
}

export function TripDateTimeHeader({ trip }: { trip: any }) {
  const display = formatTripDateTime(trip.scheduledDate, trip.pickupTime || trip.scheduledTime);
  if (!display) return null;
  return (
    <div className="flex items-center gap-2" data-testid="text-trip-datetime-header">
      <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <span className="text-base font-bold">{display}</span>
    </div>
  );
}

export function TripMetricsCard({ trip }: { trip: any }) {
  const miles = trip.distanceMiles ? parseFloat(trip.distanceMiles) : null;

  const onsiteMinutes = computeDurationMinutes(trip.arrivedPickupAt, trip.completedAt || trip.cancelledAt);
  const transportMinutes = computeDurationMinutes(trip.pickedUpAt, trip.arrivedDropoffAt);

  const terminalAt = trip.completedAt || trip.cancelledAt;
  const hasArrived = !!trip.arrivedPickupAt;
  const hasTerminal = !!terminalAt;

  let onsiteDisplay: string;
  if (hasArrived && hasTerminal && onsiteMinutes != null) {
    onsiteDisplay = `${onsiteMinutes} min`;
  } else if (hasArrived && !hasTerminal) {
    onsiteDisplay = "In progress";
  } else {
    onsiteDisplay = "—";
  }

  let transportDisplay: string;
  if (transportMinutes != null) {
    transportDisplay = `${transportMinutes} min`;
  } else if (trip.pickedUpAt && !trip.arrivedDropoffAt) {
    transportDisplay = "In transit";
  } else {
    transportDisplay = "—";
  }

  return (
    <div className="flex items-center gap-4 flex-wrap" data-testid="card-trip-metrics">
      <div className="flex items-center gap-1.5 text-sm">
        <Route className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="text-muted-foreground">Miles:</span>
        <span className="font-medium" data-testid="text-trip-miles">
          {miles != null ? `${miles.toFixed(1)} mi` : "—"}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-sm">
        <Timer className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="text-muted-foreground">On-site:</span>
        <span className="font-medium" data-testid="text-trip-onsite">
          {onsiteDisplay}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-sm">
        <Truck className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="text-muted-foreground">Transport:</span>
        <span className="font-medium" data-testid="text-trip-transport">
          {transportDisplay}
        </span>
      </div>
    </div>
  );
}

export function TripProgressTimeline({ trip, compact = false, showHeader = true, showMetrics = true }: TripProgressTimelineProps) {
  const backendEvents: ProgressEvent[] | undefined = trip.progressEvents;

  const events = backendEvents && backendEvents.length > 0
    ? backendEvents.map((ev) => ({
        key: ev.key,
        label: ev.label,
        timestamp: ev.at,
        reason: ev.meta?.reason,
        isTimeOnly: ev.key === "scheduled",
      }))
    : buildEventsFromTrip(trip);

  const currentStatus = trip.status;
  const isTerminal = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(currentStatus);

  if (events.length === 0) return null;

  return (
    <div className="space-y-3">
      {showHeader && <TripDateTimeHeader trip={trip} />}
      {showMetrics && <TripMetricsCard trip={trip} />}

      <div>
        <p className="text-xs text-muted-foreground mb-2">Trip Progress</p>
        <div className={compact ? "space-y-0.5" : "space-y-1"}>
          {events.map((event, idx) => {
            const isLast = idx === events.length - 1;
            const isNegative = event.key === "cancelled" || event.key === "no_show" || event.key === "company_error";
            const timeStr = event.isTimeOnly
              ? formatTimeOnly(event.timestamp, trip.scheduledDate)
              : formatTimestamp(event.timestamp, trip.scheduledDate);

            return (
              <div key={event.key} data-testid={`progress-step-${event.key}`}>
                <div
                  className={`flex items-center justify-between gap-2 py-1 px-2 rounded text-sm ${
                    isLast && !isTerminal
                      ? "bg-primary/10 font-medium text-primary"
                      : isNegative
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isLast && !isTerminal ? (
                      <div className="w-4 h-4 rounded-full border-2 border-primary bg-primary/20 flex-shrink-0" />
                    ) : isNegative ? (
                      event.key === "company_error" ? (
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 text-destructive" />
                      ) : (
                        <XCircle className="w-4 h-4 flex-shrink-0 text-destructive" />
                      )
                    ) : (
                      <CheckCircle
                        className="w-4 h-4 flex-shrink-0 text-emerald-500"
                      />
                    )}
                    <span>{event.label}</span>
                  </div>
                  {timeStr && (
                    <span
                      className={`text-xs tabular-nums flex-shrink-0 ${
                        isNegative ? "text-destructive/70" : "text-muted-foreground"
                      }`}
                      data-testid={`progress-time-${event.key}`}
                    >
                      {timeStr}
                    </span>
                  )}
                </div>
                {event.reason && (
                  <p className="text-xs text-muted-foreground pl-8 mt-0.5" data-testid={`progress-reason-${event.key}`}>
                    Reason: {event.reason}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
