import { useCallback, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTripRealtime } from "@/hooks/use-trip-realtime";
import { RealtimeDebugPanel } from "@/components/realtime-debug-panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Clock, Navigation, AlertTriangle, MapPin, Download, Loader2, Ban, Archive, Trash2, RotateCcw, DollarSign, Receipt, Signal } from "lucide-react";
import { apiFetch, rawAuthFetch } from "@/lib/api";
import { TripStaticMap } from "@/components/trip-static-map";
import { TripRouteMap } from "@/components/trip-route-map";
import { TripProgressTimeline, TripDateTimeHeader, TripMetricsCard } from "@/components/trip-progress-timeline";
import { queryClient } from "@/lib/queryClient";
import { downloadWithAuth } from "@/lib/export";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelFaultParty, setCancelFaultParty] = useState("unknown");
  const [archiveReason, setArchiveReason] = useState("");
  const debugEnabled = import.meta.env.VITE_UCM_DEBUG === 'true';

  const WRITE_ROLES = ["SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"];
  const canWrite = user?.role && WRITE_ROLES.includes(user.role);
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const FINANCIAL_ROLES = ["SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"];
  const canViewFinancials = user?.role && FINANCIAL_ROLES.includes(user.role);

  const cancelMutation = useMutation({
    mutationFn: () => rawAuthFetch(`/api/trips/${tripId}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: cancelReason || "Cancelled via trip detail", faultParty: cancelFaultParty }) }),
    onSuccess: () => { toast({ title: "Trip cancelled successfully" }); queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId] }); queryClient.invalidateQueries({ queryKey: ["/api/trips"] }); setCancelReason(""); setCancelFaultParty("unknown"); },
    onError: (err: any) => toast({ title: "Cancel failed", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: () => rawAuthFetch(`/api/trips/${tripId}/archive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: archiveReason || "Archived via trip detail" }) }),
    onSuccess: () => { toast({ title: "Trip archived successfully" }); queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId] }); queryClient.invalidateQueries({ queryKey: ["/api/trips"] }); setArchiveReason(""); },
    onError: (err: any) => toast({ title: "Archive failed", description: err.message, variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: () => rawAuthFetch(`/api/admin/trips/${tripId}/restore`, { method: "PATCH" }),
    onSuccess: () => { toast({ title: "Trip restored successfully" }); queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId] }); queryClient.invalidateQueries({ queryKey: ["/api/trips"] }); },
    onError: (err: any) => toast({ title: "Restore failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => rawAuthFetch(`/api/trips/${tripId}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Trip permanently deleted" }); navigate("/trips"); },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

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

  const { data: financials, isLoading: financialsLoading } = useQuery<any>({
    queryKey: ["/api/trips", tripId, "financials"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/financials`, token),
    enabled: !!token && !!canViewFinancials && tripId > 0 && !!trip && ["COMPLETED", "NO_SHOW", "CANCELLED"].includes(trip?.status || ""),
  });

  const { data: gpsQuality } = useQuery<any>({
    queryKey: ["/api/trips", tripId, "gps-quality"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/gps-quality`, token),
    enabled: !!token && tripId > 0 && !!trip && ["COMPLETED", "NO_SHOW"].includes(trip?.status || ""),
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
          <Button
            size="sm"
            variant="outline"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              await downloadWithAuth(
                `/api/trips/${trip.id}/pdf`,
                `trip-${trip.publicId || trip.id}.pdf`,
                "application/pdf",
                rawAuthFetch,
                (msg: string) => toast({ title: msg, variant: "destructive" }),
              );
              setDownloading(false);
            }}
            data-testid="button-download-trip-pdf"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span className="ml-1.5">Download PDF</span>
          </Button>
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
          {trip.archivedAt && (
            <Badge variant="outline" className="border-amber-500 text-amber-600" data-testid="badge-trip-archived">Archived</Badge>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canWrite && trip.status !== "CANCELLED" && !trip.archivedAt && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="text-orange-600 border-orange-300 hover:bg-orange-50" data-testid="button-cancel-trip">
                  <Ban className="w-4 h-4 mr-1" />
                  Cancel
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel Trip {trip.publicId}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will cancel the trip and notify relevant parties. A cancellation fee may apply depending on fault party.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <Label>Fault Party</Label>
                    <Select value={cancelFaultParty} onValueChange={setCancelFaultParty}>
                      <SelectTrigger data-testid="select-cancel-fault-party"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unknown">Unknown</SelectItem>
                        <SelectItem value="clinic">Clinic</SelectItem>
                        <SelectItem value="patient">Patient</SelectItem>
                        <SelectItem value="driver">Driver</SelectItem>
                        <SelectItem value="dispatch">Dispatch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Reason</Label>
                    <Textarea placeholder="Cancellation reason..." value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} data-testid="input-cancel-reason" />
                  </div>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-trip-dismiss">Keep Trip</AlertDialogCancel>
                  <AlertDialogAction onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} className="bg-orange-600 hover:bg-orange-700" data-testid="button-cancel-trip-confirm">
                    {cancelMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    Confirm Cancel
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {canWrite && !trip.archivedAt && ["COMPLETED", "CANCELLED", "NO_SHOW", "SCHEDULED"].includes(trip.status) && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="text-amber-600 border-amber-300 hover:bg-amber-50" data-testid="button-archive-trip">
                  <Archive className="w-4 h-4 mr-1" />
                  Archive
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive Trip {trip.publicId}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Archived trips are hidden from the main list but can be restored later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-2">
                  <Label>Reason (optional)</Label>
                  <Textarea placeholder="Archive reason..." value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} data-testid="input-archive-reason" />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-archive-trip-dismiss">Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => archiveMutation.mutate()} disabled={archiveMutation.isPending} className="bg-amber-600 hover:bg-amber-700" data-testid="button-archive-trip-confirm">
                    {archiveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    Archive Trip
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {canWrite && trip.archivedAt && (
            <Button size="sm" variant="outline" className="text-green-600 border-green-300 hover:bg-green-50" onClick={() => restoreMutation.mutate()} disabled={restoreMutation.isPending} data-testid="button-restore-trip">
              {restoreMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RotateCcw className="w-4 h-4 mr-1" />}
              Restore
            </Button>
          )}

          {isSuperAdmin && ["SCHEDULED", "ASSIGNED", "CANCELLED"].includes(trip.status) && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" data-testid="button-delete-trip">
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Permanently Delete Trip {trip.publicId}?</AlertDialogTitle>
                  <AlertDialogDescription className="text-destructive font-medium">
                    This action is irreversible. The trip and all associated data (SMS logs, tracking tokens) will be permanently removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-delete-trip-dismiss">Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} className="bg-red-600 hover:bg-red-700" data-testid="button-delete-trip-confirm">
                    {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    Delete Forever
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <TripRouteMap
        tripId={trip.id}
        pickupLat={trip.pickupLat}
        pickupLng={trip.pickupLng}
        dropoffLat={trip.dropoffLat}
        dropoffLng={trip.dropoffLng}
        pickupAddress={trip.pickupAddress}
        dropoffAddress={trip.dropoffAddress}
        token={token}
        className="w-full rounded-md"
        style={{ minHeight: "280px" }}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4 space-y-3">
            <TripDateTimeHeader trip={trip} />

            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
              <span data-testid="text-detail-pickup-time">Pickup: {trip.pickupTime}</span>
              {trip.estimatedArrivalTime && trip.estimatedArrivalTime !== "TBD" && (
                <span data-testid="text-detail-est-arrival">ETA: {trip.estimatedArrivalTime}</span>
              )}
            </div>
            {trip.recurringDays?.length > 0 && (
              <p className="text-sm text-muted-foreground">Recurring: {trip.recurringDays.join(", ")}</p>
            )}

            <TripMetricsCard trip={trip} />

            {gpsQuality && gpsQuality.grade !== "NONE" && (
              <div className="flex items-center gap-2" data-testid="gps-quality-badge">
                <Signal className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">GPS:</span>
                <Badge
                  variant={gpsQuality.grade === "GREAT" ? "default" : gpsQuality.grade === "OK" ? "secondary" : "destructive"}
                  className="text-xs"
                  data-testid="text-gps-grade"
                >
                  {gpsQuality.grade} ({gpsQuality.score}/100)
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {gpsQuality.totalPings} pings
                  {gpsQuality.avgIntervalSeconds != null && ` | ~${gpsQuality.avgIntervalSeconds}s avg`}
                </span>
              </div>
            )}

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

      {canViewFinancials && ["COMPLETED", "NO_SHOW", "CANCELLED"].includes(trip.status) && (
        <Card data-testid="card-trip-financials">
          <CardContent className="py-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <DollarSign className="w-4 h-4" />
              Financial Breakdown
            </h3>
            {financialsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-40" />
              </div>
            ) : financials ? (
              <div className="space-y-2">
                <div className="flex justify-between text-sm" data-testid="row-trip-total">
                  <span className="text-muted-foreground">Trip Total</span>
                  <span className="font-mono font-medium">${(financials.tripTotalCents / 100).toFixed(2)}</span>
                </div>
                {financials.platformFeeCents > 0 && (
                  <div className="flex justify-between text-sm" data-testid="row-platform-fee">
                    <span className="text-muted-foreground">Platform Fee</span>
                    <span className="font-mono text-red-600">-${(financials.platformFeeCents / 100).toFixed(2)}</span>
                  </div>
                )}
                {financials.driverPayoutCents > 0 && (
                  <div className="flex justify-between text-sm" data-testid="row-driver-payout">
                    <span className="text-muted-foreground">Driver Payout</span>
                    <span className="font-mono text-blue-600">-${(financials.driverPayoutCents / 100).toFixed(2)}</span>
                  </div>
                )}
                <div className="border-t pt-2 flex justify-between text-sm font-semibold" data-testid="row-net-company">
                  <span>Net to Company</span>
                  <span className="font-mono">${(financials.netToCompanyCents / 100).toFixed(2)}</span>
                </div>
                {financials.feeRuleId && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <Receipt className="w-3 h-3" />
                    <span data-testid="text-fee-rule-source">Fee Rule #{financials.feeRuleId} — {financials.feeRuleDetails?.feeType || "calculated"}</span>
                  </div>
                )}
                {financials.feeRuleDetails?.source === "legacy" && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <Receipt className="w-3 h-3" />
                    <span data-testid="text-fee-legacy-source">Legacy platform fee applied</span>
                  </div>
                )}
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span data-testid="text-ledger-entries">{financials.ledgerEntries?.length || 0} ledger entries</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-no-financials">No financial data available for this trip.</p>
            )}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
