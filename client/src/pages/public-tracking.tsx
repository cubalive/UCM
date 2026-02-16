import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, MapPin, Navigation, AlertTriangle, Car, CheckCircle2, XCircle } from "lucide-react";

function StaticMapImage({ token, ...props }: { token: string; "data-testid"?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={`/api/public/trips/static-map/${token}/full`}
      alt="Trip route"
      className="w-full h-40 object-cover rounded-md"
      loading="lazy"
      onError={() => setFailed(true)}
      data-testid={props["data-testid"]}
    />
  );
}

interface TrackingData {
  ok: boolean;
  error?: string;
  trip?: {
    status: string;
    pickup_time: string;
    pickup_address: string;
    pickup_lat: number | null;
    pickup_lng: number | null;
    scheduled_date: string;
  };
  driver?: {
    first_name: string;
    lat: number;
    lng: number;
    updated_at: string;
  } | null;
  eta?: {
    eta_minutes: number;
    distance_text: string;
  } | null;
  route_polyline?: string | null;
}

const STATUS_DISPLAY: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  SCHEDULED: { label: "Scheduled", color: "secondary", icon: Clock },
  ASSIGNED: { label: "Driver Assigned", color: "secondary", icon: Car },
  IN_PROGRESS: { label: "Driver En Route", color: "default", icon: Navigation },
  COMPLETED: { label: "Completed", color: "secondary", icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", color: "destructive", icon: XCircle },
  NO_SHOW: { label: "No Show", color: "destructive", icon: AlertTriangle },
};

