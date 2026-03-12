import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useRealtimeTrips } from "@/hooks/use-realtime-trips";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Crosshair,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Info,
  Phone,
  ArrowRightLeft,
  Send,
  Eye,
  Clock,
  MapPin,
  Navigation,
  User,
  Car,
  CheckCircle,
  XCircle,
  Activity,
  TrendingUp,
  DollarSign,
  Star,
  Wifi,
  WifiOff,
  Layers,
  Zap,
  ChevronRight,
  BarChart3,
  Radio,
  Maximize2,
  Minimize2,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Alert {
  id: string;
  type: string;
  urgency: "critical" | "high" | "medium" | "info";
  title: string;
  description: string;
  recommendedAction: string;
  actionType: string;
  actionLabel: string;
  entityId?: number;
  entityType?: string;
  createdAt: string;
}

interface KPIs {
  onTimeRate: number;
  activeTrips: number;
  completedTrips: number;
  totalTrips: number;
  revenueToday: number;
  fleetUtilization: number;
  avgRating: number;
  tripsAtRisk: number;
  unassignedCount: number;
  onlineDrivers: number;
  totalDrivers: number;
}

interface TimelineDriver {
  driverId: number | null;
  driverName: string;
  trips: Array<{
    id: number;
    publicId: string;
    status: string;
    startTime: string | null;
    endTime: string | null;
    patientName: string;
    pickupAddress: string;
    dropoffAddress: string;
  }>;
}

interface DriverMarker {
  id: number;
  name: string;
  phone: string;
  status: string;
  lat: number | null;
  lng: number | null;
  lastSeenAt: string | null;
}

interface MapData {
  drivers: DriverMarker[];
  activeTripPaths: Array<{
    tripId: number;
    publicId: string;
    status: string;
    driverId: number;
    patientName: string;
    pickup: { lat: number | null; lng: number | null; address: string };
    dropoff: { lat: number | null; lng: number | null; address: string };
  }>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 15_000; // 15 seconds

const URGENCY_CONFIG = {
  critical: { color: "bg-red-500", textColor: "text-red-500", borderColor: "border-red-500/30", bgTint: "bg-red-500/10", label: "CRITICAL" },
  high: { color: "bg-orange-500", textColor: "text-orange-500", borderColor: "border-orange-500/30", bgTint: "bg-orange-500/10", label: "HIGH" },
  medium: { color: "bg-yellow-500", textColor: "text-yellow-500", borderColor: "border-yellow-500/30", bgTint: "bg-yellow-500/10", label: "MEDIUM" },
  info: { color: "bg-blue-500", textColor: "text-blue-500", borderColor: "border-blue-500/30", bgTint: "bg-blue-500/10", label: "INFO" },
};

const TRIP_STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-white/80 border-gray-300 text-gray-700",
  ASSIGNED: "bg-blue-500/80 border-blue-600 text-white",
  EN_ROUTE_TO_PICKUP: "bg-blue-400/80 border-blue-500 text-white",
  AT_PICKUP: "bg-orange-400/80 border-orange-500 text-white",
  IN_PROGRESS: "bg-orange-500/80 border-orange-600 text-white",
  EN_ROUTE_TO_DROPOFF: "bg-orange-400/80 border-orange-500 text-white",
  COMPLETED: "bg-gray-400/60 border-gray-500 text-gray-100",
  CANCELLED: "bg-red-400/40 border-red-500 text-red-200",
  NO_SHOW: "bg-red-400/40 border-red-500 text-red-200",
};

const GANTT_STATUS_COLORS: Record<string, string> = {
  COMPLETED: "bg-gray-500/50",
  IN_PROGRESS: "bg-orange-500",
  EN_ROUTE_TO_PICKUP: "bg-blue-500",
  EN_ROUTE_TO_DROPOFF: "bg-orange-500",
  AT_PICKUP: "bg-orange-400",
  ASSIGNED: "bg-emerald-500",
  SCHEDULED: "bg-white/30 border border-white/20",
  CANCELLED: "bg-red-500/30",
  NO_SHOW: "bg-red-500/30",
};

