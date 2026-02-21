/// <reference types="google.maps" />
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth, authHeaders } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AlertTriangle, MapPin, RefreshCw, Users } from "lucide-react";

interface DriverLocation {
  driver_id: number;
  driver_name: string;
  company_name: string | null;
  city_id: number;
  lat: number;
  lng: number;
  updated_at: string | null;
  status: string;
  stale: boolean;
  vehicle_id: number | null;
  vehicle_label: string | null;
  vehicle_color: string | null;
  vehicle_color_hex: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  active_trip_status?: string | null;
  active_trip_id?: string | null;
  active_trip_patient?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  available: "#22c55e",
  enroute: "#ef4444",
  hold: "#eab308",
  off: "#9ca3af",
};

const STATUS_LABELS: Record<string, string> = {
  available: "Available",
  enroute: "En Route",
  hold: "Hold",
  off: "Off Duty",
};

const STALE_THRESHOLD_MS = 90 * 1000;

function isStale(updatedAt: string | null): boolean {
  if (!updatedAt) return true;
  return Date.now() - new Date(updatedAt).getTime() > STALE_THRESHOLD_MS;
}

function formatTimeAgo(updatedAt: string | null): string {
  if (!updatedAt) return "No data";
  const diff = Date.now() - new Date(updatedAt).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function useGoogleMapsApiKey() {
  const { token } = useAuth();
  return useQuery<{ key: string | null }>({
    queryKey: ["/api/maps/client-key"],
    queryFn: async () => {
      const res = await fetch("/api/maps/client-key", {
        headers: authHeaders(token),
      });
      if (!res.ok) return { key: null };
      return res.json();
    },
    enabled: !!token,
    staleTime: Infinity,
    retry: 1,
  });
}

function useLoadGoogleMapsScript(apiKey: string | null | undefined) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) return;

    if (window.google?.maps) {
      setLoaded(true);
      return;
    }

    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      existingScript.addEventListener("load", () => setLoaded(true));
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker,places`;
    script.async = true;
    script.defer = true;
    script.onload = () => setLoaded(true);
    script.onerror = () => setError("Failed to load Google Maps");
    document.head.appendChild(script);
  }, [apiKey]);

  return { loaded, error };
}

interface GoogleMapProps {
  drivers: DriverLocation[];
  center: { lat: number; lng: number };
  zoom: number;
  mapsLoaded: boolean;
}

const CAR_SVG_PATH = "M 7 1 C 5.5 1 4.3 1.8 3.8 3 L 2 3 C 0.9 3 0 3.9 0 5 L 0 10 C 0 10.6 0.4 11 1 11 L 2.5 11 C 2.5 12.4 3.6 13.5 5 13.5 C 6.4 13.5 7.5 12.4 7.5 11 L 12.5 11 C 12.5 12.4 13.6 13.5 15 13.5 C 16.4 13.5 17.5 12.4 17.5 11 L 19 11 C 19.6 11 20 10.6 20 10 L 20 5 C 20 3.9 19.1 3 18 3 L 16.2 3 C 15.7 1.8 14.5 1 13 1 Z M 5 10 C 4.4 10 4 10.4 4 11 C 4 11.6 4.4 12 5 12 C 5.6 12 6 11.6 6 11 C 6 10.4 5.6 10 5 10 Z M 15 10 C 14.4 10 14 10.4 14 11 C 14 11.6 14.4 12 15 12 C 15.6 12 16 11.6 16 11 C 16 10.4 15.6 10 15 10 Z M 4 5 L 7 3 L 13 3 L 16 5 Z";

const DEFAULT_MARKER_COLOR = "#9ca3af";

function getVehicleLabel(model: string | null, make: string | null): string {
  if (model) {
    const m = model.toUpperCase().replace(/\s+/g, "");
    return m.length > 6 ? m.substring(0, 6) : m;
  }
  if (make) {
    const m = make.toUpperCase().replace(/\s+/g, "");
    return m.length > 6 ? m.substring(0, 6) : m;
  }
  return "UCM";
}

function getTextColor(hexColor: string): string {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1e293b" : "#ffffff";
}

const iconCache = new Map<string, google.maps.Icon>();

function createCarIcon(vehicleColor: string | null, stale: boolean, statusColor: string, vehicleModel: string | null, vehicleMake: string | null) {
  const fillColor = vehicleColor || DEFAULT_MARKER_COLOR;
  const label = getVehicleLabel(vehicleModel, vehicleMake);
  const cacheKey = `${fillColor}-${stale}-${statusColor}-${label}`;

  const cached = iconCache.get(cacheKey);
  if (cached) return cached;

  const opacity = stale ? 0.5 : 1;
  const strokeColor = stale ? "#f59e0b" : statusColor;
  const strokeWidth = stale ? 1.5 : 1;
  const statusDot = `<circle cx="19" cy="2" r="3.5" fill="${statusColor}" stroke="white" stroke-width="1"/>`;
  const textColor = getTextColor(fillColor);
  const fontSize = label.length > 5 ? "3.2" : label.length > 4 ? "3.5" : "4";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="32" viewBox="-2 -2 25 20">
    <path d="${CAR_SVG_PATH}" fill="${fillColor}" fill-opacity="${opacity}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>
    <text x="10" y="8.5" text-anchor="middle" fill="${textColor}" fill-opacity="${opacity}" font-size="${fontSize}" font-family="Arial,sans-serif" font-weight="700" letter-spacing="0.3">${label}</text>
    ${statusDot}
  </svg>`;

  const icon = {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(42, 32),
    anchor: new google.maps.Point(21, 16),
  };
  iconCache.set(cacheKey, icon);
  return icon;
}

