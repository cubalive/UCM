import { useEffect, useRef, useState, useCallback } from "react";
import { resolveUrl } from "@/lib/api";

interface DriverTripMapProps {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  driverLat?: number | null;
  driverLng?: number | null;
  driverHeading?: number | null;
  phase: "toPickup" | "arrivedPickup" | "waiting" | "toDropoff" | "arrivedDropoff" | string;
  routePolyline?: string | null;
  className?: string;
  onNavigate?: () => void;
}

declare global {
  interface Window {
    __MAPS_KEY_CACHE__?: string;
  }
}

async function loadMapsScript(apiKey: string): Promise<void> {
  if (window.google?.maps) return;
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existing) {
      if (window.google?.maps) return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject());
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry,places`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject();
    document.head.appendChild(script);
  });
}

const LIGHT_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#F5F0EB" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#FAFAF8" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6B7280" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFFFFF" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#E5E7EB" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#FFECD2" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#FFD4A8" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#DBEAFE" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#EDE7DF" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#D4F5DD" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

// Decode a Google encoded polyline string into LatLng array
function decodePolyline(encoded: string): google.maps.LatLngLiteral[] {
  const points: google.maps.LatLngLiteral[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export function DriverTripMap({
  pickupLat, pickupLng, dropoffLat, dropoffLng,
  driverLat, driverLng, driverHeading,
  phase, routePolyline, className = "",
  onNavigate,
}: DriverTripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const routeLineRef = useRef<google.maps.Polyline | null>(null);
  const driverRouteLineRef = useRef<google.maps.Polyline | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);
  const lastDirectionsReqRef = useRef<number>(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  const isPickupPhase = ["toPickup", "arrivedPickup", "waiting"].includes(phase);
  const isMovingPhase = ["toPickup", "toDropoff"].includes(phase);

  // Load Google Maps
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        let key = window.__MAPS_KEY_CACHE__;
        if (!key) {
          const res = await fetch(resolveUrl("/api/public/maps/key"));
          const json = await res.json();
          key = json.key;
          if (key) window.__MAPS_KEY_CACHE__ = key;
        }
        if (!key || cancelled) { if (!cancelled) setError(true); return; }
        await loadMapsScript(key);
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setError(true);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  // Draw the route from driver to current destination
  const drawDriverRoute = useCallback((map: google.maps.Map, dLat: number, dLng: number, destLat: number, destLng: number) => {
    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService();
    }

    // Throttle directions requests to every 15 seconds
    const now = Date.now();
    if (now - lastDirectionsReqRef.current < 15000) return;
    lastDirectionsReqRef.current = now;

    directionsServiceRef.current.route(
      {
        origin: { lat: dLat, lng: dLng },
        destination: { lat: destLat, lng: destLng },
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === "OK" && result) {
          if (driverRouteLineRef.current) driverRouteLineRef.current.setMap(null);

          const path = result.routes[0]?.overview_path || [];
          driverRouteLineRef.current = new google.maps.Polyline({
            path,
            strokeColor: isPickupPhase ? "#34C759" : "#FF6B35",
            strokeOpacity: 0.7,
            strokeWeight: 4,
            geodesic: true,
            map,
            zIndex: 5,
          });
        }
      }
    );
  }, [isPickupPhase]);

  // Create map and markers
  useEffect(() => {
    if (!ready || !containerRef.current) return;

    if (!mapRef.current) {
      const destLat = isPickupPhase ? pickupLat : dropoffLat;
      const destLng = isPickupPhase ? pickupLng : dropoffLng;
      const center = driverLat && driverLng
        ? { lat: (driverLat + destLat) / 2, lng: (driverLng + destLng) / 2 }
        : { lat: (pickupLat + dropoffLat) / 2, lng: (pickupLng + dropoffLng) / 2 };

      mapRef.current = new google.maps.Map(containerRef.current, {
        center,
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy",
        styles: LIGHT_MAP_STYLE,
      });
    }

    // Pickup marker with pulsing effect label
    if (pickupMarkerRef.current) pickupMarkerRef.current.setMap(null);
    pickupMarkerRef.current = new google.maps.Marker({
      position: { lat: pickupLat, lng: pickupLng },
      map: mapRef.current,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: "#34C759",
        fillOpacity: 1,
        strokeWeight: isPickupPhase ? 4 : 2,
        strokeColor: isPickupPhase ? "#34C759" : "#E5E7EB",
        scale: isPickupPhase ? 12 : 7,
      },
      label: isPickupPhase ? { text: "P", color: "#1A1A2E", fontSize: "10px", fontWeight: "bold" } : undefined,
      zIndex: 3,
    });

    // Dropoff marker
    if (dropoffMarkerRef.current) dropoffMarkerRef.current.setMap(null);
    dropoffMarkerRef.current = new google.maps.Marker({
      position: { lat: dropoffLat, lng: dropoffLng },
      map: mapRef.current,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: "#FF6B35",
        fillOpacity: 1,
        strokeWeight: !isPickupPhase ? 4 : 2,
        strokeColor: !isPickupPhase ? "#FF6B35" : "#E5E7EB",
        scale: !isPickupPhase ? 12 : 7,
      },
      label: !isPickupPhase ? { text: "D", color: "#fff", fontSize: "10px", fontWeight: "bold" } : undefined,
      zIndex: 3,
    });

    // Draw route polyline - use encoded polyline from server if available
    if (routeLineRef.current) routeLineRef.current.setMap(null);

    let routePath: google.maps.LatLngLiteral[] | null = null;
    if (routePolyline) {
      try {
        routePath = decodePolyline(routePolyline);
      } catch {}
    }

    if (routePath && routePath.length > 1) {
      // Use the real route from server
      routeLineRef.current = new google.maps.Polyline({
        path: routePath,
        strokeColor: "#4A90D9",
        strokeOpacity: 0.6,
        strokeWeight: 4,
        geodesic: true,
        map: mapRef.current,
        zIndex: 2,
      });
    } else {
      // Request directions for the full trip route
      const svc = new google.maps.DirectionsService();
      svc.route(
        {
          origin: { lat: pickupLat, lng: pickupLng },
          destination: { lat: dropoffLat, lng: dropoffLng },
          travelMode: google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === "OK" && result && mapRef.current) {
            const path = result.routes[0]?.overview_path || [];
            if (routeLineRef.current) routeLineRef.current.setMap(null);
            routeLineRef.current = new google.maps.Polyline({
              path,
              strokeColor: "#4A90D9",
              strokeOpacity: 0.6,
              strokeWeight: 4,
              geodesic: true,
              map: mapRef.current,
              zIndex: 2,
            });
          }
        }
      );
    }

    // Fit bounds
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: pickupLat, lng: pickupLng });
    bounds.extend({ lat: dropoffLat, lng: dropoffLng });
    if (driverLat && driverLng) bounds.extend({ lat: driverLat, lng: driverLng });
    mapRef.current.fitBounds(bounds, 60);
  }, [ready, pickupLat, pickupLng, dropoffLat, dropoffLng, phase, routePolyline]);

  // Update driver marker position and draw driver-to-destination route
  useEffect(() => {
    if (!ready || !mapRef.current || !driverLat || !driverLng) return;

    const pos = { lat: driverLat, lng: driverLng };
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new google.maps.Marker({
        position: pos,
        map: mapRef.current,
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          fillColor: "#FF6B35",
          fillOpacity: 1,
          strokeColor: "#FFFFFF",
          strokeWeight: 2.5,
          scale: 8,
          rotation: driverHeading ?? 0,
          anchor: new google.maps.Point(0, 2.5),
        },
        zIndex: 10,
      });
    } else {
      driverMarkerRef.current.setPosition(pos);
      const icon = driverMarkerRef.current.getIcon() as google.maps.Symbol;
      if (icon && driverHeading != null) {
        icon.rotation = driverHeading;
        driverMarkerRef.current.setIcon(icon);
      }
    }

    // Draw route from driver to current destination while moving
    if (isMovingPhase && mapRef.current) {
      const destLat = isPickupPhase ? pickupLat : dropoffLat;
      const destLng = isPickupPhase ? pickupLng : dropoffLng;
      drawDriverRoute(mapRef.current, driverLat, driverLng, destLat, destLng);
    }
  }, [ready, driverLat, driverLng, driverHeading, isMovingPhase, isPickupPhase, pickupLat, pickupLng, dropoffLat, dropoffLng, drawDriverRoute]);

  // Cleanup
  useEffect(() => {
    return () => {
      pickupMarkerRef.current?.setMap(null);
      dropoffMarkerRef.current?.setMap(null);
      driverMarkerRef.current?.setMap(null);
      routeLineRef.current?.setMap(null);
      driverRouteLineRef.current?.setMap(null);
      mapRef.current = null;
    };
  }, []);

  if (error) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ background: "#FFFFFF" }}>
        <span style={{ color: "#4a5568", fontSize: 12 }}>Map unavailable</span>
      </div>
    );
  }

  return <div ref={containerRef} className={className} style={{ width: "100%", height: "100%" }} />;
}
