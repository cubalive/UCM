import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, MapPin, Navigation, AlertTriangle, Car, CheckCircle2, XCircle, Phone, MessageSquare, Truck, Package, PenLine, Camera, ShieldCheck, FileCheck } from "lucide-react";
import { resolveUrl } from "@/lib/api";

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

interface DeliveryProofItem {
  type: string;
  hasSignature: boolean;
  hasPhoto: boolean;
  recipientName: string | null;
  collectedAt: string | null;
}

interface TimelineEntry {
  status: string;
  label: string;
  timestamp: string | null;
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
    service_type?: string;
  };
  driver?: {
    name: string;
    lat: number;
    lng: number;
    updated_at: string;
  } | null;
  vehicle?: {
    name: string;
    license_plate: string;
    make?: string;
    model?: string;
    year?: number;
  } | null;
  eta?: {
    minutes: number;
    distance_text: string;
    updated_at?: string;
  } | null;
  dispatch_phone?: string | null;
  route_polyline?: string | null;
  delivery_proofs?: DeliveryProofItem[] | null;
  pharmacy_delivery?: {
    orderId: number;
    status: string;
  } | null;
  timeline?: TimelineEntry[] | null;
}

const STATUS_DISPLAY: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  SCHEDULED: { label: "Scheduled", color: "secondary", icon: Clock },
  CONFIRMED: { label: "Confirmed", color: "secondary", icon: CheckCircle2 },
  ASSIGNED: { label: "Driver Assigned", color: "secondary", icon: Car },
  EN_ROUTE_TO_PICKUP: { label: "Driver On The Way", color: "default", icon: Navigation },
  ARRIVED_PICKUP: { label: "Driver Arrived", color: "default", icon: MapPin },
  PICKED_UP: { label: "Picked Up", color: "default", icon: Car },
  IN_PROGRESS: { label: "In Progress", color: "default", icon: Navigation },
  EN_ROUTE_TO_DROPOFF: { label: "En Route to Destination", color: "default", icon: Navigation },
  ARRIVED_DROPOFF: { label: "Arrived at Destination", color: "default", icon: MapPin },
  COMPLETED: { label: "Completed", color: "secondary", icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", color: "destructive", icon: XCircle },
  NO_SHOW: { label: "No Show", color: "destructive", icon: AlertTriangle },
};

const PHARMACY_STATUS_LABELS: Record<string, string> = {
  pending: "Order Pending",
  confirmed: "Order Confirmed",
  ready_for_pickup: "Ready for Pickup",
  picked_up: "Picked Up from Pharmacy",
  in_transit: "In Transit",
  delivered: "Delivered",
  failed: "Delivery Failed",
  cancelled: "Order Cancelled",
};

const STATUS_ORDER = [
  "SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP",
  "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "COMPLETED",
];