function formatTimeAgo(isoStr: string): string {
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function PublicTrackingPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapKeyRef = useRef(`public-tracking-${token}`);
  const mapsLoadedRef = useRef(false);
  const [mapAvailable, setMapAvailable] = useState(true);

  const fetchTracking = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/trips/track/${token}`);
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Unable to load tracking information");
        setData(null);
      } else {
        setData(json);
        setError(null);
      }
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchTracking();
    const interval = setInterval(fetchTracking, 30000);
    return () => clearInterval(interval);
  }, [fetchTracking]);

  interface TrackingMapStore {
    map: google.maps.Map;
    container: HTMLDivElement;
    driverMarker: google.maps.Marker | null;
    pickupMarker: google.maps.Marker | null;
    routePolyline: google.maps.Polyline | null;
    boundsFit: boolean;
    routeRendered: boolean;
  }

  function getTrackingMapStore(): TrackingMapStore | null {
    return ((window as any).__UCM_MAP__?.[mapKeyRef.current]) as TrackingMapStore | null;
  }

  useEffect(() => {
    if (!data?.driver || !data.trip?.pickup_lat || !wrapperRef.current) return;
    if (mapsLoadedRef.current) {
      updateMapMarkers(data);
      return;
    }

    if (window.google?.maps) {
      mapsLoadedRef.current = true;
      initMap(data);
      return;
    }

    const script = document.createElement("script");
    script.async = true;

    fetch("/api/public/maps/key")
      .then(r => r.json())
      .then(json => {
        if (json.key) {
          script.src = `https://maps.googleapis.com/maps/api/js?key=${json.key}&libraries=geometry,places`;
          script.onload = () => {
            mapsLoadedRef.current = true;
            initMap(data);
          };
          document.head.appendChild(script);
        } else {
          setMapAvailable(false);
        }
      })
      .catch(() => { setMapAvailable(false); });

  }, [data]);

  function initMap(trackingData: TrackingData) {
    if (!wrapperRef.current || !trackingData.driver) return;

    if (!((window as any).__UCM_MAP__)) (window as any).__UCM_MAP__ = {};
    const store = (window as any).__UCM_MAP__ as Record<string, any>;
    let entry = store[mapKeyRef.current] as TrackingMapStore | undefined;

    if (!entry) {
      const driverPos = { lat: trackingData.driver.lat, lng: trackingData.driver.lng };
      const container = document.createElement("div");
      container.className = "w-full h-full rounded-md ucm-map-container";
      container.style.minHeight = "300px";

      const map = new google.maps.Map(container, {
        center: driverPos,
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: true,
        styles: [
          { featureType: "poi", stylers: [{ visibility: "off" }] },
        ],
      });

      entry = { map, container, driverMarker: null, pickupMarker: null, routePolyline: null, boundsFit: false, routeRendered: false };
      store[mapKeyRef.current] = entry;
    }

    if (entry.container.parentNode !== wrapperRef.current) {
      wrapperRef.current.appendChild(entry.container);
      google.maps.event.trigger(entry.map, "resize");
    }

    updateMapMarkers(trackingData);
  }

  function updateMapMarkers(trackingData: TrackingData) {
    const entry = getTrackingMapStore();
    if (!entry || !trackingData.driver) return;

    if (entry.container.parentNode !== wrapperRef.current && wrapperRef.current) {
      wrapperRef.current.appendChild(entry.container);
      google.maps.event.trigger(entry.map, "resize");
    }

    const driverPos = { lat: trackingData.driver.lat, lng: trackingData.driver.lng };

    if (entry.driverMarker) {
      entry.driverMarker.setPosition(driverPos);
    } else {
      entry.driverMarker = new google.maps.Marker({
        position: driverPos,
        map: entry.map,
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          fillColor: "#3b82f6",
          fillOpacity: 1,
          strokeWeight: 2,
          strokeColor: "#fff",
          scale: 6,
          rotation: 0,
        },
        title: "Your Driver",
        zIndex: 10,
      });
    }

    if (trackingData.trip?.pickup_lat && trackingData.trip?.pickup_lng) {
      const pickupPos = { lat: trackingData.trip.pickup_lat, lng: trackingData.trip.pickup_lng };
      if (entry.pickupMarker) {
        entry.pickupMarker.setPosition(pickupPos);
      } else {
        entry.pickupMarker = new google.maps.Marker({
          position: pickupPos,
          map: entry.map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: "#22c55e",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "#fff",
            scale: 8,
          },
          title: "Pickup Location",
          zIndex: 5,
        });
      }

      if (!entry.boundsFit) {
        entry.boundsFit = true;
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(driverPos);
        bounds.extend(pickupPos);
        entry.map.fitBounds(bounds, 60);
      }

      if (!entry.routeRendered && trackingData.route_polyline && window.google?.maps?.geometry?.encoding) {
        entry.routeRendered = true;
        try {
          const path = google.maps.geometry.encoding.decodePath(trackingData.route_polyline);
          entry.routePolyline = new google.maps.Polyline({
            path,
            map: entry.map,
            strokeColor: "#3b82f6",
            strokeWeight: 4,
            strokeOpacity: 0.7,
          });
        } catch {}
      }
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-2" />
            <CardTitle className="text-lg">Tracking Unavailable</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground" data-testid="text-tracking-error">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data?.trip) return null;

  const trip = data.trip;
  const statusInfo = STATUS_DISPLAY[trip.status] || STATUS_DISPLAY.SCHEDULED;
  const StatusIcon = statusInfo.icon;
  const showMap = !!data.driver && (trip.status === "ASSIGNED" || trip.status === "IN_PROGRESS");

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary text-primary-foreground p-4">
        <div className="max-w-md mx-auto">
          <h1 className="text-lg font-semibold" data-testid="text-tracking-header">United Care Mobility</h1>
          <p className="text-sm opacity-90">Trip Tracking</p>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4">
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium" data-testid="text-trip-status-label">Trip Status</h2>
              <Badge variant={statusInfo.color as any} data-testid="badge-trip-status">
                <StatusIcon className="w-3.5 h-3.5 mr-1" />
                {statusInfo.label}
              </Badge>
            </div>

            {data.eta && trip.status === "IN_PROGRESS" && (
              <div className="bg-primary/10 rounded-md p-3 text-center" data-testid="section-eta">
                <p className="text-sm text-muted-foreground">Estimated Arrival</p>
                <p className="text-2xl font-bold" data-testid="text-eta-value">{data.eta.eta_minutes} min</p>
                {data.eta.distance_text && (
                  <p className="text-xs text-muted-foreground" data-testid="text-eta-distance">{data.eta.distance_text} away</p>
                )}
                {data.eta.eta_minutes <= 5 && (
                  <Badge variant="destructive" className="mt-2" data-testid="badge-arriving-soon">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Arriving Soon
                  </Badge>
                )}
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Pickup</p>
                  <p className="text-sm" data-testid="text-pickup-address">{trip.pickup_address}</p>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Scheduled</p>
                  <p className="text-sm" data-testid="text-pickup-time">{trip.scheduled_date} at {trip.pickup_time}</p>
                </div>
              </div>

              {data.driver && (
                <div className="flex items-start gap-2">
                  <Car className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Driver</p>
                    <p className="text-sm" data-testid="text-driver-name">{data.driver.first_name}</p>
                    <p className="text-xs text-muted-foreground">Location updated {formatTimeAgo(data.driver.updated_at)}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card style={{ display: showMap && mapAvailable ? "block" : "none" }}>
          <CardContent className="p-0">
            <div
              ref={wrapperRef}
              className="w-full h-64 rounded-md"
              data-testid="map-tracking"
            />
          </CardContent>
        </Card>

        {showMap && !mapAvailable && (
          <Card>
            <CardContent className="p-0">
              <StaticMapImage token={token!} data-testid="img-public-static-map" />
            </CardContent>
          </Card>
        )}

        {!showMap && trip.pickup_lat && (
          <Card>
            <CardContent className="p-0">
              <StaticMapImage token={token!} data-testid="img-public-static-map" />
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-center text-muted-foreground" data-testid="text-auto-refresh">
          This page updates automatically every 15 seconds
        </p>
      </div>
    </div>
  );
}
