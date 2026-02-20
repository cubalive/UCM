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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, HeartPulse, Search, Accessibility, Pencil, Calendar, Archive, RotateCcw, Trash2, Clock, Repeat, Building2, UserCheck, Globe, ChevronDown, ChevronRight, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { GlobalSearchInput } from "@/components/GlobalSearchInput";
import { AddressAutocomplete, type StructuredAddress } from "@/components/address-autocomplete";
import { can } from "@shared/permissions";

type SourceTab = "all" | "clinic" | "internal" | "private";

export default function PatientsPage() {
  const { token, selectedCity, user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editPatient, setEditPatient] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [sourceTab, setSourceTab] = useState<SourceTab>("all");
  const [showArchived, setShowArchived] = useState(false);

  const canEdit = user?.role ? can(user.role, "patients", "write") : false;
  const isDispatchOrAdmin = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "DISPATCH" || user?.role === "COMPANY_ADMIN";
  const isClinicUser = user?.role === "VIEWER" && !!(user as any)?.clinicId;

  const patientQueryParams = new URLSearchParams();
  if (selectedCity?.id) patientQueryParams.set("cityId", String(selectedCity.id));
  if (sourceTab !== "all") patientQueryParams.set("source", sourceTab);
  const patientQueryString = patientQueryParams.toString() ? `?${patientQueryParams.toString()}` : "";

  const clinicGroupParams = new URLSearchParams();
  if (selectedCity?.id) clinicGroupParams.set("cityId", String(selectedCity.id));
  const clinicGroupQueryString = clinicGroupParams.toString() ? `?${clinicGroupParams.toString()}` : "";

  const { data: patients, isLoading } = useQuery<any[]>({
    queryKey: ["/api/patients", selectedCity?.id, sourceTab],
    queryFn: () => apiFetch(`/api/patients${patientQueryString}`, token),
    enabled: !!token,
  });

  const { data: clinicGroups, isLoading: clinicGroupsLoading } = useQuery<any[]>({
    queryKey: ["/api/patients/clinic-groups", selectedCity?.id],
    queryFn: () => apiFetch(`/api/patients/clinic-groups${clinicGroupQueryString}`, token),
    enabled: !!token && sourceTab === "clinic" && !isClinicUser,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const { scheduleDays, scheduleTime, ...patientData } = data;
      const patient = await apiFetch("/api/patients", token, {
        method: "POST",
        body: JSON.stringify({ ...patientData, cityId: selectedCity?.id }),
      });
      if (scheduleDays?.length > 0 && scheduleTime && selectedCity?.id) {
        const startDate = data.scheduleStartDate || new Date().toISOString().split("T")[0];
        await apiFetch("/api/recurring-schedules", token, {
          method: "POST",
          body: JSON.stringify({
            patientId: patient.id,
            cityId: selectedCity.id,
            days: scheduleDays,
            pickupTime: scheduleTime,
            startDate,
            endDate: data.scheduleEndDate || null,
          }),
        });
      }
      return patient;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patients/clinic-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-schedules"] });
      setOpen(false);
      toast({ title: "Patient added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const { scheduleDays, scheduleTime, ...patientData } = data;
      const patient = await apiFetch(`/api/patients/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify(patientData),
      });
      const existing = await apiFetch(`/api/recurring-schedules?patientId=${id}`, token).catch(() => []);
      if (scheduleDays?.length > 0 && scheduleTime && selectedCity?.id) {
        const startDate = data.scheduleStartDate || new Date().toISOString().split("T")[0];
        if (existing?.length > 0) {
          await apiFetch(`/api/recurring-schedules/${existing[0].id}`, token, {
            method: "PATCH",
            body: JSON.stringify({
              days: scheduleDays,
              pickupTime: scheduleTime,
              startDate: startDate,
              endDate: data.scheduleEndDate || null,
              active: true,
            }),
          });
        } else {
          await apiFetch("/api/recurring-schedules", token, {
            method: "POST",
            body: JSON.stringify({
              patientId: id,
              cityId: selectedCity.id,
              days: scheduleDays,
              pickupTime: scheduleTime,
              startDate,
              endDate: data.scheduleEndDate || null,
            }),
          });
        }
      } else if (existing?.length > 0) {
        await apiFetch(`/api/recurring-schedules/${existing[0].id}`, token, {
          method: "PATCH",
          body: JSON.stringify({ active: false }),
        });
      }
      return patient;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patients/clinic-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-schedules"] });
      setEditPatient(null);
      toast({ title: "Patient updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/admin/patients/${id}/archive`, token, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patients/clinic-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Patient archived" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/admin/patients/${id}/restore`, token, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patients/clinic-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Patient restored" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/admin/patients/${id}/permanent`, token, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patients/clinic-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Patient permanently deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const clinicDeleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/clinic/patients/${id}`, token, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patients/clinic-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Patient deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filtered = patients?.filter((p: any) => {
    const isArchived = !!p.deletedAt || !p.active;
    if (!showArchived && isArchived) return false;
    if (showArchived && !isArchived) return false;
    const q = search.toLowerCase();
    return !q || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) ||
      p.phone?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q) ||
      p.publicId?.toLowerCase().includes(q);
  });

  const renderPatientCard = (p: any) => (
    <Card key={p.id}>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium" data-testid={`text-patient-name-${p.id}`}>{p.firstName} {p.lastName}</p>
              <SourceBadge source={p.source} />
            </div>
            <p className="text-xs font-mono text-muted-foreground">{p.publicId}</p>
            {p.phone && <p className="text-sm text-muted-foreground">{p.phone}</p>}
            {p.address && <p className="text-sm text-muted-foreground truncate">{p.address}</p>}
            <div className="flex items-center gap-1 flex-wrap">
              <Badge variant="outline" className="text-xs" data-testid={`badge-mobility-${p.id}`}>
                {p.wheelchairRequired ? "Wheelchair" : "Ambulatory"}
              </Badge>
              {(() => {
                const sched = parseStructuredNotes(p.notes || "").recurringSchedule;
                return sched ? (
                  <Badge variant="outline" className="text-xs" data-testid={`badge-schedule-${p.id}`}>
                    <Calendar className="w-3 h-3 mr-1" />{sched}
                  </Badge>
                ) : null;
              })()}
            </div>
            {(() => {
              const cleanNotes = parseStructuredNotes(p.notes || "").notes;
              return cleanNotes ? <p className="text-sm text-muted-foreground truncate">{cleanNotes}</p> : null;
            })()}
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div className="flex gap-1">
              {!p.deletedAt && p.active && (
                <>
                  {canEdit && (
                    <Button size="icon" variant="ghost" onClick={() => setEditPatient(p)} data-testid={`button-edit-patient-${p.id}`}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  )}
                  {isDispatchOrAdmin && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(`Archive patient ${p.firstName} ${p.lastName}? This will move them to the archive.`)) {
                          archiveMutation.mutate(p.id);
                        }
                      }}
                      disabled={archiveMutation.isPending}
                      data-testid={`button-archive-patient-${p.id}`}
                    >
                      <Archive className="w-4 h-4" />
                    </Button>
                  )}
                  {isClinicUser && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(`Delete patient ${p.firstName} ${p.lastName}? This action cannot be undone.`)) {
                          clinicDeleteMutation.mutate(p.id);
                        }
                      }}
                      disabled={clinicDeleteMutation.isPending}
                      data-testid={`button-clinic-delete-patient-${p.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </>
              )}
              {(!!p.deletedAt || !p.active) && user?.role === "SUPER_ADMIN" && (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => restoreMutation.mutate(p.id)}
                    disabled={restoreMutation.isPending}
                    data-testid={`button-restore-patient-${p.id}`}
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => {
                      if (window.confirm(`PERMANENTLY delete patient ${p.firstName} ${p.lastName}? This cannot be undone.`)) {
                        permanentDeleteMutation.mutate(p.id);
                      }
                    }}
                    disabled={permanentDeleteMutation.isPending}
                    data-testid={`button-permanent-delete-patient-${p.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
            <Badge variant={p.active ? "secondary" : "destructive"}>
              {p.active ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const renderPatientList = () => {
    if (isLoading) {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      );
    }
    if (!filtered?.length) {
      return (
        <Card>
          <CardContent className="py-12 text-center">
            <HeartPulse className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No patients found</p>
          </CardContent>
        </Card>
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map(renderPatientCard)}
      </div>
    );
  };

  const renderClinicGrouped = () => {
    if (clinicGroupsLoading) {
      return (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      );
    }
    if (!clinicGroups?.length) {
      return (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No clinic patients found</p>
          </CardContent>
        </Card>
      );
    }
    return (
      <div className="space-y-4">
        {clinicGroups.map((group: any) => (
          <ClinicGroupCard
            key={group.clinic_id}
            group={group}
            search={search}
            renderPatientCard={renderPatientCard}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Patients</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage patient records</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-patient"><Plus className="w-4 h-4 mr-2" />Add Patient</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Patient</DialogTitle></DialogHeader>
            <PatientForm onSubmit={(d) => createMutation.mutate({ ...d, source: sourceTab !== "all" && sourceTab !== "clinic" ? sourceTab : undefined })} loading={createMutation.isPending} patientSource={sourceTab !== "all" && sourceTab !== "clinic" ? sourceTab : "internal"} />
          </DialogContent>
        </Dialog>
      </div>

      {!isClinicUser && (
        <Tabs value={sourceTab} onValueChange={(v) => setSourceTab(v as SourceTab)} data-testid="tabs-patient-source">
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all">
              <Users className="w-4 h-4 mr-1.5" />All
            </TabsTrigger>
            <TabsTrigger value="clinic" data-testid="tab-clinic">
              <Building2 className="w-4 h-4 mr-1.5" />Clinic
            </TabsTrigger>
            <TabsTrigger value="internal" data-testid="tab-internal">
              <UserCheck className="w-4 h-4 mr-1.5" />Internal
            </TabsTrigger>
            <TabsTrigger value="private" data-testid="tab-private">
              <Globe className="w-4 h-4 mr-1.5" />Private
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <GlobalSearchInput entity="patients" placeholder="Search patients..." onQueryChange={setSearch} className="max-w-sm" />
        {user?.role === "SUPER_ADMIN" && (
          <div className="flex items-center gap-2">
            <Switch
              checked={showArchived}
              onCheckedChange={setShowArchived}
              data-testid="switch-show-archived-patients"
            />
            <Label className="text-sm text-muted-foreground">Show Archived</Label>
          </div>
        )}
      </div>

      {sourceTab === "clinic" && !isClinicUser ? renderClinicGrouped() : renderPatientList()}

      <Dialog open={!!editPatient} onOpenChange={(v) => { if (!v) setEditPatient(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Patient</DialogTitle></DialogHeader>
          {editPatient && (
            <PatientForm
              initialData={editPatient}
              onSubmit={(d) => updateMutation.mutate({ id: editPatient.id, data: d })}
              loading={updateMutation.isPending}
              isEdit
              patientSource={editPatient.source || "internal"}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SourceBadge({ source }: { source?: string }) {
  if (!source || source === "internal") return null;
  if (source === "clinic") return <Badge variant="outline" className="text-xs"><Building2 className="w-3 h-3 mr-1" />Clinic</Badge>;
  if (source === "private") return <Badge variant="outline" className="text-xs"><Globe className="w-3 h-3 mr-1" />Private</Badge>;
  return null;
}

function ClinicGroupCard({ group, search, renderPatientCard }: { group: any; search: string; renderPatientCard: (p: any) => JSX.Element }) {
  const [expanded, setExpanded] = useState(false);

  const filteredPatients = group.patients?.filter(
    (p: any) =>
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      p.publicId?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <Card>
      <CardContent className="py-3">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setExpanded(!expanded)}
          data-testid={`button-clinic-group-${group.clinic_id}`}
        >
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <div>
              <p className="font-medium" data-testid={`text-clinic-name-${group.clinic_id}`}>{group.clinic_name}</p>
              <p className="text-xs text-muted-foreground">{group.patient_count} patient{group.patient_count !== 1 ? "s" : ""}</p>
            </div>
          </div>
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </button>
        {expanded && (
          <div className="mt-3 space-y-2">
            {filteredPatients.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2 text-center">No matching patients</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {filteredPatients.map(renderPatientCard)}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function parseStructuredNotes(raw: string): { recurringSchedule: string; notes: string } {
  const schedMatch = raw?.match(/\[SCHEDULE:(.*?)\]/);
  const recurringSchedule = schedMatch ? schedMatch[1].trim() : "";
  const notes = raw?.replace(/\[SCHEDULE:.*?\]\s*/g, "").trim() || "";
  return { recurringSchedule, notes };
}

function buildStructuredNotes(notes: string, recurringSchedule: string): string {
  const parts: string[] = [];
  if (recurringSchedule.trim()) parts.push(`[SCHEDULE: ${recurringSchedule.trim()}]`);
  if (notes.trim()) parts.push(notes.trim());
  return parts.join("\n");
}

const WEEKDAYS = [
  { value: "Mon", label: "Mon" },
  { value: "Tue", label: "Tue" },
  { value: "Wed", label: "Wed" },
  { value: "Thu", label: "Thu" },
  { value: "Fri", label: "Fri" },
  { value: "Sat", label: "Sat" },
  { value: "Sun", label: "Sun" },
];

function parseDaysFromScheduleString(s: string): string[] {
  const dayPart = s.split(/\s+\d/)[0] || s;
  return dayPart.split("/").map(d => d.trim()).filter(d => WEEKDAYS.some(w => w.value === d));
}

function parseTimeFromScheduleString(s: string): string {
  const match = s.match(/(\d{1,2}:\d{2})\s*(AM|PM)?/i);
  if (!match) return "";
  let [, time, ampm] = match;
  if (ampm) {
    const [h, m] = time.split(":");
    let hr = parseInt(h);
    if (ampm.toUpperCase() === "PM" && hr !== 12) hr += 12;
    if (ampm.toUpperCase() === "AM" && hr === 12) hr = 0;
    return `${hr.toString().padStart(2, "0")}:${m}`;
  }
  return time;
}

const mobilityOptions = [
  { value: "ambulatory", label: "Ambulatory" },
  { value: "wheelchair", label: "Wheelchair" },
  { value: "stretcher", label: "Stretcher" },
];

function PatientForm({ onSubmit, loading, initialData, isEdit, patientSource }: {
  onSubmit: (data: any) => void;
  loading: boolean;
  initialData?: any;
  isEdit?: boolean;
  patientSource?: string;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const emailRequired = patientSource === "private";
  const parsed = parseStructuredNotes(initialData?.notes || "");

  const parsedDays = parsed.recurringSchedule
    ? parseDaysFromScheduleString(parsed.recurringSchedule)
    : [];
  const parsedTime = parsed.recurringSchedule
    ? parseTimeFromScheduleString(parsed.recurringSchedule)
    : "";

  const initialAddress: StructuredAddress | null = initialData?.address
    ? {
        formattedAddress: initialData.address,
        street: initialData.addressStreet || "",
        city: initialData.addressCity || "",
        state: initialData.addressState || "",
        zip: initialData.addressZip || "",
        lat: initialData.lat || 0,
        lng: initialData.lng || 0,
        placeId: initialData.addressPlaceId || undefined,
      }
    : null;

  const [form, setForm] = useState({
    firstName: initialData?.firstName || "",
    lastName: initialData?.lastName || "",
    phone: initialData?.phone || "",
    email: initialData?.email || "",
    dateOfBirth: initialData?.dateOfBirth || "",
    insuranceId: initialData?.insuranceId || "",
    notes: parsed.notes,
    scheduleDays: parsedDays as string[],
    scheduleTime: parsedTime,
    scheduleStartDate: initialData?.scheduleStartDate || new Date().toISOString().split("T")[0],
    scheduleEndDate: initialData?.scheduleEndDate || "",
    mobilityType: initialData?.wheelchairRequired ? "wheelchair" : "ambulatory",
    active: initialData?.active ?? true,
  });

  const [addressData, setAddressData] = useState<StructuredAddress | null>(initialAddress);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressData) {
      toast({ title: "Address required", description: "Please select an address from the autocomplete suggestions.", variant: "destructive" });
      return;
    }
    if (!addressData.zip) {
      toast({ title: "ZIP code required", description: "Please select an address that includes a ZIP code.", variant: "destructive" });
      return;
    }
    if (!addressData.lat || !addressData.lng) {
      toast({ title: "Coordinates required", description: "Please clear and re-select the address.", variant: "destructive" });
      return;
    }
    if (emailRequired && !form.email.trim()) {
      toast({ title: "Email required", description: "Email is required for Private-pay patients to receive invoices and payment links.", variant: "destructive" });
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    const scheduleStr = form.scheduleDays.length > 0 && form.scheduleTime
      ? `${form.scheduleDays.join("/")} ${form.scheduleTime}`
      : "";
    const combinedNotes = buildStructuredNotes(form.notes, scheduleStr);
    onSubmit({
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      email: form.email.trim() || null,
      address: addressData?.formattedAddress || "",
      addressStreet: addressData?.street || "",
      addressCity: addressData?.city || "",
      addressState: addressData?.state || "",
      addressZip: addressData?.zip || "",
      addressPlaceId: addressData?.placeId || null,
      lat: addressData?.lat || null,
      lng: addressData?.lng || null,
      dateOfBirth: form.dateOfBirth,
      insuranceId: form.insuranceId,
      notes: combinedNotes,
      wheelchairRequired: form.mobilityType === "wheelchair" || form.mobilityType === "stretcher",
      active: form.active,
      scheduleDays: form.scheduleDays,
      scheduleTime: form.scheduleTime,
      scheduleStartDate: form.scheduleStartDate,
      scheduleEndDate: form.scheduleEndDate || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>First Name *</Label>
          <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required data-testid="input-patient-first" />
        </div>
        <div className="space-y-2">
          <Label>Last Name *</Label>
          <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required data-testid="input-patient-last" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-patient-phone" />
        </div>
        <div className="space-y-2">
          <Label>Email {emailRequired ? "*" : ""}</Label>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required={emailRequired}
            placeholder={emailRequired ? "Required for invoices" : "Optional"}
            data-testid="input-patient-email"
          />
          {emailRequired && (
            <p className="text-[11px] text-muted-foreground">Required to send invoices and payment links.</p>
          )}
        </div>
      </div>
      <AddressAutocomplete
        label="Address"
        value={addressData}
        onSelect={setAddressData}
        token={token}
        testIdPrefix="patient"
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Date of Birth</Label>
          <Input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} data-testid="input-patient-dob" />
        </div>
        <div className="space-y-2">
          <Label>Insurance ID</Label>
          <Input value={form.insuranceId} onChange={(e) => setForm({ ...form, insuranceId: e.target.value })} data-testid="input-patient-insurance" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Mobility Type</Label>
        <Select value={form.mobilityType} onValueChange={(v) => setForm({ ...form, mobilityType: v })}>
          <SelectTrigger data-testid="select-patient-mobility"><SelectValue placeholder="Select mobility type" /></SelectTrigger>
          <SelectContent>
            {mobilityOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-1"><Repeat className="w-3.5 h-3.5" /> Recurring Schedule</Label>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((day) => (
            <Button
              key={day.value}
              type="button"
              variant={form.scheduleDays.includes(day.value) ? "default" : "outline"}
              size="sm"
              onClick={() => {
                const next = form.scheduleDays.includes(day.value)
                  ? form.scheduleDays.filter((d: string) => d !== day.value)
                  : [...form.scheduleDays, day.value];
                setForm({ ...form, scheduleDays: next });
              }}
              data-testid={`button-day-${day.value}`}
            >
              {day.label}
            </Button>
          ))}
        </div>
        {form.scheduleDays.length > 0 && (
          <div className="space-y-2 mt-2">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="time"
                value={form.scheduleTime}
                onChange={(e) => setForm({ ...form, scheduleTime: e.target.value })}
                className="w-36"
                data-testid="input-schedule-time"
                required
              />
              <span className="text-xs text-muted-foreground">Pickup time (PT)</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Start Date *</Label>
                <Input
                  type="date"
                  value={form.scheduleStartDate}
                  onChange={(e) => setForm({ ...form, scheduleStartDate: e.target.value })}
                  data-testid="input-schedule-start-date"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">End Date (optional)</Label>
                <Input
                  type="date"
                  value={form.scheduleEndDate}
                  onChange={(e) => setForm({ ...form, scheduleEndDate: e.target.value })}
                  data-testid="input-schedule-end-date"
                />
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-patient-notes" />
      </div>
      {isEdit && (
        <div className="flex items-center gap-3">
          <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="switch-patient-active" />
          <Label>Active</Label>
        </div>
      )}
      <Button type="submit" className="w-full" disabled={loading} data-testid="button-submit-patient">
        {loading ? (isEdit ? "Saving..." : "Adding...") : (isEdit ? "Save Changes" : "Add Patient")}
      </Button>
    </form>
  );
}