const DRIVER_STATUS_COLORS: Record<string, string> = {
  available: "bg-emerald-500",
  enroute: "bg-blue-500",
  at_pickup: "bg-orange-500",
  in_transit: "bg-orange-500",
  offline: "bg-gray-500",
  hold: "bg-gray-400",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeToMinutes(timeStr: string | null): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(":");
  return parseInt(parts[0]) * 60 + parseInt(parts[1] || "0");
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function CareCommandCenter() {
  const { user, token, selectedCity } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTrip, setSelectedTrip] = useState<number | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [expandedPanel, setExpandedPanel] = useState<"map" | "timeline" | "alerts" | null>(null);

  const cityParam = selectedCity ? `?cityId=${selectedCity.id}` : "";

  // Real-time WebSocket subscription
  const { isConnected } = useRealtimeTrips({
    companyId: user?.companyId,
    invalidateKeys: [
      "/api/command-center/kpis",
      "/api/command-center/alerts",
      "/api/command-center/timeline",
      "/api/command-center/map-data",
    ],
    enabled: !!token && !!user?.companyId,
  });

  // ─── Data fetching ──────────────────────────────────────────────────────

  const { data: kpis, isLoading: kpisLoading } = useQuery<KPIs>({
    queryKey: ["/api/command-center/kpis", selectedCity?.id],
    queryFn: () => apiFetch(`/api/command-center/kpis${cityParam}`, token),
    enabled: !!token,
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: alertsData, isLoading: alertsLoading } = useQuery<{ alerts: Alert[]; count: number }>({
    queryKey: ["/api/command-center/alerts", selectedCity?.id],
    queryFn: () => apiFetch(`/api/command-center/alerts${cityParam}`, token),
    enabled: !!token,
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: timelineData, isLoading: timelineLoading } = useQuery<{
    timeline: TimelineDriver[];
    stats: { totalTrips: number; completedTrips: number; activeTrips: number };
  }>({
    queryKey: ["/api/command-center/timeline", selectedCity?.id],
    queryFn: () => apiFetch(`/api/command-center/timeline${cityParam}`, token),
    enabled: !!token,
    refetchInterval: REFRESH_INTERVAL,
  });

  const { data: mapData, isLoading: mapLoading } = useQuery<MapData>({
    queryKey: ["/api/command-center/map-data", selectedCity?.id],
    queryFn: () => apiFetch(`/api/command-center/map-data${cityParam}`, token),
    enabled: !!token,
    refetchInterval: REFRESH_INTERVAL,
  });

  const alerts = alertsData?.alerts || [];
  const timeline = timelineData?.timeline || [];
  const timelineStats = timelineData?.stats || { totalTrips: 0, completedTrips: 0, activeTrips: 0 };
  const driverMarkers = mapData?.drivers || [];
  const activeTripPaths = mapData?.activeTripPaths || [];

  const handleRefreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/command-center/kpis"] });
    queryClient.invalidateQueries({ queryKey: ["/api/command-center/alerts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/command-center/timeline"] });
    queryClient.invalidateQueries({ queryKey: ["/api/command-center/map-data"] });
    toast({ title: "Refreshed", description: "All panels updated" });
  }, [queryClient, toast]);

  const handleAlertAction = useCallback((alert: Alert) => {
    if (alert.entityType === "trip" && alert.entityId) {
      window.open(`/trips/${alert.entityId}`, "_blank");
    } else if (alert.entityType === "driver" && alert.entityId) {
      window.open(`/drivers/${alert.entityId}`, "_blank");
    } else if (alert.actionType === "view_forecast") {
      window.open("/prediction", "_blank");
    }
    toast({ title: "Action triggered", description: `${alert.actionLabel} for ${alert.title}` });
  }, [toast]);

  // Time axis for Gantt: 5 AM to 11 PM
  const ganttStart = 5 * 60; // 5:00 AM in minutes
  const ganttEnd = 23 * 60; // 11:00 PM in minutes
  const ganttRange = ganttEnd - ganttStart;

  const timeMarkers = useMemo(() => {
    const markers = [];
    for (let h = 5; h <= 23; h += 2) {
      markers.push({ minutes: h * 60, label: minutesToTime(h * 60) });
    }
    return markers;
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden bg-background" data-testid="care-command-center">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card/50 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Crosshair className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Care Command Center</h1>
              <p className="text-[10px] text-muted-foreground -mt-0.5">
                Real-time dispatch intelligence
              </p>
            </div>
          </div>
          <Badge
            variant={isConnected ? "default" : "secondary"}
            className={`text-[10px] px-1.5 py-0 h-5 ${
              isConnected ? "bg-emerald-600 hover:bg-emerald-600 animate-pulse" : "text-muted-foreground"
            }`}
          >
            {isConnected ? <Wifi className="w-3 h-3 mr-0.5" /> : <WifiOff className="w-3 h-3 mr-0.5" />}
            {isConnected ? "LIVE" : "Offline"}
          </Badge>
          {selectedCity && (
            <Badge variant="outline" className="text-[10px] h-5">
              <MapPin className="w-3 h-3 mr-0.5" />
              {selectedCity.name}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            Auto-refresh {REFRESH_INTERVAL / 1000}s
          </span>
          <Button size="sm" variant="ghost" onClick={handleRefreshAll} className="h-7 w-7 p-0">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Three-Panel Layout */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ─── LEFT PANEL: Live Map ─────────────────────────────────── */}
        <div className={`${expandedPanel === "map" ? "flex-[3]" : expandedPanel ? "hidden" : "flex-1"} border-r flex flex-col min-w-0 transition-all duration-300`}>
          <div className="flex items-center justify-between px-3 py-1.5 border-b bg-card/30 flex-shrink-0">
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-xs font-semibold">Live Map</span>
              <Badge variant="secondary" className="text-[10px] h-4 px-1">
                {driverMarkers.length} drivers
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={showHeatmap ? "default" : "ghost"}
                className="h-6 text-[10px] px-2"
                onClick={() => setShowHeatmap(!showHeatmap)}
              >
                <Layers className="w-3 h-3 mr-1" />
                Heatmap
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => setExpandedPanel(expandedPanel === "map" ? null : "map")}
              >
                {expandedPanel === "map" ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
              </Button>
            </div>
          </div>

          <div className="flex-1 relative overflow-hidden">
            {mapLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Skeleton className="w-full h-full" />
              </div>
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
                {/* Map placeholder with driver markers */}
                <div className="absolute inset-0 flex flex-col">
                  {/* Map grid overlay */}
                  <div className="absolute inset-0 opacity-10">
                    <svg width="100%" height="100%">
                      <defs>
                        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#grid)" />
                    </svg>
                  </div>

                  {/* Heatmap overlay */}
                  {showHeatmap && (
                    <div className="absolute inset-0 z-10 pointer-events-none">
                      <div className="absolute top-[20%] left-[30%] w-32 h-32 rounded-full bg-red-500/20 blur-2xl animate-pulse" />
                      <div className="absolute top-[40%] left-[60%] w-24 h-24 rounded-full bg-orange-500/20 blur-2xl animate-pulse" style={{ animationDelay: "0.5s" }} />
                      <div className="absolute top-[60%] left-[20%] w-20 h-20 rounded-full bg-yellow-500/15 blur-2xl animate-pulse" style={{ animationDelay: "1s" }} />
                      <div className="absolute top-[30%] left-[70%] w-28 h-28 rounded-full bg-red-500/15 blur-2xl animate-pulse" style={{ animationDelay: "1.5s" }} />
                      <div className="absolute bottom-4 left-3 bg-black/60 backdrop-blur-sm rounded px-2 py-1 text-[10px] text-white/70">
                        Predicted demand (next 2h)
                      </div>
                    </div>
                  )}

                  {/* Driver markers scattered on the map */}
                  <div className="absolute inset-8 z-20">
                    {driverMarkers.slice(0, 20).map((driver, idx) => {
                      // Deterministic positioning based on driver id
                      const x = ((driver.id * 37 + 13) % 85) + 5;
                      const y = ((driver.id * 53 + 7) % 80) + 5;
                      const statusColor = DRIVER_STATUS_COLORS[driver.status] || "bg-gray-500";
                      const isSelected = selectedDriver === driver.id;

                      return (
                        <Tooltip key={driver.id}>
                          <TooltipTrigger asChild>
                            <button
                              className={`absolute transition-all duration-300 z-30 ${isSelected ? "scale-150 z-40" : "hover:scale-125"}`}
                              style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
                              onClick={() => setSelectedDriver(isSelected ? null : driver.id)}
                            >
                              <div className={`w-3.5 h-3.5 rounded-full ${statusColor} shadow-lg ring-2 ring-black/30`}>
                                {driver.status === "enroute" && (
                                  <div className={`absolute inset-0 rounded-full ${statusColor} animate-ping opacity-40`} />
                                )}
                              </div>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[200px]">
                            <div className="text-xs space-y-0.5">
                              <p className="font-semibold">{driver.name}</p>
                              <p className="text-muted-foreground">{driver.phone || "No phone"}</p>
                              <p>Status: <span className="font-medium capitalize">{driver.status}</span></p>
                              <p>Last seen: {formatTimeAgo(driver.lastSeenAt)}</p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}

                    {/* Active trip path lines */}
                    {activeTripPaths.slice(0, 8).map((trip) => {
                      const fromDriver = driverMarkers.find(d => d.id === trip.driverId);
                      if (!fromDriver) return null;
                      const dx = ((fromDriver.id * 37 + 13) % 85) + 5;
                      const dy = ((fromDriver.id * 53 + 7) % 80) + 5;
                      const tx = ((trip.tripId * 41 + 19) % 70) + 15;
                      const ty = ((trip.tripId * 31 + 23) % 60) + 20;

                      return (
                        <svg key={trip.tripId} className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible">
                          <line
                            x1={`${dx}%`} y1={`${dy}%`}
                            x2={`${tx}%`} y2={`${ty}%`}
                            stroke="rgba(59, 130, 246, 0.4)"
                            strokeWidth="1.5"
                            strokeDasharray="4 4"
                          >
                            <animate attributeName="stroke-dashoffset" from="8" to="0" dur="1s" repeatCount="indefinite" />
                          </line>
                          <circle cx={`${tx}%`} cy={`${ty}%`} r="3" fill="rgba(239, 68, 68, 0.6)" />
                        </svg>
                      );
                    })}
                  </div>

                  {/* Map legend */}
                  <div className="absolute bottom-3 right-3 z-30 bg-black/60 backdrop-blur-sm rounded-lg p-2 text-[10px] text-white/80 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>Available</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span>En Route</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-orange-500" />
                      <span>At Pickup / In Transit</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-gray-500" />
                      <span>Offline</span>
                    </div>
                  </div>

                  {/* Selected driver info panel */}
                  {selectedDriver && (() => {
                    const driver = driverMarkers.find(d => d.id === selectedDriver);
                    if (!driver) return null;
                    const driverTrips = activeTripPaths.filter(t => t.driverId === driver.id);
                    return (
                      <div className="absolute top-3 left-3 z-40 bg-black/80 backdrop-blur-md rounded-lg p-3 text-xs text-white max-w-[220px] border border-white/10">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold">{driver.name}</span>
                          <button onClick={() => setSelectedDriver(null)} className="text-white/50 hover:text-white">
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="space-y-1 text-white/70">
                          <div className="flex items-center gap-1.5">
                            <Phone className="w-3 h-3" />
                            <span>{driver.phone || "N/A"}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Radio className="w-3 h-3" />
                            <span className="capitalize">{driver.status}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3 h-3" />
                            <span>{formatTimeAgo(driver.lastSeenAt)}</span>
                          </div>
                          {driverTrips.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <Navigation className="w-3 h-3" />
                              <span>{driverTrips.length} active trip(s)</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── CENTER PANEL: Trip Timeline (Gantt) ──────────────────── */}
        <div className={`${expandedPanel === "timeline" ? "flex-[3]" : expandedPanel ? "hidden" : "flex-[1.2]"} border-r flex flex-col min-w-0 transition-all duration-300`}>
          <div className="flex items-center justify-between px-3 py-1.5 border-b bg-card/30 flex-shrink-0">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs font-semibold">Trip Timeline</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>{timelineStats.completedTrips}/{timelineStats.totalTrips} done</span>
                <span className="text-emerald-500">{timelineStats.activeTrips} active</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => setExpandedPanel(expandedPanel === "timeline" ? null : "timeline")}
              >
                {expandedPanel === "timeline" ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            {timelineLoading ? (
              <div className="p-3 space-y-2">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : timeline.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-8">
                No trips scheduled for today
              </div>
            ) : (
              <div className="min-w-0">
                {/* Time axis header */}
                <div className="sticky top-0 z-10 bg-card/80 backdrop-blur-sm border-b flex">
                  <div className="w-[120px] flex-shrink-0 px-2 py-1 text-[10px] text-muted-foreground font-medium border-r">
                    Driver
                  </div>
                  <div className="flex-1 relative h-6">
                    {timeMarkers.map(marker => {
                      const left = ((marker.minutes - ganttStart) / ganttRange) * 100;
                      return (
                        <div
                          key={marker.minutes}
                          className="absolute top-0 h-full flex items-center"
                          style={{ left: `${left}%` }}
                        >
                          <span className="text-[9px] text-muted-foreground whitespace-nowrap -translate-x-1/2">
                            {marker.label}
                          </span>
                        </div>
                      );
                    })}
                    {/* Current time indicator */}
                    {(() => {
                      const now = new Date();
                      const nowMins = now.getHours() * 60 + now.getMinutes();
                      if (nowMins < ganttStart || nowMins > ganttEnd) return null;
                      const left = ((nowMins - ganttStart) / ganttRange) * 100;
                      return (
                        <div className="absolute top-0 bottom-0 z-20" style={{ left: `${left}%` }}>
                          <div className="w-0.5 h-full bg-red-500 opacity-70" />
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Driver rows */}
                {timeline.map((driverRow) => {
                  const isUnassigned = driverRow.driverId === null;
                  return (
                    <div
                      key={driverRow.driverId ?? "unassigned"}
                      className={`flex border-b hover:bg-muted/30 transition-colors ${isUnassigned ? "bg-red-500/5" : ""}`}
                    >
                      <div className="w-[120px] flex-shrink-0 px-2 py-1.5 border-r flex items-center gap-1.5">
                        {isUnassigned ? (
                          <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />
                        ) : (
                          <User className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                        )}
                        <span className={`text-[11px] truncate ${isUnassigned ? "text-red-500 font-medium" : ""}`}>
                          {driverRow.driverName}
                        </span>
                        <Badge variant="secondary" className="text-[8px] h-3.5 px-1 ml-auto flex-shrink-0">
                          {driverRow.trips.length}
                        </Badge>
                      </div>
                      <div className="flex-1 relative py-1 min-h-[32px]">
                        {/* Current time line on each row */}
                        {(() => {
                          const now = new Date();
                          const nowMins = now.getHours() * 60 + now.getMinutes();
                          if (nowMins < ganttStart || nowMins > ganttEnd) return null;
                          const left = ((nowMins - ganttStart) / ganttRange) * 100;
                          return <div className="absolute top-0 bottom-0 z-10" style={{ left: `${left}%` }}><div className="w-px h-full bg-red-500/30" /></div>;
                        })()}

                        {driverRow.trips.map((trip) => {
                          const startMins = timeToMinutes(trip.startTime);
                          const endMins = trip.endTime ? timeToMinutes(trip.endTime) : startMins + 45; // Default 45 min trip
                          const leftPct = Math.max(((startMins - ganttStart) / ganttRange) * 100, 0);
                          const widthPct = Math.max(((endMins - startMins) / ganttRange) * 100, 1.5);
                          const barColor = GANTT_STATUS_COLORS[trip.status] || "bg-gray-400";
                          const isSelected = selectedTrip === trip.id;

                          return (
                            <Tooltip key={trip.id}>
                              <TooltipTrigger asChild>
                                <button
                                  className={`absolute top-1 h-[22px] rounded-sm cursor-pointer transition-all duration-200 ${barColor} ${
                                    isSelected ? "ring-2 ring-white/60 z-20 scale-y-110" : "hover:brightness-125 z-10"
                                  }`}
                                  style={{
                                    left: `${leftPct}%`,
                                    width: `${widthPct}%`,
                                    minWidth: "12px",
                                  }}
                                  onClick={() => setSelectedTrip(isSelected ? null : trip.id)}
                                >
                                  <span className="text-[8px] px-0.5 truncate block leading-[22px] text-white/90 font-medium">
                                    {trip.publicId}
                                  </span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[250px]">
                                <div className="text-xs space-y-0.5">
                                  <p className="font-bold">{trip.publicId}</p>
                                  <p>Patient: {trip.patientName}</p>
                                  <p>Status: {trip.status.replace(/_/g, " ")}</p>
                                  <p>Time: {trip.startTime || "TBD"} - {trip.endTime || "TBD"}</p>
                                  {trip.pickupAddress && <p className="text-muted-foreground truncate">From: {trip.pickupAddress}</p>}
                                  {trip.dropoffAddress && <p className="text-muted-foreground truncate">To: {trip.dropoffAddress}</p>}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Gantt legend */}
          <div className="flex items-center gap-3 px-3 py-1 border-t bg-card/30 text-[9px] text-muted-foreground flex-shrink-0 flex-wrap">
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-emerald-500" /> Assigned</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-blue-500" /> En Route</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-orange-500" /> In Progress</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-gray-500/50" /> Completed</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-white/30 border border-white/20" /> Unassigned</div>
            <div className="flex items-center gap-1"><div className="w-0.5 h-3 bg-red-500" /> Now</div>
          </div>
        </div>

        {/* ─── RIGHT PANEL: Intelligence Feed ───────────────────────── */}
        <div className={`${expandedPanel === "alerts" ? "flex-[3]" : expandedPanel ? "hidden" : "w-[320px]"} flex flex-col min-w-0 transition-all duration-300`}>
          <div className="flex items-center justify-between px-3 py-1.5 border-b bg-card/30 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-semibold">Intelligence Feed</span>
              {alerts.length > 0 && (
                <Badge variant="destructive" className="text-[10px] h-4 px-1 animate-pulse">
                  {alerts.length}
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => setExpandedPanel(expandedPanel === "alerts" ? null : "alerts")}
            >
              {expandedPanel === "alerts" ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            </Button>
          </div>

          <ScrollArea className="flex-1">
            {alertsLoading ? (
              <div className="p-3 space-y-2">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-6">
                <CheckCircle className="w-8 h-8 text-emerald-500 mb-2" />
                <p className="text-sm font-medium">All clear</p>
                <p className="text-xs text-muted-foreground mt-1">No active alerts right now</p>
              </div>
            ) : (
              <div className="p-2 space-y-1.5">
                {alerts.map((alert) => {
                  const config = URGENCY_CONFIG[alert.urgency];
                  const AlertIcon = alert.urgency === "critical"
                    ? AlertCircle
                    : alert.urgency === "high"
                      ? AlertTriangle
                      : alert.urgency === "medium"
                        ? Info
                        : Info;

                  return (
                    <div
                      key={alert.id}
                      className={`rounded-lg border p-2.5 transition-all duration-200 hover:shadow-md ${config.borderColor} ${config.bgTint}`}
                    >
                      <div className="flex items-start gap-2">
                        <AlertIcon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${config.textColor}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <Badge className={`text-[8px] h-3.5 px-1 ${config.color} text-white border-0`}>
                              {config.label}
                            </Badge>
                            <span className="text-[9px] text-muted-foreground">
                              {alert.type.replace(/_/g, " ")}
                            </span>
                          </div>
                          <p className="text-[11px] font-medium leading-tight">{alert.title}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{alert.description}</p>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-5 text-[9px] px-2"
                              onClick={() => handleAlertAction(alert)}
                            >
                              {alert.actionType === "reassign" && <ArrowRightLeft className="w-2.5 h-2.5 mr-0.5" />}
                              {alert.actionType === "send_eta" && <Send className="w-2.5 h-2.5 mr-0.5" />}
                              {alert.actionType === "call_driver" && <Phone className="w-2.5 h-2.5 mr-0.5" />}
                              {alert.actionType === "assign" && <Zap className="w-2.5 h-2.5 mr-0.5" />}
                              {alert.actionType === "view_forecast" && <TrendingUp className="w-2.5 h-2.5 mr-0.5" />}
                              {alert.actionLabel}
                            </Button>
                            {alert.entityId && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 text-[9px] px-1.5"
                                onClick={() => {
                                  if (alert.entityType === "trip") window.open(`/trips/${alert.entityId}`, "_blank");
                                  if (alert.entityType === "driver") window.open(`/drivers/${alert.entityId}`, "_blank");
                                }}
                              >
                                <Eye className="w-2.5 h-2.5 mr-0.5" />
                                View
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* ─── BOTTOM BAR: Live KPIs ──────────────────────────────────── */}
      <div className="border-t bg-card/50 backdrop-blur-sm px-4 py-1.5 flex-shrink-0">
        {kpisLoading ? (
          <div className="flex items-center gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <Skeleton key={i} className="h-8 w-24" />)}
          </div>
        ) : (
          <div className="flex items-center gap-1 justify-between">
            <KpiPill
              icon={<CheckCircle className="w-3 h-3 text-emerald-500" />}
              label="On-Time"
              value={`${kpis?.onTimeRate ?? 0}%`}
              accent={
                (kpis?.onTimeRate ?? 100) >= 90
                  ? "text-emerald-500"
                  : (kpis?.onTimeRate ?? 100) >= 75
                    ? "text-yellow-500"
                    : "text-red-500"
              }
            />
            <KpiDivider />
            <KpiPill
              icon={<Activity className="w-3 h-3 text-blue-500" />}
              label="Active"
              value={String(kpis?.activeTrips ?? 0)}
            />
            <KpiDivider />
            <KpiPill
              icon={<CheckCircle className="w-3 h-3 text-emerald-500" />}
              label="Completed"
              value={`${kpis?.completedTrips ?? 0}/${kpis?.totalTrips ?? 0}`}
            />
            <KpiDivider />
            <KpiPill
              icon={<DollarSign className="w-3 h-3 text-emerald-500" />}
              label="Revenue"
              value={`$${(kpis?.revenueToday ?? 0).toLocaleString()}`}
            />
            <KpiDivider />
            <KpiPill
              icon={<Car className="w-3 h-3 text-blue-500" />}
              label="Fleet"
              value={`${kpis?.fleetUtilization ?? 0}%`}
              subtext={`${kpis?.onlineDrivers ?? 0}/${kpis?.totalDrivers ?? 0}`}
            />
            <KpiDivider />
            <KpiPill
              icon={<Star className="w-3 h-3 text-amber-500" />}
              label="Rating"
              value={String(kpis?.avgRating ?? 0)}
            />
            <KpiDivider />
            <KpiPill
              icon={<AlertTriangle className="w-3 h-3 text-red-500" />}
              label="At Risk"
              value={String(kpis?.tripsAtRisk ?? 0)}
              accent={(kpis?.tripsAtRisk ?? 0) > 0 ? "text-red-500" : undefined}
            />
            <KpiDivider />
            <KpiPill
              icon={<AlertCircle className="w-3 h-3 text-orange-500" />}
              label="Unassigned"
              value={String(kpis?.unassignedCount ?? 0)}
              accent={(kpis?.unassignedCount ?? 0) > 0 ? "text-orange-500" : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KPI Pill subcomponents ─────────────────────────────────────────────────

function KpiPill({
  icon,
  label,
  value,
  accent,
  subtext,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
  subtext?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5">
      {icon}
      <div className="flex flex-col">
        <span className="text-[9px] text-muted-foreground leading-none">{label}</span>
        <div className="flex items-center gap-1">
          <span className={`text-sm font-bold tabular-nums leading-tight ${accent || ""}`}>{value}</span>
          {subtext && <span className="text-[9px] text-muted-foreground">{subtext}</span>}
        </div>
      </div>
    </div>
  );
}

function KpiDivider() {
  return <div className="w-px h-6 bg-border" />;
}
