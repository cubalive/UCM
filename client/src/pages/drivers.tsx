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
import { useToast } from "@/hooks/use-toast";
import { Plus, UserCheck, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function DriversPage() {
  const { token, selectedCity } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const cityParam = selectedCity ? `?cityId=${selectedCity.id}` : "";

  const { data: drivers, isLoading } = useQuery<any[]>({
    queryKey: ["/api/drivers", selectedCity?.id],
    queryFn: () => apiFetch(`/api/drivers${cityParam}`, token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/drivers", token, {
        method: "POST",
        body: JSON.stringify({ ...data, cityId: selectedCity?.id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setOpen(false);
      toast({ title: "Driver added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filtered = drivers?.filter(
    (d: any) =>
      `${d.firstName} ${d.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      d.publicId?.toLowerCase().includes(search.toLowerCase())
  );

  const statusColors: Record<string, string> = { ACTIVE: "secondary", INACTIVE: "destructive", ON_LEAVE: "secondary" };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Drivers</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage driver assignments</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-driver"><Plus className="w-4 h-4 mr-2" />Add Driver</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Driver</DialogTitle></DialogHeader>
            <DriverForm onSubmit={(d) => createMutation.mutate(d)} loading={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search drivers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-drivers" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : !filtered?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <UserCheck className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No drivers found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((d: any) => (
            <Card key={d.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <p className="font-medium" data-testid={`text-driver-name-${d.id}`}>{d.firstName} {d.lastName}</p>
                    <p className="text-xs font-mono text-muted-foreground">{d.publicId}</p>
                    <p className="text-sm text-muted-foreground">{d.phone}</p>
                    {d.licenseNumber && <p className="text-xs text-muted-foreground">License: {d.licenseNumber}</p>}
                  </div>
                  <Badge variant={statusColors[d.status] as any || "secondary"}>{d.status}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DriverForm({ onSubmit, loading }: { onSubmit: (data: any) => void; loading: boolean }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", licenseNumber: "" });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>First Name *</Label>
          <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required data-testid="input-driver-first" />
        </div>
        <div className="space-y-2">
          <Label>Last Name *</Label>
          <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required data-testid="input-driver-last" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Phone *</Label>
        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required data-testid="input-driver-phone" />
      </div>
      <div className="space-y-2">
        <Label>License Number</Label>
        <Input value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} data-testid="input-driver-license" />
      </div>
      <Button type="submit" className="w-full" disabled={loading} data-testid="button-submit-driver">
        {loading ? "Adding..." : "Add Driver"}
      </Button>
    </form>
  );
}
