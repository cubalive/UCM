import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { setStoredCompanyScopeId, getStoredCompanyScopeId } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Building2, Plus, UserPlus, Crosshair, X, CreditCard, ExternalLink, CheckCircle2, AlertCircle, Loader2, Search, Archive, RotateCcw, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Company, UsState, UsCity } from "@shared/schema";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Indiana/Indianapolis",
];

function CreateCompanyDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const [selectedCityId, setSelectedCityId] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [cityTimezone, setCityTimezone] = useState("America/Los_Angeles");
  const { toast } = useToast();

  const { data: statesData } = useQuery<{ ok: boolean; items: UsState[] }>({
    queryKey: ["/api/locations/states"],
  });
  const states = statesData?.items || [];

  const citiesUrl = selectedState
    ? `/api/locations/cities?state=${selectedState}${citySearch.trim() ? `&search=${encodeURIComponent(citySearch.trim())}` : ""}`
    : null;
  const { data: citiesData, isLoading: citiesLoading } = useQuery<{ ok: boolean; items: UsCity[] }>({
    queryKey: ["/api/locations/cities", selectedState, citySearch],
    queryFn: async () => {
      const res = await apiRequest("GET", citiesUrl!);
      return res.json();
    },
    enabled: !!selectedState && !!citiesUrl,
  });
  const citiesList = citiesData?.items || [];

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/companies", {
        name: name.trim(),
        usCityId: parseInt(selectedCityId),
        cityTimezone,
      });
    },
    onSuccess: () => {
      toast({ title: "Company created successfully" });
      setName("");
      setSelectedState("");
      setSelectedCityId("");
      setCitySearch("");
      setCityTimezone("America/Los_Angeles");
      setOpen(false);
      onCreated();
      queryClient.invalidateQueries({ queryKey: ["/api/cities"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create company", description: err.message, variant: "destructive" });
    },
  });

  const handleStateChange = (val: string) => {
    setSelectedState(val);
    setSelectedCityId("");
    setCitySearch("");
  };

  const canSubmit = name.trim() && selectedCityId;

  const selectedCityObj = citiesList.find(c => String(c.id) === selectedCityId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-create-company">
          <Plus className="w-4 h-4 mr-2" />
          New Company
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Company</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="company-name">Company Name</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Metro Medical Transport"
              data-testid="input-company-name"
            />
          </div>
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3">Primary City (required)</p>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>State</Label>
                <Select value={selectedState} onValueChange={handleStateChange}>
                  <SelectTrigger data-testid="select-company-state">
                    <SelectValue placeholder="Select a state..." />
                  </SelectTrigger>
                  <SelectContent>
                    {states.map((s) => (
                      <SelectItem key={s.code} value={s.code} data-testid={`select-state-${s.code}`}>
                        {s.name} ({s.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedState && (
                <div className="space-y-2">
                  <Label>City</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      value={citySearch}
                      onChange={(e) => setCitySearch(e.target.value)}
                      placeholder="Search cities..."
                      className="pl-8"
                      data-testid="input-city-search"
                    />
                  </div>
                  {citiesLoading ? (
                    <Skeleton className="h-9 w-full" />
                  ) : (
                    <Select value={selectedCityId} onValueChange={setSelectedCityId}>
                      <SelectTrigger data-testid="select-company-city">
                        <SelectValue placeholder="Select a city..." />
                      </SelectTrigger>
                      <SelectContent>
                        {citiesList.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)} data-testid={`select-city-${c.id}`}>
                            {c.city}, {c.stateCode}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {selectedCityObj && (
                <div className="text-sm text-muted-foreground bg-muted rounded-md px-3 py-2" data-testid="text-selected-city">
                  Selected: {selectedCityObj.city}, {selectedCityObj.stateCode}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="city-timezone">Timezone</Label>
                <Select value={cityTimezone} onValueChange={setCityTimezone}>
                  <SelectTrigger data-testid="select-city-timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map(tz => (
                      <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!canSubmit || createMutation.isPending}
            className="w-full"
            data-testid="button-submit-company"
          >
            {createMutation.isPending ? "Creating..." : "Create Company"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateAdminDialog({ company, onCreated }: { company: Company; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string } | null>(null);
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async () => {
      const pw = password.trim() || Math.random().toString(36).slice(2, 10) + "A1!";
      const res = await apiRequest("POST", `/api/companies/${company.id}/admin`, {
        email: email.trim().toLowerCase(),
        password: pw,
        firstName: firstName.trim() || "Company",
        lastName: lastName.trim() || "Admin",
      });
      const data = await res.json();
      return { ...data, password: pw };
    },
    onSuccess: (data) => {
      toast({ title: "Company Admin created" });
      setCreatedCreds({ email: data.email, password: data.password });
      onCreated();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create admin", description: err.message, variant: "destructive" });
    },
  });

  const handleClose = (val: boolean) => {
    if (!val) {
      setEmail("");
      setPassword("");
      setFirstName("");
      setLastName("");
      setCreatedCreds(null);
    }
    setOpen(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-create-admin-${company.id}`}>
          <UserPlus className="w-4 h-4 mr-1" />
          Admin
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Admin for {company.name}</DialogTitle>
        </DialogHeader>
        {createdCreds ? (
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">Admin account created. Save these credentials:</p>
            <div className="space-y-2 bg-muted p-3 rounded-md">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">Email:</span>
                <code className="text-sm" data-testid="text-created-admin-email">{createdCreds.email}</code>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">Password:</span>
                <code className="text-sm" data-testid="text-created-admin-password">{createdCreds.password}</code>
              </div>
            </div>
            <Button variant="outline" className="w-full" onClick={() => handleClose(false)} data-testid="button-close-creds">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@company.com"
                data-testid="input-admin-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank to auto-generate"
                data-testid="input-admin-password"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="admin-first">First Name</Label>
                <Input
                  id="admin-first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Optional"
                  data-testid="input-admin-firstname"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-last">Last Name</Label>
                <Input
                  id="admin-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Optional"
                  data-testid="input-admin-lastname"
                />
              </div>
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!email.trim() || createMutation.isPending}
              className="w-full"
              data-testid="button-submit-admin"
            >
              {createMutation.isPending ? "Creating..." : "Create Admin"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StripeConnectBadge({ company }: { company: Company }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const { data: stripeStatus, isLoading: statusLoading, refetch } = useQuery<{
    connected: boolean;
    stripeAccountId?: string;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    detailsSubmitted?: boolean;
    onboardingStatus?: string;
  }>({
    queryKey: ["/api/admin/companies", company.id, "stripe-status"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/companies/${company.id}/stripe/connect/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!token,
  });

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/companies/${company.id}/stripe/connect/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.message, variant: "destructive" });
        return;
      }
      toast({ title: "Stripe account created" });
      refetch();
      handleOnboard();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleOnboard = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/companies/${company.id}/stripe/connect/onboarding-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.message, variant: "destructive" });
        return;
      }
      if (data.url) {
        window.open(data.url, "_blank");
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (statusLoading) {
    return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  }

  if (!stripeStatus?.connected) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={handleCreate}
        disabled={loading}
        data-testid={`button-stripe-setup-${company.id}`}
      >
        <CreditCard className="w-4 h-4 mr-1" />
        {loading ? "..." : "Setup Stripe"}
      </Button>
    );
  }

  if (stripeStatus.onboardingStatus === "ACTIVE" && stripeStatus.chargesEnabled) {
    return (
      <Badge variant="default" data-testid={`badge-stripe-active-${company.id}`}>
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Stripe Active
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <Badge variant="secondary" data-testid={`badge-stripe-restricted-${company.id}`}>
        <AlertCircle className="w-3 h-3 mr-1" />
        Stripe Restricted
      </Badge>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleOnboard}
        disabled={loading}
        data-testid={`button-stripe-onboard-${company.id}`}
      >
        <ExternalLink className="w-3 h-3 mr-1" />
        {loading ? "..." : "Complete"}
      </Button>
    </div>
  );
}

export default function CompaniesPage() {
  const { isSuperAdmin, token, user } = useAuth();
  const { toast } = useToast();
  const [currentScope, setCurrentScope] = useState<string | null>(() => getStoredCompanyScopeId());
  const [showArchived, setShowArchived] = useState(false);

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    enabled: isSuperAdmin,
  });

  const archiveMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/admin/companies/${id}/archive`, token, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company archived" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/admin/companies/${id}/restore`, token, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company restored" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/admin/companies/${id}/permanent`, token, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company permanently deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filteredCompanies = companies.filter((c: any) => {
    const isArchived = !!c.deletedAt;
    if (showArchived) return isArchived;
    return !isArchived;
  });

  const handleSetScope = (company: Company) => {
    setStoredCompanyScopeId(String(company.id));
    setCurrentScope(String(company.id));
    queryClient.invalidateQueries();
    toast({ title: `Scoped to ${company.name}` });
    window.dispatchEvent(new CustomEvent("ucm-scope-changed"));
  };

  const handleClearScope = () => {
    setStoredCompanyScopeId(null);
    setCurrentScope(null);
    queryClient.invalidateQueries();
    toast({ title: "Scope cleared - viewing all companies" });
    window.dispatchEvent(new CustomEvent("ucm-scope-changed"));
  };

  const refreshList = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
  };

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Access denied.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Building2 className="w-6 h-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-companies-title">Companies</h1>
            <p className="text-sm text-muted-foreground">Manage tenants and scope your view</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {currentScope && (
            <Button variant="outline" size="sm" onClick={handleClearScope} data-testid="button-clear-scope">
              <X className="w-4 h-4 mr-1" />
              Clear Scope
            </Button>
          )}
          <CreateCompanyDialog onCreated={refreshList} />
        </div>
      </div>

      {user?.role === "SUPER_ADMIN" && (
        <div className="flex items-center gap-2">
          <Switch
            checked={showArchived}
            onCheckedChange={setShowArchived}
            data-testid="switch-show-archived-companies"
          />
          <Label className="text-sm text-muted-foreground">Show Archived</Label>
        </div>
      )}

      {currentScope && (
        <Card>
          <CardContent className="py-3 flex items-center gap-2 flex-wrap">
            <Crosshair className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-sm font-medium">Active Scope:</span>
            <Badge variant="default" data-testid="badge-active-scope">
              {companies.find(c => String(c.id) === currentScope)?.name || `Company #${currentScope}`}
            </Badge>
            <span className="text-xs text-muted-foreground">All data views are filtered to this company.</span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <CardTitle className="text-lg">All Companies</CardTitle>
          <Badge variant="secondary" data-testid="badge-company-count">{filteredCompanies.length}</Badge>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filteredCompanies.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">{showArchived ? "No archived companies." : "No companies yet. Create one to get started."}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Stripe</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCompanies.map((company: any) => {
                  const isArchived = !!company.deletedAt;
                  return (
                  <TableRow key={company.id} data-testid={`row-company-${company.id}`}>
                    <TableCell className="font-mono text-sm" data-testid={`text-company-id-${company.id}`}>
                      {company.id}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium" data-testid={`text-company-name-${company.id}`}>{company.name}</span>
                        {String(company.id) === currentScope && (
                          <Badge variant="default" className="text-[10px]">SCOPED</Badge>
                        )}
                        {isArchived && (
                          <Badge variant="secondary" className="text-[10px]">ARCHIVED</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StripeConnectBadge company={company} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {company.createdAt ? new Date(company.createdAt).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 justify-end flex-wrap">
                        {!isArchived && (
                          <>
                            {String(company.id) === currentScope ? (
                              <Button size="sm" variant="outline" onClick={handleClearScope} data-testid={`button-unscope-${company.id}`}>
                                <X className="w-4 h-4 mr-1" />
                                Unscope
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => handleSetScope(company)} data-testid={`button-scope-${company.id}`}>
                                <Crosshair className="w-4 h-4 mr-1" />
                                Set Scope
                              </Button>
                            )}
                            <CreateAdminDialog company={company} onCreated={refreshList} />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => archiveMutation.mutate(company.id)}
                              disabled={archiveMutation.isPending}
                              data-testid={`button-archive-company-${company.id}`}
                            >
                              <Archive className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        {isArchived && user?.role === "SUPER_ADMIN" && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => restoreMutation.mutate(company.id)}
                              disabled={restoreMutation.isPending}
                              data-testid={`button-restore-company-${company.id}`}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => {
                                if (window.confirm(`PERMANENTLY delete company ${company.name}? This cannot be undone.`)) {
                                  permanentDeleteMutation.mutate(company.id);
                                }
                              }}
                              disabled={permanentDeleteMutation.isPending}
                              data-testid={`button-permanent-delete-company-${company.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
