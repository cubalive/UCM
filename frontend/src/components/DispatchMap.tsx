import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Driver = {
  id: string; name: string; availability: string;
  latitude?: number; longitude?: number;
  activeTripCount: number;
};

type Trip = {
  id: string; pickupAddress: string; patientName?: string;
  priority: string;
  pickupLat?: number; pickupLng?: number;
  dropoffLat?: number; dropoffLng?: number;
};

type Props = {
  drivers: Driver[];
  trips?: Trip[];
  selectedRouteCoords?: [number, number][]; // route polyline for selected trip
};

const DEFAULT_CENTER: [number, number] = [-80.1918, 25.7617];
const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const ROUTE_SOURCE = "dispatch-route";
const ROUTE_LAYER = "dispatch-route-layer";

const AVAILABILITY_COLORS: Record<string, string> = {
  available: "#22c55e",
  busy: "#ef4444",
  break: "#f59e0b",
  offline: "#9ca3af",
};

export function DispatchMap({ drivers, trips, selectedRouteCoords }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const mapLoadedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: 11,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      mapLoadedRef.current = true;
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#6366f1", "line-width": 4, "line-opacity": 0.7 },
      });
    });

    mapRef.current = map;

    return () => {
      mapLoadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update driver markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set<string>();

    drivers.forEach(driver => {
      if (!driver.latitude || !driver.longitude) return;
      const markerId = `driver-${driver.id}`;
      currentIds.add(markerId);

      const existing = markersRef.current.get(markerId);
      if (existing) {
        existing.setLngLat([Number(driver.longitude), Number(driver.latitude)]);
        const el = existing.getElement();
        const color = AVAILABILITY_COLORS[driver.availability] || "#9ca3af";
        el.style.background = color;
        return;
      }

      const color = AVAILABILITY_COLORS[driver.availability] || "#9ca3af";
      const el = document.createElement("div");
      el.style.cssText = `width:16px;height:16px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);cursor:pointer;`;

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([Number(driver.longitude), Number(driver.latitude)])
        .setPopup(new maplibregl.Popup({ offset: 10 }).setHTML(
          `<strong>${driver.name}</strong><br/><span style="text-transform:capitalize">${driver.availability}</span> | ${driver.activeTripCount} trips`
        ))
        .addTo(map);

      markersRef.current.set(markerId, marker);
    });

    // Remove stale driver markers
    markersRef.current.forEach((marker, id) => {
      if (id.startsWith("driver-") && !currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });
  }, [drivers]);

  // Update trip pickup markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !trips) return;

    const currentIds = new Set<string>();

    trips.forEach(trip => {
      if (!trip.pickupLat || !trip.pickupLng) return;
      const markerId = `trip-${trip.id}`;
      currentIds.add(markerId);

      if (markersRef.current.has(markerId)) return;

      const el = document.createElement("div");
      const isUrgent = trip.priority === "immediate";
      el.style.cssText = `width:12px;height:12px;background:${isUrgent ? "#ef4444" : "#f59e0b"};border:2px solid white;border-radius:2px;box-shadow:0 2px 4px rgba(0,0,0,0.3);`;

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([Number(trip.pickupLng), Number(trip.pickupLat)])
        .setPopup(new maplibregl.Popup({ offset: 10 }).setHTML(
          `<strong>${trip.patientName || "Trip"}</strong><br/>${trip.pickupAddress}`
        ))
        .addTo(map);

      markersRef.current.set(markerId, marker);
    });

    // Remove stale trip markers
    markersRef.current.forEach((marker, id) => {
      if (id.startsWith("trip-") && !currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });
  }, [trips]);

  // Update route polyline
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const source = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    if (selectedRouteCoords && selectedRouteCoords.length >= 2) {
      source.setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: selectedRouteCoords },
        properties: {},
      });
    } else {
      source.setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [] },
        properties: {},
      });
    }
  }, [selectedRouteCoords]);

  return <div ref={containerRef} className="map-container" />;
}
