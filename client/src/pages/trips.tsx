import { useState, useCallback } from "react";
import { useLocation } from "wouter";
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
import { playSound } from "@/hooks/use-sound-notifications";
import { downloadWithAuth } from "@/lib/export";
import { DialogFooter } from "@/components/ui/dialog";
import { Plus, Route, Search, MessageSquare, Eye, AlertTriangle, Phone, User, Pencil, Clock, Navigation, Link2, LinkIcon, Copy, XCircle, CheckCircle, Ban, Archive, ShieldCheck, Trash2, Flag, UserX, ClockAlert, UserCheck, Lock, Send, DollarSign, FileText, CreditCard, Building2, Globe, Users, Mail, RefreshCw, Download, RotateCcw, ChevronDown } from "lucide-react";
import { apiFetch, rawAuthFetch } from "@/lib/api";
import { GlobalSearchInput } from "@/components/GlobalSearchInput";
import { FilterBar, type ActiveFilter, type FilterOption, usePersistedFilters } from "@/components/filter-bar";
import { AddressAutocomplete, type StructuredAddress } from "@/components/address-autocomplete";
import { useTranslation } from "react-i18next";
import { RecurringSchedule, type TripType, type SeriesPattern, type SeriesEndType } from "@/components/recurring-schedule";
import { TripStaticMap } from "@/components/trip-static-map";
import { TripRouteMap } from "@/components/trip-route-map";
import { TripProgressTimeline, TripDateTimeHeader, TripMetricsCard } from "@/components/trip-progress-timeline";
import { PatientRef, DriverRef, VehicleRef, ClinicRef } from "@/components/entity-ref";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { EmptyState } from "@/components/empty-state";
import { formatPickupTimeDisplay, formatTripDateTime, getTripTz, tzAbbreviation, formatDate, formatDateTime } from "@/lib/timezone";

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
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [detailTrip, setDetailTrip] = useState<any>(null);
  const [tripTab, setTripTab] = useState<TripTab>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "clinic" | "internal" | "private">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [assignTrip, setAssignTrip] = useState<any>(null);
  const [tripFilters, setTripFilters] = usePersistedFilters("trips");

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
  const isDispatchOrAdmin = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "DISPATCH" || user?.role === "COMPANY_ADMIN";

  const tripQueryParams = new URLSearchParams();
  if (selectedCity?.id) tripQueryParams.set("cityId", String(selectedCity.id));
  if (tripTab !== "all") tripQueryParams.set("tab", tripTab);
  if (sourceFilter !== "all") tripQueryParams.set("source", sourceFilter);
  if (showArchived) tripQueryParams.set("includeArchived", "true");
  tripQueryParams.set("limit", "200");
  const tripQueryString = tripQueryParams.toString() ? `?${tripQueryParams.toString()}` : "";

  const { data: trips, isLoading } = useQuery<any[]>({
    queryKey: ["/api/trips", selectedCity?.id, tripTab, sourceFilter, showArchived],
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
      playSound("new_trip");
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
    onSuccess: (_d: any, variables: { id: number; status: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      if (variables.status === "COMPLETED") playSound("trip_completed");
      else if (variables.status === "CANCELLED") playSound("trip_cancelled");
      else if (variables.status === "NO_SHOW") playSound("trip_no_show");
      else playSound("status_change");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/trips/${id}/approve`, token, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      playSound("notification");
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
      playSound("trip_cancelled");
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

  const restoreTripMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/admin/trips/${id}/restore`, token, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      toast({ title: "Trip restored" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const permanentDeleteTripMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/admin/trips/${id}/permanent`, token, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Trip permanently deleted" });
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
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/drivers/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trips"] });
      setAssignTrip(null);
      playSound("trip_assigned");
      toast({ title: "Driver assigned to trip" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filtered = trips?.filter((t: any) => {
    if (search) {
      const s = search.toLowerCase();
      if (!(t.publicId?.toLowerCase().includes(s) || t.pickupAddress?.toLowerCase().includes(s) || t.dropoffAddress?.toLowerCase().includes(s))) return false;
    }
    for (const f of tripFilters) {
      if (f.key === "clinicId" && f.value && String(t.clinicId) !== f.value) return false;
      if (f.key === "assigned") {
        if (f.value === "assigned" && !t.driverId) return false;
        if (f.value === "unassigned" && t.driverId) return false;
      }
      if (f.key === "dateFrom" && f.value) {
        if (!t.scheduledDate) return false;
        const tripDate = t.scheduledDate.slice(0, 10);
        if (tripDate < f.value) return false;
      }
      if (f.key === "dateTo" && f.value) {
        if (!t.scheduledDate) return false;
        const tripDate = t.scheduledDate.slice(0, 10);
        if (tripDate > f.value) return false;
      }
    }
    return true;
  });

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
          <h1 className="text-2xl font-semibold tracking-tight">{t("trips.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("app.subtitle")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-trip">
              <Plus className="w-4 h-4 mr-2" />
              {t("trips.newTrip")}
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

      {!isClinicUser && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground mr-1">Source:</span>
          {([
            { key: "all" as const, label: "All", icon: Users },
            { key: "clinic" as const, label: "Clinic", icon: Building2 },
            { key: "internal" as const, label: "Internal", icon: UserCheck },
            { key: "private" as const, label: "Private", icon: Globe },
          ]).map((sf) => (
            <Button
              key={sf.key}
              variant={sourceFilter === sf.key ? "default" : "outline"}
              size="sm"
              onClick={() => setSourceFilter(sf.key)}
              data-testid={`button-source-${sf.key}`}
            >
              <sf.icon className="w-3.5 h-3.5 mr-1.5" />{sf.label}
            </Button>
          ))}
        </div>
      )}

      {isDispatchOrAdmin && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={showArchived ? "default" : "outline"}
            onClick={() => setShowArchived(!showArchived)}
            data-testid="button-toggle-archived"
            className={showArchived ? "bg-amber-600 hover:bg-amber-700" : ""}
          >
            <Archive className="w-3.5 h-3.5 mr-1.5" />
            {showArchived ? "Showing Archived" : "Show Archived"}
          </Button>
        </div>
      )}

      <FilterBar
        filters={[
          ...(isDispatchOrAdmin ? [{
            key: "clinicId",
            label: "Clinic",
            type: "select" as const,
            options: (clinics || []).map((c: any) => ({ value: String(c.id), label: c.name })),
          }] : []),
          {
            key: "assigned",
            label: "Assignment",
            type: "select" as const,
            options: [
              { value: "assigned", label: "Assigned" },
              { value: "unassigned", label: "Unassigned" },
            ],
          },
          {
            key: "dateFrom",
            label: "From Date",
            type: "date" as const,
          },
          {
            key: "dateTo",
            label: "To Date",
            type: "date" as const,
          },
        ]}
        activeFilters={tripFilters}
        onFilterChange={setTripFilters}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("trips.search")}
        totalCount={trips?.length}
        filteredCount={filtered?.length}
        storageKey="trips"
      />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !filtered?.length ? (
        <EmptyState
          icon={search || tripFilters.length > 0 ? "search" : "empty"}
          title={search || tripFilters.length > 0 ? "No trips match your filters" : t("trips.noTrips")}
          description={search || tripFilters.length > 0 ? "Try adjusting your search or filters to find what you're looking for." : "Schedule a new trip to get started."}
          actionLabel={!search && tripFilters.length === 0 ? "Schedule Trip" : undefined}
          onAction={!search && tripFilters.length === 0 ? () => setOpen(true) : undefined}
          testId="empty-state-trips"
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((trip: any) => (
            <Card key={trip.id} className="hover-elevate cursor-pointer" onClick={() => navigate(`/trips/${trip.id}`)} data-testid={`card-trip-${trip.id}`}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
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
                      {trip.requestSource === "clinic" && (
                        <Badge variant="outline" className="text-xs" data-testid={`badge-source-${trip.id}`}><Building2 className="w-3 h-3 mr-1" />Clinic</Badge>
                      )}
                      {trip.requestSource === "private" && (
                        <Badge variant="outline" className="text-xs" data-testid={`badge-source-${trip.id}`}><Globe className="w-3 h-3 mr-1" />Private</Badge>
                      )}
                      {trip.archivedAt && (
                        <Badge variant="outline" className="text-xs border-amber-500 text-amber-600" data-testid={`badge-archived-${trip.id}`}><Archive className="w-3 h-3 mr-1" />Archived</Badge>
                      )}
                      {trip.routeVersion != null && trip.routeVersion > 1 && (
                        <Badge variant="outline" className="text-xs border-orange-400 text-orange-600" data-testid={`badge-rerouted-${trip.id}`}>
                          <Route className="w-3 h-3 mr-1" />{trip.routeVersion - 1} reroute{trip.routeVersion > 2 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {trip.scheduledDate} | Pickup: {formatPickupTimeDisplay(trip.pickupTime)}{trip.estimatedArrivalTime && trip.estimatedArrivalTime !== "TBD" ? ` | ETA: ${formatPickupTimeDisplay(trip.estimatedArrivalTime)}` : ""}{trip.tripTimezone ? ` (${tzAbbreviation(trip.tripTimezone)})` : ""}
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
                      onClick={(e) => { e.stopPropagation(); navigate(`/trips/${trip.id}`); }}
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
                        {!["COMPLETED", "CANCELLED", "NO_SHOW"].includes(trip.status) && (
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
                        {user?.role === "SUPER_ADMIN" && !trip.deletedAt && (
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
                        {user?.role === "SUPER_ADMIN" && trip.deletedAt && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                restoreTripMutation.mutate(trip.id);
                              }}
                              disabled={restoreTripMutation.isPending}
                              data-testid={`button-restore-trip-${trip.id}`}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm("PERMANENTLY delete this trip? This cannot be undone.")) {
                                  permanentDeleteTripMutation.mutate(trip.id);
                                }
                              }}
                              disabled={permanentDeleteTripMutation.isPending}
                              data-testid={`button-permanent-delete-trip-${trip.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
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
  const [showAll, setShowAll] = useState(false);

  const driverStatusQuery = useQuery<any>({
    queryKey: ["/api/dispatch/drivers/status", cityId],
    queryFn: () => apiFetch(`/api/dispatch/drivers/status${cityId ? `?city_id=${cityId}` : ""}`, token),
    enabled: !!token && !!trip,
  });

  const driverStatus = driverStatusQuery.data || { available: [], on_trip: [], paused: [], hold: [], logged_out: [] };
  const availableDrivers = driverStatus.available || [];
  const allAssignable = showAll
    ? [...availableDrivers, ...(driverStatus.on_trip || []), ...(driverStatus.paused || []), ...(driverStatus.hold || [])]
    : availableDrivers;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>{showAll ? "All Online Drivers" : "Available Drivers Only"}</Label>
          <Button variant="outline" size="sm" onClick={() => setShowAll(!showAll)} data-testid="button-toggle-show-all-trips">
            {showAll ? "Show Available Only" : "Show All"}
          </Button>
        </div>
        {driverStatusQuery.isLoading ? (
          <Skeleton className="h-10 w-full mt-1" />
        ) : allAssignable.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-no-drivers-available">
            No {showAll ? "online" : "available"} drivers in this city.
          </p>
        ) : (
          <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
            <SelectTrigger className="w-full" data-testid="select-assign-driver">
              <SelectValue placeholder="Choose a driver" />
            </SelectTrigger>
            <SelectContent>
              {allAssignable.map((d: any) => (
                <SelectItem key={d.id} value={d.id.toString()}>
                  {d.name} ({d.publicId})
                  {d.vehicle_name ? ` - ${d.vehicle_name}` : " (No Vehicle)"}
                  {d.active_trip_public_id ? ` [${d.active_trip_public_id}]` : ""}
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
            const driver = allAssignable.find((d: any) => d.id === parseInt(selectedDriverId));
            onAssign(parseInt(selectedDriverId), driver?.vehicle_id || undefined);
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
  const [pendingEventType, setPendingEventType] = useState<string | null>(null);

  const { data: events, isLoading } = useQuery<any[]>({
    queryKey: ["/api/trips", tripId, "events"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/events`, token),
    enabled: !!token,
  });

  const hasNoShowDriver = events?.some((e: any) => e.eventType === "no_show_driver") ?? false;
  const hasNoShowPatient = events?.some((e: any) => e.eventType === "no_show_patient") ?? false;

  const createEventMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch(`/api/trips/${tripId}/events`, token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId, "events"] });
      if (result?.deduped) {
        toast({ title: "Event already recorded", description: "Duplicate event was prevented." });
      } else {
        toast({ title: "Trip event recorded" });
      }
      setShowAddEvent(false);
      setEventType("");
      setMinutesLate("");
      setEventNotes("");
      setPendingEventType(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setPendingEventType(null);
    },
  });

  const handleQuickEvent = (type: string) => {
    if (createEventMutation.isPending) return;
    setPendingEventType(type);
    if (type === "late_driver" || type === "late_patient") {
      setEventType(type);
      setShowAddEvent(true);
      setPendingEventType(null);
    } else {
      createEventMutation.mutate({ eventType: type, notes: null, minutesLate: null });
    }
  };

  const handleSubmitEvent = () => {
    if (!eventType || createEventMutation.isPending) return;
    setPendingEventType(eventType);
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
          {pendingEventType === "late_driver" ? "Recording..." : "Driver Late"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => handleQuickEvent("late_patient")} disabled={createEventMutation.isPending} data-testid="button-mark-patient-late">
          <ClockAlert className="w-4 h-4 mr-1" />
          {pendingEventType === "late_patient" ? "Recording..." : "Patient Late"}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => handleQuickEvent("no_show_driver")} disabled={createEventMutation.isPending || hasNoShowDriver} data-testid="button-mark-driver-noshow">
          <UserX className="w-4 h-4 mr-1" />
          {pendingEventType === "no_show_driver" ? "Recording..." : hasNoShowDriver ? "Driver No-Show (Recorded)" : "Driver No-Show"}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => handleQuickEvent("no_show_patient")} disabled={createEventMutation.isPending || hasNoShowPatient} data-testid="button-mark-patient-noshow">
          <UserX className="w-4 h-4 mr-1" />
          {pendingEventType === "no_show_patient" ? "Recording..." : hasNoShowPatient ? "Patient No-Show (Recorded)" : "Patient No-Show"}
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
                {formatDateTime(evt.createdAt)}
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

const INVOICE_ROLES = ["SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"];

function TripInvoicePanel({ tripId, tripStatus, token, userRole }: { tripId: number; tripStatus: string; token: string | null; userRole?: string }) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [emailSending, setEmailSending] = useState(false);

  const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW"];
  const isTerminal = TERMINAL_STATUSES.includes(tripStatus);
  const isBillable = tripStatus === "COMPLETED";
  const canEdit = userRole && ["SUPER_ADMIN", "DISPATCH", "ADMIN", "COMPANY_ADMIN"].includes(userRole);

  const invoiceQuery = useQuery<any>({
    queryKey: ["/api/trips", tripId, "invoice"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/invoice`, token),
    enabled: !!token && !!tripId && isBillable,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { amount: string; notes: string }) =>
      apiFetch(`/api/trips/${tripId}/invoice`, token, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId, "invoice"] });
      setShowCreate(false);
      setAmount("");
      setNotes("");
      toast({ title: "Invoice created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { amount?: string; status?: string; notes?: string }) => {
      const inv = invoiceQuery.data?.invoice;
      return apiFetch(`/api/invoices/${inv.id}`, token, { method: "PATCH", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId, "invoice"] });
      setEditMode(false);
      toast({ title: "Invoice updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleDownloadPdf = async () => {
    const inv = invoiceQuery.data?.invoice;
    if (!inv) return;
    setPdfLoading(true);
    await downloadWithAuth(`/api/invoices/${inv.id}/pdf`, `invoice-${inv.id}.pdf`, "application/pdf", (u, i) => rawAuthFetch(u, { ...i, method: "POST" }), (msg) => toast({ title: "Error", description: msg, variant: "destructive" }));
    setPdfLoading(false);
  };

  const handleSendEmail = async () => {
    const inv = invoiceQuery.data?.invoice;
    if (!inv) return;
    setEmailSending(true);
    try {
      await apiFetch(`/api/invoices/${inv.id}/send-email`, token, { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId, "invoice"] });
      toast({ title: "Invoice email sent", description: "Payment link email has been sent to the patient." });
    } catch (err: any) {
      toast({ title: "Email failed", description: err.message, variant: "destructive" });
    } finally {
      setEmailSending(false);
    }
  };

  const handleCopyPaymentLink = async () => {
    const inv = invoiceQuery.data?.invoice;
    if (!inv?.stripePaymentLink) {
      toast({ title: "No payment link", description: "Send the invoice email first to generate a payment link.", variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(inv.stripePaymentLink);
      toast({ title: "Copied", description: "Payment link copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Could not copy to clipboard.", variant: "destructive" });
    }
  };

  if (!isTerminal) return null;

  if (!isBillable) {
    return (
      <div className="border-t pt-4 space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <DollarSign className="w-4 h-4" />
          Invoice
        </h3>
        <p className="text-sm text-muted-foreground" data-testid="text-invoice-not-billable">
          Trip not billable. No invoice.
        </p>
      </div>
    );
  }

  if (invoiceQuery.isLoading) return <Skeleton className="h-16 w-full" />;

  const invoice = invoiceQuery.data?.invoice;

  if (!invoice && !showCreate) {
    return (
      <div className="border-t pt-4 space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <DollarSign className="w-4 h-4" />
          Invoice
        </h3>
        {canEdit ? (
          <>
            <p className="text-sm text-muted-foreground" data-testid="text-invoice-not-generated">Invoice not generated yet.</p>
            <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-invoice" className="gap-1">
              <Plus className="w-3.5 h-3.5" />
              Create Invoice
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="text-invoice-not-generated">Invoice not generated yet.</p>
        )}
      </div>
    );
  }

  if (showCreate && canEdit) {
    return (
      <div className="border-t pt-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <DollarSign className="w-4 h-4" />
          Create Invoice
        </h3>
        <div className="space-y-2">
          <Label htmlFor="inv-amount">Amount ($)</Label>
          <Input
            id="inv-amount"
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            data-testid="input-invoice-amount"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inv-notes">Notes (optional)</Label>
          <Textarea
            id="inv-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes"
            rows={2}
            data-testid="input-invoice-notes"
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => createMutation.mutate({ amount, notes })}
            disabled={!amount || parseFloat(amount) <= 0 || createMutation.isPending}
            data-testid="button-submit-invoice"
          >
            {createMutation.isPending ? "Creating..." : "Create Invoice"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setShowCreate(false); setAmount(""); setNotes(""); }} data-testid="button-cancel-invoice">
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (editMode && canEdit) {
    return (
      <div className="border-t pt-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Pencil className="w-4 h-4" />
          Edit Invoice #{invoice.id}
        </h3>
        <div className="space-y-2">
          <Label htmlFor="inv-edit-amount">Amount ($)</Label>
          <Input
            id="inv-edit-amount"
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="input-edit-invoice-amount"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inv-edit-status">Status</Label>
          <Select value={editStatus} onValueChange={setEditStatus}>
            <SelectTrigger data-testid="select-edit-invoice-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="inv-edit-notes">Notes</Label>
          <Textarea
            id="inv-edit-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
            rows={2}
            data-testid="input-edit-invoice-notes"
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              const data: any = {};
              if (amount && amount !== invoice.amount) data.amount = amount;
              if (editStatus && editStatus !== invoice.status) data.status = editStatus;
              if (notes !== (invoice.notes || "")) data.notes = notes;
              updateMutation.mutate(data);
            }}
            disabled={updateMutation.isPending}
            data-testid="button-save-invoice"
          >
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditMode(false)} data-testid="button-cancel-edit-invoice">
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
    paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  };

  return (
    <div className="border-t pt-4 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-medium">Invoice #{invoice.id}</span>
          <Badge className={statusColors[invoice.status] || ""} data-testid="badge-invoice-status">
            {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
          </Badge>
        </div>
        <span className="text-lg font-bold" data-testid="text-invoice-amount">
          ${parseFloat(invoice.amount).toFixed(2)}
        </span>
      </div>
      <div className="text-xs text-muted-foreground space-y-0.5">
        <div className="flex items-center gap-3 flex-wrap">
          <span data-testid="text-invoice-patient">{invoice.patientName}</span>
          <span data-testid="text-invoice-service-date">{invoice.serviceDate}</span>
          <span data-testid="text-invoice-created">Created: {formatDate(invoice.createdAt)}</span>
        </div>
        {invoice.notes && (
          <p data-testid="text-invoice-notes" className="italic">Notes: {invoice.notes}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {canEdit && invoice.status !== "paid" && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => {
              setAmount(invoice.amount);
              setEditStatus(invoice.status);
              setNotes(invoice.notes || "");
              setEditMode(true);
            }}
            data-testid="button-edit-invoice"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={handleDownloadPdf}
          disabled={pdfLoading}
          data-testid="button-download-invoice"
        >
          <FileText className="w-3 h-3" />
          {pdfLoading ? "Generating..." : "Download PDF"}
        </Button>
        {canEdit && invoice.status !== "paid" && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={handleSendEmail}
            disabled={emailSending}
            data-testid="button-send-invoice-email"
          >
            {emailSending ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Mail className="w-3 h-3" />
            )}
            {emailSending ? "Sending..." : (invoice.emailStatus === "sent" ? "Resend Email" : "Send Email")}
          </Button>
        )}
        {invoice.stripePaymentLink && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={handleCopyPaymentLink}
            data-testid="button-copy-payment-link"
          >
            <Copy className="w-3 h-3" />
            Copy Link
          </Button>
        )}
      </div>
      {(invoice.emailTo || invoice.emailStatus !== "not_sent") && (
        <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
          {invoice.emailTo && (
            <span data-testid="text-invoice-email-to">Sent to: {invoice.emailTo}</span>
          )}
          {invoice.emailStatus === "sent" && invoice.emailSentAt && (
            <span data-testid="text-invoice-email-sent-at">
              Sent: {formatDateTime(invoice.emailSentAt)}
            </span>
          )}
          {invoice.emailStatus === "failed" && (
            <span className="text-destructive" data-testid="text-invoice-email-error">
              Failed: {invoice.emailError || "Unknown error"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function RouteVersionHistory({ tripId, token }: { tripId: number; token: string | null }) {
  const [open, setOpen] = useState(false);
  const { data: routeHistory, isLoading } = useQuery<any[]>({
    queryKey: ["/api/trips", tripId, "route-history"],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/route/history`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return [];
      const json = await res.json();
      return json.routes || [];
    },
    enabled: open,
  });

  return (
    <div className="space-y-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        data-testid="button-toggle-route-history"
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-0" : "-rotate-90"}`} />
        Route Version History
      </button>
      {open && (
        <div className="ml-5 space-y-2 text-sm">
          {isLoading && <p className="text-muted-foreground">Loading...</p>}
          {routeHistory?.map((r: any, i: number) => (
            <div key={r.id || i} className="flex items-center gap-2 text-xs border-l-2 border-muted pl-2 py-1" data-testid={`route-version-${r.version}`}>
              <Badge variant={r.reason === "reroute" ? "destructive" : "outline"} className="text-xs">
                v{r.version}
              </Badge>
              <span className="text-muted-foreground">
                {(r.distanceMeters / 1609.344).toFixed(1)} mi
              </span>
              <span className="text-muted-foreground">
                {Math.round(r.durationSeconds / 60)} min
              </span>
              <Badge variant="secondary" className="text-xs">
                {r.reason}
              </Badge>
              {r.createdAt && (
                <span className="text-muted-foreground text-[10px]">
                  {new Date(r.createdAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          ))}
          {routeHistory?.length === 0 && <p className="text-muted-foreground">No route versions found</p>}
        </div>
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
  const [tripPdfLoading, setTripPdfLoading] = useState(false);

  const [editTripType, setEditTripType] = useState<TripType>(trip.tripType || "one_time");
  const [editMobilityRequirement, setEditMobilityRequirement] = useState(trip.mobilityRequirement || "STANDARD");
  const [editRecurringDays, setEditRecurringDays] = useState<string[]>(trip.recurringDays || []);
  const [editScheduledDate, setEditScheduledDate] = useState(trip.scheduledDate || "");
  const [editPickupTime, setEditPickupTime] = useState(trip.pickupTime || "");
  const [editEstArrival, setEditEstArrival] = useState(trip.estimatedArrivalTime || "");
  const [editNotes, setEditNotes] = useState(trip.notes || "");

  const handleDownloadTripPdf = async () => {
    if (!token || !trip.id) return;
    setTripPdfLoading(true);
    await downloadWithAuth(
      `/api/trips/${trip.id}/pdf`,
      `trip-${trip.publicId || trip.id}.pdf`,
      "application/pdf",
      rawAuthFetch,
      (msg) => toast({ title: "Error", description: msg || "Failed to download PDF", variant: "destructive" }),
    );
    setTripPdfLoading(false);
  };

  const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW"];
  const isTripLocked = TERMINAL_STATUSES.includes(trip.status);
  const canOverride = userRole === "SUPER_ADMIN" && import.meta.env.VITE_ALLOW_COMPLETED_EDIT === "true";

  const todayStr = getTodayInTimezone(cityTimezone);

  const isActiveTrip = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"].includes(trip.status);
  const hasDriver = !!trip.driverId;

  const { data: etaData } = useQuery<{ ok: boolean; eta_minutes?: number; distance_text?: string; updated_at?: string; source?: string; message?: string }>({
    queryKey: ["/api/trips", trip.id, "eta-to-pickup"],
    queryFn: () => apiFetch(`/api/trips/${trip.id}/eta-to-pickup`, token),
    enabled: !!token && hasDriver && isActiveTrip,
    refetchInterval: 60000,
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
        mobilityRequirement: editMobilityRequirement,
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
            {trip.mobilityRequirement && trip.mobilityRequirement !== "STANDARD" && (
              <Badge variant="outline" data-testid="badge-detail-mobility">{trip.mobilityRequirement}</Badge>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1 ml-auto"
              onClick={handleDownloadTripPdf}
              disabled={tripPdfLoading}
              data-testid="button-download-trip-pdf"
            >
              <Download className="w-3 h-3" />
              {tripPdfLoading ? "Generating..." : "Download PDF"}
            </Button>
          </DialogTitle>
        </DialogHeader>

        {isTripLocked && !canOverride && (
          <div className="flex items-center gap-2 rounded-md bg-muted/50 border px-3 py-2" data-testid="banner-trip-locked">
            <Lock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm text-muted-foreground">
              Locked ({trip.status === "COMPLETED" ? "Completed" : trip.status === "CANCELLED" ? "Cancelled" : "No-Show"}) — editing is disabled.
            </span>
          </div>
        )}

        {editing ? (
          <div className="space-y-4">
            {(!isClinicUser || trip.approvalStatus === "pending") && (
              <>
                <div className="space-y-2">
                  <Label>Mobility Requirement</Label>
                  <Select value={editMobilityRequirement} onValueChange={setEditMobilityRequirement}>
                    <SelectTrigger data-testid="select-edit-trip-mobility"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="STANDARD">Standard</SelectItem>
                      <SelectItem value="WHEELCHAIR">Wheelchair</SelectItem>
                      <SelectItem value="STRETCHER">Stretcher</SelectItem>
                      <SelectItem value="BARIATRIC">Bariatric</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

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
                  {editEstArrival && editEstArrival !== "TBD" && (
                    <div className="space-y-2">
                      <Label>Est. Arrival (auto-calculated)</Label>
                      <Input
                        type="time"
                        value={editEstArrival}
                        disabled
                        className="opacity-60"
                        data-testid="input-edit-trip-est-arrival"
                      />
                    </div>
                  )}
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
              {(!isClinicUser || trip.approvalStatus === "pending" || trip.approvalStatus === "approved") && trip.approvalStatus !== "cancelled" && (!isTripLocked || canOverride) && (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="button-edit-trip">
                  <Pencil className="w-4 h-4 mr-1" />
                  {isClinicUser && trip.approvalStatus !== "pending" ? "Add Notes" : "Edit"}
                </Button>
              )}
            </div>

            <TripDateTimeHeader trip={trip} />

            <div className="space-y-1">
              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                <span data-testid="text-trip-pickup-time">Pickup: {formatPickupTimeDisplay(trip.pickupTime)}</span>
                {trip.estimatedArrivalTime && trip.estimatedArrivalTime !== "TBD" && (
                  <span data-testid="text-trip-est-arrival">Est. Arrival: {formatPickupTimeDisplay(trip.estimatedArrivalTime)}</span>
                )}
                {trip.tripTimezone && (
                  <span className="text-xs text-muted-foreground/70">{tzAbbreviation(trip.tripTimezone)}</span>
                )}
              </div>
              {trip.recurringDays?.length > 0 && (
                <p className="text-sm text-muted-foreground" data-testid="text-trip-recurring-days">Recurring: {trip.recurringDays.join(", ")}</p>
              )}
            </div>

            <TripMetricsCard trip={trip} />

            {(trip.actualDistanceMeters || (trip.routeVersion && trip.routeVersion > 1)) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {trip.actualDistanceMeters != null && (
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="text-muted-foreground">Actual:</span>
                      <span className="font-medium" data-testid="text-actual-miles">
                        {(trip.actualDistanceMeters / 1609.344).toFixed(1)} mi
                      </span>
                      {trip.distanceMiles && Math.abs(trip.actualDistanceMeters / 1609.344 - parseFloat(trip.distanceMiles)) > 0.5 && (
                        <span className="text-xs text-amber-600" data-testid="text-miles-diff">
                          ({((trip.actualDistanceMeters / 1609.344 - parseFloat(trip.distanceMiles)) > 0 ? "+" : "")}{((trip.actualDistanceMeters / 1609.344 - parseFloat(trip.distanceMiles))).toFixed(1)} vs est.)
                        </span>
                      )}
                      <Badge variant="outline" className="text-xs" data-testid="badge-distance-source">
                        {trip.actualDistanceSource === "gps" ? "GPS" : "Est."}
                      </Badge>
                    </div>
                  )}
                  {trip.routeVersion != null && trip.routeVersion > 1 && (
                    <Badge variant="secondary" className="text-xs" data-testid="badge-reroute-count">
                      {trip.routeVersion - 1} reroute{trip.routeVersion > 2 ? "s" : ""}
                    </Badge>
                  )}
                  {trip.routeStatus && trip.routeStatus !== "missing" && (
                    <Badge variant={trip.routeStatus === "computed" ? "outline" : "destructive"} className="text-xs" data-testid="badge-route-status">
                      Route: {trip.routeStatus}
                    </Badge>
                  )}
                </div>
              </div>
            )}

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

            <TripRouteMap
              tripId={trip.id}
              pickupLat={trip.pickupLat}
              pickupLng={trip.pickupLng}
              dropoffLat={trip.dropoffLat}
              dropoffLng={trip.dropoffLng}
              pickupAddress={trip.pickupAddress}
              dropoffAddress={trip.dropoffAddress}
              token={token}
              className="w-full"
              style={{ minHeight: "200px" }}
            />

            {trip.routeVersion > 1 && (
              <RouteVersionHistory tripId={trip.id} token={token} />
            )}

            {driver && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Driver</h3>
                <DriverRef id={driver.id} label={`${driver.firstName} ${driver.lastName}`} size="md" />
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

            <TripProgressTimeline trip={trip} showHeader={false} showMetrics={false} />

            {trip.notes && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Notes</h3>
                <p className="text-sm" data-testid="text-trip-notes">{trip.notes}</p>
              </div>
            )}

            {userRole && INVOICE_ROLES.includes(userRole) && (
              <TripInvoicePanel tripId={trip.id} tripStatus={trip.status} token={token} userRole={userRole} />
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
                    <PatientRef id={patient.id} label={`${patient.firstName} ${patient.lastName}`} size="md" />
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
    refetchInterval: 60000,
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
  const [tripSource, setTripSource] = useState<"clinic" | "private">("clinic");
  const [scheduledDate, setScheduledDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [notes, setNotes] = useState("");
  const [tripType, setTripType] = useState<TripType>("one_time");
  const [mobilityRequirement, setMobilityRequirement] = useState("STANDARD");
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

    const effectiveClinicId = tripSource === "private" ? null : (clinicId ? parseInt(clinicId) : null);
    const effectiveRequestSource = tripSource === "private" ? "phone" : undefined;

    if (tripType === "recurring") {
      onSubmit({
        _isSeries: true,
        patientId: parseInt(patientId),
        clinicId: effectiveClinicId,
        driverId: driverId ? parseInt(driverId) : null,
        vehicleId: vehicleId ? parseInt(vehicleId) : null,
        pattern: seriesPattern,
        daysMask: recurringDays.join(","),
        startDate: scheduledDate,
        endDate: seriesEndType === "end_date" ? endDate : null,
        occurrences: seriesEndType === "occurrences" ? parseInt(occurrencesStr) : null,
        pickupTime,
        notes: notes || null,
        ...(effectiveRequestSource ? { requestSource: effectiveRequestSource } : {}),
        ...addressFields,
      });
    } else {
      onSubmit({
        patientId: parseInt(patientId),
        driverId: driverId ? parseInt(driverId) : null,
        vehicleId: vehicleId ? parseInt(vehicleId) : null,
        clinicId: effectiveClinicId,
        scheduledDate,
        scheduledTime: pickupTime,
        pickupTime,
        tripType,
        mobilityRequirement,
        recurringDays: null,
        notes: notes || null,
        ...(effectiveRequestSource ? { requestSource: effectiveRequestSource } : {}),
        ...addressFields,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Patient *</Label>
        <SearchableCombobox
          options={patients.map((p) => ({
            value: p.id.toString(),
            label: `${p.firstName} ${p.lastName}`,
            subLabel: p.phone || undefined,
          }))}
          value={patientId}
          onValueChange={setPatientId}
          placeholder="Select patient"
          searchPlaceholder="Search patients..."
          testId="select-trip-patient"
          allowDeselect={false}
        />
      </div>

      <div className="space-y-2">
        <Label>Mobility Requirement</Label>
        <Select value={mobilityRequirement} onValueChange={setMobilityRequirement}>
          <SelectTrigger data-testid="select-trip-mobility"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="STANDARD">Standard</SelectItem>
            <SelectItem value="WHEELCHAIR">Wheelchair</SelectItem>
            <SelectItem value="STRETCHER">Stretcher</SelectItem>
            <SelectItem value="BARIATRIC">Bariatric</SelectItem>
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
      <div className="space-y-2">
        <Label>Pickup Time *</Label>
        <Input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} required data-testid="input-trip-pickup-time" />
        <p className="text-xs text-muted-foreground">Estimated arrival will be calculated automatically based on the route.</p>
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
        <Label>Trip Source</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={tripSource === "clinic" ? "default" : "outline"}
            onClick={() => setTripSource("clinic")}
            data-testid="button-source-clinic"
          >
            Clinic
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tripSource === "private" ? "default" : "outline"}
            onClick={() => { setTripSource("private"); setClinicId(""); }}
            data-testid="button-source-private"
          >
            Private Pay (Phone)
          </Button>
        </div>
      </div>
      {tripSource === "clinic" && (
        <div className="space-y-2">
          <Label>Clinic</Label>
          <SearchableCombobox
            options={clinics.map((c) => ({
              value: c.id.toString(),
              label: c.name,
            }))}
            value={clinicId}
            onValueChange={setClinicId}
            placeholder="Select clinic (optional)"
            searchPlaceholder="Search clinics..."
            testId="select-trip-clinic"
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Driver</Label>
          <SearchableCombobox
            options={drivers.map((d) => ({
              value: d.id.toString(),
              label: `${d.firstName} ${d.lastName}`,
              subLabel: d.phone || undefined,
            }))}
            value={driverId}
            onValueChange={setDriverId}
            placeholder="Assign later"
            searchPlaceholder="Search drivers..."
            testId="select-trip-driver"
          />
        </div>
        <div className="space-y-2">
          <Label>Vehicle</Label>
          <SearchableCombobox
            options={vehicles.map((v) => ({
              value: v.id.toString(),
              label: v.name,
              subLabel: v.licensePlate || undefined,
            }))}
            value={vehicleId}
            onValueChange={setVehicleId}
            placeholder="Assign later"
            searchPlaceholder="Search vehicles..."
            testId="select-trip-vehicle"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-trip-notes" />
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={loading || !patientId || !pickupAddr || !dropoffAddr || !scheduledDate || !pickupTime || !!dateIsPast}
        data-testid="button-submit-trip"
      >
        {loading ? "Creating..." : tripType === "recurring" ? "Create Trip Series" : "Schedule Trip"}
      </Button>
    </form>
  );
}
