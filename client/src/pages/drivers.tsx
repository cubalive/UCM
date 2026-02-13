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
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, UserCheck, Search, Mail, ShieldCheck, ShieldAlert, Copy, Key, Pencil, Unlink, History, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api";

const UNASSIGN_REASONS = [
  { value: "vehicle_maintenance", label: "Vehicle in maintenance" },
  { value: "driver_reassignment", label: "Driver reassignment" },
  { value: "end_of_shift", label: "End of shift" },
  { value: "vehicle_out_of_service", label: "Vehicle out of service" },
  { value: "scheduling_change", label: "Scheduling change" },
  { value: "other", label: "Other" },
];

export default function DriversPage() {
  const { token, selectedCity, user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editDriver, setEditDriver] = useState<any>(null);
  const [unassignDriver, setUnassignDriver] = useState<any>(null);
  const [historyDriver, setHistoryDriver] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [tempPasswordInfo, setTempPasswordInfo] = useState<{ email: string; password: string } | null>(null);
  const [vehicleConflict, setVehicleConflict] = useState<{
    driverId: number;
    driverName: string;
    conflictingDriverId: number;
    conflictingDriverName: string;
    pendingData: any;
  } | null>(null);
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
        if (result?.emailSent) {
          toast({ title: "Driver added — credentials emailed" });
        }
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
      setVehicleConflict(null);
      toast({ title: "Driver updated" });
    },
    onError: (err: any, variables: { id: number; data: any }) => {
      if (err.data?.code === "VEHICLE_ALREADY_ASSIGNED") {
        setEditDriver(null);
        setVehicleConflict({
          driverId: variables.id,
          driverName: err.data.conflictingDriverName,
          conflictingDriverId: err.data.conflictingDriverId,
          conflictingDriverName: err.data.conflictingDriverName,
          pendingData: variables.data,
        });
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    },
  });

  const unassignMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiFetch(`/api/drivers/${id}`, token, {
        method: "PUT",
        body: JSON.stringify({ vehicleId: null, unassignReason: reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      setUnassignDriver(null);
      toast({ title: "Vehicle unassigned" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const inviteMutation = useMutation({
    mutationFn: (driverId: number) =>
      apiFetch(`/api/admin/drivers/${driverId}/send-invite`, token, {
        method: "POST",
      }),
    onSuccess: (data: any) => {
      toast({ title: "Credentials sent", description: data.message });
    },
    onError: (err: any) => toast({ title: "Failed to send credentials", description: err.message, variant: "destructive" }),
  });

  const [resetTarget, setResetTarget] = useState<{ id: number; email: string } | null>(null);
  const resetPasswordMutation = useMutation({
    mutationFn: (driverId: number) =>
      apiFetch(`/api/admin/drivers/${driverId}/reset-password`, token, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data: any) => {
      if (data?.tempPassword) {
        setTempPasswordInfo({ email: resetTarget?.email || "", password: data.tempPassword });
      }
      toast({ title: "Password reset", description: data.emailSent ? "New credentials emailed" : "Password reset — email not sent" });
      setResetTarget(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to reset password", description: err.message, variant: "destructive" });
      setResetTarget(null);
    },
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
                    {d.vehicleId ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs text-muted-foreground" data-testid={`text-driver-vehicle-${d.id}`}>
                          Vehicle: {getVehicleName(d.vehicleId)}
                        </p>
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setUnassignDriver(d)}
                            data-testid={`button-unassign-vehicle-${d.id}`}
                          >
                            <Unlink className="w-3 h-3 mr-1" />
                            Unassign
                          </Button>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground" data-testid={`text-driver-no-vehicle-${d.id}`}>
                        No vehicle assigned
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
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setHistoryDriver(d)}
                          data-testid={`button-vehicle-history-${d.id}`}
                        >
                          <History className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditDriver(d)}
                          data-testid={`button-edit-driver-${d.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                {canManageAuth && d.email && (
                  <div className="mt-3 pt-3 border-t flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => inviteMutation.mutate(d.id)}
                      disabled={inviteMutation.isPending}
                      data-testid={`button-send-invite-${d.id}`}
                    >
                      <Mail className="w-3 h-3 mr-2" />
                      Send Login Link
                    </Button>
                    {user?.role === "SUPER_ADMIN" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setResetTarget({ id: d.id, email: d.email }); resetPasswordMutation.mutate(d.id); }}
                        disabled={resetPasswordMutation.isPending}
                        data-testid={`button-reset-driver-password-${d.id}`}
                      >
                        <Key className="w-3 h-3 mr-2" />
                        Reset Password
                      </Button>
                    )}
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

      <UnassignVehicleDialog
        driver={unassignDriver}
        vehicleName={unassignDriver ? getVehicleName(unassignDriver.vehicleId) : null}
        open={!!unassignDriver}
        onOpenChange={(o) => { if (!o) setUnassignDriver(null); }}
        onConfirm={(reason) => {
          if (unassignDriver) {
            unassignMutation.mutate({ id: unassignDriver.id, reason });
          }
        }}
        loading={unassignMutation.isPending}
      />

      <VehicleHistoryDialog
        driver={historyDriver}
        open={!!historyDriver}
        onOpenChange={(o) => { if (!o) setHistoryDriver(null); }}
        token={token}
      />

      <Dialog open={!!vehicleConflict} onOpenChange={(o) => { if (!o) setVehicleConflict(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Vehicle Already Assigned
            </DialogTitle>
          </DialogHeader>
          {vehicleConflict && (
            <div className="space-y-4" data-testid="vehicle-conflict-dialog">
              <p className="text-sm text-muted-foreground">
                This vehicle is currently assigned to <span className="font-medium text-foreground">{vehicleConflict.conflictingDriverName}</span>. You must unassign it from that driver before assigning it here.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const conflictDriver = (drivers || []).find((d: any) => d.id === vehicleConflict.conflictingDriverId);
                    setVehicleConflict(null);
                    if (conflictDriver) {
                      setEditDriver(conflictDriver);
                    }
                  }}
                  data-testid="button-go-to-conflicting-driver"
                >
                  Go to {vehicleConflict.conflictingDriverName}
                </Button>
                {user?.role === "SUPER_ADMIN" && (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      updateMutation.mutate({
                        id: vehicleConflict.driverId,
                        data: { ...vehicleConflict.pendingData, forceAssign: true },
                      });
                    }}
                    disabled={updateMutation.isPending}
                    data-testid="button-force-assign"
                  >
                    {updateMutation.isPending ? "Reassigning..." : "Force Reassign (Admin Override)"}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => setVehicleConflict(null)}
                  data-testid="button-cancel-conflict"
                >
                  Cancel
                </Button>
              </div>
            </div>
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

function UnassignVehicleDialog({
  driver,
  vehicleName,
  open,
  onOpenChange,
  onConfirm,
  loading,
}: {
  driver: any;
  vehicleName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
}) {
  const [reasonCategory, setReasonCategory] = useState("");
  const [reasonText, setReasonText] = useState("");

  const buildReason = () => {
    const catLabel = UNASSIGN_REASONS.find((r) => r.value === reasonCategory)?.label || "";
    if (reasonCategory === "other" && reasonText.trim()) return reasonText.trim();
    if (catLabel && reasonText.trim()) return `${catLabel}: ${reasonText.trim()}`;
    return catLabel || reasonText.trim();
  };

  const canSubmit = !!reasonCategory && (reasonCategory !== "other" || reasonText.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o) {
        setReasonCategory("");
        setReasonText("");
      }
      onOpenChange(o);
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unassign Vehicle</DialogTitle>
        </DialogHeader>
        {driver && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Remove <span className="font-medium text-foreground">{vehicleName}</span> from driver{" "}
              <span className="font-medium text-foreground">{driver.firstName} {driver.lastName}</span>?
            </p>
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Select value={reasonCategory} onValueChange={setReasonCategory}>
                <SelectTrigger data-testid="select-unassign-reason">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {UNASSIGN_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {reasonCategory && (
              <div className="space-y-2">
                <Label>{reasonCategory === "other" ? "Please describe *" : "Additional details (optional)"}</Label>
                <Textarea
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  placeholder={reasonCategory === "other" ? "Enter reason..." : "Optional notes..."}
                  data-testid="input-unassign-details"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel-unassign"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!canSubmit || loading}
                onClick={() => onConfirm(buildReason())}
                data-testid="button-confirm-unassign"
              >
                {loading ? "Unassigning..." : "Unassign Vehicle"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VehicleHistoryDialog({
  driver,
  open,
  onOpenChange,
  token,
}: {
  driver: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string | null;
}) {
  const { data: history, isLoading } = useQuery<any[]>({
    queryKey: ["/api/drivers", driver?.id, "vehicle-history"],
    queryFn: () => apiFetch(`/api/drivers/${driver?.id}/vehicle-history`, token),
    enabled: !!driver && !!token && open,
  });

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Vehicle History — {driver?.firstName} {driver?.lastName}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : !history?.length ? (
          <p className="text-sm text-muted-foreground py-6 text-center" data-testid="text-no-vehicle-history">
            No vehicle assignment history found.
          </p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto" data-testid="vehicle-history-list">
            {history.map((h: any) => (
              <Card key={h.id}>
                <CardContent className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <p className="font-medium text-sm" data-testid={`text-history-vehicle-${h.id}`}>
                        {h.vehicleName} — {h.vehicleLicensePlate}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Assigned: {formatDate(h.assignedAt)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Unassigned: {h.unassignedAt ? formatDate(h.unassignedAt) : <Badge variant="secondary" className="text-xs">Current</Badge>}
                      </p>
                      {h.reason && (
                        <p className="text-xs text-muted-foreground">Reason: {h.reason}</p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs flex-shrink-0">{h.assignedBy}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
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

  const cityVehicles = vehicles.filter((v: any) => v.cityId === form.cityId && v.status === "ACTIVE");

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
        disabled={loading || (!isEdit && !form.email) || !form.cityId}
        data-testid="button-submit-driver"
      >
        {loading ? (isEdit ? "Saving..." : "Adding...") : (isEdit ? "Save Changes" : "Add Driver")}
      </Button>
    </form>
  );
}
