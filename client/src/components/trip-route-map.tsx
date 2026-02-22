import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { MapPin, Loader2 } from "lucide-react";

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
}: TripRouteMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
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

    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    const routePolyline = routeQuery.data?.routePolyline;
    let path: google.maps.LatLng[];

    if (routePolyline && window.google?.maps?.geometry?.encoding) {
      try {
        path = google.maps.geometry.encoding.decodePath(routePolyline);
      } catch {
        path = [new google.maps.LatLng(pLat, pLng), new google.maps.LatLng(dLat, dLng)];
      }
    } else {
      path = [new google.maps.LatLng(pLat, pLng), new google.maps.LatLng(dLat, dLng)];
    }

    polylineRef.current = new google.maps.Polyline({
      path,
      strokeColor: routePolyline ? "#3b82f6" : "#94a3b8",
      strokeOpacity: routePolyline ? 0.9 : 0.6,
      strokeWeight: routePolyline ? 5 : 3,
      geodesic: !routePolyline,
      map: mapRef.current,
    });

    const bounds = new google.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    bounds.extend({ lat: pLat, lng: pLng });
    bounds.extend({ lat: dLat, lng: dLng });
    mapRef.current.fitBounds(bounds, 40);
  }, [mapsReady, pLat, pLng, dLat, dLng, routeQuery.data?.routePolyline]);

  useEffect(() => {
    return () => {
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
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

  return (
    <div className={`relative rounded-md overflow-hidden ${className}`} style={style} data-testid={`div-route-map-${tripId}`}>
      <div ref={mapContainerRef} className="w-full h-full" style={{ minHeight: "inherit" }} />
      {routeQuery.isLoading && (
        <div className="absolute top-2 right-2 bg-background/80 rounded-md px-2 py-1 flex items-center gap-1 text-xs">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading route...
        </div>
      )}
      {routeQuery.data && !routeQuery.data.routePolyline && !routeQuery.isLoading && (
        <div className="absolute bottom-2 left-2 bg-background/80 rounded-md px-2 py-1 text-xs text-muted-foreground">
          Straight line (road route unavailable)
        </div>
      )}
    </div>
  );
}
