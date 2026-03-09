import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Props = {
  driverLat?: number;
  driverLng?: number;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  routeCoords?: [number, number][]; // [lng, lat] pairs for route polyline
};

const DEFAULT_CENTER: [number, number] = [-80.1918, 25.7617]; // Miami
const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const ROUTE_SOURCE = "route-line";
const ROUTE_LAYER = "route-line-layer";

export function DriverMap({ driverLat, driverLng, pickupLat, pickupLng, dropoffLat, dropoffLng, routeCoords }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const driverMarkerRef = useRef<maplibregl.Marker | null>(null);
  const pickupMarkerRef = useRef<maplibregl.Marker | null>(null);
  const dropoffMarkerRef = useRef<maplibregl.Marker | null>(null);
  const mapLoadedRef = useRef(false);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const center: [number, number] = driverLat && driverLng ? [driverLng, driverLat] : DEFAULT_CENTER;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center,
      zoom: 13,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      mapLoadedRef.current = true;
      // Add empty route source and layer
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#3b82f6", "line-width": 4, "line-opacity": 0.8 },
      });
    });

    mapRef.current = map;

    return () => {
      mapLoadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update driver marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !driverLat || !driverLng) return;

    if (driverMarkerRef.current) {
      driverMarkerRef.current.setLngLat([driverLng, driverLat]);
    } else {
      const el = document.createElement("div");
      el.style.cssText = "width:20px;height:20px;background:var(--blue-600);border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);";
      driverMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([driverLng, driverLat])
        .addTo(map);
    }
  }, [driverLat, driverLng]);

  // Update pickup marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (pickupMarkerRef.current) {
      pickupMarkerRef.current.remove();
      pickupMarkerRef.current = null;
    }

    if (pickupLat && pickupLng) {
      const el = document.createElement("div");
      el.style.cssText = "width:14px;height:14px;background:#22c55e;border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);";
      pickupMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([pickupLng, pickupLat])
        .setPopup(new maplibregl.Popup({ offset: 10 }).setText("Pickup"))
        .addTo(map);
    }
  }, [pickupLat, pickupLng]);

  // Update dropoff marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (dropoffMarkerRef.current) {
      dropoffMarkerRef.current.remove();
      dropoffMarkerRef.current = null;
    }

    if (dropoffLat && dropoffLng) {
      const el = document.createElement("div");
      el.style.cssText = "width:14px;height:14px;background:#ef4444;border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);";
      dropoffMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([dropoffLng, dropoffLat])
        .setPopup(new maplibregl.Popup({ offset: 10 }).setText("Dropoff"))
        .addTo(map);
    }
  }, [dropoffLat, dropoffLng]);

  // Update route polyline
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const source = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    if (routeCoords && routeCoords.length >= 2) {
      source.setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: routeCoords },
        properties: {},
      });
    } else {
      source.setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [] },
        properties: {},
      });
    }
  }, [routeCoords]);

  // Fit bounds when trip locations change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const points: [number, number][] = [];
    if (driverLat && driverLng) points.push([driverLng, driverLat]);
    if (pickupLat && pickupLng) points.push([pickupLng, pickupLat]);
    if (dropoffLat && dropoffLng) points.push([dropoffLng, dropoffLat]);

    if (points.length >= 2) {
      const bounds = new maplibregl.LngLatBounds(points[0], points[0]);
      points.forEach(p => bounds.extend(p));
      map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 500 });
    } else if (points.length === 1) {
      map.flyTo({ center: points[0], zoom: 14, duration: 500 });
    }
  }, [driverLat, driverLng, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  return <div ref={containerRef} className="map-container" />;
}
