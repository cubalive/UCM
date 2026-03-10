import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, rawAuthFetch } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/timezone";
import { downloadWithAuth } from "@/lib/export";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  MapPin,
  User,
  Navigation,
  Car,
  CheckCircle,
  Lock,
  XCircle,
  Download,
  ArrowLeft,
  AlertTriangle,
  Timer,
  Route,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  ASSIGNED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  EN_ROUTE_TO_PICKUP: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  ARRIVED_PICKUP: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  PICKED_UP: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  EN_ROUTE_TO_DROPOFF: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  ARRIVED_DROPOFF: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  IN_PROGRESS: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  NO_SHOW: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  ASSIGNED: "Assigned",
  EN_ROUTE_TO_PICKUP: "En Route to Pickup",
  ARRIVED_PICKUP: "Arrived at Pickup",
  PICKED_UP: "Picked Up",
  EN_ROUTE_TO_DROPOFF: "En Route to Dropoff",
  ARRIVED_DROPOFF: "Arrived at Dropoff",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
};


function fmtTimestamp(isoStr: string | Date | null | undefined): string {
  if (!isoStr) return "\u2014";
  try {
    const d = new Date(isoStr as string);
    if (isNaN(d.getTime())) return "\u2014";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return "\u2014";
  }
}

function fmtPickupTime(t: string | null | undefined): string {
  if (!t) return "\u2014";
  try {
    const [h, m] = t.split(":").map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return t;
  }
}

