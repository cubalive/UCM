import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, resolveUrl } from "@/lib/api";
import { MapPin, Loader2, CheckCircle, AlertTriangle } from "lucide-react";

interface DriverLocationData {
  lat: number;
  lng: number;
  heading?: number;
  ts?: number;
}

interface TripRouteMapProps {
  tripId: number;
  pickupLat?: number | string | null;
  pickupLng?: number | string | null;
  dropoffLat?: number | string | null;
  dropoffLng?: number | string | null;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  token?: string | null;
  className?: string;
  style?: React.CSSProperties;
  driverLocation?: DriverLocationData | null;
  showBreadcrumbs?: boolean;
}

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

function parseCoord(val: number | string | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function getQualityLabel(score: number | null): { label: string; variant: "default" | "secondary" | "destructive"; icon: "good" | "ok" | "poor" } {
  if (score === null || score === undefined) return { label: "N/A", variant: "secondary", icon: "ok" };
  if (score >= 70) return { label: "Good", variant: "default", icon: "good" };
  if (score >= 40) return { label: "OK", variant: "secondary", icon: "ok" };
  return { label: "Poor", variant: "destructive", icon: "poor" };
}

export function TripRouteMap({
  tripId,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  pickupAddress,
  dropoffAddress,
  token,
  className = "",
  style,
  driverLocation,
  showBreadcrumbs,
}: TripRouteMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const plannedPolylineRef = useRef<google.maps.Polyline | null>(null);
  const actualPolylineRef = useRef<google.maps.Polyline | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapError, setMapError] = useState(false);

  const pLat = parseCoord(pickupLat);
  const pLng = parseCoord(pickupLng);
  const dLat = parseCoord(dropoffLat);
  const dLng = parseCoord(dropoffLng);
  const hasCoords = pLat !== null && pLng !== null && dLat !== null && dLng !== null;

  const routeQuery = useQuery<any>({
    queryKey: ["/api/trips", tripId, "route"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/route`, token ?? null),
    enabled: !!token && tripId > 0 && hasCoords,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!hasCoords) return;
    let cancelled = false;

    async function init() {
      try {
        let apiKey = window.__MAPS_KEY_CACHE__;
        if (!apiKey) {
          const res = await fetch(resolveUrl("/api/public/maps/key"));
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
  }, [hasCoords]);

  useEffect(() => {
    if (!mapsReady || !mapContainerRef.current || !hasCoords || pLat === null || pLng === null || dLat === null || dLng === null) return;

    if (!mapRef.current) {
      const center = { lat: (pLat + dLat) / 2, lng: (pLng + dLng) / 2 };
      mapRef.current = new google.maps.Map(mapContainerRef.current, {
        center,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
        styles: [
          { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
        ],
      });
    }

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const pickupMarker = new google.maps.Marker({
      position: { lat: pLat, lng: pLng },
      map: mapRef.current,
      title: pickupAddress || "Pickup",
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: "#22c55e",
        fillOpacity: 1,
        strokeWeight: 2,
        strokeColor: "#fff",
        scale: 8,
      },
      zIndex: 5,
    });

    const dropoffMarker = new google.maps.Marker({
      position: { lat: dLat, lng: dLng },
      map: mapRef.current,
      title: dropoffAddress || "Dropoff",
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: "#ef4444",
        fillOpacity: 1,
        strokeWeight: 2,
        strokeColor: "#fff",
        scale: 8,
      },
      zIndex: 5,
    });

    markersRef.current = [pickupMarker, dropoffMarker];

    if (plannedPolylineRef.current) {
      plannedPolylineRef.current.setMap(null);
      plannedPolylineRef.current = null;
    }
    if (actualPolylineRef.current) {
      actualPolylineRef.current.setMap(null);
      actualPolylineRef.current = null;
    }

    const routeData = routeQuery.data;
    const plannedPolyline = routeData?.routePolyline;
    const actualPolyline = routeData?.actualPolyline;
    const hasActual = !!actualPolyline;
    const hasPlanned = !!plannedPolyline;

    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: pLat, lng: pLng });
    bounds.extend({ lat: dLat, lng: dLng });

    if (hasPlanned && window.google?.maps?.geometry?.encoding) {
      try {
        const plannedPath = google.maps.geometry.encoding.decodePath(plannedPolyline);
        plannedPolylineRef.current = new google.maps.Polyline({
          path: plannedPath,
          strokeColor: "#94a3b8",
          strokeOpacity: hasActual ? 0.5 : 0.8,
          strokeWeight: hasActual ? 3 : 4,
          geodesic: false,
          map: mapRef.current,
          zIndex: 1,
        });
        plannedPath.forEach((p) => bounds.extend(p));
      } catch {
        // fallback below
      }
    }

    if (hasActual && window.google?.maps?.geometry?.encoding) {
      try {
        const actualPath = google.maps.geometry.encoding.decodePath(actualPolyline);
        actualPolylineRef.current = new google.maps.Polyline({
          path: actualPath,
          strokeColor: "#8b5cf6",
          strokeOpacity: 0.9,
          strokeWeight: 5,
          geodesic: false,
          map: mapRef.current,
          zIndex: 2,
        });
        actualPath.forEach((p) => bounds.extend(p));
      } catch {
        // ignore decode errors
      }
    }

    if (!hasPlanned && !hasActual) {
      const straightPath = [new google.maps.LatLng(pLat, pLng), new google.maps.LatLng(dLat, dLng)];
      plannedPolylineRef.current = new google.maps.Polyline({
        path: straightPath,
        strokeColor: "#94a3b8",
        strokeOpacity: 0.3,
        strokeWeight: 2,
        geodesic: true,
        icons: [{
          icon: { path: "M 0,-1 0,1", strokeOpacity: 0.4, scale: 3 },
          offset: "0",
          repeat: "15px",
        }],
        map: mapRef.current,
        zIndex: 1,
      });
    }

    mapRef.current.fitBounds(bounds, 40);
  }, [mapsReady, pLat, pLng, dLat, dLng, routeQuery.data?.routePolyline, routeQuery.data?.actualPolyline]);

  useEffect(() => {
    if (!mapRef.current || !mapsReady || !driverLocation) {
      if (driverMarkerRef.current) {
        driverMarkerRef.current.setMap(null);
        driverMarkerRef.current = null;
      }
      return;
    }

    const pos = { lat: driverLocation.lat, lng: driverLocation.lng };

    if (!driverMarkerRef.current) {
      const svgIcon = {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        fillColor: "#3b82f6",
        fillOpacity: 1,
        strokeColor: "#1e40af",
        strokeWeight: 2,
        scale: 6,
        rotation: driverLocation.heading ?? 0,
        anchor: new google.maps.Point(0, 2.5),
      };
      driverMarkerRef.current = new google.maps.Marker({
        position: pos,
        map: mapRef.current,
        icon: svgIcon,
        title: "Driver",
        zIndex: 100,
      });
    } else {
      driverMarkerRef.current.setPosition(pos);
      const icon = driverMarkerRef.current.getIcon() as google.maps.Symbol;
      if (icon && driverLocation.heading != null) {
        icon.rotation = driverLocation.heading;
        driverMarkerRef.current.setIcon(icon);
      }
    }
  }, [mapsReady, driverLocation]);

  useEffect(() => {
    return () => {
      plannedPolylineRef.current?.setMap(null);
      plannedPolylineRef.current = null;
      actualPolylineRef.current?.setMap(null);
      actualPolylineRef.current = null;
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      driverMarkerRef.current?.setMap(null);
      driverMarkerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  if (!hasCoords || mapError) {
    return (
      <div
        className={`bg-muted flex items-center justify-center rounded-md ${className}`}
        style={style}
        data-testid={`placeholder-route-map-${tripId}`}
      >
        <MapPin className="w-5 h-5 text-muted-foreground" />
      </div>
    );
  }

  const routeData = routeQuery.data;
  const hasActual = !!routeData?.actualPolyline;
  const hasPlanned = !!routeData?.routePolyline;
  const quality = getQualityLabel(routeData?.routeQualityScore ?? null);

  return (
    <div className={`relative rounded-md overflow-hidden ${className}`} style={style} data-testid={`div-route-map-${tripId}`}>
      <div ref={mapContainerRef} className="w-full h-full" style={{ minHeight: "inherit" }} />
      {routeQuery.isLoading && (
        <div className="absolute top-2 right-2 bg-background/80 rounded-md px-2 py-1 flex items-center gap-1 text-xs">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading route...
        </div>
      )}
      {routeData && !routeQuery.isLoading && (
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {hasActual && hasPlanned && (
            <div className="flex gap-1">
              <div className="bg-background/90 rounded px-1.5 py-0.5 flex items-center gap-1 text-[10px]">
                <span className="w-3 h-0.5 rounded" style={{ backgroundColor: "#94a3b8", display: "inline-block" }} />
                Planned
              </div>
              <div className="bg-background/90 rounded px-1.5 py-0.5 flex items-center gap-1 text-[10px]">
                <span className="w-3 h-0.5 rounded" style={{ backgroundColor: "#8b5cf6", display: "inline-block" }} />
                Actual
              </div>
            </div>
          )}
          {routeData.routeQualityScore != null && (
            <div className="bg-background/90 rounded px-1.5 py-0.5 flex items-center gap-1 text-[10px]" data-testid="badge-route-quality">
              {quality.icon === "good" ? (
                <CheckCircle className="w-3 h-3 text-green-500" />
              ) : quality.icon === "poor" ? (
                <AlertTriangle className="w-3 h-3 text-red-500" />
              ) : null}
              Route: {quality.label}
            </div>
          )}
        </div>
      )}
      {!hasPlanned && !hasActual && !routeQuery.isLoading && (
        <div className="absolute bottom-2 left-2 bg-amber-500/90 text-white rounded-md px-2 py-1 text-xs font-medium flex items-center gap-1" data-testid="label-route-pending">
          <Loader2 className="w-3 h-3 animate-spin" />
          Route pending compute
        </div>
      )}
    </div>
  );
}
