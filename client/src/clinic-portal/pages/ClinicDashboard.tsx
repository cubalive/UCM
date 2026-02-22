import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { useState, useEffect, useRef, useCallback } from "react";
import { playSound } from "@/hooks/use-sound-notifications";
import {
  Car,
  Clock,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  MapPin,
  CreditCard,
  ArrowRight,
  Users,
  CalendarDays,
  Radar,
  Bell,
  Accessibility,
  DoorOpen,
  RotateCcw,
  Timer,
  Eye,
  Volume2,
  VolumeX,
} from "lucide-react";

declare global {
  interface Window {
    __MAPS_KEY_CACHE__?: string;
  }
}

async function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (window.google?.maps) return;
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existing) {
      if (window.google?.maps) return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Maps script failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry,places`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Maps script failed"));
    document.head.appendChild(script);
  });
}

const PHASE_COLORS: Record<string, string> = {
  ASSIGNED: "#6366f1",
  EN_ROUTE_TO_PICKUP: "#3b82f6",
  ARRIVED_PICKUP: "#f59e0b",
  PICKED_UP: "#a855f7",
  EN_ROUTE_TO_DROPOFF: "#06b6d4",
  ARRIVED_DROPOFF: "#8b5cf6",
  IN_PROGRESS: "#22c55e",
};

const PHASE_LABELS: Record<string, string> = {
  ASSIGNED: "Assigned",
  EN_ROUTE_TO_PICKUP: "En Route to Pickup",
  ARRIVED_PICKUP: "At Pickup",
  PICKED_UP: "Picked Up",
  EN_ROUTE_TO_DROPOFF: "En Route to Dropoff",
  ARRIVED_DROPOFF: "At Dropoff",
  IN_PROGRESS: "In Progress",
};

const ALERT_ICONS: Record<string, any> = {
  wheelchair_surge: Accessibility,
  at_door: DoorOpen,
  return_backlog: RotateCcw,
  high_delay_risk: Timer,
};

const ALERT_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  danger: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400", icon: "text-red-400" },
  warning: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400", icon: "text-amber-400" },
  info: { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-400", icon: "text-blue-400" },
};

function ArrivalRadarMap({ trips, clinic }: { trips: any[]; clinic: any }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        let apiKey = window.__MAPS_KEY_CACHE__;
        if (!apiKey) {
          const res = await fetch("/api/public/maps/key");
          const json = await res.json();
          apiKey = json.key;
          if (apiKey) window.__MAPS_KEY_CACHE__ = apiKey;
        }
        if (!apiKey || cancelled) {
          if (!cancelled) setMapError(true);
          return;
        }
        await loadGoogleMapsScript(apiKey);
        if (!cancelled) setMapsReady(true);
      } catch {
        if (!cancelled) setMapError(true);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mapsReady || !mapContainerRef.current) return;
    if (!clinic?.lat || !clinic?.lng) return;

    if (!mapRef.current) {
      mapRef.current = new google.maps.Map(mapContainerRef.current, {
        center: { lat: clinic.lat, lng: clinic.lng },
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: [
          { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
          { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
          { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
          { featureType: "road", elementType: "geometry", stylers: [{ color: "#304a7d" }] },
          { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#255763" }] },
          { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
          { featureType: "poi", stylers: [{ visibility: "off" }] },
        ],
      });

      infoWindowRef.current = new google.maps.InfoWindow();

      new google.maps.Marker({
        position: { lat: clinic.lat, lng: clinic.lng },
        map: mapRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: "#ef4444",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
          scale: 8,
        },
        title: clinic.name || "Clinic",
        zIndex: 1000,
      });
    }
  }, [mapsReady, clinic]);

  useEffect(() => {
    if (!mapRef.current || !mapsReady) return;

    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    const driversWithLocation = trips.filter(t => t.driverLastLat && t.driverLastLng);

    driversWithLocation.forEach(trip => {
      const color = PHASE_COLORS[trip.phase] || "#6b7280";
      const marker = new google.maps.Marker({
        position: { lat: trip.driverLastLat, lng: trip.driverLastLng },
        map: mapRef.current!,
        icon: {
          path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
          fillColor: color,
          fillOpacity: 0.9,
          strokeColor: "#fff",
          strokeWeight: 1.5,
          scale: 1.4,
          anchor: new google.maps.Point(12, 22),
        },
        title: `${trip.driverName || "Driver"} — ${PHASE_LABELS[trip.phase] || trip.phase}`,
        zIndex: 500,
      });

      marker.addListener("click", () => {
        const etaText = trip.etaMinutes != null ? `${trip.etaMinutes} min` : "—";
        const content = `
          <div style="font-family:system-ui;font-size:13px;max-width:220px;color:#1e293b">
            <div style="font-weight:600;margin-bottom:4px">${trip.patientName || "Patient"}</div>
            <div style="color:#64748b;font-size:11px;margin-bottom:3px">${trip.driverName || "No driver"}</div>
            <div style="display:flex;gap:8px;font-size:11px;color:#475569;margin-bottom:6px">
              <span style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${PHASE_LABELS[trip.phase] || trip.phase}</span>
              <span>ETA: ${etaText}</span>
            </div>
            ${trip.insideGeofence ? '<div style="color:#22c55e;font-size:11px;font-weight:500">● At clinic door</div>' : ''}
            <div style="margin-top:6px">
              <a href="#" id="radar-trip-${trip.tripId}" style="color:#3b82f6;font-size:11px;text-decoration:none;font-weight:500">View Trip →</a>
            </div>
          </div>
        `;
        infoWindowRef.current?.setContent(content);
        infoWindowRef.current?.open(mapRef.current!, marker);

        setTimeout(() => {
          const link = document.getElementById(`radar-trip-${trip.tripId}`);
          if (link) {
            link.addEventListener("click", (e) => {
              e.preventDefault();
              navigate(`/trips`);
            });
          }
        }, 100);
      });

      markersRef.current.push(marker);
    });
  }, [trips, mapsReady, navigate]);

  if (mapError) {
    return (
      <div className="h-[280px] bg-[#111827] border border-[#1e293b] rounded-xl flex items-center justify-center">
        <div className="text-center">
          <MapPin className="w-8 h-8 text-gray-700 mx-auto mb-2" />
          <p className="text-sm text-gray-500">Map unavailable</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={mapContainerRef}
      className="h-[280px] rounded-xl overflow-hidden border border-[#1e293b]"
      data-testid="arrival-radar-map"
    />
  );
}

function SmartAlerts({ alerts, soundEnabled, onToggleSound }: { alerts: any[]; soundEnabled: boolean; onToggleSound: () => void }) {
  const [, navigate] = useLocation();

  if (alerts.length === 0) {
    return (
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 text-center" data-testid="no-alerts">
        <Bell className="w-6 h-6 text-gray-700 mx-auto mb-2" />
        <p className="text-xs text-gray-500">No active alerts</p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="smart-alerts-list">
      {alerts.map((alert: any) => {
        const colors = ALERT_COLORS[alert.severity] || ALERT_COLORS.info;
        const Icon = ALERT_ICONS[alert.type] || AlertTriangle;
        return (
          <div
            key={alert.id}
            className={`${colors.bg} border ${colors.border} rounded-xl p-4 transition-all`}
            data-testid={`alert-${alert.type}`}
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5">
                <Icon className={`w-5 h-5 ${colors.icon}`} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className={`text-sm font-semibold ${colors.text}`}>{alert.title}</h4>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">{alert.message}</p>
                <button
                  onClick={() => navigate(alert.ctaHref)}
                  className={`mt-2 text-xs font-medium ${colors.text} hover:underline flex items-center gap-1`}
                  data-testid={`alert-cta-${alert.type}`}
                >
                  <Eye className="w-3 h-3" />
                  {alert.ctaLabel}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ClinicDashboard() {
  const { user } = useAuth();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const firedSignaturesRef = useRef<Set<string>>(new Set());

  const { data: ops, isLoading: opsLoading } = useQuery({
    queryKey: ["/api/clinic/ops"],
    enabled: !!user?.clinicId,
  });

  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ["/api/clinic/metrics"],
    enabled: !!user?.clinicId,
  });

  const { data: activeTrips, isLoading: activeLoading } = useQuery({
    queryKey: ["/api/clinic/active-trips"],
    enabled: !!user?.clinicId,
  });

  const { data: inboundData } = useQuery<any>({
    queryKey: ["/api/clinic/inbound-live"],
    enabled: !!user?.clinicId,
    refetchInterval: 15000,
  });

  const { data: alertData } = useQuery<any>({
    queryKey: ["/api/clinic/alert-inputs"],
    enabled: !!user?.clinicId,
    refetchInterval: 15000,
  });

  const alerts = (alertData as any)?.alerts ?? [];

  useEffect(() => {
    if (!alerts.length || !soundEnabled) return;
    const newAlerts = alerts.filter((a: any) => !firedSignaturesRef.current.has(a.signature));
    if (newAlerts.length > 0) {
      playSound("new_trip");
      newAlerts.forEach((a: any) => firedSignaturesRef.current.add(a.signature));
    }
  }, [alerts, soundEnabled]);

  const inboundTrips = (inboundData as any)?.trips ?? [];
  const clinicInfo = (inboundData as any)?.clinic ?? null;

  const todayTrips = (ops as any)?.todayTrips ?? 0;
  const activeCount = Array.isArray(activeTrips) ? activeTrips.length : 0;
  const completedToday = (ops as any)?.completedToday ?? 0;
  const cancelledToday = (ops as any)?.cancelledToday ?? 0;
  const totalPatients = (metrics as any)?.totalPatients ?? 0;
  const avgRating = (metrics as any)?.avgRating ?? 0;

  const statCards = [
    { label: "Today's Trips", value: todayTrips, icon: CalendarDays, color: "blue", testId: "stat-today-trips" },
    { label: "Active Now", value: activeCount, icon: Car, color: "green", testId: "stat-active" },
    { label: "Completed", value: completedToday, icon: CheckCircle2, color: "emerald", testId: "stat-completed" },
    { label: "Cancelled", value: cancelledToday, icon: AlertTriangle, color: "amber", testId: "stat-cancelled" },
  ];

  const quickActions = [
    { label: "View All Trips", href: "/trips", icon: Car, testId: "action-trips" },
    { label: "Live Tracking", href: "/live", icon: MapPin, testId: "action-live" },
    { label: "Billing & Invoices", href: "/billing", icon: CreditCard, testId: "action-billing" },
  ];

  const loading = opsLoading || metricsLoading || activeLoading;

  const inboundWithDrivers = inboundTrips.filter((t: any) => t.driverLastLat && t.driverLastLng);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="clinic-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white" data-testid="text-welcome">
            Welcome back
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Here's your clinic overview for today
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Clock className="w-3.5 h-3.5" />
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="stats-grid">
        {statCards.map((stat) => (
          <div
            key={stat.testId}
            className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 hover:border-blue-500/30 transition-colors"
            data-testid={stat.testId}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-500 uppercase tracking-wider">{stat.label}</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-${stat.color}-500/10`}>
                <stat.icon className={`w-4 h-4 text-${stat.color}-400`} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 bg-gray-800 rounded animate-pulse" />
            ) : (
              <p className="text-2xl font-bold text-white">{stat.value}</p>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden" data-testid="arrival-radar-section">
            <div className="px-5 py-4 border-b border-[#1e293b] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Radar className="w-4 h-4 text-cyan-400" />
                Arrival Radar
                {inboundWithDrivers.length > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 font-medium">
                    {inboundWithDrivers.length} driver{inboundWithDrivers.length !== 1 ? "s" : ""}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-600 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  Live • 15s
                </span>
              </div>
            </div>
            {clinicInfo?.lat && clinicInfo?.lng ? (
              <ArrivalRadarMap trips={inboundTrips} clinic={clinicInfo} />
            ) : (
              <div className="h-[280px] flex items-center justify-center">
                <div className="text-center">
                  <MapPin className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Clinic location not configured</p>
                  <p className="text-xs text-gray-600 mt-1">Contact admin to set clinic coordinates</p>
                </div>
              </div>
            )}
            {inboundWithDrivers.length > 0 && (
              <div className="px-5 py-3 border-t border-[#1e293b]">
                <div className="flex flex-wrap gap-3">
                  {inboundWithDrivers.slice(0, 4).map((trip: any) => (
                    <div
                      key={trip.tripId}
                      className="flex items-center gap-2 text-xs"
                      data-testid={`radar-driver-${trip.tripId}`}
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: PHASE_COLORS[trip.phase] || "#6b7280" }}
                      />
                      <span className="text-gray-400">{trip.driverName || "Driver"}</span>
                      {trip.etaMinutes != null && (
                        <span className="text-gray-500">{trip.etaMinutes}m</span>
                      )}
                      {trip.insideGeofence && (
                        <span className="text-green-400 font-medium">At door</span>
                      )}
                    </div>
                  ))}
                  {inboundWithDrivers.length > 4 && (
                    <span className="text-xs text-gray-600">+{inboundWithDrivers.length - 4} more</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-400" />
              Staff Alerts
              {alerts.length > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">
                  {alerts.length}
                </span>
              )}
            </h2>
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-gray-500 hover:text-gray-300"
              title={soundEnabled ? "Mute alerts" : "Unmute alerts"}
              data-testid="button-toggle-alert-sound"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>
          <SmartAlerts
            alerts={alerts}
            soundEnabled={soundEnabled}
            onToggleSound={() => setSoundEnabled(!soundEnabled)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {quickActions.map((action) => (
          <Link key={action.testId} href={action.href}>
            <div
              className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 hover:border-blue-500/30 hover:bg-[#111827]/80 transition-all cursor-pointer group"
              data-testid={action.testId}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                    <action.icon className="w-5 h-5 text-blue-400" />
                  </div>
                  <span className="text-sm font-medium text-white">{action.label}</span>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors" />
              </div>
            </div>
          </Link>
        ))}
      </div>

      {Array.isArray(activeTrips) && activeTrips.length > 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden" data-testid="active-trips-section">
          <div className="px-5 py-4 border-b border-[#1e293b] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Active Trips
            </h2>
            <Link href="/live">
              <span className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer" data-testid="link-view-live">
                View Live Map
              </span>
            </Link>
          </div>
          <div className="divide-y divide-[#1e293b]">
            {(activeTrips as any[]).slice(0, 5).map((trip: any) => (
              <div key={trip.id} className="px-5 py-3 flex items-center justify-between hover:bg-white/[0.02]" data-testid={`active-trip-${trip.id}`}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-500/10 rounded-full flex items-center justify-center">
                    <Car className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm text-white">{trip.patientName || "Patient"}</p>
                    <p className="text-xs text-gray-500">{trip.pickupAddress || "Pickup"} → {trip.dropoffAddress || "Dropoff"}</p>
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  trip.status === "EN_ROUTE_PICKUP" ? "bg-blue-500/10 text-blue-400" :
                  trip.status === "EN_ROUTE_DROPOFF" ? "bg-cyan-500/10 text-cyan-400" :
                  trip.status === "ARRIVED_PICKUP" ? "bg-amber-500/10 text-amber-400" :
                  "bg-gray-500/10 text-gray-400"
                }`} data-testid={`trip-status-${trip.id}`}>
                  {(trip.status || "").replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5" data-testid="stat-patients">
          <div className="flex items-center gap-3 mb-2">
            <Users className="w-5 h-5 text-purple-400" />
            <span className="text-sm font-medium text-white">Total Patients</span>
          </div>
          {loading ? (
            <div className="h-8 w-16 bg-gray-800 rounded animate-pulse" />
          ) : (
            <p className="text-3xl font-bold text-white">{totalPatients}</p>
          )}
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5" data-testid="stat-rating">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="w-5 h-5 text-green-400" />
            <span className="text-sm font-medium text-white">Average Rating</span>
          </div>
          {loading ? (
            <div className="h-8 w-16 bg-gray-800 rounded animate-pulse" />
          ) : (
            <p className="text-3xl font-bold text-white">{avgRating > 0 ? avgRating.toFixed(1) : "N/A"}</p>
          )}
        </div>
      </div>
    </div>
  );
}
