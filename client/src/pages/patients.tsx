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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, HeartPulse, Search, Accessibility, Pencil, Calendar } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function PatientsPage() {
  const { token, selectedCity, user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editPatient, setEditPatient] = useState<any>(null);
  const [search, setSearch] = useState("");

  const canEdit = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "DISPATCH";

  const cityParam = selectedCity ? `?cityId=${selectedCity.id}` : "";

  const { data: patients, isLoading } = useQuery<any[]>({
    queryKey: ["/api/patients", selectedCity?.id],
    queryFn: () => apiFetch(`/api/patients${cityParam}`, token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/patients", token, {
        method: "POST",
        body: JSON.stringify({ ...data, cityId: selectedCity?.id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setOpen(false);
      toast({ title: "Patient added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiFetch(`/api/patients/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setEditPatient(null);
      toast({ title: "Patient updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filtered = patients?.filter(
    (p: any) =>
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      p.publicId?.toLowerCase().includes(search.toLowerCase())
  );

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
            <PatientForm onSubmit={(d) => createMutation.mutate(d)} loading={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search patients..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-patients" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : !filtered?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <HeartPulse className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No patients found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((p: any) => (
            <Card key={p.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <p className="font-medium" data-testid={`text-patient-name-${p.id}`}>{p.firstName} {p.lastName}</p>
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
                    {canEdit && (
                      <Button size="icon" variant="ghost" onClick={() => setEditPatient(p)} data-testid={`button-edit-patient-${p.id}`}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                    <Badge variant={p.active ? "secondary" : "destructive"}>
                      {p.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editPatient} onOpenChange={(v) => { if (!v) setEditPatient(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Patient</DialogTitle></DialogHeader>
          {editPatient && (
            <PatientForm
              initialData={editPatient}
              onSubmit={(d) => updateMutation.mutate({ id: editPatient.id, data: d })}
              loading={updateMutation.isPending}
              isEdit
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
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

const mobilityOptions = [
  { value: "ambulatory", label: "Ambulatory" },
  { value: "wheelchair", label: "Wheelchair" },
  { value: "stretcher", label: "Stretcher" },
];

function PatientForm({ onSubmit, loading, initialData, isEdit }: {
  onSubmit: (data: any) => void;
  loading: boolean;
  initialData?: any;
  isEdit?: boolean;
}) {
  const parsed = parseStructuredNotes(initialData?.notes || "");

  const [form, setForm] = useState({
    firstName: initialData?.firstName || "",
    lastName: initialData?.lastName || "",
    phone: initialData?.phone || "",
    address: initialData?.address || "",
    dateOfBirth: initialData?.dateOfBirth || "",
    insuranceId: initialData?.insuranceId || "",
    notes: parsed.notes,
    recurringSchedule: parsed.recurringSchedule,
    mobilityType: initialData?.wheelchairRequired ? "wheelchair" : "ambulatory",
    active: initialData?.active ?? true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const combinedNotes = buildStructuredNotes(form.notes, form.recurringSchedule);
    onSubmit({
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      address: form.address,
      dateOfBirth: form.dateOfBirth,
      insuranceId: form.insuranceId,
      notes: combinedNotes,
      wheelchairRequired: form.mobilityType === "wheelchair" || form.mobilityType === "stretcher",
      active: form.active,
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
      <div className="space-y-2">
        <Label>Phone</Label>
        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-patient-phone" />
      </div>
      <div className="space-y-2">
        <Label>Address</Label>
        <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="input-patient-address" />
      </div>
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
        <Label>Recurring Schedule</Label>
        <Input
          value={form.recurringSchedule}
          onChange={(e) => setForm({ ...form, recurringSchedule: e.target.value })}
          placeholder="e.g. Mon/Wed/Fri 9:00 AM"
          data-testid="input-patient-schedule"
        />
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
