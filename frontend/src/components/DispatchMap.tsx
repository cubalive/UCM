import { useEffect, useRef, useMemo } from "react";
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
  selectedTripId?: string;
};

const DEFAULT_CENTER: [number, number] = [-80.1918, 25.7617];
const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const ROUTE_SOURCE = "dispatch-route";
const ROUTE_LAYER = "dispatch-route-layer";
const DRIVER_SOURCE = "dispatch-drivers";
const DRIVER_CLUSTER_LAYER = "driver-clusters";
const DRIVER_CLUSTER_COUNT_LAYER = "driver-cluster-count";
const DRIVER_POINT_LAYER = "driver-points";
const DRIVER_NEARBY_LAYER = "driver-nearby-ring";

const NEARBY_DISTANCE_MILES = 5;

const AVAILABILITY_COLORS: Record<string, string> = {
  available: "#22c55e",
  busy: "#ef4444",
  break: "#f59e0b",
  offline: "#9ca3af",
};

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function DispatchMap({ drivers, trips, selectedRouteCoords, selectedTripId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const mapLoadedRef = useRef(false);
  const driverPopupRef = useRef<maplibregl.Popup | null>(null);

  // Find selected trip's pickup coords for proximity highlighting
  const selectedPickup = useMemo(() => {
    if (!selectedTripId || !trips) return null;
    const trip = trips.find(t => t.id === selectedTripId);
    if (trip?.pickupLat && trip?.pickupLng) return { lat: trip.pickupLat, lng: trip.pickupLng };
    return null;
  }, [selectedTripId, trips]);

  // Build GeoJSON for drivers
  const driverGeoJson = useMemo(() => {
    const features = drivers
      .filter(d => d.latitude && d.longitude)
      .map(d => {
        const isNearby = selectedPickup
          ? haversineDistance(selectedPickup.lat, selectedPickup.lng, d.latitude!, d.longitude!) <= NEARBY_DISTANCE_MILES
          : false;
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [Number(d.longitude), Number(d.latitude)] },
          properties: {
            id: d.id,
            name: d.name,
            availability: d.availability,
            activeTripCount: d.activeTripCount,
            color: AVAILABILITY_COLORS[d.availability] || "#9ca3af",
            nearby: isNearby ? 1 : 0,
          },
        };
      });
    return { type: "FeatureCollection" as const, features };
  }, [drivers, selectedPickup]);

  // Initialize map
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

      // Route source + layer
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

      // Driver source with clustering
      map.addSource(DRIVER_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // Cluster circles
      map.addLayer({
        id: DRIVER_CLUSTER_LAYER,
        type: "circle",
        source: DRIVER_SOURCE,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step", ["get", "point_count"],
            "#6366f1", 5,
            "#4f46e5", 10,
            "#4338ca",
          ],
          "circle-radius": ["step", ["get", "point_count"], 18, 5, 24, 10, 30],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Cluster count text
      map.addLayer({
        id: DRIVER_CLUSTER_COUNT_LAYER,
        type: "symbol",
        source: DRIVER_SOURCE,
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-size": 13,
        },
        paint: { "text-color": "#ffffff" },
      });

      // Nearby driver highlight ring (rendered behind the point)
      map.addLayer({
        id: DRIVER_NEARBY_LAYER,
        type: "circle",
        source: DRIVER_SOURCE,
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "nearby"], 1]],
        paint: {
          "circle-radius": 14,
          "circle-color": "transparent",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#6366f1",
          "circle-opacity": 0.8,
        },
      });

      // Individual driver points
      map.addLayer({
        id: DRIVER_POINT_LAYER,
        type: "circle",
        source: DRIVER_SOURCE,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": ["case", ["==", ["get", "nearby"], 1], 9, 7],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Click cluster to zoom
      map.on("click", DRIVER_CLUSTER_LAYER, (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [DRIVER_CLUSTER_LAYER] });
        if (!features.length) return;
        const clusterId = features[0].properties.cluster_id;
        const source = map.getSource(DRIVER_SOURCE) as maplibregl.GeoJSONSource;
        source.getClusterExpansionZoom(clusterId).then(zoom => {
          const geo = features[0].geometry;
          if (geo.type === "Point") {
            map.easeTo({ center: geo.coordinates as [number, number], zoom });
          }
        });
      });

      // Hover popup on driver points
      map.on("mouseenter", DRIVER_POINT_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", DRIVER_POINT_LAYER, () => {
        map.getCanvas().style.cursor = "";
        if (driverPopupRef.current) { driverPopupRef.current.remove(); driverPopupRef.current = null; }
      });
      map.on("click", DRIVER_POINT_LAYER, (e) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const props = f.properties;
        if (driverPopupRef.current) driverPopupRef.current.remove();
        driverPopupRef.current = new maplibregl.Popup({ offset: 10 })
          .setLngLat(f.geometry.coordinates as [number, number])
          .setHTML(`<strong>${props.name}</strong><br/><span style="text-transform:capitalize">${props.availability}</span> | ${props.activeTripCount} trips`)
          .addTo(map);
      });

      // Cursor for clusters
      map.on("mouseenter", DRIVER_CLUSTER_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", DRIVER_CLUSTER_LAYER, () => { map.getCanvas().style.cursor = ""; });
    });

    mapRef.current = map;

    return () => {
      mapLoadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update driver GeoJSON source
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const source = map.getSource(DRIVER_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(driverGeoJson as GeoJSON.FeatureCollection);
    }
  }, [driverGeoJson]);

  // Update trip markers (pickup + dropoff for selected)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !trips) return;

    const currentIds = new Set<string>();

    trips.forEach(trip => {
      if (!trip.pickupLat || !trip.pickupLng) return;
      const markerId = `trip-${trip.id}`;
      currentIds.add(markerId);

      const isSelected = trip.id === selectedTripId;
      const isUrgent = trip.priority === "immediate";

      // Remove and recreate if selection state changed
      const existing = markersRef.current.get(markerId);
      if (existing) {
        existing.remove();
        markersRef.current.delete(markerId);
      }

      const el = document.createElement("div");
      const size = isSelected ? 16 : 12;
      const bg = isSelected ? "#6366f1" : isUrgent ? "#ef4444" : "#f59e0b";
      el.style.cssText = `width:${size}px;height:${size}px;background:${bg};border:2px solid white;border-radius:2px;box-shadow:0 2px 4px rgba(0,0,0,0.3);cursor:pointer;${isSelected ? "z-index:10;" : ""}`;

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([Number(trip.pickupLng), Number(trip.pickupLat)])
        .setPopup(new maplibregl.Popup({ offset: 10 }).setHTML(
          `<strong>${trip.patientName || "Trip"}</strong><br/>${trip.pickupAddress}`
        ))
        .addTo(map);

      markersRef.current.set(markerId, marker);

      // Add dropoff marker for selected trip
      if (isSelected && trip.dropoffLat && trip.dropoffLng) {
        const dropoffId = `trip-dropoff-${trip.id}`;
        currentIds.add(dropoffId);
        const dropEl = document.createElement("div");
        dropEl.style.cssText = "width:14px;height:14px;background:#ef4444;border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);z-index:10;";
        const dropMarker = new maplibregl.Marker({ element: dropEl })
          .setLngLat([Number(trip.dropoffLng), Number(trip.dropoffLat)])
          .setPopup(new maplibregl.Popup({ offset: 10 }).setText("Dropoff"))
          .addTo(map);
        markersRef.current.set(dropoffId, dropMarker);
      }
    });

    // Remove stale trip markers
    markersRef.current.forEach((marker, id) => {
      if ((id.startsWith("trip-")) && !currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });
  }, [trips, selectedTripId]);

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
