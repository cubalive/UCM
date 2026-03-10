import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useState, useEffect, useRef } from "react";
import { resolveUrl } from "@/lib/api";
import {
  MapPin,
  Car,
  Clock,
  RefreshCw,
  User,
  Navigation,
  Phone,
  Truck,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  AlertTriangle,
  Shield,
  Timer,
  Activity,
  Eye,
} from "lucide-react";

const PHASE_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  ASSIGNED: { bg: "bg-indigo-500/10", text: "text-indigo-400", border: "border-indigo-500/20", label: "Assigned" },
  EN_ROUTE_TO_PICKUP: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20", label: "En Route to Pickup" },
  ARRIVED_PICKUP: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20", label: "At Pickup Location" },
  PICKED_UP: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20", label: "Patient Picked Up" },
  EN_ROUTE_TO_DROPOFF: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/20", label: "Transporting to Clinic" },
  ARRIVED_DROPOFF: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20", label: "Arrived at Clinic" },
  IN_PROGRESS: { bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/20", label: "In Progress" },
};

function formatTimeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown";
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function EtaCountdown({ etaMinutes, status }: { etaMinutes: number | null | undefined; status: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const interval = setInterval(() => setElapsed(e => e + 1), 60000);
    return () => clearInterval(interval);
  }, [etaMinutes]);

  if (etaMinutes == null) return <span className="text-gray-600 text-xs">ETA unavailable</span>;

  const remaining = Math.max(0, etaMinutes - elapsed);
  const isUrgent = remaining <= 5;
  const isArriving = remaining <= 2;
  const isArrived = ["ARRIVED_PICKUP", "ARRIVED_DROPOFF"].includes(status);

  if (isArrived) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-emerald-400 text-sm font-bold">HERE</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1.5 ${isUrgent ? "animate-pulse" : ""}`}>
      <Timer className={`w-3.5 h-3.5 ${isArriving ? "text-emerald-400" : isUrgent ? "text-amber-400" : "text-gray-400"}`} />
      <span className={`text-lg font-bold ${isArriving ? "text-emerald-400" : isUrgent ? "text-amber-400" : "text-white"}`}>
        {remaining}
      </span>
      <span className={`text-[10px] ${isArriving ? "text-emerald-400/70" : isUrgent ? "text-amber-400/70" : "text-gray-500"}`}>min</span>
    </div>
  );
}

