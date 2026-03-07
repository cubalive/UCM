import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, resolveUrl } from "@/lib/api";
import {
  ArrowLeft,
  User,
  Car,
  Clock,
  Shield,
  Building2,
  Phone,
  Mail,
  Hash,
  Pencil,
  Save,
  X,
  Lock,
  WifiOff,
} from "lucide-react";
import { useLocation } from "wouter";

const PROFILE_CACHE_KEY = "ucm_driver_profile_cache";

function getCachedProfile(): any | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedProfile(data: any) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data));
  } catch {}
}

function getInitials(firstName?: string, lastName?: string): string {
  const f = (firstName || "").trim().charAt(0).toUpperCase();
  const l = (lastName || "").trim().charAt(0).toUpperCase();
  return f + l || "?";
}

function formatShiftDuration(startedAt: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function capabilityBadge(cap: string) {
  switch (cap) {
    case "wheelchair":
      return { label: "Wheelchair", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800" };
    case "both":
      return { label: "Sedan + Wheelchair", className: "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 border-purple-200 dark:border-purple-800" };
    default:
      return { label: "Sedan", className: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300 border-green-200 dark:border-green-800" };
  }
}

export default function DriverProfilePage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", phone: "" });
  const [shiftTick, setShiftTick] = useState(0);
  const [isOffline, setIsOffline] = useState(false);

  const profileQuery = useQuery<any>({
    queryKey: ["/api/driver/me"],
    queryFn: () => apiFetch("/api/driver/me", token),
    enabled: !!token,
    staleTime: 30000,
    retry: 1,
  });

  useEffect(() => {
    if (profileQuery.data) {
      setCachedProfile(profileQuery.data);
      setIsOffline(false);
    } else if (profileQuery.isError) {
      setIsOffline(true);
    }
  }, [profileQuery.data, profileQuery.isError]);

  const data = profileQuery.data || (isOffline ? getCachedProfile() : null);
  const d = data?.driver;
  const settings = data?.settings;

  useEffect(() => {
    if (!d?.shift?.startedAt || d?.shift?.status !== "ON_SHIFT") return;
    const iv = setInterval(() => setShiftTick((t) => t + 1), 60000);
    return () => clearInterval(iv);
  }, [d?.shift?.startedAt, d?.shift?.status]);

  const updateMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await fetch(resolveUrl("/api/driver/me"), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message || "Update failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/profile"] });
      setEditing(false);
      toast({ title: "Profile updated" });
    },
    onError: (err: any) =>
      toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const startEdit = () => {
    if (!d) return;
    setEditForm({
      firstName: d.firstName || "",
      lastName: d.lastName || "",
      phone: d.phone || "",
    });
    setEditing(true);
  };

  const handleSave = () => {
    const payload: any = {};
    if (editForm.firstName.trim()) payload.firstName = editForm.firstName.trim();
    if (editForm.lastName.trim()) payload.lastName = editForm.lastName.trim();
    if (editForm.phone.trim()) payload.phone = editForm.phone.trim();
    updateMutation.mutate(payload);
  };

  if (profileQuery.isLoading && !data) {
    return (
      <div className="min-h-screen bg-background" data-testid="div-profile-page-loading">
        <div className="sticky top-0 z-30 bg-background border-b px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/driver")} data-testid="button-profile-back" className="min-w-[44px] min-h-[44px]">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-semibold">My Profile</h1>
        </div>
        <div className="p-4 space-y-4 max-w-lg mx-auto">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!d) {
    return (
      <div className="min-h-screen bg-background" data-testid="div-profile-page-error">
        <div className="sticky top-0 z-30 bg-background border-b px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/driver")} data-testid="button-profile-back-error" className="min-w-[44px] min-h-[44px]">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-semibold">My Profile</h1>
        </div>
        <div className="p-4 text-center text-muted-foreground mt-12" data-testid="text-profile-unavailable">
          <User className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium">Profile unavailable</p>
          <p className="text-sm mt-1">Please try again later</p>
          <Button variant="outline" className="mt-4" onClick={() => profileQuery.refetch()} data-testid="button-retry-profile">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const initials = getInitials(d.firstName, d.lastName);
  const cap = capabilityBadge(d.vehicleCapability || "sedan");
  const isOnShift = d.shift?.status === "ON_SHIFT";
  const vehCategory = d.assignedVehicle?.category;

  return (
    <div className="min-h-screen bg-background pb-6" data-testid="div-profile-page">
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/driver")} data-testid="button-profile-back" className="min-w-[44px] min-h-[44px]">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-semibold flex-1">My Profile</h1>
        {!editing && !isOffline && (
          <Button variant="ghost" size="icon" onClick={startEdit} data-testid="button-edit-profile" className="min-w-[44px] min-h-[44px]">
            <Pencil className="w-5 h-5" />
          </Button>
        )}
      </div>

      {isOffline && (
        <div className="mx-4 mt-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 flex items-center gap-3" data-testid="banner-offline-mode">
          <WifiOff className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Offline Mode</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">Showing cached data. Editing disabled.</p>
          </div>
        </div>
      )}

      <div className="p-4 space-y-4 max-w-lg mx-auto">
        <div className="flex items-center gap-4 py-2" data-testid="div-profile-header">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 border-2 border-primary/20">
            {d.photoUrl ? (
              <img
                src={d.photoUrl}
                alt="Profile"
                className="w-20 h-20 rounded-full object-cover"
                data-testid="img-profile-avatar"
              />
            ) : (
              <span className="text-2xl font-bold text-primary" data-testid="text-profile-initials">
                {initials}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-2xl font-bold truncate" data-testid="text-profile-display-name">
              {d.displayName || `${d.firstName || ""} ${d.lastName || ""}`.trim()}
            </p>
            {d.company?.name && (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5" data-testid="text-profile-company">
                <Building2 className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{d.company.name}</span>
              </p>
            )}
          </div>
        </div>

        {editing && (
          <Card data-testid="card-edit-profile">
            <CardContent className="py-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-base">Edit Profile</span>
                <Button variant="ghost" size="icon" onClick={() => setEditing(false)} data-testid="button-cancel-edit" className="min-w-[44px] min-h-[44px]">
                  <X className="w-5 h-5" />
                </Button>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">First Name</Label>
                <Input
                  value={editForm.firstName}
                  onChange={(e) => setEditForm((p) => ({ ...p, firstName: e.target.value }))}
                  className="mt-1"
                  data-testid="input-edit-firstname"
                />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Last Name</Label>
                <Input
                  value={editForm.lastName}
                  onChange={(e) => setEditForm((p) => ({ ...p, lastName: e.target.value }))}
                  className="mt-1"
                  data-testid="input-edit-lastname"
                />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Phone</Label>
                <Input
                  value={editForm.phone}
                  onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))}
                  className="mt-1"
                  data-testid="input-edit-phone"
                />
              </div>
              <Button
                className="w-full min-h-[48px] text-base"
                onClick={handleSave}
                disabled={updateMutation.isPending}
                data-testid="button-save-profile"
              >
                <Save className="w-5 h-5 mr-2" />
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card data-testid="card-professional-info">
          <CardContent className="py-4 space-y-3">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Professional Info</p>
            <div className="space-y-2.5">
              <div className="flex items-center gap-3" data-testid="row-driver-id">
                <Hash className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Driver ID</p>
                  <p className="font-mono text-sm font-medium" data-testid="text-driver-id">{d.publicId}</p>
                </div>
              </div>
              <div className="flex items-center gap-3" data-testid="row-driver-phone">
                <Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <p className="text-sm font-medium" data-testid="text-driver-phone">{d.phone || "Not set"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3" data-testid="row-driver-email">
                <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="text-sm font-medium truncate" data-testid="text-driver-email">{d.email || data?.user?.email || "Not set"}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-capability">
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Vehicle Capability</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={`text-sm px-3 py-1 ${cap.className}`} data-testid="badge-capability">
                {cap.label}
              </Badge>
              {settings?.lockDriverCapability && (
                <span className="text-xs text-muted-foreground flex items-center gap-1" data-testid="text-capability-locked">
                  <Lock className="w-3 h-3" /> Company managed
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {d.assignedVehicle && (
          <Card data-testid="card-vehicle">
            <CardContent className="py-4 space-y-2">
              <div className="flex items-center gap-2">
                <Car className="w-4 h-4 text-primary" />
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Assigned Vehicle</p>
              </div>
              <p className="text-lg font-semibold" data-testid="text-vehicle-name">{d.assignedVehicle.name}</p>
              <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
                <span className="font-mono" data-testid="text-vehicle-plate">{d.assignedVehicle.plate}</span>
                {d.assignedVehicle.make && (
                  <span>
                    {d.assignedVehicle.make} {d.assignedVehicle.model} {d.assignedVehicle.year}
                  </span>
                )}
              </div>
              {vehCategory && (
                <Badge
                  variant="outline"
                  className={
                    vehCategory === "WHEELCHAIR"
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                      : vehCategory === "BOTH"
                        ? "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                        : "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                  }
                  data-testid="badge-vehicle-category"
                >
                  {vehCategory === "WHEELCHAIR" ? "Wheelchair Van" : vehCategory === "BOTH" ? "Multi-Category" : "Sedan"}
                </Badge>
              )}
              {d.assignedVehicle.color && (
                <div className="flex items-center gap-2 mt-1">
                  <div
                    className="w-5 h-5 rounded-full border border-border"
                    style={{ backgroundColor: d.assignedVehicle.color }}
                  />
                  <span className="text-xs text-muted-foreground">Vehicle color</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card data-testid="card-shift-status">
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Shift Status</p>
            </div>
            <div className="flex items-center gap-3">
              {isOnShift ? (
                <>
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300 border-green-200 dark:border-green-800" data-testid="badge-shift-on">
                    ON SHIFT
                  </Badge>
                  {d.shift?.startedAt && (
                    <span className="text-sm text-muted-foreground" data-testid="text-shift-duration">
                      {formatShiftDuration(d.shift.startedAt)}
                    </span>
                  )}
                </>
              ) : (
                <Badge variant="secondary" className="text-muted-foreground" data-testid="badge-shift-off">
                  OFF SHIFT
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
