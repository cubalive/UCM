import { useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { useTripRealtime } from "@/hooks/use-trip-realtime";
import { RealtimeDebugPanel } from "@/components/realtime-debug-panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Clock, Navigation, AlertTriangle, MapPin } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { TripStaticMap } from "@/components/trip-static-map";
import { TripProgressTimeline, TripDateTimeHeader, TripMetricsCard } from "@/components/trip-progress-timeline";
import { queryClient } from "@/lib/queryClient";

const STATUS_DISPLAY_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  ASSIGNED: "Assigned",
  EN_ROUTE_TO_PICKUP: "En Route Pickup",
  ARRIVED_PICKUP: "Arrived Pickup",
  PICKED_UP: "Picked Up",
  EN_ROUTE_TO_DROPOFF: "En Route Dropoff",
  ARRIVED_DROPOFF: "Arrived Dropoff",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
};

const STATUS_VARIANTS: Record<string, string> = {
  SCHEDULED: "secondary",
  ASSIGNED: "default",
  IN_PROGRESS: "default",
  COMPLETED: "secondary",
  CANCELLED: "destructive",
  NO_SHOW: "destructive",
};

export default function TripDetailPage() {
  const params = useParams<{ id: string }>();
  const tripId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { token, user } = useAuth();
  const debugEnabled = import.meta.env.VITE_UCM_DEBUG === 'true';

  const { data: trip, isLoading, error } = useQuery<any>({
    queryKey: ["/api/trips", tripId],
    queryFn: () => apiFetch(`/api/trips/${tripId}`, token),
    enabled: !!token && tripId > 0,
  });

  const { data: patient } = useQuery<any>({
    queryKey: ["/api/patients", trip?.patientId],
    queryFn: () => apiFetch(`/api/patients/${trip.patientId}`, token),
    enabled: !!token && !!trip?.patientId,
  });

  const { data: driver } = useQuery<any>({
    queryKey: ["/api/drivers", trip?.driverId],
    queryFn: () => apiFetch(`/api/drivers/${trip.driverId}`, token),
    enabled: !!token && !!trip?.driverId,
  });

  const isActiveTrip = trip ? ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"].includes(trip.status) : false;
  const hasDriver = !!trip?.driverId;

  const handleRtStatusChange = useCallback((statusData: { status: string; tripId: number }) => {
    queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId] });
    queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId, "eta-to-pickup"] });
  }, [tripId]);

  const handleRtEtaUpdate = useCallback((etaData: { minutes: number; distanceMiles: number }) => {
    queryClient.setQueryData(["/api/trips", tripId, "eta-to-pickup"], (old: any) => {
      if (!old) return old;
      return { ...old, eta_minutes: etaData.minutes, distance_text: `${etaData.distanceMiles.toFixed(1)} mi`, updated_at: new Date().toISOString(), source: "realtime" };
    });
  }, [tripId]);

  const { connected: rtConnected, debugInfo: rtDebugInfo } = useTripRealtime({
    tripId: (isActiveTrip && hasDriver) || debugEnabled ? tripId : null,
    authToken: token,
    onStatusChange: handleRtStatusChange,
    onEtaUpdate: handleRtEtaUpdate,
  });

  const { data: etaData } = useQuery<{ ok: boolean; eta_minutes?: number; distance_text?: string; updated_at?: string; source?: string }>({
    queryKey: ["/api/trips", tripId, "eta-to-pickup"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/eta-to-pickup`, token),
    enabled: !!token && hasDriver && isActiveTrip,
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <Button variant="ghost" onClick={() => navigate("/trips")} data-testid="button-back-trips">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Trips
        </Button>
        <Card className="mt-4">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground" data-testid="text-trip-not-found">Trip not found or access denied.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto overflow-y-auto h-full" data-testid="trip-detail-page">
      {debugEnabled && (
        <RealtimeDebugPanel
          debugInfo={rtDebugInfo}
          pollingActive={!rtConnected}
          pollingIntervalMs={rtConnected ? false : 10000}
          tripId={trip.id}
        />
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" onClick={() => navigate("/trips")} data-testid="button-back-trips">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-lg font-mono font-semibold" data-testid="text-trip-public-id">{trip.publicId}</span>
          <Badge variant={(STATUS_VARIANTS[trip.status] as any) || "secondary"} data-testid="badge-trip-status">
            {STATUS_DISPLAY_LABELS[trip.status] || trip.status.replace(/_/g, " ")}
          </Badge>
          {trip.approvalStatus && trip.approvalStatus !== "approved" && (
            <Badge variant={trip.approvalStatus === "pending" ? "secondary" : "destructive"} data-testid="badge-trip-approval">
              {trip.approvalStatus === "pending" ? "Pending Approval" : trip.approvalStatus === "cancel_requested" ? "Cancel Requested" : trip.approvalStatus}
            </Badge>
          )}
          {trip.tripType === "recurring" && (
            <Badge variant="outline">Recurring</Badge>
          )}
          {trip.mobilityRequirement && trip.mobilityRequirement !== "STANDARD" && (
            <Badge variant="outline" data-testid="badge-mobility-requirement">{trip.mobilityRequirement}</Badge>
          )}
        </div>
      </div>

      <TripStaticMap
        tripId={trip.id}
        pickupLat={trip.pickupLat}
        dropoffLat={trip.dropoffLat}
        size="full"
        token={token}
        className="w-full h-56 md:h-72 rounded-md"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4 space-y-3">
            <TripDateTimeHeader trip={trip} />

            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
              <span data-testid="text-detail-pickup-time">Pickup: {trip.pickupTime}</span>
              <span data-testid="text-detail-est-arrival">ETA: {trip.estimatedArrivalTime}</span>
            </div>
            {trip.recurringDays?.length > 0 && (
              <p className="text-sm text-muted-foreground">Recurring: {trip.recurringDays.join(", ")}</p>
            )}

            <TripMetricsCard trip={trip} />

            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                Pickup
              </h3>
              <p className="text-sm" data-testid="text-detail-pickup-addr">{trip.pickupAddress}</p>
              {trip.pickupZip && <p className="text-xs text-muted-foreground">ZIP: {trip.pickupZip}</p>}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                Dropoff
              </h3>
              <p className="text-sm" data-testid="text-detail-dropoff-addr">{trip.dropoffAddress}</p>
              {trip.dropoffZip && <p className="text-xs text-muted-foreground">ZIP: {trip.dropoffZip}</p>}
            </div>

            {driver && (
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-muted-foreground">Driver</h3>
                <p className="text-sm" data-testid="text-detail-driver">{driver.firstName} {driver.lastName}</p>
              </div>
            )}

            {patient && (
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-muted-foreground">Patient</h3>
                <p className="text-sm" data-testid="text-detail-patient">{patient.firstName} {patient.lastName}</p>
              </div>
            )}

            {isActiveTrip && hasDriver && etaData?.ok && etaData.eta_minutes != null && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Navigation className="w-4 h-4" />
                  ETA to Pickup
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={etaData.eta_minutes <= 5 ? "destructive" : "secondary"} data-testid="badge-detail-eta">
                    <Clock className="w-3 h-3 mr-1" />
                    {etaData.eta_minutes} min
                  </Badge>
                  {etaData.distance_text && (
                    <span className="text-sm text-muted-foreground">{etaData.distance_text}</span>
                  )}
                  {etaData.source === "cached" && (
                    <span className="text-xs text-muted-foreground">(cached)</span>
                  )}
                </div>
              </div>
            )}

            {trip.notes && (
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-muted-foreground">Notes</h3>
                <p className="text-sm" data-testid="text-detail-notes">{trip.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <TripProgressTimeline trip={trip} showHeader={true} showMetrics={false} />
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
