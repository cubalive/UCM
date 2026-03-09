import { useEffect, useRef, useState } from "react";
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
  className?: string;
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

const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#0a0e17" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a0e17" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#4a5568" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a202c" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#2d3748" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0c1222" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

export function DriverTripMap({
  pickupLat, pickupLng, dropoffLat, dropoffLng,
  driverLat, driverLng, driverHeading,
  phase, className = "",
}: DriverTripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const routeLineRef = useRef<google.maps.Polyline | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  const isPickupPhase = ["toPickup", "arrivedPickup", "waiting"].includes(phase);

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
        styles: DARK_MAP_STYLE,
      });
    }

    // Pickup marker
    if (pickupMarkerRef.current) pickupMarkerRef.current.setMap(null);
    pickupMarkerRef.current = new google.maps.Marker({
      position: { lat: pickupLat, lng: pickupLng },
      map: mapRef.current,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: "#00ff88",
        fillOpacity: 1,
        strokeWeight: 3,
        strokeColor: "#0a0e17",
        scale: isPickupPhase ? 10 : 6,
      },
      zIndex: 3,
    });

    // Dropoff marker
    if (dropoffMarkerRef.current) dropoffMarkerRef.current.setMap(null);
    dropoffMarkerRef.current = new google.maps.Marker({
      position: { lat: dropoffLat, lng: dropoffLng },
      map: mapRef.current,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: "#ff00aa",
        fillOpacity: 1,
        strokeWeight: 3,
        strokeColor: "#0a0e17",
        scale: !isPickupPhase ? 10 : 6,
      },
      zIndex: 3,
    });

    // Route line (straight for now, could use Directions API)
    if (routeLineRef.current) routeLineRef.current.setMap(null);
    routeLineRef.current = new google.maps.Polyline({
      path: [
        { lat: pickupLat, lng: pickupLng },
        { lat: dropoffLat, lng: dropoffLng },
      ],
      strokeColor: "#00f0ff",
      strokeOpacity: 0.4,
      strokeWeight: 3,
      geodesic: true,
      icons: [{
        icon: { path: "M 0,-1 0,1", strokeOpacity: 0.6, strokeColor: "#00f0ff", scale: 3 },
        offset: "0", repeat: "12px",
      }],
      map: mapRef.current,
      zIndex: 1,
    });

    // Fit bounds
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: pickupLat, lng: pickupLng });
    bounds.extend({ lat: dropoffLat, lng: dropoffLng });
    if (driverLat && driverLng) bounds.extend({ lat: driverLat, lng: driverLng });
    mapRef.current.fitBounds(bounds, 60);
  }, [ready, pickupLat, pickupLng, dropoffLat, dropoffLng, phase]);

  // Update driver marker position
  useEffect(() => {
    if (!ready || !mapRef.current || !driverLat || !driverLng) return;

    const pos = { lat: driverLat, lng: driverLng };
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new google.maps.Marker({
        position: pos,
        map: mapRef.current,
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          fillColor: "#00f0ff",
          fillOpacity: 1,
          strokeColor: "#0a0e17",
          strokeWeight: 2,
          scale: 7,
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
  }, [ready, driverLat, driverLng, driverHeading]);

  // Cleanup
  useEffect(() => {
    return () => {
      pickupMarkerRef.current?.setMap(null);
      dropoffMarkerRef.current?.setMap(null);
      driverMarkerRef.current?.setMap(null);
      routeLineRef.current?.setMap(null);
      mapRef.current = null;
    };
  }, []);

  if (error) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ background: "#0a0e17" }}>
        <span style={{ color: "#4a5568", fontSize: 12 }}>Map unavailable</span>
      </div>
    );
  }

  return <div ref={containerRef} className={className} style={{ width: "100%", height: "100%" }} />;
}
