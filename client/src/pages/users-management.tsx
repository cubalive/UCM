import { useState, useEffect } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Users, Search, Key, Mail, Copy, Archive, MapPin, Power, RotateCcw, Filter, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { apiFetch } from "@/lib/api";
import { AddressAutocomplete, StructuredAddress } from "@/components/address-autocomplete";

const ALL_ROLES = [
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "ADMIN",
  "DISPATCH",
  "DRIVER",
  "VIEWER",
  "CLINIC_USER",
  "CLINIC_ADMIN",
  "CLINIC_VIEWER",
  "CLINIC_STAFF",
];

export default function UsersPage() {
  const { token, user: currentUser } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [tempPasswordInfo, setTempPasswordInfo] = useState<{ email: string; password: string } | null>(null);
  const [cityPermsUser, setCityPermsUser] = useState<any | null>(null);

  const [roleFilter, setRoleFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [clinicFilter, setClinicFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [showFilters, setShowFilters] = useState(false);

  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";

  const { data: usersData, isLoading } = useQuery<any[]>({
    queryKey: ["/api/users", isSuperAdmin],
    queryFn: () => apiFetch(`/api/users${isSuperAdmin ? "?includeInactive=true" : ""}`, token),
    enabled: !!token,
  });

  const { data: citiesData } = useQuery<any[]>({
    queryKey: ["/api/cities"],
    queryFn: () => apiFetch("/api/cities", token),
    enabled: !!token,
  });

  const { data: companiesData } = useQuery<any[]>({
    queryKey: ["/api/companies"],
    queryFn: () => apiFetch("/api/companies", token),
    enabled: !!token && isSuperAdmin,
  });

  const { data: clinicsData } = useQuery<any[]>({
    queryKey: ["/api/clinics"],
    queryFn: async () => {
      try {
        return await apiFetch("/api/clinics", token);
      } catch {
        return [];
      }
    },
    enabled: !!token,
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (userId: number) =>
      apiFetch(`/api/admin/users/${userId}/reset-password`, token, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data: any) => {
      if (data?.tempPassword) {
        setTempPasswordInfo({ email: "", password: data.tempPassword });
      }
      toast({ title: "Password reset", description: "New credentials emailed to user" });
    },
    onError: (err: any) => toast({ title: "Failed to reset password", description: err.message, variant: "destructive" }),
  });

  const sendLoginLinkMutation = useMutation({
    mutationFn: ({ targetType, targetId }: { targetType: string; targetId: number }) =>
      apiFetch("/api/admin/send-login-link", token, {
        method: "POST",
        body: JSON.stringify({ targetType, targetId: String(targetId) }),
      }),
    onSuccess: (data: any) => {
      toast({ title: "Login link sent", description: data.message });
    },
    onError: (err: any) => toast({ title: "Failed to send login link", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: (userId: number) =>
      apiFetch(`/api/admin/users/${userId}/archive`, token, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User archived", description: "User has been moved to the archive" });
    },
    onError: (err: any) => toast({ title: "Archive failed", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/users", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setOpen(false);
      toast({ title: "User created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const companiesMap = new Map<number, string>();
  (companiesData || []).forEach((c: any) => {
    companiesMap.set(c.id, c.name);
  });

  const citiesMap = new Map<number, string>();
  (citiesData || []).forEach((c: any) => {
    citiesMap.set(c.id, `${c.name}, ${c.state}`);
  });

  const clinicsMap = new Map<number, string>();
  (clinicsData || []).forEach((c: any) => {
    clinicsMap.set(c.id, c.name);
  });

  const uniqueRoles = [...new Set((usersData || []).map((u: any) => u.role))].sort();
  const uniqueCompanyIds = [...new Set((usersData || []).filter((u: any) => u.companyId).map((u: any) => u.companyId))];
  const uniqueClinicIds = [...new Set((usersData || []).filter((u: any) => u.clinicId).map((u: any) => u.clinicId))];

  const filtered = usersData?.filter((u: any) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const nameMatch = `${u.firstName} ${u.lastName}`.toLowerCase().includes(q);
      const emailMatch = u.email?.toLowerCase().includes(q);
      const idMatch = u.publicId?.toLowerCase().includes(q);
      if (!nameMatch && !emailMatch && !idMatch) return false;
    }

    if (roleFilter !== "all" && u.role !== roleFilter) return false;

    if (companyFilter !== "all") {
      if (companyFilter === "none") {
        if (u.companyId) return false;
      } else {
        if (String(u.companyId) !== companyFilter) return false;
      }
    }

    if (cityFilter !== "all" && String(u.workingCityId) !== cityFilter) return false;

    if (clinicFilter !== "all") {
      if (clinicFilter === "none") {
        if (u.clinicId) return false;
      } else {
        if (String(u.clinicId) !== clinicFilter) return false;
      }
    }

    if (statusFilter === "active" && !u.active) return false;
    if (statusFilter === "inactive" && u.active) return false;

    return true;
  });

  const activeFilterCount = [
    roleFilter !== "all" ? 1 : 0,
    companyFilter !== "all" ? 1 : 0,
    cityFilter !== "all" ? 1 : 0,
    clinicFilter !== "all" ? 1 : 0,
    statusFilter !== "active" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  function clearFilters() {
    setRoleFilter("all");
    setCompanyFilter("all");
    setCityFilter("all");
    setClinicFilter("all");
    setStatusFilter("active");
    setSearch("");
  }

  const roleColors: Record<string, string> = {
    SUPER_ADMIN: "default",
    ADMIN: "default",
    COMPANY_ADMIN: "default",
    DISPATCH: "secondary",
    DRIVER: "secondary",
    VIEWER: "secondary",
    CLINIC_USER: "secondary",
    CLINIC_ADMIN: "default",
    CLINIC_VIEWER: "secondary",
    CLINIC_STAFF: "secondary",
  };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage system users</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-user"><Plus className="w-4 h-4 mr-2" />Add User</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
            <UserForm cities={citiesData || []} companies={companiesData || []} clinics={clinicsData || []} onSubmit={(d) => createMutation.mutate(d)} loading={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name, email, or ID..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-users" />
        </div>
        <Button
          variant={showFilters ? "default" : "outline"}
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          data-testid="button-toggle-filters"
        >
          <Filter className="w-4 h-4 mr-1" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs">{activeFilterCount}</Badge>
          )}
        </Button>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
            <X className="w-4 h-4 mr-1" />
            Clear
          </Button>
        )}
        <div className="text-sm text-muted-foreground">
          {filtered?.length || 0} users
        </div>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="py-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Role</Label>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="h-9" data-testid="select-filter-role">
                    <SelectValue placeholder="All roles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    {uniqueRoles.map((role: string) => (
                      <SelectItem key={role} value={role}>{role.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isSuperAdmin && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Company</Label>
                  <Select value={companyFilter} onValueChange={setCompanyFilter}>
                    <SelectTrigger className="h-9" data-testid="select-filter-company">
                      <SelectValue placeholder="All companies" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Companies</SelectItem>
                      <SelectItem value="none">No Company</SelectItem>
                      {uniqueCompanyIds.map((cid: number) => (
                        <SelectItem key={cid} value={String(cid)}>
                          {companiesMap.get(cid) || `Company #${cid}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">City</Label>
                <Select value={cityFilter} onValueChange={setCityFilter}>
                  <SelectTrigger className="h-9" data-testid="select-filter-city">
                    <SelectValue placeholder="All cities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Cities</SelectItem>
                    {(citiesData || []).filter((c: any) => c.active !== false).map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}, {c.state}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {uniqueClinicIds.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Clinic</Label>
                  <Select value={clinicFilter} onValueChange={setClinicFilter}>
                    <SelectTrigger className="h-9" data-testid="select-filter-clinic">
                      <SelectValue placeholder="All clinics" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Clinics</SelectItem>
                      <SelectItem value="none">No Clinic</SelectItem>
                      {uniqueClinicIds.map((cid: number) => (
                        <SelectItem key={cid} value={String(cid)}>
                          {clinicsMap.get(cid) || `Clinic #${cid}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9" data-testid="select-filter-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active Only</SelectItem>
                    <SelectItem value="inactive">Inactive Only</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : !filtered?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No users found</p>
            {activeFilterCount > 0 && (
              <Button variant="link" onClick={clearFilters} className="mt-2">Clear filters</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((u: any) => (
            <Card key={u.id} className={!u.active ? "opacity-60" : ""}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <p className="font-medium" data-testid={`text-user-fullname-${u.id}`}>{u.firstName} {u.lastName}</p>
                    <p className="text-xs font-mono text-muted-foreground">{u.publicId}</p>
                    <p className="text-sm text-muted-foreground">{u.email}</p>
                    {isSuperAdmin && u.companyId && (
                      <p className="text-xs text-muted-foreground">
                        {companiesMap.get(u.companyId) || `Company #${u.companyId}`}
                      </p>
                    )}
                    {u.workingCityId && (
                      <p className="text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3 inline mr-1" />
                        {citiesMap.get(u.workingCityId) || `City #${u.workingCityId}`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge variant={roleColors[u.role] as any || "secondary"} data-testid={`badge-user-role-${u.id}`}>
                      {u.role.replace(/_/g, " ")}
                    </Badge>
                    <Badge variant={u.active ? "secondary" : "destructive"} data-testid={`badge-user-status-${u.id}`}>
                      {u.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
                {currentUser?.role === "SUPER_ADMIN" && u.email && u.role !== "SUPER_ADMIN" && (
                  <div className="mt-3 pt-3 border-t flex items-center gap-2 flex-wrap">
                    {(u.role === "DISPATCH" || u.role === "ADMIN" || u.role === "COMPANY_ADMIN") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => sendLoginLinkMutation.mutate({ targetType: "dispatch", targetId: u.id })}
                        disabled={sendLoginLinkMutation.isPending}
                        data-testid={`button-send-login-link-${u.id}`}
                      >
                        <Mail className="w-3 h-3 mr-2" />
                        Send Login Link
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resetPasswordMutation.mutate(u.id)}
                      disabled={resetPasswordMutation.isPending}
                      data-testid={`button-reset-password-${u.id}`}
                    >
                      <Key className="w-3 h-3 mr-2" />
                      Reset Password
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (window.confirm(`Archive user ${u.firstName} ${u.lastName}? This will disable their access.`)) {
                          archiveMutation.mutate(u.id);
                        }
                      }}
                      disabled={archiveMutation.isPending}
                      data-testid={`button-archive-user-${u.id}`}
                    >
                      <Archive className="w-3 h-3 mr-2" />
                      Archive
                    </Button>
                    {u.role === "DISPATCH" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCityPermsUser(u)}
                        data-testid={`button-city-perms-${u.id}`}
                      >
                        <MapPin className="w-3 h-3 mr-2" />
                        City Access
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {cityPermsUser && (
        <DispatcherCityPermsDialog
          user={cityPermsUser}
          token={token}
          onClose={() => setCityPermsUser(null)}
        />
      )}
      {tempPasswordInfo && (
        <Dialog open={!!tempPasswordInfo} onOpenChange={() => setTempPasswordInfo(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Password Reset</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                A new temporary password has been generated and emailed to the user.
              </p>
              <div className="flex items-center gap-2 bg-muted p-3 rounded-md font-mono text-sm">
                <span className="flex-1 break-all" data-testid="text-temp-password">{tempPasswordInfo.password}</span>
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
              <Button className="w-full" onClick={() => setTempPasswordInfo(null)} data-testid="button-close-temp-password">
                Done
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function DispatcherCityPermsDialog({
  user,
  token,
  onClose,
}: {
  user: any;
  token: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [selectedCities, setSelectedCities] = useState<number[]>([]);

  const { data: currentPerms, isLoading: permsLoading } = useQuery<{
    allowedCityIds: number[];
    companyId: number;
  }>({
    queryKey: ["/api/company/dispatchers", user.id, "permissions"],
    queryFn: () =>
      apiFetch(
        `/api/company/dispatchers/${user.id}/permissions`,
        token,
      ),
    enabled: !!token && !!user.id,
  });

  const dispatcherCompanyId = currentPerms?.companyId;

  const { data: companyCities, isLoading: citiesLoading } = useQuery<
    Array<{ cityId: number; cityName: string }>
  >({
    queryKey: ["/api/company/cities", dispatcherCompanyId],
    queryFn: () =>
      apiFetch(
        `/api/company/cities?companyId=${dispatcherCompanyId}`,
        token,
      ),
    enabled: !!token && !!dispatcherCompanyId,
  });

  useEffect(() => {
    if (currentPerms) {
      setSelectedCities(currentPerms.allowedCityIds);
    }
  }, [currentPerms]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/company/dispatchers/${user.id}/permissions`,
        token,
        {
          method: "PUT",
          body: JSON.stringify({ allowedCityIds: selectedCities }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/company/dispatchers", user.id, "permissions"],
      });
      toast({
        title: "Permissions updated",
        description: `City access for ${user.firstName} ${user.lastName} has been saved.`,
      });
      onClose();
    },
    onError: (err: any) =>
      toast({
        title: "Failed to save",
        description: err.message,
        variant: "destructive",
      }),
  });

  const toggleCity = (cityId: number) => {
    setSelectedCities((prev) =>
      prev.includes(cityId)
        ? prev.filter((id) => id !== cityId)
        : [...prev, cityId],
    );
  };

  const isLoading = citiesLoading || permsLoading;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            City Access: {user.firstName} {user.lastName}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Select which cities this dispatcher can access. They will only see trips, drivers, vehicles, and patients in these cities.
        </p>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : !companyCities?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No cities configured for this company.
          </p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto border rounded-md p-3">
            {companyCities.map((c) => (
              <label
                key={c.cityId}
                className="flex items-center gap-3 py-1 px-1 rounded hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={selectedCities.includes(c.cityId)}
                  onCheckedChange={() => toggleCity(c.cityId)}
                  data-testid={`checkbox-city-${c.cityId}`}
                />
                <span className="text-sm">{c.cityName}</span>
              </label>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            {selectedCities.length} {selectedCities.length === 1 ? "city" : "cities"} selected
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              data-testid="button-cancel-city-perms"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid="button-save-city-perms"
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CREATABLE_ROLES: { value: string; label: string; group: string }[] = [
  { value: "COMPANY_ADMIN", label: "Company Admin", group: "Company" },
  { value: "ADMIN", label: "Admin", group: "Company" },
  { value: "DISPATCH", label: "Dispatch", group: "Company" },
  { value: "DRIVER", label: "Driver", group: "Company" },
  { value: "VIEWER", label: "Viewer", group: "Company" },
  { value: "CLINIC_ADMIN", label: "Clinic Admin", group: "Clinic" },
  { value: "CLINIC_USER", label: "Clinic User", group: "Clinic" },
  { value: "CLINIC_VIEWER", label: "Clinic Viewer", group: "Clinic" },
];

const CLINIC_ROLES = new Set(["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"]);
const COMPANY_ROLES = new Set(["COMPANY_ADMIN", "ADMIN", "DISPATCH", "DRIVER", "VIEWER"]);

function UserForm({ cities, companies, clinics, onSubmit, loading }: { cities: any[]; companies: any[]; clinics: any[]; onSubmit: (data: any) => void; loading: boolean }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({
    email: "", password: "", firstName: "", lastName: "", role: "VIEWER", phone: "", cityIds: [] as string[], companyId: "", clinicId: "",
  });
  const [showNewClinic, setShowNewClinic] = useState(false);
  const [newClinic, setNewClinic] = useState({ name: "", address: "", cityId: "", companyId: "" });
  const [creatingClinic, setCreatingClinic] = useState(false);
  const [newClinicAddr, setNewClinicAddr] = useState<StructuredAddress | null>(null);

  const isClinicRole = CLINIC_ROLES.has(form.role);
  const isCompanyRole = COMPANY_ROLES.has(form.role);

  const filteredClinics = form.companyId
    ? clinics.filter((c: any) => String(c.companyId) === form.companyId)
    : clinics;

  const handleRoleChange = (role: string) => {
    const updates: any = { role };
    if (CLINIC_ROLES.has(role) && !CLINIC_ROLES.has(form.role)) {
      updates.cityIds = [];
    }
    if (!CLINIC_ROLES.has(role)) {
      updates.clinicId = "";
    }
    if (!COMPANY_ROLES.has(role) && !CLINIC_ROLES.has(role)) {
      updates.companyId = "";
    }
    setForm((prev) => ({ ...prev, ...updates }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {
      email: form.email,
      password: form.password,
      firstName: form.firstName,
      lastName: form.lastName,
      role: form.role,
      phone: form.phone || null,
      cityIds: form.cityIds.map(Number),
    };
    if (form.companyId) payload.companyId = Number(form.companyId);
    if (form.clinicId) payload.clinicId = Number(form.clinicId);
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>First Name *</Label>
          <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required data-testid="input-user-first" />
        </div>
        <div className="space-y-2">
          <Label>Last Name *</Label>
          <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required data-testid="input-user-last" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Email *</Label>
        <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required data-testid="input-user-email" />
      </div>
      <div className="space-y-2">
        <Label>Password *</Label>
        <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required data-testid="input-user-password" />
      </div>
      <div className="space-y-2">
        <Label>Role *</Label>
        <Select value={form.role} onValueChange={handleRoleChange}>
          <SelectTrigger data-testid="select-user-role"><SelectValue /></SelectTrigger>
          <SelectContent>
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Company Roles</div>
            {CREATABLE_ROLES.filter(r => r.group === "Company").map(r => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-1">Clinic Roles</div>
            {CREATABLE_ROLES.filter(r => r.group === "Clinic").map(r => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {(isCompanyRole || isClinicRole) && companies.length > 0 && (
        <div className="space-y-2">
          <Label>Company {isCompanyRole ? "*" : ""}</Label>
          <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v, clinicId: "" })}>
            <SelectTrigger data-testid="select-user-company"><SelectValue placeholder="Select company" /></SelectTrigger>
            <SelectContent>
              {companies.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {isClinicRole && (
        <div className="space-y-2">
          <Label>Clinic *</Label>
          <Select value={form.clinicId} onValueChange={(v) => setForm({ ...form, clinicId: v })}>
            <SelectTrigger data-testid="select-user-clinic"><SelectValue placeholder="Select clinic" /></SelectTrigger>
            <SelectContent>
              {filteredClinics.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  {form.companyId ? "No clinics for this company" : "No clinics available"}
                </div>
              )}
              {filteredClinics.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full mt-1"
            onClick={() => {
              setNewClinic({ name: "", address: "", cityId: "", companyId: form.companyId });
              setNewClinicAddr(null);
              setShowNewClinic(true);
            }}
            data-testid="button-create-new-clinic"
          >
            <Plus className="w-4 h-4 mr-1" /> Create New Clinic
          </Button>
          {showNewClinic && (
            <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
              <div className="text-sm font-medium">New Clinic</div>
              <Input
                placeholder="Clinic name *"
                value={newClinic.name}
                onChange={(e) => setNewClinic({ ...newClinic, name: e.target.value })}
                data-testid="input-new-clinic-name"
              />
              <AddressAutocomplete
                label="Address"
                value={newClinicAddr}
                onSelect={(addr) => {
                  setNewClinicAddr(addr);
                  if (addr) setNewClinic({ ...newClinic, address: addr.formattedAddress });
                  else setNewClinic({ ...newClinic, address: "" });
                }}
                token={token}
                testIdPrefix="new-clinic"
                required
                allowManualOverride
              />
              <Select value={newClinic.cityId} onValueChange={(v) => setNewClinic({ ...newClinic, cityId: v })}>
                <SelectTrigger data-testid="select-new-clinic-city"><SelectValue placeholder="Select city *" /></SelectTrigger>
                <SelectContent>
                  {cities.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}, {c.state}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!form.companyId && companies.length > 0 && (
                <Select value={newClinic.companyId} onValueChange={(v) => setNewClinic({ ...newClinic, companyId: v })}>
                  <SelectTrigger data-testid="select-new-clinic-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={creatingClinic || !newClinic.name || !newClinic.address || !newClinic.cityId}
                  onClick={async () => {
                    setCreatingClinic(true);
                    try {
                      const body: any = { name: newClinic.name, address: newClinic.address, cityId: Number(newClinic.cityId) };
                      if (newClinicAddr) {
                        body.lat = newClinicAddr.lat;
                        body.lng = newClinicAddr.lng;
                        body.addressStreet = newClinicAddr.street;
                        body.addressCity = newClinicAddr.city;
                        body.addressState = newClinicAddr.state;
                        body.addressZip = newClinicAddr.zip;
                        body.addressPlaceId = newClinicAddr.placeId;
                      }
                      const compId = form.companyId || newClinic.companyId;
                      if (compId) body.companyId = Number(compId);
                      const created = await apiFetch("/api/clinics", token, { method: "POST", body: JSON.stringify(body) });
                      queryClient.invalidateQueries({ queryKey: ["/api/clinics"] });
                      setForm((prev) => ({ ...prev, clinicId: String(created.id), companyId: compId || prev.companyId }));
                      setShowNewClinic(false);
                      toast({ title: "Clinic created", description: created.name });
                    } catch (err: any) {
                      toast({ title: "Error", description: err.message || "Failed to create clinic", variant: "destructive" });
                    } finally {
                      setCreatingClinic(false);
                    }
                  }}
                  data-testid="button-save-new-clinic"
                >
                  {creatingClinic ? "Creating..." : "Save Clinic"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewClinic(false)} data-testid="button-cancel-new-clinic">
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="space-y-2">
        <Label>Phone</Label>
        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-user-phone" />
      </div>
      {cities.length > 0 && !isClinicRole && (
        <div className="space-y-2">
          <Label>City Access</Label>
          <div className="space-y-2 max-h-32 overflow-y-auto border rounded-md p-2">
            {cities.map((c: any) => (
              <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.cityIds.includes(c.id.toString())}
                  onChange={(e) => {
                    const id = c.id.toString();
                    setForm({
                      ...form,
                      cityIds: e.target.checked ? [...form.cityIds, id] : form.cityIds.filter((i) => i !== id),
                    });
                  }}
                />
                {c.name}, {c.state}
              </label>
            ))}
          </div>
        </div>
      )}
      <Button type="submit" className="w-full" disabled={loading || (isClinicRole && !form.clinicId)} data-testid="button-submit-user">
        {loading ? "Creating..." : "Create User"}
      </Button>
    </form>
  );
}
