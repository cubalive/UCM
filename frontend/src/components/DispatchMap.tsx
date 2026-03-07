import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Driver = {
  id: string; name: string; availability: string;
  latitude?: number; longitude?: number;
  activeTripCount: number;
};

type Props = {
  drivers: Driver[];
};

const DEFAULT_CENTER: [number, number] = [-80.1918, 25.7617];
const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const AVAILABILITY_COLORS: Record<string, string> = {
  available: "#22c55e",
  busy: "#ef4444",
  break: "#f59e0b",
  offline: "#9ca3af",
};

export function DispatchMap({ drivers }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

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
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set<string>();

    drivers.forEach(driver => {
      if (!driver.latitude || !driver.longitude) return;
      currentIds.add(driver.id);

      const existing = markersRef.current.get(driver.id);
      if (existing) {
        existing.setLngLat([Number(driver.longitude), Number(driver.latitude)]);
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

      markersRef.current.set(driver.id, marker);
    });

    // Remove stale markers
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });
  }, [drivers]);

  return <div ref={containerRef} className="map-container" />;
}