function createFallbackIcon(stale: boolean, statusColor: string) {
  const cacheKey = `fallback-${stale}-${statusColor}`;
  const cached = iconCache.get(cacheKey);
  if (cached) return cached;

  const opacity = stale ? 0.5 : 1;
  const strokeColor = stale ? "#f59e0b" : "#ffffff";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
    <circle cx="14" cy="14" r="10" fill="${DEFAULT_MARKER_COLOR}" fill-opacity="${opacity}" stroke="${strokeColor}" stroke-width="2"/>
    <text x="14" y="17.5" text-anchor="middle" fill="white" fill-opacity="${opacity}" font-size="6" font-family="Arial,sans-serif" font-weight="700">UCM</text>
  </svg>`;

  const icon = {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(28, 28),
    anchor: new google.maps.Point(14, 14),
  };
  iconCache.set(cacheKey, icon);
  return icon;
}

declare global {
  interface Window {
    __UCM_MAP__?: Record<string, {
      map: google.maps.Map;
      container: HTMLDivElement;
      markers: Map<number, google.maps.Marker>;
      labels: Map<number, google.maps.Marker>;
      infoWindow: google.maps.InfoWindow;
      driversData: Map<number, DriverLocation>;
      boundsFit: boolean;
    }>;
  }
}

function getOrCreateGlobalMap(key: string, center: { lat: number; lng: number }, zoom: number): NonNullable<Window['__UCM_MAP__']>[string] | null {
  if (!window.google?.maps) return null;
  if (!window.__UCM_MAP__) window.__UCM_MAP__ = {};
  if (window.__UCM_MAP__[key]) return window.__UCM_MAP__[key];

  const container = document.createElement("div");
  container.className = "w-full h-full rounded-md ucm-map-container";
  container.style.minHeight = "500px";
  container.setAttribute("data-testid", "div-google-map");

  console.log("MAP INIT live-map-dispatch");
  const map = new google.maps.Map(container, {
    center,
    zoom,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    zoomControl: true,
    styles: [
      { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
    ],
  });

  window.__UCM_MAP__[key] = {
    map,
    container,
    markers: new Map(),
    labels: new Map(),
    infoWindow: new google.maps.InfoWindow(),
    driversData: new Map(),
    boundsFit: false,
  };

  return window.__UCM_MAP__[key];
}

function GoogleMapView({ drivers, center, zoom, mapsLoaded }: GoogleMapProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapKeyRef = useRef("live-map-dispatch");

  useEffect(() => {
    if (!mapsLoaded || !wrapperRef.current || !window.google?.maps) return;
    const entry = getOrCreateGlobalMap(mapKeyRef.current, center, zoom);
    if (!entry) return;
    if (entry.container.parentNode !== wrapperRef.current) {
      wrapperRef.current.appendChild(entry.container);
      google.maps.event.trigger(entry.map, "resize");
    }
  }, [mapsLoaded]);

  useEffect(() => {
    if (!mapsLoaded || !window.google?.maps) return;
    const entry = window.__UCM_MAP__?.[mapKeyRef.current];
    if (!entry) return;

    const currentIds = new Set(drivers.map((d) => d.driver_id));
    const existingIdArray = Array.from(entry.markers.keys());

    existingIdArray.forEach((id) => {
      if (!currentIds.has(id)) {
        entry.markers.get(id)?.setMap(null);
        entry.markers.delete(id);
        entry.labels.get(id)?.setMap(null);
        entry.labels.delete(id);
        entry.driversData.delete(id);
      }
    });

    drivers.forEach((driver) => {
      const stale = isStale(driver.updated_at);
      const statusColor = STATUS_COLORS[driver.status] || STATUS_COLORS.off;
      const hasVehicle = driver.vehicle_id != null;
      const icon = hasVehicle
        ? createCarIcon(driver.vehicle_color_hex || driver.vehicle_color, stale, statusColor, driver.vehicle_model, driver.vehicle_make)
        : createFallbackIcon(stale, statusColor);
      const pos = { lat: driver.lat, lng: driver.lng };

      entry.driversData.set(driver.driver_id, driver);

      const existingMarker = entry.markers.get(driver.driver_id);
      const existingLabel = entry.labels.get(driver.driver_id);

      if (existingMarker) {
        existingMarker.setPosition(pos);
        existingMarker.setIcon(icon);
        existingMarker.setZIndex(stale ? 1 : 10);
        if (existingLabel) {
          existingLabel.setPosition(pos);
          existingLabel.setZIndex(stale ? 0 : 5);
        }
      } else {
        const marker = new google.maps.Marker({
          position: pos,
          map: entry.map,
          icon,
          title: driver.driver_name,
          zIndex: stale ? 1 : 10,
        });

        const firstName = driver.driver_name.split(" ")[0];
        const labelMarker = new google.maps.Marker({
          position: pos,
          map: entry.map,
          icon: {
            url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'),
            scaledSize: new google.maps.Size(1, 1),
            anchor: new google.maps.Point(0, 0),
          },
          label: {
            text: firstName,
            color: "#1e293b",
            fontSize: "11px",
            fontWeight: "600",
            className: "driver-map-label",
          },
          clickable: false,
          zIndex: stale ? 0 : 5,
        });

        marker.addListener("click", () => {
          const d = entry.driversData.get(driver.driver_id);
          if (!d) return;
          const dStale = isStale(d.updated_at);
          const dStatusColor = STATUS_COLORS[d.status] || STATUS_COLORS.off;
          const statusLabel = STATUS_LABELS[d.status] || d.status;
          const timeAgo = formatTimeAgo(d.updated_at);
          const staleTag = dStale
            ? `<div style="color:#d97706;font-weight:600;font-size:11px;margin-top:4px;">STALE</div>`
            : "";
          const vehicleMakeModel = d.vehicle_make && d.vehicle_model
            ? `${d.vehicle_make} ${d.vehicle_model}`
            : d.vehicle_make || d.vehicle_model || null;
          const vehicleInfo = d.vehicle_label
            ? `<div style="font-size:11px;color:#666;margin-top:2px;">Vehicle: ${d.vehicle_label}${vehicleMakeModel ? ` (${vehicleMakeModel})` : ""}</div>`
            : `<div style="font-size:11px;color:#999;margin-top:2px;font-style:italic;">No vehicle assigned</div>`;

          const tripStatusColors: Record<string, string> = {
            SCHEDULED: "#3b82f6",
            ASSIGNED: "#f97316",
            EN_ROUTE_TO_PICKUP: "#f59e0b",
            ARRIVED_PICKUP: "#8b5cf6",
            PICKED_UP: "#a855f7",
            EN_ROUTE_TO_DROPOFF: "#ef4444",
            IN_PROGRESS: "#ef4444",
            ARRIVED_DROPOFF: "#06b6d4",
            COMPLETED: "#22c55e",
          };
          const tripBadge = d.active_trip_status
            ? `<div style="margin-top:4px;padding:3px 6px;border-radius:4px;background:${tripStatusColors[d.active_trip_status] || '#6b7280'};color:#fff;font-size:10px;font-weight:600;display:inline-block;">${d.active_trip_status.replace(/_/g, ' ')}</div>
               ${d.active_trip_id ? `<div style="font-size:10px;color:#666;margin-top:2px;">Trip: ${d.active_trip_id}</div>` : ""}
               ${d.active_trip_patient ? `<div style="font-size:10px;color:#666;">Patient: ${d.active_trip_patient}</div>` : ""}`
            : `<div style="margin-top:4px;font-size:10px;color:#999;font-style:italic;">No active trip</div>`;

          const companyInfo = d.company_name
            ? `<div style="font-size:11px;color:#666;margin-top:2px;">Company: ${d.company_name}</div>`
            : "";

          entry.infoWindow.setContent(`
            <div style="padding:4px;min-width:160px;">
              <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${d.driver_name}</div>
              ${companyInfo}
              <div style="font-size:12px;color:#666;">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dStatusColor};margin-right:4px;"></span>
                ${statusLabel}
              </div>
              ${vehicleInfo}
              <div style="font-size:11px;color:#888;margin-top:2px;">Updated: ${timeAgo}</div>
              ${staleTag}
              ${tripBadge}
            </div>
          `);
          entry.infoWindow.open(entry.map, marker);
        });

        entry.markers.set(driver.driver_id, marker);
        entry.labels.set(driver.driver_id, labelMarker);
      }
    });

    if (!entry.boundsFit && drivers.length > 0) {
      entry.boundsFit = true;
      if (drivers.length > 1) {
        const bounds = new google.maps.LatLngBounds();
        drivers.forEach((d) => bounds.extend({ lat: d.lat, lng: d.lng }));
        entry.map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
      } else {
        entry.map.setCenter({ lat: drivers[0].lat, lng: drivers[0].lng });
        entry.map.setZoom(14);
      }
    }
  }, [drivers, mapsLoaded]);

  return (
    <div
      ref={wrapperRef}
      className="w-full h-full rounded-md"
      style={{ minHeight: "500px" }}
    />
  );
}

const CITY_DEFAULTS: Record<string, { lat: number; lng: number }> = {
  default: { lat: 39.8283, lng: -98.5795 },
};

interface ActiveTripInfo {
  id: number;
  publicId: string;
  status: string;
  pickupAddress: string;
  pickupTime: string;
  scheduledDate: string;
  driver?: { id: number; firstName: string; lastName: string } | null;
  patient?: { id: number; firstName: string; lastName: string } | null;
}

function ClinicMapView({ token, cityId, mapsReady, renderError, keyLoading, mapsLoaded }: {
  token: string | null;
  cityId: number | null;
  mapsReady: boolean;
  renderError: any;
  keyLoading: boolean;
  mapsLoaded: boolean;
}) {
  const { data: driverLocations, isLoading: driversLoading, refetch, dataUpdatedAt } = useQuery<DriverLocation[]>({
    queryKey: ["/api/ops/driver-locations", cityId],
    queryFn: async () => {
      const res = await fetch(`/api/ops/driver-locations?city_id=${cityId}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!cityId && !!token,
    refetchInterval: 10000,
  });

  const { data: tripData } = useQuery<{ role: string; clinicId: number; trips: ActiveTripInfo[] }>({
    queryKey: ["/api/ops/my-active-trips", cityId],
    queryFn: async () => {
      const res = await fetch(`/api/ops/my-active-trips?city_id=${cityId}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) return { role: "clinic", clinicId: 0, trips: [] };
      return res.json();
    },
    enabled: !!cityId && !!token,
    refetchInterval: 15000,
  });

  const drivers = driverLocations || [];
  const activeTrips = tripData?.trips || [];
  const mapCenter = CITY_DEFAULTS.default;

  return (
    <div className="p-4 space-y-4 h-full flex flex-col" data-testid="page-live-map">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-live-map-title">My Clinic Trips</h1>
          <p className="text-sm text-muted-foreground">
            Active trip drivers for your clinic
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          data-testid="button-refresh-locations"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {activeTrips.length > 0 && (
        <div className="space-y-2">
          {activeTrips.map((trip) => (
            <Card key={trip.id}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium" data-testid={`text-trip-id-${trip.id}`}>
                      Trip {trip.publicId}
                    </p>
                    <p className="text-xs text-muted-foreground" data-testid={`text-trip-pickup-${trip.id}`}>
                      {trip.pickupAddress}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {trip.scheduledDate} at {trip.pickupTime}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" data-testid={`badge-trip-status-${trip.id}`}>
                      {trip.status}
                    </Badge>
                    {trip.driver && (
                      <Badge variant="outline" data-testid={`badge-trip-driver-${trip.id}`}>
                        <MapPin className="w-3 h-3 mr-1" />
                        {trip.driver.firstName} {trip.driver.lastName}
                      </Badge>
                    )}
                    {trip.patient && (
                      <span className="text-xs text-muted-foreground">
                        Patient: {trip.patient.firstName} {trip.patient.lastName}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0">
        <div className="relative h-full" style={{ minHeight: "400px" }}>
          <GoogleMapView drivers={drivers} center={mapCenter} zoom={5} mapsLoaded={mapsLoaded} />
          {renderError && (
            <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
              <Card>
                <CardContent className="text-center p-6">
                  <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-3" />
                  <p className="text-destructive font-medium" data-testid="text-map-error">Maps unavailable</p>
                  <p className="text-sm text-muted-foreground mt-1">Google Maps API key is not configured.</p>
                </CardContent>
              </Card>
            </div>
          )}
          {!renderError && (keyLoading || !mapsLoaded || driversLoading) && (
            <div className="absolute inset-0 z-10">
              <Skeleton className="w-full h-full rounded-md" data-testid="skeleton-map" />
            </div>
          )}
          {!renderError && !keyLoading && mapsLoaded && !driversLoading && drivers.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-card/90 border rounded-md p-4 text-center pointer-events-auto">
                <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground" data-testid="text-no-driver-locations">
                  No active trip drivers to display
                </p>
              </div>
            </div>
          )}
          {!renderError && !keyLoading && mapsLoaded && dataUpdatedAt && (
            <div className="absolute bottom-3 left-3">
              <Badge variant="secondary" className="text-xs" data-testid="badge-last-updated">
                Last poll: {new Date(dataUpdatedAt).toLocaleTimeString()}
              </Badge>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PatientMapView({ token, mapsReady, renderError, keyLoading, mapsLoaded, isDriver = false }: {
  token: string | null;
  mapsReady: boolean;
  renderError: any;
  keyLoading: boolean;
  mapsLoaded: boolean;
  isDriver?: boolean;
}) {
  const { data: driverLocations, isLoading: driversLoading, refetch, dataUpdatedAt } = useQuery<DriverLocation[]>({
    queryKey: ["/api/ops/driver-locations"],
    queryFn: async () => {
      const res = await fetch("/api/ops/driver-locations", {
        headers: authHeaders(token),
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!token,
    refetchInterval: 10000,
  });

  const { data: tripData } = useQuery<{ role: string; patientId: number; trip: ActiveTripInfo | null }>({
    queryKey: ["/api/ops/my-active-trips"],
    queryFn: async () => {
      const res = await fetch("/api/ops/my-active-trips", {
        headers: authHeaders(token),
      });
      if (!res.ok) return { role: "patient", patientId: 0, trip: null };
      return res.json();
    },
    enabled: !!token,
    refetchInterval: 15000,
  });

  const drivers = driverLocations || [];
  const trip = tripData?.trip || null;
  const mapCenter = CITY_DEFAULTS.default;

  if (!trip) {
    return (
      <div className="p-4 h-full flex items-center justify-center" data-testid="page-live-map">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <h2 className="text-lg font-semibold mb-1" data-testid="text-no-active-trip">{isDriver ? "No Location Data" : "No Active Trip"}</h2>
            <p className="text-sm text-muted-foreground">
              {isDriver
                ? "Your location data is not available yet. Make sure location sharing is enabled."
                : "You don't have any active trips right now. When a driver is assigned to your trip, you'll see their location here."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 h-full flex flex-col" data-testid="page-live-map">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-live-map-title">{isDriver ? "My Location" : "Your Trip"}</h1>
          <p className="text-sm text-muted-foreground">{isDriver ? "Your current location on the map" : "Track your driver in real-time"}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          data-testid="button-refresh-locations"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-medium" data-testid="text-patient-trip-id">Trip {trip.publicId}</p>
              <p className="text-xs text-muted-foreground" data-testid="text-patient-pickup">{trip.pickupAddress}</p>
              <p className="text-xs text-muted-foreground">{trip.scheduledDate} at {trip.pickupTime}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" data-testid="badge-patient-trip-status">{trip.status}</Badge>
              {trip.driver && (
                <Badge variant="outline" data-testid="badge-patient-driver">
                  <MapPin className="w-3 h-3 mr-1" />
                  {trip.driver.firstName}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex-1 min-h-0">
        <div className="relative h-full" style={{ minHeight: "400px" }}>
          <GoogleMapView drivers={drivers} center={mapCenter} zoom={5} mapsLoaded={mapsLoaded} />
          {renderError && (
            <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
              <Card>
                <CardContent className="text-center p-6">
                  <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-3" />
                  <p className="text-destructive font-medium" data-testid="text-map-error">Maps unavailable</p>
                </CardContent>
              </Card>
            </div>
          )}
          {!renderError && (keyLoading || !mapsLoaded || driversLoading) && (
            <div className="absolute inset-0 z-10">
              <Skeleton className="w-full h-full rounded-md" data-testid="skeleton-map" />
            </div>
          )}
          {!renderError && !keyLoading && mapsLoaded && !driversLoading && drivers.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-card/90 border rounded-md p-4 text-center pointer-events-auto">
                <MapPin className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground" data-testid="text-no-driver-locations">
                  Driver location not yet available
                </p>
              </div>
            </div>
          )}
          {!renderError && !keyLoading && mapsLoaded && dataUpdatedAt && (
            <div className="absolute bottom-3 left-3">
              <Badge variant="secondary" className="text-xs" data-testid="badge-last-updated">
                Last poll: {new Date(dataUpdatedAt).toLocaleTimeString()}
              </Badge>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DispatchMapView({ token, localCityId, cities, setSelectedCity, setLocalCityId, renderError, keyLoading, mapsLoaded, mapsError }: {
  token: string | null;
  localCityId: number | null;
  cities: any[];
  setSelectedCity: (city: any) => void;
  setLocalCityId: (id: number) => void;
  renderError: any;
  keyLoading: boolean;
  mapsLoaded: boolean;
  mapsError: string | null;
}) {
  const { data: driverLocations, isLoading: driversLoading, refetch, dataUpdatedAt } = useQuery<DriverLocation[]>({
    queryKey: ["/api/ops/driver-locations", localCityId],
    queryFn: async () => {
      const res = await fetch(`/api/ops/driver-locations?city_id=${localCityId}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to fetch driver locations" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    enabled: !!localCityId && !!token,
    refetchInterval: 10000,
  });

  const drivers = driverLocations || [];
  const staleCount = drivers.filter((d) => isStale(d.updated_at)).length;
  const activeCount = drivers.filter((d) => !isStale(d.updated_at)).length;

  const mapCenter = CITY_DEFAULTS.default;
  const mapZoom = 5;

  const handleCityChange = useCallback((val: string) => {
    const id = parseInt(val);
    const city = cities.find((c) => c.id === id);
    if (city) {
      setSelectedCity(city);
      setLocalCityId(city.id);
    }
  }, [cities, setSelectedCity]);

  return (
    <div className="p-4 space-y-4 h-full flex flex-col" data-testid="page-live-map">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-live-map-title">Live Map</h1>
          <p className="text-sm text-muted-foreground">
            Real-time driver locations
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={localCityId?.toString() || ""}
            onValueChange={handleCityChange}
          >
            <SelectTrigger className="w-48" data-testid="select-map-city">
              <SelectValue placeholder="Select city" />
            </SelectTrigger>
            <SelectContent>
              {cities.map((city) => (
                <SelectItem key={city.id} value={city.id.toString()}>
                  {city.name}, {city.state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={!localCityId}
            data-testid="button-refresh-locations"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {localCityId && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-lg font-semibold" data-testid="text-total-drivers">{drivers.length}</p>
                  <p className="text-xs text-muted-foreground">Tracked Drivers</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 flex-shrink-0 text-green-500" />
                <div className="min-w-0">
                  <p className="text-lg font-semibold" data-testid="text-active-drivers">{activeCount}</p>
                  <p className="text-xs text-muted-foreground">Active</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500" />
                <div className="min-w-0">
                  <p className="text-lg font-semibold" data-testid="text-stale-drivers">{staleCount}</p>
                  <p className="text-xs text-muted-foreground">Stale ({">"}2 min)</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <div className="relative h-full" style={{ minHeight: "500px" }}>
          <GoogleMapView drivers={drivers} center={mapCenter} zoom={mapZoom} mapsLoaded={mapsLoaded} />
          {!localCityId && (
            <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
              <Card>
                <CardContent className="text-center p-6">
                  <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground" data-testid="text-select-city-prompt">
                    Select a city above to view driver locations
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
          {localCityId && renderError && (
            <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
              <Card>
                <CardContent className="text-center p-6">
                  <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-3" />
                  <p className="text-destructive font-medium" data-testid="text-map-error">
                    Maps unavailable
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {typeof mapsError === "string" ? mapsError : "Google Maps API key is not configured or invalid. Contact your administrator."}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
          {localCityId && !renderError && (keyLoading || !mapsLoaded || driversLoading) && (
            <div className="absolute inset-0 z-10">
              <Skeleton className="w-full h-full rounded-md" data-testid="skeleton-map" />
            </div>
          )}
          {localCityId && !renderError && !keyLoading && mapsLoaded && !driversLoading && drivers.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-card/90 border rounded-md p-6 text-center pointer-events-auto max-w-xs">
                <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium mb-2" data-testid="text-no-driver-locations">
                  No drivers online for this city
                </p>
                <p className="text-xs text-muted-foreground">
                  Drivers must be connected via the Driver App to appear on the map. Check that drivers have tapped "Start Shift" in their app.
                </p>
              </div>
            </div>
          )}
          {localCityId && !renderError && !keyLoading && mapsLoaded && !driversLoading && staleCount > 0 && (
            <div className="absolute top-3 right-3">
              <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700" data-testid="badge-stale-warning">
                <AlertTriangle className="w-3 h-3 mr-1" />
                {staleCount} stale
              </Badge>
            </div>
          )}
          {localCityId && !renderError && !keyLoading && mapsLoaded && dataUpdatedAt && (
            <div className="absolute bottom-3 left-3">
              <Badge variant="secondary" className="text-xs" data-testid="badge-last-updated">
                Last poll: {new Date(dataUpdatedAt).toLocaleTimeString()}
              </Badge>
            </div>
          )}
        </div>
      </div>

      {localCityId && drivers.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Driver Legend</p>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5">
                <svg width="16" height="12" viewBox="-1 -1 22 16" className="flex-shrink-0">
                  <path d={CAR_SVG_PATH} fill="#6366F1" stroke="#22c55e" strokeWidth="1" />
                </svg>
                <span className="text-xs">Vehicle assigned</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full border border-background bg-muted-foreground" />
                <span className="text-xs">No vehicle</span>
              </div>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span
                    className="w-3 h-3 rounded-full border border-background"
                    style={{ backgroundColor: STATUS_COLORS[key] }}
                  />
                  <span className="text-xs">{label}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full border-2 border-amber-500 bg-gray-400 opacity-50" />
                <span className="text-xs text-amber-600 dark:text-amber-400">Stale</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function LiveMapPage() {
  const { token, selectedCity, cities, setSelectedCity, user } = useAuth();
  const [localCityId, setLocalCityId] = useState<number | null>(selectedCity?.id || null);

  useEffect(() => {
    if (selectedCity?.id) {
      setLocalCityId(selectedCity.id);
    }
  }, [selectedCity?.id]);

  const { data: keyData, isLoading: keyLoading, error: keyError } = useGoogleMapsApiKey();
  const { loaded: mapsLoaded, error: mapsError } = useLoadGoogleMapsScript(keyData?.key);

  const renderError = keyError || mapsError || (keyData && !keyData.key);

  const role = (user?.role || "").toUpperCase();
  const isClinicUser = role === "VIEWER" && (user as any)?.clinicId != null;
  const isPatientUser = role === "VIEWER" && (user as any)?.patientId != null && !(user as any)?.clinicId;
  const isDriverUser = role === "DRIVER";

  if (isClinicUser) {
    return <ClinicMapView token={token} cityId={localCityId} mapsReady={mapsLoaded && !renderError} renderError={renderError} keyLoading={keyLoading} mapsLoaded={mapsLoaded} />;
  }

  if (isPatientUser || isDriverUser) {
    return <PatientMapView token={token} mapsReady={mapsLoaded && !renderError} renderError={renderError} keyLoading={keyLoading} mapsLoaded={mapsLoaded} isDriver={isDriverUser} />;
  }

  return (
    <DispatchMapView
      token={token}
      localCityId={localCityId}
      cities={cities}
      setSelectedCity={setSelectedCity}
      setLocalCityId={setLocalCityId}
      renderError={renderError}
      keyLoading={keyLoading}
      mapsLoaded={mapsLoaded}
      mapsError={typeof mapsError === "string" ? mapsError : null}
    />
  );
}