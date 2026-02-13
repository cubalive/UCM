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
import { Plus, Route, Search, MessageSquare, Eye, AlertTriangle, Phone, User, Pencil, Clock, Navigation, Link2, LinkIcon, Copy, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { AddressAutocomplete, type StructuredAddress } from "@/components/address-autocomplete";
import { RecurringSchedule, type TripType } from "@/components/recurring-schedule";

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

export default function TripsPage() {
  const { token, selectedCity, user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [detailTrip, setDetailTrip] = useState<any>(null);

  const cityParam = selectedCity ? `?cityId=${selectedCity.id}` : "";

  const canSendSms =
    user?.role === "SUPER_ADMIN" ||
    user?.role === "DISPATCH";

  const { data: trips, isLoading } = useQuery<any[]>({
    queryKey: ["/api/trips", selectedCity?.id],
    queryFn: () => apiFetch(`/api/trips${cityParam}`, token),
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
    mutationFn: (data: any) =>
      apiFetch("/api/trips", token, {
        method: "POST",
        body: JSON.stringify({ ...data, cityId: selectedCity?.id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setOpen(false);
      toast({ title: "Trip created" });
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
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono font-medium" data-testid={`text-trip-id-${trip.id}`}>
                        {trip.publicId}
                      </span>
                      <Badge variant={statusColors[trip.status] as any || "secondary"}>
                        {trip.status.replace("_", " ")}
                      </Badge>
                      {trip.tripType === "recurring" && (
                        <Badge variant="outline">Recurring</Badge>
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
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); setDetailTrip(trip); }}
                      data-testid={`button-view-trip-${trip.id}`}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Select
                      value={trip.status}
                      onValueChange={(status) => updateStatusMutation.mutate({ id: trip.id, status })}
                    >
                      <SelectTrigger
                        className="w-36"
                        data-testid={`select-trip-status-${trip.id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["SCHEDULED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"].map((s) => (
                          <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
          token={token}
          cityTimezone={selectedCity?.timezone || "America/New_York"}
          onClose={() => setDetailTrip(null)}
        />
      )}
    </div>
  );
}

function TripDetailDialog({
  trip,
  patient,
  driver,
  canSendSms,
  token,
  cityTimezone,
  onClose,
}: {
  trip: any;
  patient: any;
  driver: any;
  canSendSms: boolean;
  token: string | null;
  cityTimezone: string;
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
    updateMutation.mutate({
      tripType: editTripType,
      recurringDays: editTripType === "recurring" ? editRecurringDays : null,
      scheduledDate: editScheduledDate,
      scheduledTime: editPickupTime,
      pickupTime: editPickupTime,
      estimatedArrivalTime: editEstArrival,
      notes: editNotes || null,
    });
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
            {trip.tripType === "recurring" && (
              <Badge variant="outline">Recurring</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {editing ? (
          <div className="space-y-4">
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
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="button-edit-trip">
                <Pencil className="w-4 h-4 mr-1" />
                Edit
              </Button>
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
                    disabled={createTokenMutation.isPending}
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

                  {canSendSms && patient.phone && normalizePhoneToE164(patient.phone) && (
                    <Button
                      variant="outline"
                      onClick={() => setSmsOpen(true)}
                      data-testid="button-send-sms"
                    >
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Send SMS
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-no-patient">No patient linked to this trip</p>
              )}
            </div>
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

  const templates = [
    { label: "Driver Assigned", text: "United Care Mobility: Your driver has been assigned." },
    { label: "On the Way", text: "United Care Mobility: Your driver is on the way." },
    { label: "Arrived", text: "United Care Mobility: Your driver has arrived." },
    { label: "Cancelled", text: "United Care Mobility: Your ride was cancelled." },
  ];

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
            Send SMS
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
            <Label>Quick Templates</Label>
            <div className="grid grid-cols-2 gap-2">
              {templates.map((t) => (
                <Button
                  key={t.label}
                  variant="outline"
                  size="sm"
                  onClick={() => setMessage(t.text)}
                  data-testid={`button-template-${t.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message or select a template above..."
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
    if (!dropoffAddr || !dropoffAddr.zip) {
      toast({ title: "Dropoff address requires a ZIP code", variant: "destructive" });
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

    onSubmit({
      patientId: parseInt(patientId),
      driverId: driverId ? parseInt(driverId) : null,
      vehicleId: vehicleId ? parseInt(vehicleId) : null,
      clinicId: clinicId ? parseInt(clinicId) : null,
      pickupAddress: pickupAddr.formattedAddress,
      pickupStreet: pickupAddr.street,
      pickupCity: pickupAddr.city,
      pickupState: pickupAddr.state,
      pickupZip: pickupAddr.zip,
      pickupLat: pickupAddr.lat,
      pickupLng: pickupAddr.lng,
      dropoffAddress: dropoffAddr.formattedAddress,
      dropoffStreet: dropoffAddr.street,
      dropoffCity: dropoffAddr.city,
      dropoffState: dropoffAddr.state,
      dropoffZip: dropoffAddr.zip,
      dropoffLat: dropoffAddr.lat,
      dropoffLng: dropoffAddr.lng,
      scheduledDate,
      scheduledTime: pickupTime,
      pickupTime,
      estimatedArrivalTime,
      tripType,
      recurringDays: tripType === "recurring" ? recurringDays : null,
      notes: notes || null,
    });
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
        {loading ? "Creating..." : "Schedule Trip"}
      </Button>
    </form>
  );
}
