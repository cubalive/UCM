import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, MapPin, Navigation, AlertTriangle, Car, CheckCircle2, XCircle } from "lucide-react";

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
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
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

  useEffect(() => {
    if (!data?.driver || !data.trip?.pickup_lat || !mapRef.current) return;
    if (mapsLoadedRef.current) {
      updateMapMarkers(data);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=&libraries=geometry`;
    script.async = true;
    script.onload = () => {
      mapsLoadedRef.current = true;
      initMap(data);
    };
    script.onerror = () => {};

    fetch("/api/public/maps/key")
      .then(r => r.json())
      .then(json => {
        if (json.key) {
          script.src = `https://maps.googleapis.com/maps/api/js?key=${json.key}&libraries=geometry`;
          document.head.appendChild(script);
        } else {
          setMapAvailable(false);
        }
      })
      .catch(() => { setMapAvailable(false); });

    return () => {
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, [data]);

  function initMap(trackingData: TrackingData) {
    if (!mapRef.current || !trackingData.driver) return;

    const driverPos = { lat: trackingData.driver.lat, lng: trackingData.driver.lng };
    const map = new google.maps.Map(mapRef.current, {
      center: driverPos,
      zoom: 13,
      disableDefaultUI: true,
      zoomControl: true,
      styles: [
        { featureType: "poi", stylers: [{ visibility: "off" }] },
      ],
    });
    mapInstanceRef.current = map;

    directionsRendererRef.current = new google.maps.DirectionsRenderer({
      map,
      suppressMarkers: true,
      polylineOptions: { strokeColor: "#3b82f6", strokeWeight: 4, strokeOpacity: 0.7 },
    });

    updateMapMarkers(trackingData);
  }

  function updateMapMarkers(trackingData: TrackingData) {
    if (!mapInstanceRef.current || !trackingData.driver) return;

    const driverPos = { lat: trackingData.driver.lat, lng: trackingData.driver.lng };

    if (driverMarkerRef.current) {
      driverMarkerRef.current.setPosition(driverPos);
    } else {
      driverMarkerRef.current = new google.maps.Marker({
        position: driverPos,
        map: mapInstanceRef.current,
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
      if (pickupMarkerRef.current) {
        pickupMarkerRef.current.setPosition(pickupPos);
      } else {
        pickupMarkerRef.current = new google.maps.Marker({
          position: pickupPos,
          map: mapInstanceRef.current,
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

      const bounds = new google.maps.LatLngBounds();
      bounds.extend(driverPos);
      bounds.extend(pickupPos);
      mapInstanceRef.current.fitBounds(bounds, 60);

      if (directionsRendererRef.current) {
        const directionsService = new google.maps.DirectionsService();
        directionsService.route(
          {
            origin: driverPos,
            destination: pickupPos,
            travelMode: google.maps.TravelMode.DRIVING,
          },
          (result, status) => {
            if (status === "OK" && result) {
              directionsRendererRef.current?.setDirections(result);
            }
          }
        );
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

        {showMap && mapAvailable && (
          <Card>
            <CardContent className="p-0">
              <div
                ref={mapRef}
                className="w-full h-64 rounded-md"
                data-testid="map-tracking"
              />
            </CardContent>
          </Card>
        )}

        {showMap && !mapAvailable && (
          <Card>
            <CardContent className="p-4 text-center">
              <Navigation className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Live map unavailable. Your driver is on the way.</p>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-center text-muted-foreground" data-testid="text-auto-refresh">
          This page updates automatically every 30 seconds
        </p>
      </div>
    </div>
  );
}