function formatTimeAgo(isoStr: string): string {
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatTimestamp(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatVehicleLabel(v: TrackingData["vehicle"]): string {
  if (!v) return "";
  const parts: string[] = [];
  if (v.year) parts.push(String(v.year));
  if (v.make) parts.push(v.make);
  if (v.model) parts.push(v.model);
  if (parts.length === 0) parts.push(v.name);
  return parts.join(" ");
}

// ─── Delivery Status Timeline ───────────────────────────────────────────────

function DeliveryTimeline({ timeline, currentStatus }: { timeline: TimelineEntry[]; currentStatus: string }) {
  const currentIndex = STATUS_ORDER.indexOf(currentStatus);

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-medium mb-3" data-testid="text-timeline-header">Delivery Timeline</h3>
        <div className="space-y-0">
          {timeline.map((entry, i) => {
            const entryIndex = STATUS_ORDER.indexOf(entry.status);
            const isCompleted = entryIndex <= currentIndex || entry.timestamp != null;
            const isCurrent = entry.status === currentStatus;
            const isLast = i === timeline.length - 1;

            return (
              <div key={entry.status} className="flex gap-3" data-testid={`timeline-entry-${entry.status}`}>
                <div className="flex flex-col items-center">
                  <div
                    className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                      isCurrent
                        ? "border-primary bg-primary"
                        : isCompleted
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/30 bg-background"
                    }`}
                  />
                  {!isLast && (
                    <div
                      className={`w-0.5 h-6 ${
                        isCompleted ? "bg-primary" : "bg-muted-foreground/20"
                      }`}
                    />
                  )}
                </div>
                <div className={`pb-3 ${isCurrent ? "" : ""}`}>
                  <p className={`text-sm ${isCurrent ? "font-medium" : isCompleted ? "text-foreground" : "text-muted-foreground"}`}>
                    {entry.label}
                  </p>
                  {entry.timestamp && (
                    <p className="text-xs text-muted-foreground">{formatTimestamp(entry.timestamp)}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Proof of Delivery Display ──────────────────────────────────────────────

function DeliveryProofDisplay({ proofs }: { proofs: DeliveryProofItem[] }) {
  const proofIcons: Record<string, typeof PenLine> = {
    SIGNATURE: PenLine,
    PHOTO: Camera,
    GPS_VERIFICATION: MapPin,
    ID_CHECK: ShieldCheck,
  };

  const proofLabels: Record<string, string> = {
    SIGNATURE: "Signature Collected",
    PHOTO: "Photo Captured",
    GPS_VERIFICATION: "GPS Verified",
    ID_CHECK: "ID Verified",
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileCheck className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium" data-testid="text-pod-header">Proof of Delivery</h3>
        </div>
        <div className="space-y-2">
          {proofs.map((proof, i) => {
            const Icon = proofIcons[proof.type] || CheckCircle2;
            return (
              <div key={i} className="flex items-center gap-2 text-sm" data-testid={`pod-item-${proof.type}`}>
                <Icon className="w-4 h-4 text-green-600 flex-shrink-0" />
                <span>{proofLabels[proof.type] || proof.type}</span>
                {proof.recipientName && (
                  <span className="text-muted-foreground">- {proof.recipientName}</span>
                )}
                {proof.collectedAt && (
                  <span className="text-xs text-muted-foreground ml-auto">{formatTimestamp(proof.collectedAt)}</span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

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
      const res = await fetch(resolveUrl(`/api/public/trips/track/${token}`));
      const json = await res.json();
      if (!json.ok) {
        setError(json.message || json.error || "Unable to load tracking information");
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
    const interval = setInterval(fetchTracking, 15000);
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

    fetch(resolveUrl("/api/public/maps/key"))
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
  const enRouteStatuses = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "IN_PROGRESS", "EN_ROUTE_TO_DROPOFF"];
  const showMap = !!data.driver && enRouteStatuses.includes(trip.status);
  const showEta = !!data.eta && enRouteStatuses.includes(trip.status);
  const isPharmacyDelivery = !!data.pharmacy_delivery;
  const isCompleted = trip.status === "COMPLETED";

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary text-primary-foreground p-4">
        <div className="max-w-md mx-auto">
          <h1 className="text-lg font-semibold" data-testid="text-tracking-header">United Care Mobility</h1>
          <p className="text-sm opacity-90">
            {isPharmacyDelivery ? "Pharmacy Delivery Tracking" : "Trip Tracking"}
          </p>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4">
        {/* Status Card */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium" data-testid="text-trip-status-label">
                {isPharmacyDelivery ? "Delivery Status" : "Trip Status"}
              </h2>
              <Badge variant={statusInfo.color as any} data-testid="badge-trip-status">
                <StatusIcon className="w-3.5 h-3.5 mr-1" />
                {statusInfo.label}
              </Badge>
            </div>

            {/* Pharmacy delivery badge */}
            {isPharmacyDelivery && data.pharmacy_delivery && (
              <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/30 rounded-md p-2" data-testid="section-pharmacy-delivery">
                <Package className="w-4 h-4 text-blue-600" />
                <span className="text-sm text-blue-700 dark:text-blue-400">
                  {PHARMACY_STATUS_LABELS[data.pharmacy_delivery.status] || data.pharmacy_delivery.status}
                </span>
              </div>
            )}

            {showEta && data.eta && (
              <div className="bg-primary/10 rounded-md p-3 text-center" data-testid="section-eta">
                <p className="text-sm text-muted-foreground">Estimated Arrival</p>
                <p className="text-2xl font-bold" data-testid="text-eta-value">{data.eta.minutes} min</p>
                {data.eta.distance_text && (
                  <p className="text-xs text-muted-foreground" data-testid="text-eta-distance">{data.eta.distance_text} away</p>
                )}
                {data.eta.minutes <= 5 && (
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
                  <p className="text-xs text-muted-foreground">
                    {isPharmacyDelivery ? "Delivery Address" : "Pickup"}
                  </p>
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
                    <p className="text-sm" data-testid="text-driver-name">{data.driver.name}</p>
                    {data.driver.updated_at && !isCompleted && (
                      <p className="text-xs text-muted-foreground">Location updated {formatTimeAgo(data.driver.updated_at)}</p>
                    )}
                  </div>
                </div>
              )}

              {data.vehicle && (
                <div className="flex items-start gap-2">
                  <Truck className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Vehicle</p>
                    <p className="text-sm" data-testid="text-vehicle-info">{formatVehicleLabel(data.vehicle)}</p>
                    <p className="text-xs text-muted-foreground" data-testid="text-vehicle-plate">{data.vehicle.license_plate}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Live Map */}
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

        {/* Delivery Timeline */}
        {data.timeline && data.timeline.length > 0 && (
          <DeliveryTimeline timeline={data.timeline} currentStatus={trip.status} />
        )}

        {/* Proof of Delivery (shown after completion) */}
        {isCompleted && data.delivery_proofs && data.delivery_proofs.length > 0 && (
          <DeliveryProofDisplay proofs={data.delivery_proofs} />
        )}

        {/* Completed confirmation */}
        {isCompleted && (
          <Card>
            <CardContent className="p-4 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-2" />
              <p className="text-sm font-medium" data-testid="text-completed-message">
                {isPharmacyDelivery ? "Your delivery has been completed" : "Your trip has been completed"}
              </p>
              {data.delivery_proofs && data.delivery_proofs.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {data.delivery_proofs.length} proof{data.delivery_proofs.length !== 1 ? "s" : ""} of delivery on file
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Dispatch Contact */}
        {data.dispatch_phone && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm font-medium mb-3" data-testid="text-dispatch-label">Need Help?</p>
              <div className="flex gap-2">
                <Button asChild variant="default" className="flex-1" data-testid="button-call-dispatch">
                  <a href={`tel:${data.dispatch_phone}`}>
                    <Phone className="w-4 h-4 mr-2" />
                    Call Dispatch
                  </a>
                </Button>
                <Button asChild variant="outline" className="flex-1" data-testid="button-text-dispatch">
                  <a href={`sms:${data.dispatch_phone}`}>
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Text Dispatch
                  </a>
                </Button>
              </div>
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
