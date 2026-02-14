import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { DialogFooter } from "@/components/ui/dialog";
import { Plus, Route, Search, MessageSquare, Eye, AlertTriangle, Phone, User, Pencil, Clock, Navigation, Link2, LinkIcon, Copy, XCircle, CheckCircle, Ban, Archive, ShieldCheck, Trash2, Flag, UserX, ClockAlert, UserCheck, Lock, Send } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { AddressAutocomplete, type StructuredAddress } from "@/components/address-autocomplete";
import { RecurringSchedule, type TripType, type SeriesPattern, type SeriesEndType } from "@/components/recurring-schedule";
import { TripStaticMap } from "@/components/trip-static-map";

function normalizePhoneToE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.startsWith("+") && /^\+[1-9]\d{1,14}$/.test(phone)) return phone;
  return null;
}

function formatPhoneDisplay(phone: string): string {
  const normalized = normalizePhoneToE164(phone);
  if (!normalized) return phone;
  const digits = normalized.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const area = digits.substring(1, 4);
    const prefix = digits.substring(4, 7);
    const line = digits.substring(7, 11);
    return `(${area}) ${prefix}-${line}`;
  }
  return phone;
}


function getTodayInTimezone(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const y = parts.find(p => p.type === "year")?.value;
    const m = parts.find(p => p.type === "month")?.value;
    const d = parts.find(p => p.type === "day")?.value;
    return `${y}-${m}-${d}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

type TripTab = "all" | "unassigned" | "scheduled" | "active" | "completed";

const ACTIVE_TRIP_STATUSES = ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];

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

export default function TripsPage() {
  const { token, selectedCity, user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [detailTrip, setDetailTrip] = useState<any>(null);
  const [tripTab, setTripTab] = useState<TripTab>("all");
  const [assignTrip, setAssignTrip] = useState<any>(null);

  const cityParam = selectedCity ? `?cityId=${selectedCity.id}` : "";

  const [cancelRequestTrip, setCancelRequestTrip] = useState<any>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [dispatchCancelTrip, setDispatchCancelTrip] = useState<any>(null);
  const [dispatchCancelReason, setDispatchCancelReason] = useState("");
  const [dispatchCancelType, setDispatchCancelType] = useState<"soft" | "hard">("soft");

  const hasSmsPerm =
    user?.role === "SUPER_ADMIN" ||
    user?.role === "DISPATCH";

  const { data: smsHealth } = useQuery<{ twilioConfigured: boolean; dispatchPhoneConfigured: boolean }>({
    queryKey: ["/api/sms/health"],
    queryFn: () => apiFetch("/api/sms/health", token),
    enabled: !!token && hasSmsPerm,
    staleTime: 5 * 60 * 1000,
  });

  const canSendSms = hasSmsPerm && smsHealth?.twilioConfigured === true;

  const isClinicUser = user?.role === "VIEWER" && !!user?.clinicId;
  const isDispatchOrAdmin = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "DISPATCH";

  const tripQueryParams = new URLSearchParams();
  if (selectedCity?.id) tripQueryParams.set("cityId", String(selectedCity.id));
  if (tripTab !== "all") tripQueryParams.set("tab", tripTab);
  const tripQueryString = tripQueryParams.toString() ? `?${tripQueryParams.toString()}` : "";

  const { data: trips, isLoading } = useQuery<any[]>({
    queryKey: ["/api/trips", selectedCity?.id, tripTab],
    queryFn: () => apiFetch(`/api/trips${tripQueryString}`, token),
    enabled: !!token,
  });

  const { data: patients } = useQuery<any[]>({
    queryKey: ["/api/patients", selectedCity?.id],
    queryFn: () => apiFetch(`/api/patients${cityParam}`, token),
    enabled: !!token,
  });

  const { data: drivers } = useQuery<any[]>({
    queryKey: ["/api/drivers", selectedCity?.id],
    queryFn: () => apiFetch(`/api/drivers${cityParam}`, token),
    enabled: !!token,
  });

  const { data: vehicles } = useQuery<any[]>({
    queryKey: ["/api/vehicles", selectedCity?.id],
    queryFn: () => apiFetch(`/api/vehicles${cityParam}`, token),
    enabled: !!token,
  });

  const { data: clinics } = useQuery<any[]>({
    queryKey: ["/api/clinics", selectedCity?.id],
    queryFn: () => apiFetch(`/api/clinics${cityParam}`, token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => {
      if (data._isSeries) {
        const { _isSeries, ...seriesData } = data;
        return apiFetch("/api/trip-series", token, {
          method: "POST",
          body: JSON.stringify({ ...seriesData, cityId: selectedCity?.id }),
        });
      }
      return apiFetch("/api/trips", token, {
        method: "POST",
        body: JSON.stringify({ ...data, cityId: selectedCity?.id }),
      });
    },
    onSuccess: (_data: any, variables: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setOpen(false);
      if (variables._isSeries) {
        toast({ title: `Series created with ${_data?.count || "multiple"} trips` });
      } else {
        toast({ title: "Trip created" });
      }
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/api/trips/${id}/status`, token, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/trips/${id}/approve`, token, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      toast({ title: "Trip approved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const cancelRequestMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiFetch(`/api/trips/${id}/cancel-request`, token, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      setCancelRequestTrip(null);
      setCancelReason("");
      toast({ title: "Cancel request submitted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const dispatchCancelMutation = useMutation({
    mutationFn: ({ id, reason, type }: { id: number; reason: string; type: string }) =>
      apiFetch(`/api/trips/${id}/cancel`, token, {
        method: "PATCH",
        body: JSON.stringify({ reason, type }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      setDispatchCancelTrip(null);
      setDispatchCancelReason("");
      setDispatchCancelType("soft");
      toast({ title: "Trip cancelled" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/admin/trips/${id}/archive`, token, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      toast({ title: "Trip archived" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const clinicDeleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/clinic/trips/${id}`, token, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Trip deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const assignDriverMutation = useMutation({
    mutationFn: ({ tripId, driverId, vehicleId }: { tripId: number; driverId: number; vehicleId?: number }) =>
      apiFetch(`/api/trips/${tripId}/assign`, token, {
        method: "PATCH",
        body: JSON.stringify({ driverId, vehicleId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      setAssignTrip(null);
      toast({ title: "Driver assigned to trip" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filtered = trips?.filter(
    (t: any) =>
      t.publicId?.toLowerCase().includes(search.toLowerCase()) ||
      t.pickupAddress?.toLowerCase().includes(search.toLowerCase()) ||
      t.dropoffAddress?.toLowerCase().includes(search.toLowerCase())
  );

  const statusColors: Record<string, string> = {
    SCHEDULED: "secondary",
    ASSIGNED: "default",
    IN_PROGRESS: "default",
    COMPLETED: "secondary",
    CANCELLED: "destructive",
    NO_SHOW: "destructive",
  };

  const approvalColors: Record<string, string> = {
    pending: "secondary",
    approved: "default",
    cancel_requested: "destructive",
    cancelled: "destructive",
  };

  const approvalLabels: Record<string, string> = {
    pending: "Pending Approval",
    approved: "Approved",
    cancel_requested: "Cancel Requested",
    cancelled: "Cancelled",
  };

  const getPatientForTrip = (trip: any) => {
    return patients?.find((p: any) => p.id === trip.patientId);
  };

  const getDriverForTrip = (trip: any) => {
    return drivers?.find((d: any) => d.id === trip.driverId);
  };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trips</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage transportation trips</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-trip">
              <Plus className="w-4 h-4 mr-2" />
              New Trip
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Schedule New Trip</DialogTitle>
            </DialogHeader>
            <TripForm
              patients={patients || []}
              drivers={drivers || []}
              vehicles={vehicles || []}
              clinics={clinics || []}
              token={token}
              cityTimezone={selectedCity?.timezone || "America/New_York"}
              onSubmit={(data) => createMutation.mutate(data)}
              loading={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: "all" as TripTab, label: "All" },
          { key: "unassigned" as TripTab, label: "Unassigned" },
          { key: "scheduled" as TripTab, label: "Scheduled" },
          { key: "active" as TripTab, label: "Active" },
          { key: "completed" as TripTab, label: "Completed" },
        ]).map((tab) => (
          <Button
            key={tab.key}
            variant={tripTab === tab.key ? "default" : "outline"}
            size="sm"
            onClick={() => setTripTab(tab.key)}
            data-testid={`button-tab-${tab.key}`}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search trips..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-trips"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !filtered?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Route className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No trips found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((trip: any) => (
            <Card key={trip.id} className="hover-elevate cursor-pointer" onClick={() => setDetailTrip(trip)} data-testid={`card-trip-${trip.id}`}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <TripStaticMap
                    tripId={trip.id}
                    pickupLat={trip.pickupLat}
                    dropoffLat={trip.dropoffLat}
                    size="thumb"
                    token={token}
                    className="w-[120px] h-[60px] flex-shrink-0 hidden sm:block"
                  />
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono font-medium" data-testid={`text-trip-id-${trip.id}`}>
                        {trip.publicId}
                      </span>
                      <Badge variant={statusColors[trip.status] as any || "secondary"}>
                        {trip.status.replace("_", " ")}
                      </Badge>
                      {trip.approvalStatus && trip.approvalStatus !== "approved" && (
                        <Badge variant={approvalColors[trip.approvalStatus] as any || "outline"} data-testid={`badge-approval-${trip.id}`}>
                          {approvalLabels[trip.approvalStatus] || trip.approvalStatus}
                        </Badge>
                      )}
                      {trip.tripType === "recurring" && (
                        <Badge variant="outline">Recurring</Badge>
                      )}
                      {trip.tripSeriesId && (
                        <Badge variant="outline" data-testid={`badge-series-${trip.id}`}>
                          Series #{trip.tripSeriesId}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {trip.scheduledDate} | Pickup: {trip.pickupTime} | ETA: {trip.estimatedArrivalTime}
                    </p>
                    <p className="text-sm">
                      <span className="text-muted-foreground">From:</span> {trip.pickupAddress}
                    </p>
                    <p className="text-sm">
                      <span className="text-muted-foreground">To:</span> {trip.dropoffAddress}
                    </p>
                    {trip.recurringDays?.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Recurring: {trip.recurringDays.join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); setDetailTrip(trip); }}
                      data-testid={`button-view-trip-${trip.id}`}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    {isDispatchOrAdmin && (
                      <>
                        {trip.approvalStatus === "pending" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); approveMutation.mutate(trip.id); }}
                            disabled={approveMutation.isPending}
                            data-testid={`button-approve-trip-${trip.id}`}
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Approve
                          </Button>
                        )}
                        {trip.approvalStatus === "cancel_requested" && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={(e) => { e.stopPropagation(); setDispatchCancelTrip(trip); setDispatchCancelReason(trip.cancelledReason || ""); }}
                            disabled={dispatchCancelMutation.isPending}
                            data-testid={`button-confirm-cancel-trip-${trip.id}`}
                          >
                            <Ban className="w-3 h-3 mr-1" />
                            Confirm Cancel
                          </Button>
                        )}
                        {isDispatchOrAdmin && trip.approvalStatus === "approved" && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={(e) => { e.stopPropagation(); setDispatchCancelTrip(trip); }}
                            data-testid={`button-dispatch-cancel-trip-${trip.id}`}
                          >
                            <Ban className="w-3 h-3 mr-1" />
                            Cancel Trip
                          </Button>
                        )}
                        {isDispatchOrAdmin && !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(trip.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); setAssignTrip(trip); }}
                            data-testid={`button-assign-driver-${trip.id}`}
                          >
                            <UserCheck className="w-3 h-3 mr-1" />
                            Assign Driver
                          </Button>
                        )}
                        {trip.status !== "COMPLETED" && (
                        <Select
                          value={trip.status}
                          onValueChange={(status) => updateStatusMutation.mutate({ id: trip.id, status })}
                        >
                          <SelectTrigger
                            className="w-44"
                            data-testid={`select-trip-status-${trip.id}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"].map((s) => (
                              <SelectItem key={s} value={s}>{STATUS_DISPLAY_LABELS[s] || s.replace(/_/g, " ")}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        )}
                        {user?.role === "SUPER_ADMIN" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm("Archive this trip? This will move it to the archive.")) {
                                archiveMutation.mutate(trip.id);
                              }
                            }}
                            disabled={archiveMutation.isPending}
                            data-testid={`button-archive-trip-${trip.id}`}
                          >
                            <Archive className="w-4 h-4" />
                          </Button>
                        )}
                      </>
                    )}
                    {isClinicUser && (
                      <>
                        {trip.approvalStatus === "pending" && (
                          <>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={(e) => { e.stopPropagation(); setCancelRequestTrip(trip); }}
                              data-testid={`button-cancel-pending-trip-${trip.id}`}
                            >
                              <Ban className="w-3 h-3 mr-1" />
                              Cancel
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm("Delete this pending trip? This action cannot be undone.")) {
                                  clinicDeleteMutation.mutate(trip.id);
                                }
                              }}
                              disabled={clinicDeleteMutation.isPending}
                              data-testid={`button-clinic-delete-trip-${trip.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        {trip.approvalStatus === "approved" && !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(trip.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); setCancelRequestTrip(trip); }}
                            data-testid={`button-request-cancel-trip-${trip.id}`}
                          >
                            <Ban className="w-3 h-3 mr-1" />
                            Request Cancel
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {detailTrip && (
        <TripDetailDialog
          trip={detailTrip}
          patient={getPatientForTrip(detailTrip)}
          driver={getDriverForTrip(detailTrip)}
          canSendSms={canSendSms}
          hasSmsPerm={hasSmsPerm}
          smsHealth={smsHealth}
          token={token}
          cityTimezone={selectedCity?.timezone || "America/New_York"}
          isClinicUser={isClinicUser}
          isDispatchOrAdmin={isDispatchOrAdmin}
          userRole={user?.role}
          onClose={() => setDetailTrip(null)}
        />
      )}

      <Dialog open={!!cancelRequestTrip} onOpenChange={(o) => { if (!o) { setCancelRequestTrip(null); setCancelReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {cancelRequestTrip?.approvalStatus === "pending" ? "Cancel Trip" : "Request Cancellation"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {cancelRequestTrip?.approvalStatus === "pending"
              ? "This trip has not been approved yet. You can cancel it directly."
              : "This trip has been approved. Your cancellation request will be sent to dispatch for review."}
          </p>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Provide a reason for cancellation..."
              data-testid="textarea-cancel-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCancelRequestTrip(null); setCancelReason(""); }}>
              Go Back
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelReason.trim() || cancelRequestMutation.isPending}
              data-testid="button-submit-cancel-request"
              onClick={() => {
                if (cancelRequestTrip) {
                  cancelRequestMutation.mutate({ id: cancelRequestTrip.id, reason: cancelReason });
                }
              }}
            >
              {cancelRequestMutation.isPending ? "Submitting..." : cancelRequestTrip?.approvalStatus === "pending" ? "Cancel Trip" : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dispatchCancelTrip} onOpenChange={(o) => { if (!o) { setDispatchCancelTrip(null); setDispatchCancelReason(""); setDispatchCancelType("soft"); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Trip</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {dispatchCancelTrip?.approvalStatus === "cancel_requested"
              ? "A clinic has requested cancellation of this trip. Confirm and select a cancel type."
              : "Cancel this trip. Choose the cancellation type."}
          </p>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Cancel Type</Label>
              <Select value={dispatchCancelType} onValueChange={(v: "soft" | "hard") => setDispatchCancelType(v)}>
                <SelectTrigger data-testid="select-cancel-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="soft">Soft Cancel (recoverable)</SelectItem>
                  <SelectItem value="hard">Hard Cancel (permanent)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea
                value={dispatchCancelReason}
                onChange={(e) => setDispatchCancelReason(e.target.value)}
                placeholder="Provide a reason for cancellation..."
                data-testid="textarea-dispatch-cancel-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDispatchCancelTrip(null); setDispatchCancelReason(""); setDispatchCancelType("soft"); }}>
              Go Back
            </Button>
            <Button
              variant="destructive"
              disabled={!dispatchCancelReason.trim() || dispatchCancelMutation.isPending}
              data-testid="button-submit-dispatch-cancel"
              onClick={() => {
                if (dispatchCancelTrip) {
                  dispatchCancelMutation.mutate({ id: dispatchCancelTrip.id, reason: dispatchCancelReason, type: dispatchCancelType });
                }
              }}
            >
              {dispatchCancelMutation.isPending ? "Cancelling..." : "Cancel Trip"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!assignTrip} onOpenChange={(open) => { if (!open) setAssignTrip(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Driver to {assignTrip?.publicId}</DialogTitle>
          </DialogHeader>
          <AssignDriverPanel
            trip={assignTrip}
            token={token}
            cityId={selectedCity?.id}
            onAssign={(driverId, vehicleId) => {
              if (assignTrip) assignDriverMutation.mutate({ tripId: assignTrip.id, driverId, vehicleId });
            }}
            loading={assignDriverMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AssignDriverPanel({
  trip,
  token,
  cityId,
  onAssign,
  loading,
}: {
  trip: any;
  token: string | null;
  cityId?: number;
  onAssign: (driverId: number, vehicleId?: number) => void;
  loading: boolean;
}) {
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");

  const activeDriversQuery = useQuery<any[]>({
    queryKey: ["/api/dispatch/drivers/active", cityId],
    queryFn: () => apiFetch(`/api/dispatch/drivers/active${cityId ? `?cityId=${cityId}` : ""}`, token),
    enabled: !!token && !!trip,
  });

  const activeDrivers = activeDriversQuery.data || [];

  return (
    <div className="space-y-4">
      <div>
        <Label>Select Active Driver</Label>
        {activeDriversQuery.isLoading ? (
          <Skeleton className="h-10 w-full mt-1" />
        ) : activeDrivers.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-1">No active drivers available in this city.</p>
        ) : (
          <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
            <SelectTrigger className="w-full mt-1" data-testid="select-assign-driver">
              <SelectValue placeholder="Choose a driver" />
            </SelectTrigger>
            <SelectContent>
              {activeDrivers.map((d: any) => (
                <SelectItem key={d.id} value={d.id.toString()}>
                  {d.firstName} {d.lastName} ({d.publicId})
                  {d.vehicleId ? " - Vehicle assigned" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <DialogFooter>
        <Button
          onClick={() => {
            if (!selectedDriverId) return;
            const driver = activeDrivers.find((d: any) => d.id === parseInt(selectedDriverId));
            onAssign(parseInt(selectedDriverId), driver?.vehicleId || undefined);
          }}
          disabled={loading || !selectedDriverId}
          data-testid="button-confirm-assign"
        >
          {loading ? "Assigning..." : "Assign Driver"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function TripEventsSection({ tripId, token }: { tripId: number; token: string | null }) {
  const { toast } = useToast();
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [eventType, setEventType] = useState<string>("");
  const [minutesLate, setMinutesLate] = useState("");
  const [eventNotes, setEventNotes] = useState("");

  const { data: events, isLoading } = useQuery<any[]>({
    queryKey: ["/api/trips", tripId, "events"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/events`, token),
    enabled: !!token,
  });

  const createEventMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch(`/api/trips/${tripId}/events`, token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId, "events"] });
      toast({ title: "Trip event recorded" });
      setShowAddEvent(false);
      setEventType("");
      setMinutesLate("");
      setEventNotes("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleQuickEvent = (type: string) => {
    if (type === "late_driver" || type === "late_patient") {
      setEventType(type);
      setShowAddEvent(true);
    } else {
      createEventMutation.mutate({ eventType: type, notes: null, minutesLate: null });
    }
  };

  const handleSubmitEvent = () => {
    if (!eventType) return;
    const isLateType = eventType === "late_driver" || eventType === "late_patient";
    const mins = isLateType && minutesLate ? parseInt(minutesLate) : null;
    createEventMutation.mutate({
      eventType,
      minutesLate: mins,
      notes: eventNotes || null,
    });
  };

  const eventLabel = (type: string) => {
    switch (type) {
      case "late_driver": return "Driver Late";
      case "late_patient": return "Patient Late";
      case "no_show_driver": return "Driver No-Show";
      case "no_show_patient": return "Patient No-Show";
      case "complaint": return "Complaint";
      case "incident": return "Incident";
      default: return type;
    }
  };

  const eventVariant = (type: string): "destructive" | "secondary" | "outline" => {
    if (type.includes("no_show")) return "destructive";
    if (type.includes("late")) return "secondary";
    return "outline";
  };

  return (
    <div className="border-t pt-4 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Flag className="w-4 h-4" />
        Trip Events
      </h3>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => handleQuickEvent("late_driver")} disabled={createEventMutation.isPending} data-testid="button-mark-driver-late">
          <ClockAlert className="w-4 h-4 mr-1" />
          Driver Late
        </Button>
        <Button size="sm" variant="outline" onClick={() => handleQuickEvent("late_patient")} disabled={createEventMutation.isPending} data-testid="button-mark-patient-late">
          <ClockAlert className="w-4 h-4 mr-1" />
          Patient Late
        </Button>
        <Button size="sm" variant="destructive" onClick={() => handleQuickEvent("no_show_driver")} disabled={createEventMutation.isPending} data-testid="button-mark-driver-noshow">
          <UserX className="w-4 h-4 mr-1" />
          Driver No-Show
        </Button>
        <Button size="sm" variant="destructive" onClick={() => handleQuickEvent("no_show_patient")} disabled={createEventMutation.isPending} data-testid="button-mark-patient-noshow">
          <UserX className="w-4 h-4 mr-1" />
          Patient No-Show
        </Button>
      </div>

      {showAddEvent && (
        <div className="space-y-3 p-3 border rounded-md">
          <p className="text-sm font-medium">{eventLabel(eventType)}</p>
          {(eventType === "late_driver" || eventType === "late_patient") && (
            <div className="space-y-1">
              <Label>Minutes Late</Label>
              <Input
                type="number"
                min="1"
                max="999"
                value={minutesLate}
                onChange={(e) => setMinutesLate(e.target.value)}
                placeholder="e.g. 15"
                data-testid="input-minutes-late"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label>Notes (optional)</Label>
            <Textarea value={eventNotes} onChange={(e) => setEventNotes(e.target.value)} data-testid="input-event-notes" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSubmitEvent} disabled={createEventMutation.isPending} data-testid="button-submit-event">
              {createEventMutation.isPending ? "Saving..." : "Record Event"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowAddEvent(false); setEventType(""); }} data-testid="button-cancel-event">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isLoading && <Skeleton className="h-8 w-full" />}
      {events && events.length > 0 && (
        <div className="space-y-1">
          {events.map((evt: any) => (
            <div key={evt.id} className="flex items-center gap-2 flex-wrap" data-testid={`event-row-${evt.id}`}>
              <Badge variant={eventVariant(evt.eventType)} data-testid={`badge-event-${evt.id}`}>
                {eventLabel(evt.eventType)}
              </Badge>
              {evt.minutesLate && (
                <span className="text-xs text-muted-foreground">{evt.minutesLate} min late</span>
              )}
              {evt.notes && (
                <span className="text-xs text-muted-foreground italic">{evt.notes}</span>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {new Date(evt.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
      {events && events.length === 0 && (
        <p className="text-xs text-muted-foreground">No events recorded</p>
      )}
    </div>
  );
}

function TripDetailDialog({
  trip,
  patient,
  driver,
  canSendSms,
  hasSmsPerm,
  smsHealth,
  token,
  cityTimezone,
  isClinicUser,
  isDispatchOrAdmin,
  userRole,
  onClose,
}: {
  trip: any;
  patient: any;
  driver: any;
  canSendSms: boolean;
  hasSmsPerm: boolean;
  smsHealth: { twilioConfigured: boolean; dispatchPhoneConfigured: boolean } | undefined;
  token: string | null;
  cityTimezone: string;
  isClinicUser: boolean;
  isDispatchOrAdmin: boolean;
  userRole?: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [smsOpen, setSmsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [trackingUrl, setTrackingUrl] = useState<string | null>(null);

  const [editTripType, setEditTripType] = useState<TripType>(trip.tripType || "one_time");
  const [editRecurringDays, setEditRecurringDays] = useState<string[]>(trip.recurringDays || []);
  const [editScheduledDate, setEditScheduledDate] = useState(trip.scheduledDate || "");
  const [editPickupTime, setEditPickupTime] = useState(trip.pickupTime || "");
  const [editEstArrival, setEditEstArrival] = useState(trip.estimatedArrivalTime || "");
  const [editNotes, setEditNotes] = useState(trip.notes || "");

  const isTripLocked = trip.status === "COMPLETED";

  const todayStr = getTodayInTimezone(cityTimezone);

  const isActiveTrip = trip.status === "ASSIGNED" || trip.status === "IN_PROGRESS";
  const hasDriver = !!trip.driverId;

  const { data: etaData } = useQuery<{ ok: boolean; eta_minutes?: number; distance_text?: string; updated_at?: string; source?: string; message?: string }>({
    queryKey: ["/api/trips", trip.id, "eta-to-pickup"],
    queryFn: () => apiFetch(`/api/trips/${trip.id}/eta-to-pickup`, token),
    enabled: !!token && hasDriver && isActiveTrip,
    refetchInterval: 120000,
  });

  const createTokenMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/trips/${trip.id}/share-token`, token, { method: "POST" }),
    onSuccess: (data: any) => {
      setTrackingUrl(data.url);
      toast({ title: "Tracking link created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const revokeTokenMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/trips/${trip.id}/share-token/revoke`, token, { method: "POST" }),
    onSuccess: () => {
      setTrackingUrl(null);
      toast({ title: "Tracking link revoked" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch(`/api/trips/${trip.id}`, token, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      toast({ title: "Trip updated" });
      setEditing(false);
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSaveEdit = () => {
    if (editPickupTime && editEstArrival && editPickupTime >= editEstArrival) {
      toast({ title: "Pickup time must be before estimated arrival time", variant: "destructive" });
      return;
    }
    if (editTripType === "recurring" && editRecurringDays.length === 0) {
      toast({ title: "Please select at least one recurring day", variant: "destructive" });
      return;
    }
    const clinicNotesOnly = isClinicUser && trip.approvalStatus !== "pending";
    if (clinicNotesOnly) {
      updateMutation.mutate({ notes: editNotes || null });
    } else {
      updateMutation.mutate({
        tripType: editTripType,
        recurringDays: editTripType === "recurring" ? editRecurringDays : null,
        scheduledDate: editScheduledDate,
        scheduledTime: editPickupTime,
        pickupTime: editPickupTime,
        estimatedArrivalTime: editEstArrival,
        notes: editNotes || null,
      });
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span className="font-mono">{trip.publicId}</span>
            <Badge variant={trip.status === "CANCELLED" || trip.status === "NO_SHOW" ? "destructive" : "secondary"}>
              {trip.status.replace("_", " ")}
            </Badge>
            {trip.approvalStatus && trip.approvalStatus !== "approved" && (
              <Badge variant={trip.approvalStatus === "pending" ? "secondary" : "destructive"} data-testid="badge-detail-approval">
                {trip.approvalStatus === "pending" ? "Pending Approval" : trip.approvalStatus === "cancel_requested" ? "Cancel Requested" : trip.approvalStatus}
              </Badge>
            )}
            {trip.tripType === "recurring" && (
              <Badge variant="outline">Recurring</Badge>
            )}
            {trip.tripSeriesId && (
              <Badge variant="outline" data-testid="badge-detail-series">
                Series #{trip.tripSeriesId}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {isTripLocked && (
          <div className="flex items-center gap-2 rounded-md bg-muted/50 border px-3 py-2" data-testid="banner-trip-locked">
            <Lock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm text-muted-foreground">Completed trip — editing is locked.</span>
          </div>
        )}

        {editing ? (
          <div className="space-y-4">
            {(!isClinicUser || trip.approvalStatus === "pending") && (
              <>
                <RecurringSchedule
                  tripType={editTripType}
                  onTripTypeChange={setEditTripType}
                  recurringDays={editRecurringDays}
                  onRecurringDaysChange={setEditRecurringDays}
                  testIdPrefix="edit-trip"
                />

                <div className="space-y-2">
                  <Label>Start Date *</Label>
                  <Input
                    type="date"
                    value={editScheduledDate}
                    min={todayStr}
                    onChange={(e) => setEditScheduledDate(e.target.value)}
                    required
                    data-testid="input-edit-trip-date"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Pickup Time *</Label>
                    <Input
                      type="time"
                      value={editPickupTime}
                      onChange={(e) => setEditPickupTime(e.target.value)}
                      required
                      data-testid="input-edit-trip-pickup-time"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Est. Arrival Time *</Label>
                    <Input
                      type="time"
                      value={editEstArrival}
                      onChange={(e) => setEditEstArrival(e.target.value)}
                      required
                      data-testid="input-edit-trip-est-arrival"
                    />
                  </div>
                </div>
              </>
            )}
            {isClinicUser && trip.approvalStatus !== "pending" && (
              <p className="text-sm text-muted-foreground">This trip has been approved. You can only update notes.</p>
            )}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} data-testid="input-edit-trip-notes" />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSaveEdit} disabled={updateMutation.isPending} data-testid="button-save-edit-trip">
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)} data-testid="button-cancel-edit-trip">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-end gap-2">
              {trip.approvalStatus && trip.approvalStatus !== "approved" && trip.approvalStatus !== "cancelled" && (
                <Badge variant={trip.approvalStatus === "pending" ? "secondary" : "destructive"}>
                  <ShieldCheck className="w-3 h-3 mr-1" />
                  {trip.approvalStatus === "pending" ? "Pending Approval" : "Cancel Requested"}
                </Badge>
              )}
              {trip.cancelledReason && (
                <span className="text-xs text-muted-foreground italic">Reason: {trip.cancelledReason}</span>
              )}
              {(!isClinicUser || trip.approvalStatus === "pending" || trip.approvalStatus === "approved") && trip.approvalStatus !== "cancelled" && !isTripLocked && (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="button-edit-trip">
                  <Pencil className="w-4 h-4 mr-1" />
                  {isClinicUser && trip.approvalStatus !== "pending" ? "Add Notes" : "Edit"}
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Schedule</h3>
              <p className="text-sm" data-testid="text-trip-schedule">{trip.scheduledDate}</p>
              <p className="text-sm" data-testid="text-trip-pickup-time">Pickup: {trip.pickupTime}</p>
              <p className="text-sm" data-testid="text-trip-est-arrival">Est. Arrival: {trip.estimatedArrivalTime}</p>
              {trip.recurringDays?.length > 0 && (
                <p className="text-sm" data-testid="text-trip-recurring-days">Recurring: {trip.recurringDays.join(", ")}</p>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Pickup</h3>
              <p className="text-sm" data-testid="text-trip-pickup">{trip.pickupAddress}</p>
              {trip.pickupZip && (
                <p className="text-xs text-muted-foreground" data-testid="text-trip-pickup-zip">ZIP: {trip.pickupZip}</p>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Dropoff</h3>
              <p className="text-sm" data-testid="text-trip-dropoff">{trip.dropoffAddress}</p>
              {trip.dropoffZip && (
                <p className="text-xs text-muted-foreground" data-testid="text-trip-dropoff-zip">ZIP: {trip.dropoffZip}</p>
              )}
            </div>

            <TripStaticMap
              tripId={trip.id}
              pickupLat={trip.pickupLat}
              dropoffLat={trip.dropoffLat}
              size="full"
              token={token}
              className="w-full h-40"
            />

            {driver && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Driver</h3>
                <p className="text-sm" data-testid="text-trip-driver">{driver.firstName} {driver.lastName}</p>
              </div>
            )}

            {isActiveTrip && hasDriver && etaData?.ok && etaData.eta_minutes != null && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Navigation className="w-4 h-4" />
                  ETA to Pickup
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={etaData.eta_minutes <= 5 ? "destructive" : "secondary"} data-testid="badge-eta-minutes">
                    <Clock className="w-3 h-3 mr-1" />
                    {etaData.eta_minutes} min
                  </Badge>
                  {etaData.distance_text && (
                    <span className="text-sm text-muted-foreground" data-testid="text-eta-distance">{etaData.distance_text}</span>
                  )}
                  {etaData.source === "cached" && (
                    <span className="text-xs text-muted-foreground">(cached)</span>
                  )}
                </div>
                {etaData.eta_minutes <= 5 && trip.status === "IN_PROGRESS" && (
                  <Badge variant="destructive" className="mt-1" data-testid="badge-five-min-alert">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Driver is 5 minutes away
                  </Badge>
                )}
              </div>
            )}

            {canSendSms && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <LinkIcon className="w-4 h-4" />
                  Tracking Link
                </h3>
                {trackingUrl ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={trackingUrl}
                        readOnly
                        className="text-xs font-mono flex-1"
                        data-testid="input-tracking-url"
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard.writeText(trackingUrl);
                          toast({ title: "Link copied" });
                        }}
                        data-testid="button-copy-tracking-link"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => revokeTokenMutation.mutate()}
                      disabled={revokeTokenMutation.isPending}
                      data-testid="button-revoke-tracking-link"
                    >
                      <XCircle className="w-4 h-4 mr-1" />
                      {revokeTokenMutation.isPending ? "Revoking..." : "Revoke Link"}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => createTokenMutation.mutate()}
                    disabled={createTokenMutation.isPending || isTripLocked}
                    data-testid="button-create-tracking-link"
                  >
                    <Link2 className="w-4 h-4 mr-1" />
                    {createTokenMutation.isPending ? "Creating..." : "Create Tracking Link"}
                  </Button>
                )}
              </div>
            )}

            {trip.notes && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Notes</h3>
                <p className="text-sm" data-testid="text-trip-notes">{trip.notes}</p>
              </div>
            )}

            <div className="border-t pt-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <User className="w-4 h-4" />
                Patient Communication
              </h3>

              {patient ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Name:</span>
                    <span className="text-sm" data-testid="text-patient-name">{patient.firstName} {patient.lastName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Phone:</span>
                    {patient.phone ? (
                      <span className="text-sm font-mono" data-testid="text-patient-phone">{formatPhoneDisplay(patient.phone)}</span>
                    ) : (
                      <span className="text-sm text-destructive flex items-center gap-1" data-testid="text-patient-phone-missing">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Patient phone not available
                      </span>
                    )}
                  </div>

                  {hasSmsPerm && !canSendSms && smsHealth && !smsHealth.twilioConfigured && (
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-amber-600 dark:text-amber-400" data-testid="text-sms-not-configured">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      SMS not configured (Twilio credentials missing)
                    </div>
                  )}

                  {canSendSms && patient.phone && normalizePhoneToE164(patient.phone) && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSmsOpen(true)}
                        data-testid="button-send-sms"
                      >
                        <MessageSquare className="w-4 h-4 mr-1" />
                        Custom SMS
                      </Button>
                      <SmsNotifyButton tripId={trip.id} status="scheduled" label="Send Scheduled" token={token} />
                      <SmsNotifyButton tripId={trip.id} status="en_route" label="Send En Route" token={token} />
                      <SmsNotifyButton tripId={trip.id} status="arrived" label="Send Arrived" token={token} />
                      <SmsNotifyButton tripId={trip.id} status="canceled" label="Send Cancelled" token={token} />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-no-patient">No patient linked to this trip</p>
              )}
            </div>

            {isDispatchOrAdmin && trip.driverId && (
              <TripMessagingPanel tripId={trip.id} tripStatus={trip.status} token={token} />
            )}

            {isDispatchOrAdmin && (
              <TripEventsSection tripId={trip.id} token={token} />
            )}
          </div>
        )}
      </DialogContent>

      {smsOpen && patient?.phone && (
        <SendSmsDialog
          phone={patient.phone}
          patientName={`${patient.firstName} ${patient.lastName}`}
          token={token}
          onClose={() => setSmsOpen(false)}
        />
      )}
    </Dialog>
  );
}

function TripMessagingPanel({ tripId, tripStatus, token }: { tripId: number; tripStatus: string; token: string | null }) {
  const { toast } = useToast();
  const [msgText, setMsgText] = useState("");
  const isLocked = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(tripStatus);

  const { data: messages, isLoading: msgsLoading } = useQuery<any[]>({
    queryKey: ["/api/trips", tripId, "messages"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/messages`, token),
    enabled: !!token,
    refetchInterval: 15000,
  });

  const sendMsgMutation = useMutation({
    mutationFn: (message: string) =>
      apiFetch(`/api/trips/${tripId}/messages`, token, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId, "messages"] });
      setMsgText("");
    },
    onError: (err: any) => toast({ title: "Message failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="border-t pt-4 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <MessageSquare className="w-4 h-4" />
        Driver Messages
        {isLocked && <Lock className="w-3 h-3 text-muted-foreground" />}
      </h3>
      <div className="max-h-40 overflow-y-auto space-y-2 border rounded-md p-2">
        {msgsLoading ? (
          <p className="text-xs text-muted-foreground">Loading messages...</p>
        ) : !messages?.length ? (
          <p className="text-xs text-muted-foreground">No messages yet</p>
        ) : (
          messages.map((m: any) => (
            <div key={m.id} className="text-xs space-y-0.5" data-testid={`msg-${m.id}`}>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-[10px]">{m.senderRole}</Badge>
                <span className="text-muted-foreground">{new Date(m.createdAt).toLocaleTimeString()}</span>
              </div>
              <p>{m.message}</p>
            </div>
          ))
        )}
      </div>
      {!isLocked && (
        <div className="flex gap-2">
          <Input
            value={msgText}
            onChange={(e) => setMsgText(e.target.value)}
            placeholder="Type a message..."
            className="flex-1"
            onKeyDown={(e) => { if (e.key === "Enter" && msgText.trim()) sendMsgMutation.mutate(msgText.trim()); }}
            data-testid="input-trip-message"
          />
          <Button
            size="icon"
            onClick={() => { if (msgText.trim()) sendMsgMutation.mutate(msgText.trim()); }}
            disabled={!msgText.trim() || sendMsgMutation.isPending}
            data-testid="button-send-trip-message"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function SmsNotifyButton({
  tripId,
  status,
  label,
  token,
}: {
  tripId: number;
  status: string;
  label: string;
  token: string | null;
}) {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/trips/${tripId}/notify`, token, {
        method: "POST",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (data: any) => {
      toast({ title: `${label} SMS sent`, description: data.patient ? `Sent to ${data.patient}` : undefined });
    },
    onError: (err: any) => {
      toast({ title: `${label} failed`, description: err.message, variant: "destructive" });
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      data-testid={`button-notify-${status}`}
    >
      {mutation.isPending ? "Sending..." : label}
    </Button>
  );
}

function SendSmsDialog({
  phone,
  patientName,
  token,
  onClose,
}: {
  phone: string;
  patientName: string;
  token: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");

  const sendMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/sms/send", token, {
        method: "POST",
        body: JSON.stringify({ to: phone, message }),
      }),
    onSuccess: () => {
      toast({ title: "SMS sent successfully" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "SMS failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Send Custom SMS
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-muted-foreground">To</Label>
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm" data-testid="text-sms-recipient">{patientName}</span>
              <span className="text-sm font-mono text-muted-foreground" data-testid="text-sms-phone">{formatPhoneDisplay(phone)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your custom message..."
              rows={4}
              data-testid="textarea-sms-message"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} data-testid="button-sms-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={!message.trim() || sendMutation.isPending}
              data-testid="button-sms-send"
            >
              {sendMutation.isPending ? "Sending..." : "Send SMS"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TripForm({
  patients,
  drivers,
  vehicles,
  clinics,
  token,
  cityTimezone,
  onSubmit,
  loading,
}: {
  patients: any[];
  drivers: any[];
  vehicles: any[];
  clinics: any[];
  token: string | null;
  cityTimezone: string;
  onSubmit: (data: any) => void;
  loading: boolean;
}) {
  const { toast } = useToast();
  const [patientId, setPatientId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [estimatedArrivalTime, setEstimatedArrivalTime] = useState("");
  const [notes, setNotes] = useState("");
  const [tripType, setTripType] = useState<TripType>("one_time");
  const [recurringDays, setRecurringDays] = useState<string[]>([]);
  const [seriesPattern, setSeriesPattern] = useState<SeriesPattern>("custom");
  const [seriesEndType, setSeriesEndType] = useState<SeriesEndType>("end_date");
  const [endDate, setEndDate] = useState("");
  const [occurrencesStr, setOccurrencesStr] = useState("");

  const [pickupAddr, setPickupAddr] = useState<StructuredAddress | null>(null);
  const [dropoffAddr, setDropoffAddr] = useState<StructuredAddress | null>(null);

  const todayStr = getTodayInTimezone(cityTimezone);
  const dateIsPast = scheduledDate && scheduledDate < todayStr;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!pickupAddr || !pickupAddr.zip) {
      toast({ title: "Pickup address requires a ZIP code", variant: "destructive" });
      return;
    }
    if (pickupAddr && (!pickupAddr.lat || !pickupAddr.lng)) {
      toast({ title: "Pickup address missing coordinates. Please re-select.", variant: "destructive" });
      return;
    }
    if (!dropoffAddr || !dropoffAddr.zip) {
      toast({ title: "Dropoff address requires a ZIP code", variant: "destructive" });
      return;
    }
    if (dropoffAddr && (!dropoffAddr.lat || !dropoffAddr.lng)) {
      toast({ title: "Dropoff address missing coordinates. Please re-select.", variant: "destructive" });
      return;
    }
    if (dateIsPast) {
      toast({ title: "Trip date cannot be in the past", variant: "destructive" });
      return;
    }
    if (pickupTime >= estimatedArrivalTime) {
      toast({ title: "Pickup time must be before estimated arrival time", variant: "destructive" });
      return;
    }
    if (tripType === "recurring" && recurringDays.length === 0) {
      toast({ title: "Please select at least one recurring day", variant: "destructive" });
      return;
    }
    if (tripType === "recurring") {
      if (seriesEndType === "end_date" && !endDate) {
        toast({ title: "End date is required for recurring trips", variant: "destructive" });
        return;
      }
      if (seriesEndType === "occurrences" && (!occurrencesStr || parseInt(occurrencesStr) < 1)) {
        toast({ title: "Number of trips must be at least 1", variant: "destructive" });
        return;
      }
      if (seriesEndType === "end_date" && endDate <= scheduledDate) {
        toast({ title: "End date must be after start date", variant: "destructive" });
        return;
      }
    }

    const addressFields = {
      pickupAddress: pickupAddr.formattedAddress,
      pickupStreet: pickupAddr.street,
      pickupCity: pickupAddr.city,
      pickupState: pickupAddr.state,
      pickupZip: pickupAddr.zip,
      pickupPlaceId: pickupAddr.placeId || null,
      pickupLat: pickupAddr.lat,
      pickupLng: pickupAddr.lng,
      dropoffAddress: dropoffAddr.formattedAddress,
      dropoffStreet: dropoffAddr.street,
      dropoffCity: dropoffAddr.city,
      dropoffState: dropoffAddr.state,
      dropoffZip: dropoffAddr.zip,
      dropoffPlaceId: dropoffAddr.placeId || null,
      dropoffLat: dropoffAddr.lat,
      dropoffLng: dropoffAddr.lng,
    };

    if (tripType === "recurring") {
      onSubmit({
        _isSeries: true,
        patientId: parseInt(patientId),
        clinicId: clinicId ? parseInt(clinicId) : null,
        driverId: driverId ? parseInt(driverId) : null,
        vehicleId: vehicleId ? parseInt(vehicleId) : null,
        pattern: seriesPattern,
        daysMask: recurringDays.join(","),
        startDate: scheduledDate,
        endDate: seriesEndType === "end_date" ? endDate : null,
        occurrences: seriesEndType === "occurrences" ? parseInt(occurrencesStr) : null,
        pickupTime,
        estimatedArrivalTime,
        notes: notes || null,
        ...addressFields,
      });
    } else {
      onSubmit({
        patientId: parseInt(patientId),
        driverId: driverId ? parseInt(driverId) : null,
        vehicleId: vehicleId ? parseInt(vehicleId) : null,
        clinicId: clinicId ? parseInt(clinicId) : null,
        scheduledDate,
        scheduledTime: pickupTime,
        pickupTime,
        estimatedArrivalTime,
        tripType,
        recurringDays: null,
        notes: notes || null,
        ...addressFields,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Patient *</Label>
        <Select value={patientId} onValueChange={setPatientId}>
          <SelectTrigger data-testid="select-trip-patient"><SelectValue placeholder="Select patient" /></SelectTrigger>
          <SelectContent>
            {patients.map((p) => (
              <SelectItem key={p.id} value={p.id.toString()}>{p.firstName} {p.lastName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <RecurringSchedule
        tripType={tripType}
        onTripTypeChange={setTripType}
        recurringDays={recurringDays}
        onRecurringDaysChange={setRecurringDays}
        seriesPattern={seriesPattern}
        onSeriesPatternChange={setSeriesPattern}
        seriesEndType={seriesEndType}
        onSeriesEndTypeChange={setSeriesEndType}
        endDate={endDate}
        onEndDateChange={setEndDate}
        occurrences={occurrencesStr}
        onOccurrencesChange={setOccurrencesStr}
        minDate={scheduledDate || todayStr}
        testIdPrefix="trip"
      />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Start Date *</Label>
          <Input
            type="date"
            value={scheduledDate}
            min={todayStr}
            onChange={(e) => setScheduledDate(e.target.value)}
            required
            data-testid="input-trip-date"
          />
          {dateIsPast && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Date cannot be in the past
            </p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Pickup Time *</Label>
          <Input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} required data-testid="input-trip-pickup-time" />
        </div>
        <div className="space-y-2">
          <Label>Est. Arrival Time *</Label>
          <Input type="time" value={estimatedArrivalTime} onChange={(e) => setEstimatedArrivalTime(e.target.value)} required data-testid="input-trip-est-arrival" />
        </div>
      </div>

      <AddressAutocomplete
        label="Pickup Address"
        value={pickupAddr}
        onSelect={setPickupAddr}
        token={token}
        testIdPrefix="pickup"
        required
      />

      <AddressAutocomplete
        label="Dropoff Address"
        value={dropoffAddr}
        onSelect={setDropoffAddr}
        token={token}
        testIdPrefix="dropoff"
        required
      />

      <div className="space-y-2">
        <Label>Clinic</Label>
        <Select value={clinicId} onValueChange={setClinicId}>
          <SelectTrigger data-testid="select-trip-clinic"><SelectValue placeholder="Select clinic (optional)" /></SelectTrigger>
          <SelectContent>
            {clinics.map((c) => (
              <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Driver</Label>
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger data-testid="select-trip-driver"><SelectValue placeholder="Assign later" /></SelectTrigger>
            <SelectContent>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id.toString()}>{d.firstName} {d.lastName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Vehicle</Label>
          <Select value={vehicleId} onValueChange={setVehicleId}>
            <SelectTrigger data-testid="select-trip-vehicle"><SelectValue placeholder="Assign later" /></SelectTrigger>
            <SelectContent>
              {vehicles.map((v) => (
                <SelectItem key={v.id} value={v.id.toString()}>{v.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-trip-notes" />
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={loading || !patientId || !pickupAddr || !dropoffAddr || !scheduledDate || !pickupTime || !estimatedArrivalTime || !!dateIsPast}
        data-testid="button-submit-trip"
      >
        {loading ? "Creating..." : tripType === "recurring" ? "Create Trip Series" : "Schedule Trip"}
      </Button>
    </form>
  );
}
