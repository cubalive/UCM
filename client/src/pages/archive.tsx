import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Archive, RotateCcw, Trash2, Search, Building2, UserCheck, HeartPulse, Users, Copy, KeyRound, Route, Car } from "lucide-react";
import { apiFetch } from "@/lib/api";

type EntityTab = "clinics" | "drivers" | "patients" | "users" | "trips" | "vehicles";

const allTabs: { key: EntityTab; label: string; icon: typeof Building2; superAdminOnly?: boolean }[] = [
  { key: "clinics", label: "Clinics", icon: Building2, superAdminOnly: true },
  { key: "drivers", label: "Drivers", icon: UserCheck },
  { key: "patients", label: "Patients", icon: HeartPulse },
  { key: "users", label: "Users", icon: Users, superAdminOnly: true },
  { key: "trips", label: "Trips", icon: Route },
  { key: "vehicles", label: "Vehicles", icon: Car, superAdminOnly: true },
];

const entityListKey: Record<EntityTab, string> = {
  clinics: "/api/clinics",
  drivers: "/api/drivers",
  patients: "/api/patients",
  users: "/api/users",
  trips: "/api/trips",
  vehicles: "/api/vehicles",
};

export default function ArchivePage() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const isSuperAdmin = user?.role?.toUpperCase() === "SUPER_ADMIN" || user?.role?.toUpperCase() === "ADMIN";
  const tabs = allTabs.filter(t => !t.superAdminOnly || isSuperAdmin);
  const defaultTab = tabs[0]?.key || "drivers";
  const [activeTab, setActiveTab] = useState<EntityTab>(defaultTab);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; entity: EntityTab } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [resetTarget, setResetTarget] = useState<number | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const { data, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/archived", activeTab],
    queryFn: () => apiFetch(`/api/admin/archived?entity=${activeTab}`, token),
    enabled: !!token,
  });

  const restoreMutation = useMutation({
    mutationFn: ({ entity, id }: { entity: EntityTab; id: number }) =>
      apiFetch(`/api/admin/${entity}/${id}/restore`, token, { method: "PATCH" }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/archived", variables.entity] });
      queryClient.invalidateQueries({ queryKey: [entityListKey[variables.entity]] });
      toast({ title: "Restored successfully" });
    },
    onError: (err: any) => toast({ title: "Restore failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ entity, id }: { entity: EntityTab; id: number }) =>
      apiFetch(`/api/admin/${entity}/${id}/permanent`, token, { method: "DELETE" }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/archived", variables.entity] });
      queryClient.invalidateQueries({ queryKey: [entityListKey[variables.entity]] });
      setDeleteTarget(null);
      setConfirmText("");
      toast({ title: "Permanently deleted" });
    },
    onError: (err: any) => {
      const msg = err.message?.includes("409") || err.data?.message?.includes("active trips")
        ? "Cannot delete: entity has active trips"
        : err.message;
      toast({ title: "Delete failed", description: msg, variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (userId: number) =>
      apiFetch(`/api/admin/users/${userId}/reset-password`, token, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data: any) => {
      setResetTarget(null);
      setTempPassword(data.tempPassword);
      toast({ title: "Password reset successfully" });
    },
    onError: (err: any) => toast({ title: "Reset failed", description: err.message, variant: "destructive" }),
  });

  const filtered = data?.filter((item: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = `${item.firstName || ""} ${item.lastName || ""} ${item.name || ""}`.toLowerCase();
    const email = (item.email || "").toLowerCase();
    const publicId = (item.publicId || "").toLowerCase();
    return name.includes(q) || email.includes(q) || publicId.includes(q);
  });

  const renderCard = (item: any) => {
    const singularEntity = activeTab.slice(0, -1) as string;

    return (
      <Card key={item.id}>
        <CardContent className="py-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1 min-w-0">
              {activeTab === "clinics" && (
                <>
                  <p className="font-medium" data-testid={`text-archive-name-${item.id}`}>{item.name}</p>
                  <p className="text-sm text-muted-foreground">{item.address}</p>
                  <p className="text-sm text-muted-foreground">{item.email}</p>
                </>
              )}
              {activeTab === "drivers" && (
                <>
                  <p className="font-medium" data-testid={`text-archive-name-${item.id}`}>{item.firstName} {item.lastName}</p>
                  <p className="text-sm text-muted-foreground">{item.phone}</p>
                  <p className="text-sm text-muted-foreground">{item.email}</p>
                  {item.licenseNumber && <p className="text-xs text-muted-foreground">License: {item.licenseNumber}</p>}
                </>
              )}
              {activeTab === "patients" && (
                <>
                  <p className="font-medium" data-testid={`text-archive-name-${item.id}`}>{item.firstName} {item.lastName}</p>
                  <p className="text-sm text-muted-foreground">{item.phone}</p>
                  {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
                </>
              )}
              {activeTab === "users" && (
                <>
                  <p className="font-medium" data-testid={`text-archive-name-${item.id}`}>{item.firstName} {item.lastName}</p>
                  <p className="text-sm text-muted-foreground">{item.email}</p>
                </>
              )}
              {activeTab === "trips" && (
                <>
                  <p className="font-medium" data-testid={`text-archive-name-${item.id}`}>{item.publicId}</p>
                  <p className="text-sm text-muted-foreground">{item.scheduledDate} | {item.pickupTime}</p>
                  <p className="text-sm text-muted-foreground truncate">{item.pickupAddress}</p>
                </>
              )}
              {activeTab === "vehicles" && (
                <>
                  <p className="font-medium" data-testid={`text-archive-name-${item.id}`}>{item.name}</p>
                  <p className="text-sm text-muted-foreground">{item.licensePlate}</p>
                  {item.make && <p className="text-sm text-muted-foreground">{item.make} {item.model} {item.year}</p>}
                </>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-xs font-mono">{item.publicId}</Badge>
                {activeTab === "clinics" && item.facilityType && (
                  <Badge variant="outline">{item.facilityType}</Badge>
                )}
                {activeTab === "users" && item.role && (
                  <Badge variant="outline">{item.role.replace("_", " ")}</Badge>
                )}
                {activeTab === "trips" && item.status && (
                  <Badge variant={item.status === "CANCELLED" ? "destructive" : "outline"}>{item.status.replace("_", " ")}</Badge>
                )}
              </div>
              {item.deletedAt && (
                <p className="text-xs text-muted-foreground">
                  Deleted: {new Date(item.deletedAt).toLocaleDateString()}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                data-testid={`button-restore-${singularEntity}-${item.id}`}
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate({ entity: activeTab, id: item.id })}
              >
                <RotateCcw className="w-4 h-4 mr-1" />
                Restore
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid={`button-delete-${singularEntity}-${item.id}`}
                onClick={() => setDeleteTarget({ id: item.id, entity: activeTab })}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete
              </Button>
              {activeTab === "users" && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={`button-reset-password-${item.id}`}
                  onClick={() => setResetTarget(item.id)}
                >
                  <KeyRound className="w-4 h-4 mr-1" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div>
        <div className="flex items-center gap-2">
          <Archive className="w-6 h-6" />
          <h1 className="text-2xl font-semibold tracking-tight">Admin Archive</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">View and manage archived records</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {tabs.map((tab) => (
          <Button
            key={tab.key}
            variant={activeTab === tab.key ? "default" : "outline"}
            size="sm"
            data-testid={`tab-archive-${tab.key}`}
            onClick={() => { setActiveTab(tab.key); setSearch(""); }}
            className="toggle-elevate"
          >
            <tab.icon className="w-4 h-4 mr-1" />
            {tab.label}
          </Button>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder={`Search archived ${activeTab}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-archive-search"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : !filtered?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Archive className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No archived {activeTab} found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((item: any) => renderCard(item))}
        </div>
      )}

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setConfirmText(""); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanent Deletion</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This action cannot be undone. Type DELETE to permanently remove this record.
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE to confirm"
            data-testid="input-confirm-delete"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setDeleteTarget(null); setConfirmText(""); }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== "DELETE" || deleteMutation.isPending}
              data-testid="button-confirm-delete"
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate({ entity: deleteTarget.entity, id: deleteTarget.id });
                }
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Forever"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!resetTarget}
        onOpenChange={(open) => { if (!open) setResetTarget(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will generate a new temporary password for this user.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button
              disabled={resetPasswordMutation.isPending}
              data-testid="button-confirm-reset-password"
              onClick={() => { if (resetTarget) resetPasswordMutation.mutate(resetTarget); }}
            >
              {resetPasswordMutation.isPending ? "Resetting..." : "Generate Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!tempPassword}
        onOpenChange={(open) => { if (!open) setTempPassword(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary Password</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Share this temporary password with the user. They should change it on first login.
          </p>
          <div className="flex items-center gap-2">
            <Input value={tempPassword || ""} readOnly className="font-mono" data-testid="input-temp-password" />
            <Button
              variant="outline"
              size="icon"
              data-testid="button-copy-password"
              onClick={() => {
                if (tempPassword) {
                  navigator.clipboard.writeText(tempPassword);
                  toast({ title: "Copied to clipboard" });
                }
              }}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setTempPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
