import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/timezone";
import { setStoredCompanyScopeId, getStoredCompanyScopeId, rawAuthFetch } from "@/lib/api";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Building2, Plus, UserPlus, Crosshair, X, CreditCard, ExternalLink, CheckCircle2, AlertCircle, Loader2, Search, Archive, RotateCcw, Trash2, MapPin, Phone, Pencil, Upload, ImageIcon } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Company, UsState, UsCity, City } from "@shared/schema";

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
  const { t } = useTranslation();

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
      toast({ title: t("companies.companyCreated") });
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
      toast({ title: t("companies.createFailed"), description: err.message, variant: "destructive" });
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
          {t("companies.newCompany")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("companies.createCompany")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="company-name">{t("companies.companyName")}</Label>
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

function EditCompanyDialog({ company, onUpdated }: { company: Company; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(company.name);
  const [dispatchPhone, setDispatchPhone] = useState((company as any).dispatchPhone || "");
  const [companyTimezone, setCompanyTimezone] = useState((company as any).timezone || "America/Los_Angeles");
  const [logoPreview, setLogoPreview] = useState<string | null>((company as any).logoUrl || null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [brandColor, setBrandColor] = useState((company as any).brandColor || "#10b981");
  const [brandSecondaryColor, setBrandSecondaryColor] = useState((company as any).brandSecondaryColor || "");
  const [brandTagline, setBrandTagline] = useState((company as any).brandTagline || "");
  const [customDomain, setCustomDomain] = useState((company as any).customDomain || "");
  const { token } = useAuth();
  const { toast } = useToast();
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(company.name);
      setDispatchPhone((company as any).dispatchPhone || "");
      setCompanyTimezone((company as any).timezone || "America/Los_Angeles");
      setLogoPreview((company as any).logoUrl || null);
      setBrandColor((company as any).brandColor || "#10b981");
      setBrandSecondaryColor((company as any).brandSecondaryColor || "");
      setBrandTagline((company as any).brandTagline || "");
      setCustomDomain((company as any).customDomain || "");
    }
  }, [open, company]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/admin/companies/${company.id}`, {
        name: name.trim(),
        dispatchPhone: dispatchPhone.trim() || null,
        timezone: companyTimezone,
        brandColor: brandColor.trim() || null,
        brandSecondaryColor: brandSecondaryColor.trim() || null,
        brandTagline: brandTagline.trim() || null,
        customDomain: customDomain.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Company updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      onUpdated();
      setOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 2MB", variant: "destructive" });
      return;
    }
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const res = await rawAuthFetch(`/api/admin/companies/${company.id}/logo`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      const data = await res.json();
      setLogoPreview(data.logoUrl + "?t=" + Date.now());
      toast({ title: "Logo uploaded" });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }

  async function handleLogoDelete() {
    try {
      const res = await rawAuthFetch(`/api/admin/companies/${company.id}/logo`, { method: "DELETE" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      setLogoPreview(null);
      toast({ title: "Logo removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" data-testid={`button-edit-company-${company.id}`}>
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Company</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Company Logo</Label>
            <div className="flex items-center gap-3">
              {logoPreview ? (
                <img
                  src={logoPreview}
                  alt="Company logo"
                  className="h-12 w-12 rounded-lg object-contain border bg-white"
                />
              ) : (
                <div className="h-12 w-12 rounded-lg border border-dashed flex items-center justify-center bg-muted">
                  <ImageIcon className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo}
                >
                  {uploadingLogo ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Upload className="w-3 h-3 mr-1" />}
                  Upload
                </Button>
                {logoPreview && (
                  <Button type="button" size="sm" variant="ghost" onClick={handleLogoDelete}>
                    <Trash2 className="w-3 h-3 mr-1" /> Remove
                  </Button>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={handleLogoUpload}
              />
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPEG, WebP, or SVG. Max 2MB.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-name">Company Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-edit-company-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-dispatch-phone">Dispatch Phone Number</Label>
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-muted-foreground" />
              <Input
                id="edit-dispatch-phone"
                value={dispatchPhone}
                onChange={(e) => setDispatchPhone(e.target.value)}
                placeholder="+17025551234"
                data-testid="input-edit-dispatch-phone"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              SMS notifications for this company will come from this number. Leave empty to use the global default.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-timezone">Timezone</Label>
            <Select value={companyTimezone} onValueChange={setCompanyTimezone}>
              <SelectTrigger data-testid="select-edit-company-timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map(tz => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              All trip scheduling, billing, and reporting will use this timezone.
            </p>
          </div>

          <div className="border-t pt-4 mt-2">
            <p className="text-sm font-semibold mb-3">Branding</p>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="edit-brand-color">Brand Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    id="edit-brand-color"
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-9 w-12 rounded border cursor-pointer"
                    data-testid="input-brand-color"
                  />
                  <Input
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    placeholder="#10b981"
                    className="flex-1"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Primary brand color used in sidebar, headers, and PDFs.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-brand-secondary">Secondary Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    id="edit-brand-secondary"
                    value={brandSecondaryColor || "#6366f1"}
                    onChange={(e) => setBrandSecondaryColor(e.target.value)}
                    className="h-9 w-12 rounded border cursor-pointer"
                  />
                  <Input
                    value={brandSecondaryColor}
                    onChange={(e) => setBrandSecondaryColor(e.target.value)}
                    placeholder="#6366f1"
                    className="flex-1"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-brand-tagline">Tagline</Label>
                <Input
                  id="edit-brand-tagline"
                  value={brandTagline}
                  onChange={(e) => setBrandTagline(e.target.value)}
                  placeholder="e.g. Medical Transportation Services"
                  data-testid="input-brand-tagline"
                />
                <p className="text-xs text-muted-foreground">Shown under company name in sidebar and on invoices.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-custom-domain">Custom Domain</Label>
                <Input
                  id="edit-custom-domain"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="e.g. app.mycompany.com"
                  data-testid="input-custom-domain"
                />
                <p className="text-xs text-muted-foreground">Custom subdomain for this company (requires DNS setup).</p>
              </div>
            </div>
          </div>

          <Button
            className="w-full"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || !name.trim()}
            data-testid="button-save-company"
          >
            {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompanyCitiesDialog({ company }: { company: Company; }) {
  const [open, setOpen] = useState(false);
  const { token } = useAuth();
  const { toast } = useToast();
  const [selectedCityIds, setSelectedCityIds] = useState<number[]>([]);
  const [initialized, setInitialized] = useState(false);

  const { data: allCities = [] } = useQuery<City[]>({
    queryKey: ["/api/cities"],
  });

  const { data: companyCityData, isLoading: loadingCurrent } = useQuery<{ cityIds: number[] }>({
    queryKey: ["/api/admin/companies", company.id, "cities"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/companies/${company.id}/cities`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open,
  });

  const activeCities = allCities.filter(c => c.active !== false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/companies/${company.id}/cities`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cityIds: selectedCityIds }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Cities updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies", company.id, "cities"] });
      setOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update cities", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (companyCityData && open && !initialized) {
      setSelectedCityIds(companyCityData.cityIds || []);
      setInitialized(true);
    }
  }, [companyCityData, open, initialized]);

  const handleOpen = (val: boolean) => {
    setOpen(val);
    if (!val) setInitialized(false);
  };

  const toggleCity = (cityId: number) => {
    setSelectedCityIds(prev =>
      prev.includes(cityId) ? prev.filter(id => id !== cityId) : [...prev, cityId]
    );
  };

  const citiesByState = activeCities.reduce<Record<string, City[]>>((acc, city) => {
    const st = city.state || "Other";
    if (!acc[st]) acc[st] = [];
    acc[st].push(city);
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-manage-cities-${company.id}`}>
          <MapPin className="w-4 h-4 mr-1" />
          Cities
          {companyCityData?.cityIds?.length ? ` (${companyCityData.cityIds.length})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign Cities to {company.name}</DialogTitle>
        </DialogHeader>
        {loadingCurrent ? (
          <div className="space-y-2 py-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Select cities where this company operates. Users scoped to this company will only see these cities.
            </p>
            {Object.entries(citiesByState)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([state, stateCities]) => (
                <div key={state} className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">{state}</p>
                  {stateCities.map(city => (
                    <label
                      key={city.id}
                      className="flex items-center gap-2 cursor-pointer hover:bg-muted rounded px-2 py-1"
                      data-testid={`checkbox-city-${city.id}`}
                    >
                      <Checkbox
                        checked={selectedCityIds.includes(city.id)}
                        onCheckedChange={() => toggleCity(city.id)}
                      />
                      <span className="text-sm">{city.name}, {city.state}</span>
                    </label>
                  ))}
                </div>
              ))}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="flex-1"
                data-testid="button-save-company-cities"
              >
                {saveMutation.isPending ? "Saving..." : "Save Cities"}
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-company-cities">
                Cancel
              </Button>
            </div>
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

  const [connectError, setConnectError] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    setConnectError(false);
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
        if (data.connectRequired) {
          setConnectError(true);
        }
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
      <div className="flex flex-col items-start gap-1">
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
        {connectError && (
          <a
            href="https://dashboard.stripe.com/connect/overview"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-emerald-500 hover:underline flex items-center gap-0.5"
            data-testid={`link-stripe-connect-help-${company.id}`}
          >
            <ExternalLink className="w-2.5 h-2.5" />
            Enable Stripe Connect first
          </a>
        )}
      </div>
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
                  <TableHead>Dispatch Phone</TableHead>
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
                        {(company as any).logoUrl && (
                          <img
                            src={`/api/companies/${company.id}/logo`}
                            alt=""
                            className="h-6 w-6 rounded object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        )}
                        <span className="font-medium" data-testid={`text-company-name-${company.id}`}>{company.name}</span>
                        {String(company.id) === currentScope && (
                          <Badge variant="default" className="text-[10px]">SCOPED</Badge>
                        )}
                        {isArchived && (
                          <Badge variant="secondary" className="text-[10px]">ARCHIVED</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm" data-testid={`text-dispatch-phone-${company.id}`}>
                      {company.dispatchPhone ? (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3 text-muted-foreground" />
                          {company.dispatchPhone}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StripeConnectBadge company={company} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {company.createdAt ? formatDate(company.createdAt) : "-"}
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
                            <EditCompanyDialog company={company} onUpdated={refreshList} />
                            <CompanyCitiesDialog company={company} />
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
