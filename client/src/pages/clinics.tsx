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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Building2, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";

const facilityTypeLabels: Record<string, string> = {
  clinic: "Clinic",
  hospital: "Hospital",
  mental: "Mental Health",
  private: "Private Practice",
};

export default function ClinicsPage() {
  const { token, selectedCity } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const cityParam = selectedCity ? `?cityId=${selectedCity.id}` : "";

  const { data: clinics, isLoading } = useQuery<any[]>({
    queryKey: ["/api/clinics", selectedCity?.id],
    queryFn: () => apiFetch(`/api/clinics${cityParam}`, token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/clinics", token, {
        method: "POST",
        body: JSON.stringify({ ...data, cityId: selectedCity?.id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setOpen(false);
      toast({ title: "Clinic added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filtered = clinics?.filter(
    (c: any) =>
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.publicId?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clinics</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage healthcare facilities</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-clinic"><Plus className="w-4 h-4 mr-2" />Add Clinic</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Clinic</DialogTitle></DialogHeader>
            <ClinicForm onSubmit={(d) => createMutation.mutate(d)} loading={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search clinics..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-clinics" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : !filtered?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No clinics found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((c: any) => (
            <Card key={c.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <p className="font-medium" data-testid={`text-clinic-name-${c.id}`}>{c.name}</p>
                    <p className="text-xs font-mono text-muted-foreground">{c.publicId}</p>
                    {c.facilityType && (
                      <Badge variant="outline" className="text-xs" data-testid={`badge-facility-type-${c.id}`}>
                        {facilityTypeLabels[c.facilityType] || c.facilityType}
                      </Badge>
                    )}
                    <p className="text-sm text-muted-foreground truncate">{c.address}</p>
                    {c.phone && <p className="text-sm text-muted-foreground">{c.phone}</p>}
                    {c.contactName && <p className="text-xs text-muted-foreground">Contact: {c.contactName}</p>}
                  </div>
                  <Badge variant={c.active ? "secondary" : "destructive"} className="flex-shrink-0">
                    {c.active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ClinicForm({ onSubmit, loading }: { onSubmit: (data: any) => void; loading: boolean }) {
  const [form, setForm] = useState({ name: "", address: "", phone: "", contactName: "", facilityType: "clinic" });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Clinic Name *</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-clinic-name" />
      </div>
      <div className="space-y-2">
        <Label>Address *</Label>
        <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required data-testid="input-clinic-address" />
      </div>
      <div className="space-y-2">
        <Label>Facility Type *</Label>
        <Select value={form.facilityType} onValueChange={(v) => setForm({ ...form, facilityType: v })}>
          <SelectTrigger data-testid="select-clinic-facility-type"><SelectValue placeholder="Select type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="clinic">Clinic</SelectItem>
            <SelectItem value="hospital">Hospital</SelectItem>
            <SelectItem value="mental">Mental Health</SelectItem>
            <SelectItem value="private">Private Practice</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-clinic-phone" />
        </div>
        <div className="space-y-2">
          <Label>Contact Name</Label>
          <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} data-testid="input-clinic-contact" />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading} data-testid="button-submit-clinic">
        {loading ? "Adding..." : "Add Clinic"}
      </Button>
    </form>
  );
}
