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
import { Plus, Building2, Search, Pencil, AlertTriangle, Mail, ShieldCheck, ShieldAlert, Copy, Key } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { AddressAutocomplete, type StructuredAddress } from "@/components/address-autocomplete";
import { ClinicHealthBanner } from "@/components/clinic-health-banner";

const facilityTypeLabels: Record<string, string> = {
  clinic: "Clinic",
  hospital: "Hospital",
  mental: "Mental Health",
  private: "Private Practice",
};

export default function ClinicsPage() {
  const { token, selectedCity, user } = useAuth();
  const { toast } = useToast();
  const canManageAuth = user?.role === "SUPER_ADMIN" || user?.role === "DISPATCH";
  const [open, setOpen] = useState(false);
  const [editClinic, setEditClinic] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [tempPasswordInfo, setTempPasswordInfo] = useState<{ email: string; password: string } | null>(null);
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
        body: JSON.stringify(data),
      }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setOpen(false);
      if (result?.tempPassword && result?.email) {
        setTempPasswordInfo({ email: result.email, password: result.tempPassword });
      } else {
        const parts = ["Clinic added"];
        if (result?.userCreated) parts.push("user account created");
        if (result?.emailSent) parts.push("login link emailed");
        toast({ title: parts.join(" — ") });
      }
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiFetch(`/api/clinics/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinics"] });
      setEditClinic(null);
      toast({ title: "Clinic updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const inviteMutation = useMutation({
    mutationFn: (clinicId: number) =>
      apiFetch(`/api/admin/clinics/${clinicId}/send-invite`, token, {
        method: "POST",
      }),
    onSuccess: (data: any) => {
      toast({ title: "Login link sent", description: data.message });
    },
    onError: (err: any) => toast({ title: "Failed to send login link", description: err.message, variant: "destructive" }),
  });

  const [resetTarget, setResetTarget] = useState<{ id: number; email: string } | null>(null);
  const resetPasswordMutation = useMutation({
    mutationFn: (clinicId: number) =>
      apiFetch(`/api/admin/clinics/${clinicId}/reset-password`, token, {
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

  const filtered = clinics?.filter(
    (c: any) =>
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.publicId?.toLowerCase().includes(search.toLowerCase()) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
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
            <ClinicForm
              onSubmit={(d) => createMutation.mutate(d)}
              loading={createMutation.isPending}
              token={token}
            />
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
            <div key={c.id} className="space-y-2">
              <ClinicHealthBanner clinicId={c.id} />
            <Card>
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
                    {c.email && <p className="text-sm text-muted-foreground" data-testid={`text-clinic-email-${c.id}`}>{c.email}</p>}
                    <p className="text-sm text-muted-foreground truncate">{c.address}</p>
                    {c.phone && <p className="text-sm text-muted-foreground">{c.phone}</p>}
                    {c.contactName && <p className="text-xs text-muted-foreground">Contact: {c.contactName}</p>}
                    {!c.email && (
                      <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mt-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Missing email</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge variant={c.active ? "secondary" : "destructive"}>
                      {c.active ? "Active" : "Inactive"}
                    </Badge>
                    {c.authUserId ? (
                      <Badge variant="outline" className="text-xs" data-testid={`badge-clinic-auth-linked-${c.id}`}>
                        <ShieldCheck className="w-3 h-3 mr-1" />Auth linked
                      </Badge>
                    ) : c.email ? (
                      <Badge variant="outline" className="text-xs text-muted-foreground" data-testid={`badge-clinic-auth-missing-${c.id}`}>
                        <ShieldAlert className="w-3 h-3 mr-1" />No auth
                      </Badge>
                    ) : null}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setEditClinic(c)}
                      data-testid={`button-edit-clinic-${c.id}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                {canManageAuth && c.email && (
                  <div className="mt-3 pt-3 border-t flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => inviteMutation.mutate(c.id)}
                      disabled={inviteMutation.isPending}
                      data-testid={`button-send-clinic-invite-${c.id}`}
                    >
                      <Mail className="w-3 h-3 mr-2" />
                      Send Login Link
                    </Button>
                    {user?.role === "SUPER_ADMIN" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setResetTarget({ id: c.id, email: c.email }); resetPasswordMutation.mutate(c.id); }}
                        disabled={resetPasswordMutation.isPending}
                        data-testid={`button-reset-clinic-password-${c.id}`}
                      >
                        <Key className="w-3 h-3 mr-2" />
                        Reset Password
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editClinic} onOpenChange={(v) => !v && setEditClinic(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Clinic</DialogTitle></DialogHeader>
          {editClinic && (
            <ClinicForm
              initialData={editClinic}
              onSubmit={(d) => updateMutation.mutate({ id: editClinic.id, data: d })}
              loading={updateMutation.isPending}
              token={token}
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
                Share this temporary password with the clinic securely.
              </p>
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted font-mono text-sm">
                <span className="flex-1 select-all" data-testid="text-clinic-temp-password">{tempPasswordInfo.password}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(tempPasswordInfo.password);
                    toast({ title: "Copied to clipboard" });
                  }}
                  data-testid="button-copy-clinic-temp-password"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <div className="p-3 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  This password is shown only once and is not stored. The user must change it on first login.
                </p>
              </div>
              <Button className="w-full" onClick={() => setTempPasswordInfo(null)} data-testid="button-dismiss-clinic-temp-password">
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClinicForm({
  initialData,
  onSubmit,
  loading,
  token,
}: {
  initialData?: any;
  onSubmit: (data: any) => void;
  loading: boolean;
  token: string | null;
}) {
  const isEdit = !!initialData;

  const { data: cities } = useQuery<any[]>({
    queryKey: ["/api/cities"],
    queryFn: () => apiFetch("/api/cities", token),
    enabled: !!token,
  });

  const [form, setForm] = useState({
    name: initialData?.name || "",
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    contactName: initialData?.contactName || "",
    facilityType: initialData?.facilityType || "clinic",
    cityId: initialData?.cityId ? String(initialData.cityId) : "",
  });

  const [addressValue, setAddressValue] = useState<StructuredAddress | null>(() => {
    if (initialData?.address && initialData?.lat != null && initialData?.lng != null) {
      return {
        formattedAddress: initialData.address,
        street: initialData.addressStreet || "",
        city: initialData.addressCity || "",
        state: initialData.addressState || "",
        zip: initialData.addressZip || "",
        lat: initialData.lat,
        lng: initialData.lng,
        placeId: initialData.addressPlaceId || undefined,
      };
    }
    return null;
  });

  const [addressError, setAddressError] = useState("");

  const selectedCityObj = cities?.find((c: any) => String(c.id) === form.cityId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.cityId) {
      setAddressError("Service City is required");
      return;
    }
    if (!addressValue) {
      setAddressError("Select an address from the list");
      return;
    }
    if (!addressValue.zip) {
      setAddressError("ZIP code is required");
      return;
    }
    if (!addressValue.lat || !addressValue.lng) {
      setAddressError("Coordinates are missing. Please re-select the address.");
      return;
    }
    if (selectedCityObj) {
      const addrCity = (addressValue.city || "").trim().toLowerCase();
      const addrState = (addressValue.state || "").trim().toLowerCase();
      const svcCity = (selectedCityObj.name || "").trim().toLowerCase();
      const svcState = (selectedCityObj.state || "").trim().toLowerCase();
      if (addrCity !== svcCity || addrState !== svcState) {
        setAddressError(
          "Clinic address must be inside the selected Service City. Please choose the correct Service City or pick an address within it."
        );
        return;
      }
    }
    setAddressError("");
    onSubmit({
      ...form,
      cityId: parseInt(form.cityId),
      address: addressValue.formattedAddress,
      addressStreet: addressValue.street,
      addressCity: addressValue.city,
      addressState: addressValue.state,
      addressZip: addressValue.zip,
      addressPlaceId: addressValue.placeId || null,
      lat: addressValue.lat,
      lng: addressValue.lng,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Clinic Name *</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-clinic-name" />
      </div>
      <div className="space-y-2">
        <Label>Service City *</Label>
        <Select value={form.cityId} onValueChange={(v) => { setForm({ ...form, cityId: v }); setAddressError(""); }}>
          <SelectTrigger data-testid="select-clinic-city">
            <SelectValue placeholder="Select service city" />
          </SelectTrigger>
          <SelectContent>
            {cities?.map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)} data-testid={`option-clinic-city-${c.id}`}>
                {c.name}, {c.state}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Email *</Label>
        <Input
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
          data-testid="input-clinic-email"
        />
        {isEdit && !initialData?.email && (
          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Clinic must have an email for login access.
          </p>
        )}
      </div>
      <AddressAutocomplete
        label="Address"
        value={addressValue}
        onSelect={(addr) => {
          setAddressValue(addr);
          setAddressError("");
        }}
        token={token}
        testIdPrefix="clinic-address"
        required
      />
      {addressError && (
        <p className="text-xs text-destructive flex items-center gap-1" data-testid="text-clinic-address-error">
          <AlertTriangle className="w-3 h-3" />
          {addressError}
        </p>
      )}
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
      <Button type="submit" className="w-full" disabled={loading || !form.email || !form.cityId} data-testid="button-submit-clinic">
        {loading ? (isEdit ? "Saving..." : "Adding...") : (isEdit ? "Save Changes" : "Add Clinic")}
      </Button>
    </form>
  );
}