function PatientTransportTimeline({ trip }: { trip: any }) {
  const steps = [
    { key: "assigned", label: "Driver Assigned", icon: Car, done: true },
    {
      key: "en_route_pickup",
      label: "En Route to Patient",
      icon: Navigation,
      done: ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"].includes(trip.status),
      active: trip.status === "EN_ROUTE_TO_PICKUP",
    },
    {
      key: "at_pickup",
      label: "At Pickup Location",
      icon: MapPin,
      done: ["ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"].includes(trip.status),
      active: trip.status === "ARRIVED_PICKUP",
    },
    {
      key: "picked_up",
      label: "Patient On Board",
      icon: User,
      done: ["PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"].includes(trip.status),
      active: trip.status === "PICKED_UP",
    },
    {
      key: "transporting",
      label: "Transporting to Clinic",
      icon: Truck,
      done: ["EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"].includes(trip.status),
      active: trip.status === "EN_ROUTE_TO_DROPOFF",
    },
    {
      key: "arrived",
      label: "Arrived at Clinic",
      icon: CheckCircle2,
      done: ["ARRIVED_DROPOFF"].includes(trip.status),
      active: trip.status === "ARRIVED_DROPOFF",
    },
  ];

  return (
    <div className="space-y-0">
      {steps.map((step, i) => {
        const Icon = step.icon;
        const isLast = i === steps.length - 1;
        return (
          <div key={step.key} className="flex items-start gap-2.5">
            <div className="flex flex-col items-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                  step.active ? "ring-2 ring-emerald-400/50 ring-offset-1 ring-offset-[#111827]" : ""
                }`}
                style={{
                  background: step.done
                    ? step.active ? "rgba(16, 185, 129, 0.2)" : "rgba(16, 185, 129, 0.1)"
                    : "rgba(75, 85, 99, 0.15)",
                }}
              >
                <Icon className={`w-3 h-3 ${step.done ? (step.active ? "text-emerald-400" : "text-emerald-500/70") : "text-gray-600"}`} />
              </div>
              {!isLast && (
                <div
                  className="w-0.5 h-4"
                  style={{ background: step.done ? "rgba(16, 185, 129, 0.3)" : "rgba(75, 85, 99, 0.15)" }}
                />
              )}
            </div>
            <span className={`text-[11px] pt-1 ${step.active ? "text-emerald-400 font-semibold" : step.done ? "text-gray-300" : "text-gray-600"}`}>
              {step.label}
              {step.active && " ●"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DriverLocationCard({ trip }: { trip: any }) {
  const hasLocation = trip.driverLastLat && trip.driverLastLng;
  const lastSeen = trip.driverLastSeenAt;
  const phaseInfo = PHASE_COLORS[trip.status] || { bg: "bg-gray-500/10", text: "text-gray-400", border: "border-gray-500/20", label: trip.status?.replace(/_/g, " ") || "Unknown" };

  const isInbound = ["EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF"].includes(trip.status);
  const isOutbound = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP"].includes(trip.status);
  const isOnBoard = ["PICKED_UP", "EN_ROUTE_TO_DROPOFF", "IN_PROGRESS"].includes(trip.status);
  const isAtClinic = trip.status === "ARRIVED_DROPOFF";

  return (
    <div
      className={`bg-[#111827] border rounded-xl overflow-hidden transition-all ${
        isAtClinic ? "border-emerald-500/40 shadow-lg shadow-emerald-500/5" : "border-[#1e293b] hover:border-emerald-500/20"
      }`}
      data-testid={`live-trip-${trip.id}`}
    >
      {/* Header strip */}
      <div className={`px-4 py-2.5 flex items-center justify-between ${phaseInfo.bg} border-b ${phaseInfo.border}`}>
        <div className="flex items-center gap-2">
          {isOnBoard ? (
            <div className="flex items-center gap-1.5">
              <Shield className={`w-3.5 h-3.5 ${phaseInfo.text}`} />
              <span className={`text-xs font-semibold ${phaseInfo.text}`}>Patient On Board</span>
            </div>
          ) : isAtClinic ? (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-semibold text-emerald-400">At Clinic</span>
            </div>
          ) : (
            <span className={`text-xs font-semibold ${phaseInfo.text}`}>{phaseInfo.label}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isInbound && (
            <span className="flex items-center gap-1 text-[10px] text-cyan-400 font-medium">
              <ArrowDown className="w-3 h-3" /> Inbound
            </span>
          )}
          {isOutbound && (
            <span className="flex items-center gap-1 text-[10px] text-blue-400 font-medium">
              <ArrowUp className="w-3 h-3" /> Outbound
            </span>
          )}
          {lastSeen && (
            <span className="text-[10px] text-gray-600 flex items-center gap-1" data-testid={`last-updated-${trip.id}`}>
              <Activity className="w-3 h-3" />
              {formatTimeAgo(lastSeen)}
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Patient and ETA row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/10 rounded-full flex items-center justify-center shrink-0">
              <User className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{trip.patientName || "Patient"}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">
                {trip.serviceLevel || "Ambulatory"} Transport
              </p>
            </div>
          </div>
          <EtaCountdown etaMinutes={trip.etaMinutes} status={trip.status} />
        </div>

        {/* Transport Timeline */}
        <div className="py-2 px-1">
          <PatientTransportTimeline trip={trip} />
        </div>

        {/* Driver info */}
        <div
          className="flex items-center justify-between p-2.5 rounded-lg"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-cyan-500/10 rounded-full flex items-center justify-center shrink-0">
              <Car className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-white">
                {trip.driverName || <span className="text-amber-400">No driver yet</span>}
              </p>
              {trip.vehicleLabel && (
                <p className="text-[10px] text-gray-500">{trip.vehicleLabel}</p>
              )}
            </div>
          </div>
          {trip.driverPhone && (
            <a
              href={`tel:${trip.driverPhone}`}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-[10px] font-medium hover:bg-emerald-500/20 transition-colors"
            >
              <Phone className="w-3 h-3" />
              Call
            </a>
          )}
        </div>

        {/* Route info */}
        <div className="flex gap-2 text-[10px]">
          <div className="flex-1 p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="flex items-center gap-1 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-gray-500 uppercase tracking-wider">Pickup</span>
            </div>
            <p className="text-gray-300 truncate">{trip.pickupAddress || "Not set"}</p>
          </div>
          <div className="flex items-center text-gray-700">→</div>
          <div className="flex-1 p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="flex items-center gap-1 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              <span className="text-gray-500 uppercase tracking-wider">Dropoff</span>
            </div>
            <p className="text-gray-300 truncate">{trip.dropoffAddress || "Not set"}</p>
          </div>
        </div>

        {/* GPS coordinates */}
        {hasLocation && (
          <div className="flex items-center gap-2 pt-1">
            <Navigation className="w-3 h-3 text-green-400" />
            <span className="text-[10px] text-gray-600 font-mono">
              {Number(trip.driverLastLat).toFixed(5)}, {Number(trip.driverLastLng).toFixed(5)}
            </span>
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[10px] text-green-400/70">GPS Active</span>
          </div>
        )}
      </div>
    </div>
  );
}

function LiveSummaryBar({ trips }: { trips: any[] }) {
  const inbound = trips.filter(t => ["EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF"].includes(t.status)).length;
  const outbound = trips.filter(t => ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP"].includes(t.status)).length;
  const onBoard = trips.filter(t => ["PICKED_UP", "EN_ROUTE_TO_DROPOFF", "IN_PROGRESS"].includes(t.status)).length;
  const atClinic = trips.filter(t => t.status === "ARRIVED_DROPOFF").length;
  const avgEta = trips.filter(t => t.etaMinutes != null).reduce((sum, t) => sum + (t.etaMinutes || 0), 0) / (trips.filter(t => t.etaMinutes != null).length || 1);

  const stats = [
    { label: "Total Active", value: trips.length, icon: Activity, color: "text-white" },
    { label: "Inbound", value: inbound, icon: ArrowDown, color: "text-cyan-400" },
    { label: "Outbound", value: outbound, icon: ArrowUp, color: "text-blue-400" },
    { label: "On Board", value: onBoard, icon: Shield, color: "text-purple-400" },
    { label: "At Clinic", value: atClinic, icon: CheckCircle2, color: "text-emerald-400" },
    { label: "Avg ETA", value: `${Math.round(avgEta)}m`, icon: Timer, color: "text-amber-400" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3" data-testid="live-summary-bar">
      {stats.map(stat => {
        const Icon = stat.icon;
        return (
          <div key={stat.label} className="bg-[#111827] border border-[#1e293b] rounded-xl p-3 text-center">
            <Icon className={`w-4 h-4 mx-auto mb-1 ${stat.color}`} />
            <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-[9px] text-gray-500 uppercase tracking-wider">{stat.label}</p>
          </div>
        );
      })}
    </div>
  );
}

export default function ClinicLiveView() {
  const { user } = useAuth();
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [filter, setFilter] = useState<"all" | "inbound" | "outbound" | "at_clinic">("all");

  const { data: activeTrips, isLoading, refetch } = useQuery({
    queryKey: ["/api/clinic/active-trips"],
    enabled: !!user?.clinicId || user?.role === "SUPER_ADMIN",
    refetchInterval: 15000,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setLastRefresh(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const allTrips = Array.isArray(activeTrips) ? activeTrips : [];

  const filteredTrips = allTrips.filter(trip => {
    if (filter === "inbound") return ["EN_ROUTE_TO_DROPOFF", "PICKED_UP", "IN_PROGRESS"].includes(trip.status);
    if (filter === "outbound") return ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP"].includes(trip.status);
    if (filter === "at_clinic") return trip.status === "ARRIVED_DROPOFF";
    return true;
  });

  const handleRefresh = () => {
    refetch();
    setLastRefresh(Date.now());
  };

  const filterTabs = [
    { key: "all", label: "All", count: allTrips.length },
    { key: "inbound", label: "Inbound", count: allTrips.filter(t => ["EN_ROUTE_TO_DROPOFF", "PICKED_UP", "IN_PROGRESS"].includes(t.status)).length },
    { key: "outbound", label: "Outbound", count: allTrips.filter(t => ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP"].includes(t.status)).length },
    { key: "at_clinic", label: "At Clinic", count: allTrips.filter(t => t.status === "ARRIVED_DROPOFF").length },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5" data-testid="clinic-live-view">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
            Patient Transport Monitor
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Real-time tracking — auto-refreshes every 15 seconds
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#111827] border border-[#1e293b]">
            <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            <span className="text-[10px] text-gray-400">LIVE</span>
          </div>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-2 bg-[#111827] border border-[#1e293b] rounded-lg text-sm text-gray-400 hover:text-white hover:border-emerald-500/30 transition-all"
            data-testid="button-refresh"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {allTrips.length > 0 && <LiveSummaryBar trips={allTrips} />}

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {filterTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key as any)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === tab.key
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                : "bg-[#111827] text-gray-500 border border-[#1e293b] hover:border-gray-700 hover:text-gray-300"
            }`}
            data-testid={`filter-${tab.key}`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                filter === tab.key ? "bg-emerald-500/20 text-emerald-400" : "bg-gray-800 text-gray-500"
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Trip cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 animate-pulse">
              <div className="h-4 w-24 bg-gray-800 rounded mb-3" />
              <div className="h-3 w-48 bg-gray-800 rounded mb-2" />
              <div className="h-3 w-36 bg-gray-800 rounded" />
            </div>
          ))}
        </div>
      ) : filteredTrips.length === 0 ? (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-12 text-center" data-testid="text-no-active-trips">
          <MapPin className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">
            {filter === "all" ? "No active trips right now" : `No ${filter.replace("_", " ")} trips`}
          </p>
          <p className="text-gray-600 text-xs mt-1">Active trips will appear here in real-time</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="live-trips-grid">
          {filteredTrips.map((trip: any) => (
            <DriverLocationCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}
    </div>
  );
}
