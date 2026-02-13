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
  city_id: number;
  lat: number;
  lng: number;
  updated_at: string | null;
  status: string;
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

const STALE_THRESHOLD_MS = 2 * 60 * 1000;

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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker`;
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
}

function GoogleMapView({ drivers, center, zoom }: GoogleMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new google.maps.Map(mapRef.current, {
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
      infoWindowRef.current = new google.maps.InfoWindow();
    }
  }, [center, zoom]);

  useEffect(() => {
    if (!mapInstanceRef.current || !window.google?.maps) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    drivers.forEach((driver) => {
      const stale = isStale(driver.updated_at);
      const color = STATUS_COLORS[driver.status] || STATUS_COLORS.off;

      const svgIcon = {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: color,
        fillOpacity: stale ? 0.5 : 1,
        strokeColor: stale ? "#f59e0b" : "#ffffff",
        strokeWeight: stale ? 3 : 2,
        scale: 10,
      };

      const marker = new google.maps.Marker({
        position: { lat: driver.lat, lng: driver.lng },
        map: mapInstanceRef.current!,
        icon: svgIcon,
        title: driver.driver_name,
        zIndex: stale ? 1 : 10,
      });

      marker.addListener("click", () => {
        const statusLabel = STATUS_LABELS[driver.status] || driver.status;
        const timeAgo = formatTimeAgo(driver.updated_at);
        const staleTag = stale
          ? `<div style="color:#d97706;font-weight:600;font-size:11px;margin-top:4px;">STALE</div>`
          : "";

        infoWindowRef.current?.setContent(`
          <div style="padding:4px;min-width:140px;">
            <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${driver.driver_name}</div>
            <div style="font-size:12px;color:#666;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:4px;"></span>
              ${statusLabel}
            </div>
            <div style="font-size:11px;color:#888;margin-top:2px;">Updated: ${timeAgo}</div>
            ${staleTag}
          </div>
        `);
        infoWindowRef.current?.open(mapInstanceRef.current!, marker);
      });

      markersRef.current.push(marker);
    });

    if (drivers.length > 0 && drivers.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      drivers.forEach((d) => bounds.extend({ lat: d.lat, lng: d.lng }));
      mapInstanceRef.current.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
    } else if (drivers.length === 1) {
      mapInstanceRef.current.setCenter({ lat: drivers[0].lat, lng: drivers[0].lng });
      mapInstanceRef.current.setZoom(14);
    }
  }, [drivers]);

  return (
    <div
      ref={mapRef}
      data-testid="div-google-map"
      className="w-full h-full rounded-md"
      style={{ minHeight: "500px" }}
    />
  );
}

const CITY_DEFAULTS: Record<string, { lat: number; lng: number }> = {
  default: { lat: 39.8283, lng: -98.5795 },
};

export default function LiveMapPage() {
  const { token, selectedCity, cities, setSelectedCity } = useAuth();
  const [localCityId, setLocalCityId] = useState<number | null>(selectedCity?.id || null);

  useEffect(() => {
    if (selectedCity?.id) {
      setLocalCityId(selectedCity.id);
    }
  }, [selectedCity?.id]);

  const { data: keyData, isLoading: keyLoading, error: keyError } = useGoogleMapsApiKey();
  const { loaded: mapsLoaded, error: mapsError } = useLoadGoogleMapsScript(keyData?.key);

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

  const renderError = keyError || mapsError || (keyData && !keyData.key);

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
        {!localCityId ? (
          <Card className="h-full flex items-center justify-center" style={{ minHeight: "500px" }}>
            <CardContent className="text-center p-6">
              <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground" data-testid="text-select-city-prompt">
                Select a city above to view driver locations
              </p>
            </CardContent>
          </Card>
        ) : renderError ? (
          <Card className="h-full flex items-center justify-center" style={{ minHeight: "500px" }}>
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
        ) : keyLoading || !mapsLoaded ? (
          <Skeleton className="w-full rounded-md" style={{ minHeight: "500px" }} data-testid="skeleton-map" />
        ) : driversLoading ? (
          <Skeleton className="w-full rounded-md" style={{ minHeight: "500px" }} data-testid="skeleton-drivers" />
        ) : (
          <div className="relative h-full" style={{ minHeight: "500px" }}>
            <GoogleMapView drivers={drivers} center={mapCenter} zoom={mapZoom} />
            {drivers.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-card/90 border rounded-md p-4 text-center pointer-events-auto">
                  <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground" data-testid="text-no-driver-locations">
                    No driver locations available for this city
                  </p>
                </div>
              </div>
            )}
            {staleCount > 0 && (
              <div className="absolute top-3 right-3">
                <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700" data-testid="badge-stale-warning">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {staleCount} stale
                </Badge>
              </div>
            )}
            {dataUpdatedAt && (
              <div className="absolute bottom-3 left-3">
                <Badge variant="secondary" className="text-xs" data-testid="badge-last-updated">
                  Last poll: {new Date(dataUpdatedAt).toLocaleTimeString()}
                </Badge>
              </div>
            )}
          </div>
        )}
      </div>

      {localCityId && drivers.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Driver Legend</p>
            <div className="flex items-center gap-4 flex-wrap">
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