function ClinicTripSignatures({ tripId, token }: { tripId: number; token: string | null }) {
  const sigQuery = useQuery<any>({
    queryKey: ["/api/trips", tripId, "signature"],
    queryFn: async () => {
      if (!token) return null;
      return apiFetch(`/api/trips/${tripId}/signature`, token);
    },
    enabled: !!token,
  });

  const data = sigQuery.data;

  return (
    <Card>
      <CardContent className="py-4 px-5 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Signatures</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Driver</span>
            <div data-testid="text-driver-signed">
              {data?.driverSigned ? (
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 text-sm">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Signed {data.driverSignedAt ? formatDate(data.driverSignedAt) : ""}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Not signed</span>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Clinic / Patient</span>
            <div data-testid="text-clinic-signed">
              {data?.clinicSigned ? (
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 text-sm">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Signed {data.clinicSignedAt ? formatDate(data.clinicSignedAt) : ""}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Not signed</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ClinicTripDetailsPage() {
  const [, params] = useRoute("/clinic-trip/:id");
  const [, navigate] = useLocation();
  const { token } = useAuth();
  const { toast } = useToast();
  const [pdfLoading, setPdfLoading] = useState(false);

  const tripId = params?.id ? parseInt(params.id) : null;

  const tripQuery = useQuery<any>({
    queryKey: ["/api/clinic/trips", tripId],
    queryFn: () => apiFetch(`/api/clinic/trips/${tripId}`, token),
    enabled: !!token && !!tripId,
  });

  const trip = tripQuery.data;

  const handleDownloadPdf = async () => {
    if (!token || !tripId) return;
    setPdfLoading(true);
    await downloadWithAuth(
      `/api/clinic/trips/${tripId}/pdf`,
      `trip-${trip?.publicId || tripId}.pdf`,
      "application/pdf",
      rawAuthFetch,
      (msg) => toast({ title: "Error", description: msg || "Failed to download PDF", variant: "destructive" }),
    );
    setPdfLoading(false);
  };

  if (tripQuery.isLoading) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4" data-testid="clinic-trip-details-loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (tripQuery.isError || !trip) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4" data-testid="clinic-trip-details-error">
        <Button variant="ghost" className="gap-2" onClick={() => navigate("/clinic-trips")} data-testid="button-back-to-trips">
          <ArrowLeft className="w-4 h-4" />
          Back to Trips
        </Button>
        <Card>
          <CardContent className="py-8 text-center space-y-2">
            <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">Trip not found or you don't have access to view it.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isTerminal = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(trip.status);
  const serviceLabel =
    trip.mobilityRequirement === "WHEELCHAIR"
      ? "Wheelchair"
      : trip.mobilityRequirement === "STRETCHER"
        ? "Stretcher"
        : trip.mobilityRequirement === "BARIATRIC"
          ? "Bariatric"
          : "Sedan";

  const FULL_TIMELINE: { label: string; value: string; reason?: string }[] = [
    { label: "Scheduled Pickup", value: fmtPickupTime(trip.pickupTime) },
    { label: "Scheduled Dropoff (ETA)", value: fmtPickupTime(trip.estimatedArrivalTime) },
    { label: "Created", value: fmtTimestamp(trip.createdAt) },
    { label: "Approved", value: fmtTimestamp(trip.approvedAt) },
    { label: "Assigned to Driver", value: fmtTimestamp(trip.assignedAt) },
    { label: "Driver Accepted", value: fmtTimestamp(trip.acceptedAt) },
    { label: "En Route to Pickup", value: fmtTimestamp(trip.startedAt) },
    { label: "Arrived at Pickup", value: fmtTimestamp(trip.arrivedPickupAt) },
    { label: "Picked Up", value: fmtTimestamp(trip.pickedUpAt) },
    { label: "En Route to Dropoff", value: fmtTimestamp(trip.enRouteDropoffAt) },
    { label: "Arrived at Dropoff", value: fmtTimestamp(trip.arrivedDropoffAt) },
  ];
  if (trip.status === "COMPLETED") {
    FULL_TIMELINE.push({ label: "Completed", value: fmtTimestamp(trip.completedAt) });
  } else if (trip.status === "CANCELLED") {
    FULL_TIMELINE.push({ label: "Cancelled", value: fmtTimestamp(trip.cancelledAt), reason: trip.cancelledReason || undefined });
  } else if (trip.status === "NO_SHOW") {
    FULL_TIMELINE.push({ label: "No-Show", value: fmtTimestamp(trip.cancelledAt), reason: trip.cancelledReason || undefined });
  } else {
    FULL_TIMELINE.push({ label: "Completed", value: "\u2014" });
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5" data-testid="clinic-trip-details-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Button variant="ghost" className="gap-2" onClick={() => navigate("/clinic-trips")} data-testid="button-back-to-trips">
          <ArrowLeft className="w-4 h-4" />
          Back to Trips
        </Button>
        <Button
          variant="outline"
          className="gap-2"
          onClick={handleDownloadPdf}
          disabled={pdfLoading}
          data-testid="button-download-trip-pdf"
        >
          <Download className="w-4 h-4" />
          {pdfLoading ? "Generating..." : "Download PDF"}
        </Button>
      </div>

      {(trip.routeImageUrl || trip.staticMapFullUrl || trip.staticMapThumbUrl) && (
        <div className="rounded-md overflow-hidden border">
          <img
            src={trip.routeImageUrl || trip.staticMapFullUrl || trip.staticMapThumbUrl}
            alt="Route map"
            className="w-full h-auto"
            data-testid="img-route-map"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold" data-testid="text-trip-id">
            Trip {trip.publicId}
          </h1>
          <Badge className={STATUS_COLORS[trip.status] || ""} data-testid="badge-trip-status">
            {STATUS_LABELS[trip.status] || trip.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground" data-testid="text-trip-date">
          {formatDate(trip.scheduledDate)}
          {trip.pickupTime ? ` \u2014 Pickup at ${fmtPickupTime(trip.pickupTime)}` : ""}
        </p>
      </div>

      {isTerminal && (trip.waitTimeMinutes != null || trip.totalDurationMinutes != null || trip.transportMinutes != null || trip.distanceMiles != null) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {trip.distanceMiles != null && (
            <Card>
              <CardContent className="py-3 px-4 text-center space-y-1">
                <Navigation className="w-4 h-4 text-emerald-500 mx-auto" />
                <p className="text-lg font-semibold tabular-nums" data-testid="text-metric-distance">
                  {parseFloat(trip.distanceMiles).toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground">Miles</p>
              </CardContent>
            </Card>
          )}
          {trip.totalDurationMinutes != null && (
            <Card>
              <CardContent className="py-3 px-4 text-center space-y-1">
                <Clock className="w-4 h-4 text-muted-foreground mx-auto" />
                <p className="text-lg font-semibold tabular-nums" data-testid="text-metric-total-duration">
                  {trip.totalDurationMinutes}
                </p>
                <p className="text-xs text-muted-foreground">Total Min</p>
              </CardContent>
            </Card>
          )}
          {trip.transportMinutes != null && (
            <Card>
              <CardContent className="py-3 px-4 text-center space-y-1">
                <Route className="w-4 h-4 text-purple-500 mx-auto" />
                <p className="text-lg font-semibold tabular-nums" data-testid="text-metric-transport">
                  {trip.transportMinutes}
                </p>
                <p className="text-xs text-muted-foreground">Transport Min</p>
              </CardContent>
            </Card>
          )}
          {trip.waitTimeMinutes != null && (
            <Card>
              <CardContent className="py-3 px-4 text-center space-y-1">
                <Timer className="w-4 h-4 text-amber-500 mx-auto" />
                <p className="text-lg font-semibold tabular-nums" data-testid="text-metric-wait">
                  {trip.waitTimeMinutes}
                </p>
                <p className="text-xs text-muted-foreground">Wait Min</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Card>
        <CardContent className="py-4 px-5 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Trip Information</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {trip.patientName && (
              <>
                <span className="text-muted-foreground">Patient</span>
                <span className="font-medium" data-testid="text-patient-name">{trip.patientName}</span>
              </>
            )}
            {trip.clinicName && (
              <>
                <span className="text-muted-foreground">Clinic</span>
                <span data-testid="text-clinic-name">{trip.clinicName}</span>
              </>
            )}
            {trip.cityName && (
              <>
                <span className="text-muted-foreground">City</span>
                <span data-testid="text-city-name">{trip.cityName}</span>
              </>
            )}
            <span className="text-muted-foreground">Service Type</span>
            <span data-testid="text-service-type">{serviceLabel}</span>
            {trip.tripType && (
              <>
                <span className="text-muted-foreground">Trip Type</span>
                <span data-testid="text-trip-type">{trip.tripType}</span>
              </>
            )}
            {trip.direction && (
              <>
                <span className="text-muted-foreground">Direction</span>
                <span data-testid="text-direction">{trip.direction}</span>
              </>
            )}
            {trip.passengerCount > 1 && (
              <>
                <span className="text-muted-foreground">Passengers</span>
                <span data-testid="text-passenger-count">{trip.passengerCount}</span>
              </>
            )}
            {trip.wheelchairRequired && (
              <>
                <span className="text-muted-foreground">Special Needs</span>
                <span className="flex items-center gap-1" data-testid="text-special-needs">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  Wheelchair Required
                </span>
              </>
            )}
          </div>
          {trip.patientNotes && (
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-patient-notes">
              Patient Notes: {trip.patientNotes}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 px-5 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Route</p>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-white">A</span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pickup</p>
                <p className="text-sm" data-testid="text-pickup-address">{trip.pickupAddress || "\u2014"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-white">B</span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dropoff</p>
                <p className="text-sm" data-testid="text-dropoff-address">{trip.dropoffAddress || "\u2014"}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap text-sm mt-1">
            <span className="flex items-center gap-1" data-testid="text-distance">
              <Navigation className="w-3.5 h-3.5 text-emerald-500" />
              {trip.distanceMiles != null ? `${parseFloat(trip.distanceMiles).toFixed(1)} miles` : "\u2014"}
            </span>
            {trip.durationMinutes != null && (
              <span className="flex items-center gap-1" data-testid="text-duration">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                {trip.durationMinutes} min est.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 px-5 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Full Timeline</p>
          <div className="space-y-1">
            {FULL_TIMELINE.map((evt, idx) => {
              const isDash = evt.value === "\u2014";
              const isNegative = evt.label === "Cancelled" || evt.label === "No-Show";
              return (
                <div key={idx} data-testid={`timeline-row-${idx}`}>
                  <div
                    className={`flex items-center justify-between gap-2 py-1.5 px-2 rounded text-sm ${
                      isNegative ? "text-destructive" : isDash ? "text-muted-foreground" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isDash ? (
                        <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
                      ) : isNegative ? (
                        <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      )}
                      <span>{evt.label}</span>
                    </div>
                    <span
                      className={`text-xs tabular-nums flex-shrink-0 ${isDash ? "text-muted-foreground/50" : isNegative ? "text-destructive/70" : "text-muted-foreground"}`}
                    >
                      {evt.value}
                    </span>
                  </div>
                  {evt.reason && (
                    <p className="text-xs text-muted-foreground pl-8 mt-0.5">Reason: {evt.reason}</p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 px-5 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Driver & Vehicle</p>
          {trip.driverName ? (
            <>
              <p className="text-sm font-medium flex items-center gap-1.5" data-testid="text-driver-name">
                <User className="w-4 h-4" />
                {trip.driverName}
              </p>
              {(trip.vehicleLabel || trip.vehicleColor) && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5" data-testid="text-vehicle-info">
                  <Car className="w-4 h-4" />
                  {[trip.vehicleColor, trip.vehicleMake, trip.vehicleModel].filter(Boolean).join(" ") || ""}
                  {trip.vehicleLabel && ` (${trip.vehicleLabel})`}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-driver-unassigned">Unassigned</p>
          )}
        </CardContent>
      </Card>

      {trip.billingOutcome && (
        <Card>
          <CardContent className="py-4 px-5 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Billing</p>
            <p className="text-sm" data-testid="text-billing-outcome">Outcome: {trip.billingOutcome}</p>
            {trip.billingReason && (
              <p className="text-sm text-muted-foreground" data-testid="text-billing-reason">Reason: {trip.billingReason}</p>
            )}
          </CardContent>
        </Card>
      )}

      {trip.cancelledReason && (
        <Card>
          <CardContent className="py-4 px-5 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cancellation</p>
            <p className="text-sm" data-testid="text-cancel-reason">{trip.cancelledReason}</p>
          </CardContent>
        </Card>
      )}

      {isTerminal && <ClinicTripSignatures tripId={trip.id} token={token} />}

      {isTerminal && (
        <div className="text-center py-2">
          <Badge variant="secondary" className="gap-1">
            <Lock className="w-3 h-3" />
            This trip is completed and locked
          </Badge>
        </div>
      )}

      <Button
        className="w-full gap-2"
        variant="outline"
        onClick={handleDownloadPdf}
        disabled={pdfLoading}
        data-testid="button-download-trip-pdf-bottom"
      >
        <Download className="w-4 h-4" />
        {pdfLoading ? "Generating PDF..." : "Download PDF Report"}
      </Button>
    </div>
  );
}
