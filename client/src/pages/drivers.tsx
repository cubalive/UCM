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
import { Plus, UserCheck, Search, Mail, ShieldCheck, ShieldAlert, Copy, Key, Pencil } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function DriversPage() {
  const { token, selectedCity, user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editDriver, setEditDriver] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [tempPasswordInfo, setTempPasswordInfo] = useState<{ email: string; password: string } | null>(null);
  const cityParam = selectedCity ? `?cityId=${selectedCity.id}` : "";

  const canManageAuth = user?.role === "SUPER_ADMIN" || user?.role === "DISPATCH";
  const canEdit = user?.role === "SUPER_ADMIN" || user?.role === "DISPATCH" || user?.role === "ADMIN";

  const { data: drivers, isLoading } = useQuery<any[]>({
    queryKey: ["/api/drivers", selectedCity?.id],
    queryFn: () => apiFetch(`/api/drivers${cityParam}`, token),
    enabled: !!token,
  });

  const { data: cities } = useQuery<any[]>({
    queryKey: ["/api/cities"],
    queryFn: () => apiFetch("/api/cities", token),
    enabled: !!token,
  });

  const { data: vehicles } = useQuery<any[]>({
    queryKey: ["/api/vehicles"],
    queryFn: () => apiFetch("/api/vehicles", token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/drivers", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setOpen(false);
      if (result?.tempPassword && result?.email) {
        setTempPasswordInfo({ email: result.email, password: result.tempPassword });
      } else {
        toast({ title: "Driver added" });
      }
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiFetch(`/api/drivers/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setEditDriver(null);
      toast({ title: "Driver updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const inviteMutation = useMutation({
    mutationFn: (driverId: number) =>
      apiFetch(`/api/admin/drivers/${driverId}/send-invite`, token, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data: any) => {
      toast({ title: "Invite sent", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
    },
    onError: (err: any) => toast({ title: "Failed to send invite", description: err.message, variant: "destructive" }),
  });

  const backfillMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/admin/drivers/backfill-auth", token, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data: any) => {
      toast({
        title: "Backfill complete",
        description: `Processed: ${data.processed}, Created: ${data.created}, Linked: ${data.linked}, Skipped: ${data.skipped}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
    },
    onError: (err: any) => toast({ title: "Backfill failed", description: err.message, variant: "destructive" }),
  });

  const filtered = drivers?.filter(
    (d: any) =>
      `${d.firstName} ${d.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      d.publicId?.toLowerCase().includes(search.toLowerCase())
  );

  const driversWithoutAuth = drivers?.filter((d: any) => d.email && !d.authUserId) || [];

  const statusColors: Record<string, string> = { ACTIVE: "secondary", INACTIVE: "destructive", ON_LEAVE: "secondary" };

  const getVehicleName = (vehicleId: number | null) => {
    if (!vehicleId || !vehicles) return null;
    const v = vehicles.find((v: any) => v.id === vehicleId);
    return v ? `${v.name} — ${v.licensePlate}` : null;
  };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-drivers-heading">Drivers</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage driver assignments</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canManageAuth && user?.role === "SUPER_ADMIN" && driversWithoutAuth.length > 0 && (
            <Button
              variant="outline"
              onClick={() => backfillMutation.mutate()}
              disabled={backfillMutation.isPending}
              data-testid="button-backfill-auth"
            >
              <ShieldCheck className="w-4 h-4 mr-2" />
              {backfillMutation.isPending ? "Processing..." : `Provision Auth (${driversWithoutAuth.length})`}
            </Button>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-driver"><Plus className="w-4 h-4 mr-2" />Add Driver</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Driver</DialogTitle></DialogHeader>
              <DriverForm
                cities={cities || []}
                vehicles={vehicles || []}
                defaultCityId={selectedCity?.id}
                onSubmit={(d) => createMutation.mutate(d)}
                loading={createMutation.isPending}
              />
            </DialogContent>
          </Dialog>
        </div>
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
                    {d.email && <p className="text-sm text-muted-foreground" data-testid={`text-driver-email-${d.id}`}>{d.email}</p>}
                    <p className="text-sm text-muted-foreground">{d.phone}</p>
                    {d.licenseNumber && <p className="text-xs text-muted-foreground">License: {d.licenseNumber}</p>}
                    {getVehicleName(d.vehicleId) && (
                      <p className="text-xs text-muted-foreground" data-testid={`text-driver-vehicle-${d.id}`}>
                        Vehicle: {getVehicleName(d.vehicleId)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge variant={statusColors[d.status] as any || "secondary"}>{d.status}</Badge>
                    {d.authUserId ? (
                      <Badge variant="outline" className="text-xs" data-testid={`badge-auth-linked-${d.id}`}>
                        <ShieldCheck className="w-3 h-3 mr-1" />Auth linked
                      </Badge>
                    ) : d.email ? (
                      <Badge variant="outline" className="text-xs text-muted-foreground" data-testid={`badge-auth-missing-${d.id}`}>
                        <ShieldAlert className="w-3 h-3 mr-1" />No auth
                      </Badge>
                    ) : null}
                    {canEdit && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditDriver(d)}
                        data-testid={`button-edit-driver-${d.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {canManageAuth && d.email && (
                  <div className="mt-3 pt-3 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => inviteMutation.mutate(d.id)}
                      disabled={inviteMutation.isPending}
                      data-testid={`button-send-invite-${d.id}`}
                    >
                      <Mail className="w-3 h-3 mr-2" />
                      Send Driver Login Link
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editDriver} onOpenChange={(o) => { if (!o) setEditDriver(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Driver</DialogTitle></DialogHeader>
          {editDriver && (
            <DriverForm
              cities={cities || []}
              vehicles={vehicles || []}
              defaultCityId={editDriver.cityId}
              initialData={editDriver}
              onSubmit={(d) => updateMutation.mutate({ id: editDriver.id, data: d })}
              loading={updateMutation.isPending}
              isEdit
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!tempPasswordInfo} onOpenChange={(v) => !v && setTempPasswordInfo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              Temporary Password
            </DialogTitle>
          </DialogHeader>
          {tempPasswordInfo && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                A login account has been created for <span className="font-medium text-foreground">{tempPasswordInfo.email}</span>.
                Share this temporary password with the driver securely.
              </p>
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted font-mono text-sm">
                <span className="flex-1 select-all" data-testid="text-temp-password">{tempPasswordInfo.password}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(tempPasswordInfo.password);
                    toast({ title: "Copied to clipboard" });
                  }}
                  data-testid="button-copy-temp-password"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <div className="p-3 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  This password is shown only once and is not stored. The user must change it on first login.
                </p>
              </div>
              <Button className="w-full" onClick={() => setTempPasswordInfo(null)} data-testid="button-dismiss-temp-password">
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DriverForm({
  cities,
  vehicles,
  defaultCityId,
  initialData,
  onSubmit,
  loading,
  isEdit,
}: {
  cities: any[];
  vehicles: any[];
  defaultCityId?: number;
  initialData?: any;
  onSubmit: (data: any) => void;
  loading: boolean;
  isEdit?: boolean;
}) {
  const [form, setForm] = useState({
    email: initialData?.email || "",
    firstName: initialData?.firstName || "",
    lastName: initialData?.lastName || "",
    phone: initialData?.phone || "",
    licenseNumber: initialData?.licenseNumber || "",
    cityId: initialData?.cityId || defaultCityId || 0,
    vehicleId: initialData?.vehicleId || null as number | null,
    status: initialData?.status || "ACTIVE",
  });

  const cityVehicles = vehicles.filter((v: any) => v.cityId === form.cityId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = { ...form };
    if (!isEdit && !payload.vehicleId) delete payload.vehicleId;
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Email *</Label>
        <Input
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
          disabled={isEdit}
          data-testid="input-driver-email"
        />
        {!isEdit && <p className="text-xs text-muted-foreground">Driver will use this email to log in</p>}
      </div>
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
        <Input value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} style={{ textTransform: "uppercase" }} data-testid="input-driver-license" />
      </div>
      {!isEdit && (
        <div className="space-y-2">
          <Label>City *</Label>
          <Select
            value={form.cityId ? String(form.cityId) : ""}
            onValueChange={(v) => setForm({ ...form, cityId: Number(v), vehicleId: null })}
          >
            <SelectTrigger data-testid="select-driver-city">
              <SelectValue placeholder="Select city" />
            </SelectTrigger>
            <SelectContent>
              {cities.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <Label>Vehicle</Label>
        <Select
          value={form.vehicleId ? String(form.vehicleId) : "none"}
          onValueChange={(v) => setForm({ ...form, vehicleId: v === "none" ? null : Number(v) })}
        >
          <SelectTrigger data-testid="select-driver-vehicle">
            <SelectValue placeholder="Select vehicle (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No vehicle</SelectItem>
            {cityVehicles.map((v: any) => (
              <SelectItem key={v.id} value={String(v.id)}>
                {v.name} — {v.licensePlate}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form.cityId > 0 && cityVehicles.length === 0 && (
          <p className="text-xs text-muted-foreground">No vehicles in selected city</p>
        )}
      </div>
      {isEdit && (
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
            <SelectTrigger data-testid="select-driver-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
              <SelectItem value="ON_LEAVE">On Leave</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={loading || !form.email || !form.cityId}
        data-testid="button-submit-driver"
      >
        {loading ? (isEdit ? "Saving..." : "Adding...") : (isEdit ? "Save Changes" : "Add Driver")}
      </Button>
    </form>
  );
}
