import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Plus, Route, Search, MessageSquare, Eye, AlertTriangle, Phone, User } from "lucide-react";
import { apiFetch } from "@/lib/api";

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
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {trip.scheduledDate} at {trip.scheduledTime} | Pickup: {trip.pickupTime}
                      {trip.estimatedArrivalTime && ` | ETA: ${trip.estimatedArrivalTime}`}
                    </p>
                    <p className="text-sm">
                      <span className="text-muted-foreground">From:</span> {trip.pickupAddress}
                    </p>
                    <p className="text-sm">
                      <span className="text-muted-foreground">To:</span> {trip.dropoffAddress}
                    </p>
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
  onClose,
}: {
  trip: any;
  patient: any;
  driver: any;
  canSendSms: boolean;
  token: string | null;
  onClose: () => void;
}) {
  const [smsOpen, setSmsOpen] = useState(false);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{trip.publicId}</span>
            <Badge variant={trip.status === "CANCELLED" || trip.status === "NO_SHOW" ? "destructive" : "secondary"}>
              {trip.status.replace("_", " ")}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">Schedule</h3>
            <p className="text-sm" data-testid="text-trip-schedule">{trip.scheduledDate} at {trip.scheduledTime}</p>
            <p className="text-sm" data-testid="text-trip-pickup-time">Pickup: {trip.pickupTime}</p>
            {trip.estimatedArrivalTime && (
              <p className="text-sm" data-testid="text-trip-est-arrival">Est. Arrival: {trip.estimatedArrivalTime}</p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">Pickup</h3>
            <p className="text-sm" data-testid="text-trip-pickup">{trip.pickupAddress}</p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">Dropoff</h3>
            <p className="text-sm" data-testid="text-trip-dropoff">{trip.dropoffAddress}</p>
          </div>

          {driver && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Driver</h3>
              <p className="text-sm" data-testid="text-trip-driver">{driver.firstName} {driver.lastName}</p>
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
  onSubmit,
  loading,
}: {
  patients: any[];
  drivers: any[];
  vehicles: any[];
  clinics: any[];
  onSubmit: (data: any) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState({
    patientId: "",
    driverId: "",
    vehicleId: "",
    clinicId: "",
    pickupAddress: "",
    dropoffAddress: "",
    scheduledDate: "",
    scheduledTime: "",
    pickupTime: "",
    estimatedArrivalTime: "",
    notes: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      patientId: parseInt(form.patientId),
      driverId: form.driverId ? parseInt(form.driverId) : null,
      vehicleId: form.vehicleId ? parseInt(form.vehicleId) : null,
      clinicId: form.clinicId ? parseInt(form.clinicId) : null,
      estimatedArrivalTime: form.estimatedArrivalTime || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Patient *</Label>
        <Select value={form.patientId} onValueChange={(v) => setForm({ ...form, patientId: v })}>
          <SelectTrigger data-testid="select-trip-patient"><SelectValue placeholder="Select patient" /></SelectTrigger>
          <SelectContent>
            {patients.map((p) => (
              <SelectItem key={p.id} value={p.id.toString()}>{p.firstName} {p.lastName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Date *</Label>
          <Input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} required data-testid="input-trip-date" />
        </div>
        <div className="space-y-2">
          <Label>Time *</Label>
          <Input type="time" value={form.scheduledTime} onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })} required data-testid="input-trip-time" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Pickup Time *</Label>
          <Input type="time" value={form.pickupTime} onChange={(e) => setForm({ ...form, pickupTime: e.target.value })} required data-testid="input-trip-pickup-time" />
        </div>
        <div className="space-y-2">
          <Label>Est. Arrival Time</Label>
          <Input type="time" value={form.estimatedArrivalTime} onChange={(e) => setForm({ ...form, estimatedArrivalTime: e.target.value })} data-testid="input-trip-est-arrival" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Pickup Address *</Label>
        <Input value={form.pickupAddress} onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })} required data-testid="input-trip-pickup" />
      </div>
      <div className="space-y-2">
        <Label>Dropoff Address *</Label>
        <Input value={form.dropoffAddress} onChange={(e) => setForm({ ...form, dropoffAddress: e.target.value })} required data-testid="input-trip-dropoff" />
      </div>
      <div className="space-y-2">
        <Label>Clinic</Label>
        <Select value={form.clinicId} onValueChange={(v) => setForm({ ...form, clinicId: v })}>
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
          <Select value={form.driverId} onValueChange={(v) => setForm({ ...form, driverId: v })}>
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
          <Select value={form.vehicleId} onValueChange={(v) => setForm({ ...form, vehicleId: v })}>
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
        <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-trip-notes" />
      </div>
      <Button type="submit" className="w-full" disabled={loading} data-testid="button-submit-trip">
        {loading ? "Creating..." : "Schedule Trip"}
      </Button>
    </form>
  );
}
