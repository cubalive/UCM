import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch, rawAuthFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { downloadWithAuth } from "@/lib/export";
import {
  DollarSign,
  FileText,
  ClipboardList,
  Plus,
  Save,
  Download,
  Eye,
  Lock,
  Unlock,
  Loader2,
  Settings,
  Receipt,
  Calendar,
  CheckCircle,
  Clock,
  XCircle,
} from "lucide-react";

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}
function getWeekAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().split("T")[0];
}

const OUTCOME_LABELS: Record<string, string> = {
  completed: "Completed",
  no_show: "No Show",
  cancelled: "Cancelled",
  company_error: "Company Error",
};

const CANCEL_WINDOW_LABELS: Record<string, string> = {
  advance: "Advance",
  same_day: "Same Day",
  late: "Late",
};

const OUTCOME_COLORS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  no_show: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  company_error: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

function PricesTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [selectedClinicId, setSelectedClinicId] = useState<string>("");
  const [selectedCityId, setSelectedCityId] = useState<string>("");
  const [editedRates, setEditedRates] = useState<Record<number, string>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [cancelAdvanceHours, setCancelAdvanceHours] = useState("24");
  const [cancelLateMinutes, setCancelLateMinutes] = useState("0");

  const clinicsQ = useQuery<any[]>({
    queryKey: ["/api/clinics"],
    queryFn: () => apiFetch("/api/clinics", token),
    enabled: !!token,
  });

  const citiesQ = useQuery<any[]>({
    queryKey: ["/api/cities"],
    queryFn: () => apiFetch("/api/cities", token),
    enabled: !!token,
  });

  const profilesQ = useQuery<any[]>({
    queryKey: ["/api/clinic-billing/profiles", selectedClinicId],
    queryFn: () => {
      const params = selectedClinicId ? `?clinic_id=${selectedClinicId}` : "";
      return apiFetch(`/api/clinic-billing/profiles${params}`, token);
    },
    enabled: !!token,
  });

  const profiles = profilesQ.data || [];
  const activeProfile = profiles.find((p: any) =>
    (!selectedClinicId || String(p.clinicId) === selectedClinicId) &&
    (!selectedCityId || String(p.cityId) === selectedCityId) &&
    p.isActive
  );

  const profileDetailQ = useQuery<any>({
    queryKey: ["/api/clinic-billing/profiles", activeProfile?.id],
    queryFn: () => apiFetch(`/api/clinic-billing/profiles/${activeProfile?.id}`, token),
    enabled: !!token && !!activeProfile?.id,
  });

  useEffect(() => {
    if (profileDetailQ.data?.profile) {
      setCancelAdvanceHours(String(profileDetailQ.data.profile.cancelAdvanceHours));
      setCancelLateMinutes(String(profileDetailQ.data.profile.cancelLateMinutes));
    }
  }, [profileDetailQ.data]);

  const createProfileMutation = useMutation({
    mutationFn: (data: any) => apiFetch("/api/clinic-billing/profiles", token, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic-billing/profiles"] });
      toast({ title: "Billing profile created with default rates" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch(`/api/clinic-billing/profiles/${activeProfile?.id}`, token, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic-billing/profiles"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const batchUpdateMutation = useMutation({
    mutationFn: (rules: any[]) =>
      apiFetch("/api/clinic-billing/rules/batch", token, { method: "PATCH", body: JSON.stringify({ rules }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic-billing/profiles"] });
      setEditedRates({});
      toast({ title: "Rates saved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleCreateProfile = () => {
    if (!selectedClinicId || !selectedCityId) return;
    const clinic = (clinicsQ.data || []).find((c: any) => String(c.id) === selectedClinicId);
    const city = (citiesQ.data || []).find((c: any) => String(c.id) === selectedCityId);
    createProfileMutation.mutate({
      clinicId: parseInt(selectedClinicId),
      cityId: parseInt(selectedCityId),
      name: `${clinic?.name || "Clinic"} - ${city?.name || "City"}`,
    });
  };

  const handleSaveRates = () => {
    const rules = Object.entries(editedRates).map(([id, rate]) => ({
      id: parseInt(id),
      unitRate: rate,
    }));
    if (rules.length > 0) batchUpdateMutation.mutate(rules);
  };

  const handleSaveSettings = () => {
    updateProfileMutation.mutate({
      cancelAdvanceHours: parseInt(cancelAdvanceHours),
      cancelLateMinutes: parseInt(cancelLateMinutes),
    });
    setShowSettings(false);
  };

  const rules = profileDetailQ.data?.rules || [];

  const getRate = (outcome: string, pc: number, legType: string, cancelWindow: string | null) => {
    return rules.find((r: any) =>
      r.outcome === outcome &&
      r.passengerCount === pc &&
      r.legType === legType &&
      (cancelWindow ? r.cancelWindow === cancelWindow : !r.cancelWindow)
    );
  };

  const renderRateCell = (rule: any) => {
    if (!rule) return <TableCell className="text-center text-muted-foreground">—</TableCell>;
    const val = editedRates[rule.id] !== undefined ? editedRates[rule.id] : rule.unitRate;
    return (
      <TableCell className="p-1">
        <Input
          type="number"
          step="0.01"
          min="0"
          className="w-20 text-center text-sm"
          value={val}
          onChange={(e) => setEditedRates((prev) => ({ ...prev, [rule.id]: e.target.value }))}
          data-testid={`input-rate-${rule.id}`}
        />
      </TableCell>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="space-y-1">
          <Label>Clinic</Label>
          <Select value={selectedClinicId} onValueChange={setSelectedClinicId}>
            <SelectTrigger className="w-48" data-testid="select-billing-clinic">
              <SelectValue placeholder="Select clinic" />
            </SelectTrigger>
            <SelectContent>
              {(clinicsQ.data || []).map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>City</Label>
          <Select value={selectedCityId} onValueChange={setSelectedCityId}>
            <SelectTrigger className="w-48" data-testid="select-billing-city">
              <SelectValue placeholder="Select city" />
            </SelectTrigger>
            <SelectContent>
              {(citiesQ.data || []).map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedClinicId && selectedCityId && !activeProfile && (
          <div className="self-end">
            <Button onClick={handleCreateProfile} disabled={createProfileMutation.isPending} data-testid="button-create-profile" className="gap-1.5">
              <Plus className="w-4 h-4" />
              Create Billing Profile
            </Button>
          </div>
        )}
        {activeProfile && (
          <div className="self-end flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setShowSettings(true)} data-testid="button-billing-settings">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {profileDetailQ.isLoading && <Skeleton className="h-48 w-full" />}

      {activeProfile && rules.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
              <span>Tariff Matrix: {activeProfile.clinicName} — {activeProfile.cityName}</span>
              <div className="flex items-center gap-2">
                {Object.keys(editedRates).length > 0 && (
                  <Button size="sm" onClick={handleSaveRates} disabled={batchUpdateMutation.isPending} data-testid="button-save-rates" className="gap-1">
                    {batchUpdateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save Rates
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2} className="text-center align-middle">Pax</TableHead>
                  <TableHead colSpan={2} className="text-center border-l">Completed</TableHead>
                  <TableHead colSpan={2} className="text-center border-l">No Show</TableHead>
                  <TableHead colSpan={6} className="text-center border-l">Cancelled</TableHead>
                  <TableHead colSpan={2} className="text-center border-l">Company Error</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead className="text-center text-xs border-l">Out</TableHead>
                  <TableHead className="text-center text-xs">Ret</TableHead>
                  <TableHead className="text-center text-xs border-l">Out</TableHead>
                  <TableHead className="text-center text-xs">Ret</TableHead>
                  <TableHead className="text-center text-xs border-l">Adv Out</TableHead>
                  <TableHead className="text-center text-xs">Adv Ret</TableHead>
                  <TableHead className="text-center text-xs">SD Out</TableHead>
                  <TableHead className="text-center text-xs">SD Ret</TableHead>
                  <TableHead className="text-center text-xs">Late Out</TableHead>
                  <TableHead className="text-center text-xs">Late Ret</TableHead>
                  <TableHead className="text-center text-xs border-l">Out</TableHead>
                  <TableHead className="text-center text-xs">Ret</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[1, 2, 3, 4].map((pc) => (
                  <TableRow key={pc} data-testid={`row-pax-${pc}`}>
                    <TableCell className="text-center font-medium">{pc}</TableCell>
                    {renderRateCell(getRate("completed", pc, "outbound", null))}
                    {renderRateCell(getRate("completed", pc, "return", null))}
                    {renderRateCell(getRate("no_show", pc, "outbound", null))}
                    {renderRateCell(getRate("no_show", pc, "return", null))}
                    {renderRateCell(getRate("cancelled", pc, "outbound", "advance"))}
                    {renderRateCell(getRate("cancelled", pc, "return", "advance"))}
                    {renderRateCell(getRate("cancelled", pc, "outbound", "same_day"))}
                    {renderRateCell(getRate("cancelled", pc, "return", "same_day"))}
                    {renderRateCell(getRate("cancelled", pc, "outbound", "late"))}
                    {renderRateCell(getRate("cancelled", pc, "return", "late"))}
                    {renderRateCell(getRate("company_error", pc, "outbound", null))}
                    {renderRateCell(getRate("company_error", pc, "return", null))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!activeProfile && selectedClinicId && selectedCityId && !profileDetailQ.isLoading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No billing profile exists for this clinic + city. Create one to set rates.
          </CardContent>
        </Card>
      )}

      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Window Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Advance Cancel Threshold (hours before pickup)</Label>
              <Input
                type="number"
                min="0"
                value={cancelAdvanceHours}
                onChange={(e) => setCancelAdvanceHours(e.target.value)}
                data-testid="input-cancel-advance-hours"
              />
              <p className="text-xs text-muted-foreground">
                Trips cancelled {cancelAdvanceHours}+ hours before pickup = Advance rate
              </p>
            </div>
            <div className="space-y-2">
              <Label>Late Cancel Threshold (minutes before pickup)</Label>
              <Input
                type="number"
                min="0"
                value={cancelLateMinutes}
                onChange={(e) => setCancelLateMinutes(e.target.value)}
                data-testid="input-cancel-late-minutes"
              />
              <p className="text-xs text-muted-foreground">
                Trips cancelled within {cancelLateMinutes} minutes of pickup = Late rate
              </p>
            </div>
            <Button onClick={handleSaveSettings} disabled={updateProfileMutation.isPending} data-testid="button-save-settings">
              Save Settings
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TripsLogTab() {
  const { token } = useAuth();
  const [clinicId, setClinicId] = useState<string>("");
  const [startDate, setStartDate] = useState(getWeekAgo());
  const [endDate, setEndDate] = useState(getToday());
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [passengerFilter, setPassengerFilter] = useState<string>("all");

  const clinicsQ = useQuery<any[]>({
    queryKey: ["/api/clinics"],
    queryFn: () => apiFetch("/api/clinics", token),
    enabled: !!token,
  });

  const tripsLogQ = useQuery<any>({
    queryKey: ["/api/clinic-billing/trips-log", clinicId, startDate, endDate, outcomeFilter, passengerFilter],
    queryFn: () => {
      let url = `/api/clinic-billing/trips-log?clinic_id=${clinicId}&start_date=${startDate}&end_date=${endDate}`;
      if (outcomeFilter !== "all") url += `&outcome=${outcomeFilter}`;
      if (passengerFilter !== "all") url += `&passenger_count=${passengerFilter}`;
      return apiFetch(url, token);
    },
    enabled: !!token && !!clinicId && !!startDate && !!endDate,
  });

  const grouped = tripsLogQ.data?.grouped || {};
  const tripsList = tripsLogQ.data?.trips || [];

  const totalAmount = tripsList.reduce((s: number, t: any) => s + parseFloat(t.lineTotal || "0"), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="space-y-1">
          <Label>Clinic</Label>
          <Select value={clinicId} onValueChange={setClinicId}>
            <SelectTrigger className="w-48" data-testid="select-trips-log-clinic">
              <SelectValue placeholder="Select clinic" />
            </SelectTrigger>
            <SelectContent>
              {(clinicsQ.data || []).map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Start</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" data-testid="input-trips-log-start" />
        </div>
        <div className="space-y-1">
          <Label>End</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" data-testid="input-trips-log-end" />
        </div>
        <div className="space-y-1">
          <Label>Outcome</Label>
          <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
            <SelectTrigger className="w-36" data-testid="select-trips-log-outcome">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="no_show">No Show</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="company_error">Company Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Passengers</Label>
          <Select value={passengerFilter} onValueChange={setPassengerFilter}>
            <SelectTrigger className="w-24" data-testid="select-trips-log-pax">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="1">1</SelectItem>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {tripsLogQ.isLoading && <Skeleton className="h-48 w-full" />}

      {!clinicId && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Select a clinic to view the billing trips log.
          </CardContent>
        </Card>
      )}

      {clinicId && tripsList.length === 0 && !tripsLogQ.isLoading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No billable trips found for the selected filters.
          </CardContent>
        </Card>
      )}

      {Object.keys(grouped).length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Badge variant="secondary" data-testid="badge-trips-log-count">{tripsList.length} trip legs</Badge>
            <span className="text-sm font-medium" data-testid="text-trips-log-total">Total: ${totalAmount.toFixed(2)}</span>
          </div>

          {Object.keys(grouped).sort().map((date) => (
            <Card key={date}>
              <CardHeader className="py-2 px-4">
                <CardTitle className="text-sm font-medium">{date}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {Object.entries(grouped[date] as Record<string, any[]>).map(([pKey, legs]) => {
                  const [, patientName] = pKey.split("-");
                  return (
                    <div key={pKey} className="border-t px-4 py-2">
                      <p className="text-sm font-medium mb-1">{patientName}</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Time</TableHead>
                            <TableHead className="text-xs">ID</TableHead>
                            <TableHead className="text-xs">Leg</TableHead>
                            <TableHead className="text-xs">Pickup → Dropoff</TableHead>
                            <TableHead className="text-xs">Mi</TableHead>
                            <TableHead className="text-xs">Pax</TableHead>
                            <TableHead className="text-xs">Outcome</TableHead>
                            <TableHead className="text-xs text-right">Rate</TableHead>
                            <TableHead className="text-xs text-right">Price</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(legs as any[]).map((leg: any) => (
                            <TableRow key={leg.tripId} data-testid={`row-trip-log-${leg.tripId}`}>
                              <TableCell className="text-xs">{leg.pickupTime || "—"}</TableCell>
                              <TableCell className="text-xs font-mono">{leg.publicId}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs capitalize">{leg.legType}</Badge>
                              </TableCell>
                              <TableCell className="text-xs max-w-[200px] truncate">
                                {leg.pickupAddress?.split(",")[0]} → {leg.dropoffAddress?.split(",")[0]}
                              </TableCell>
                              <TableCell className="text-xs">{leg.distanceMiles ? parseFloat(leg.distanceMiles).toFixed(1) : "—"}</TableCell>
                              <TableCell className="text-xs text-center" data-testid={`text-pax-${leg.tripId}`}>{leg.passengerCount}</TableCell>
                              <TableCell>
                                <Badge className={`text-xs ${OUTCOME_COLORS[leg.billingOutcome] || ""}`}>
                                  {OUTCOME_LABELS[leg.billingOutcome] || leg.billingOutcome}
                                  {leg.cancelWindow && ` (${CANCEL_WINDOW_LABELS[leg.cancelWindow] || leg.cancelWindow})`}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-right" data-testid={`text-rate-${leg.tripId}`}>${leg.unitRate}</TableCell>
                              <TableCell className="text-xs text-right font-medium" data-testid={`text-price-${leg.tripId}`}>${leg.lineTotal}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

function InvoicesTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [clinicId, setClinicId] = useState<string>("");
  const [cityId, setCityId] = useState<string>("");
  const [weekStart, setWeekStart] = useState(getWeekAgo());
  const [weekEnd, setWeekEnd] = useState(getToday());
  const [showDetail, setShowDetail] = useState<number | null>(null);

  const clinicsQ = useQuery<any[]>({
    queryKey: ["/api/clinics"],
    queryFn: () => apiFetch("/api/clinics", token),
    enabled: !!token,
  });

  const citiesQ = useQuery<any[]>({
    queryKey: ["/api/cities"],
    queryFn: () => apiFetch("/api/cities", token),
    enabled: !!token,
  });

  const invoicesQ = useQuery<any[]>({
    queryKey: ["/api/clinic-billing/invoices", clinicId],
    queryFn: () => {
      const params = clinicId ? `?clinic_id=${clinicId}` : "";
      return apiFetch(`/api/clinic-billing/invoices${params}`, token);
    },
    enabled: !!token,
  });

  const detailQ = useQuery<any>({
    queryKey: ["/api/clinic-billing/invoices", showDetail, "detail"],
    queryFn: () => apiFetch(`/api/clinic-billing/invoices/${showDetail}`, token),
    enabled: !!token && showDetail !== null,
  });

  const generateMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/clinic-billing/invoices/generate", token, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic-billing/invoices"] });
      toast({ title: data.regenerated ? "Invoice regenerated" : "Invoice generated", description: `${data.lineCount} trip legs` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const finalizeMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/clinic-billing/invoices/${id}/finalize`, token, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic-billing/invoices"] });
      toast({ title: "Invoice finalized" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const reopenMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/clinic-billing/invoices/${id}/reopen`, token, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic-billing/invoices"] });
      toast({ title: "Invoice reopened" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleDownloadCsv = async (invId: number) => {
    await downloadWithAuth(`/api/clinic-billing/invoices/${invId}/csv`, `clinic-billing-${invId}.csv`, "text/csv; charset=utf-8", rawAuthFetch, (msg) => toast({ title: "Error", description: msg, variant: "destructive" }));
  };

  const handleGenerate = () => {
    if (!clinicId || !cityId || !weekStart || !weekEnd) return;
    generateMutation.mutate({
      clinicId: parseInt(clinicId),
      cityId: parseInt(cityId),
      weekStart,
      weekEnd,
    });
  };

  const invoices = invoicesQ.data || [];
  const detail = detailQ.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Generate Clinic Billing Invoice
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="space-y-1">
              <Label>Clinic</Label>
              <Select value={clinicId} onValueChange={setClinicId}>
                <SelectTrigger className="w-48" data-testid="select-invoice-clinic">
                  <SelectValue placeholder="Select clinic" />
                </SelectTrigger>
                <SelectContent>
                  {(clinicsQ.data || []).map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>City</Label>
              <Select value={cityId} onValueChange={setCityId}>
                <SelectTrigger className="w-48" data-testid="select-invoice-city">
                  <SelectValue placeholder="Select city" />
                </SelectTrigger>
                <SelectContent>
                  {(citiesQ.data || []).map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Week Start</Label>
              <Input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="w-40" data-testid="input-invoice-week-start" />
            </div>
            <div className="space-y-1">
              <Label>Week End</Label>
              <Input type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} className="w-40" data-testid="input-invoice-week-end" />
            </div>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending || !clinicId || !cityId}
            data-testid="button-generate-invoice"
            className="gap-1.5"
          >
            {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
            Generate Draft Invoice
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Clinic Billing Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoicesQ.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No clinic billing invoices yet.</p>
          ) : (
            <div className="overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Clinic</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Legs</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv: any) => (
                    <TableRow key={inv.id} data-testid={`row-cb-invoice-${inv.id}`}>
                      <TableCell className="font-mono text-sm">#{inv.id}</TableCell>
                      <TableCell className="text-sm">{inv.clinicName}</TableCell>
                      <TableCell className="text-sm">{inv.weekStart} — {inv.weekEnd}</TableCell>
                      <TableCell><Badge variant="secondary">{inv.lineCount}</Badge></TableCell>
                      <TableCell className="font-medium">${parseFloat(inv.totalAmount).toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant={inv.status === "finalized" ? "default" : "outline"}>
                          {inv.status === "finalized" ? "Finalized" : "Draft"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" onClick={() => setShowDetail(inv.id)} data-testid={`button-view-cb-inv-${inv.id}`}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => handleDownloadCsv(inv.id)} data-testid={`button-csv-cb-inv-${inv.id}`}>
                            <Download className="w-4 h-4" />
                          </Button>
                          {inv.status === "draft" && (
                            <Button size="sm" variant="outline" onClick={() => finalizeMutation.mutate(inv.id)} disabled={finalizeMutation.isPending} data-testid={`button-finalize-cb-inv-${inv.id}`} className="gap-1">
                              <Lock className="w-3.5 h-3.5" />
                              Finalize
                            </Button>
                          )}
                          {inv.status === "finalized" && (
                            <Button size="sm" variant="outline" onClick={() => reopenMutation.mutate(inv.id)} disabled={reopenMutation.isPending} data-testid={`button-reopen-cb-inv-${inv.id}`} className="gap-1">
                              <Unlock className="w-3.5 h-3.5" />
                              Reopen
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDetail !== null} onOpenChange={(open) => !open && setShowDetail(null)}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Invoice Detail {detail?.invoice ? `#${detail.invoice.id}` : ""}
            </DialogTitle>
          </DialogHeader>

          {detailQ.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Clinic:</span>{" "}
                  <span className="font-medium">{detail.invoice.clinicName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Period:</span>{" "}
                  <span className="font-medium">{detail.invoice.weekStart} — {detail.invoice.weekEnd}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge variant={detail.invoice.status === "finalized" ? "default" : "outline"}>
                    {detail.invoice.status}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Total:</span>{" "}
                  <span className="font-bold text-base">${parseFloat(detail.invoice.totalAmount).toFixed(2)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Card>
                  <CardContent className="p-2 text-center">
                    <p className="text-muted-foreground">Completed</p>
                    <p className="font-medium">${parseFloat(detail.invoice.completedTotal).toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-2 text-center">
                    <p className="text-muted-foreground">No Show</p>
                    <p className="font-medium">${parseFloat(detail.invoice.noShowTotal).toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-2 text-center">
                    <p className="text-muted-foreground">Cancelled</p>
                    <p className="font-medium">${parseFloat(detail.invoice.cancelledTotal).toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-2 text-center">
                    <p className="text-muted-foreground">Company Error</p>
                    <p className="font-medium">${parseFloat(detail.invoice.companyErrorTotal).toFixed(2)}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <Card>
                  <CardContent className="p-2 text-center">
                    <p className="text-muted-foreground">Outbound Total</p>
                    <p className="font-medium">${parseFloat(detail.invoice.outboundTotal).toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-2 text-center">
                    <p className="text-muted-foreground">Return Total</p>
                    <p className="font-medium">${parseFloat(detail.invoice.returnTotal).toFixed(2)}</p>
                  </CardContent>
                </Card>
              </div>

              {detail.totals && (
                <div className="text-xs space-y-1">
                  <p className="font-medium">By Passenger Count:</p>
                  <div className="flex gap-3 flex-wrap">
                    {[1, 2, 3, 4].map((pc) => (
                      <span key={pc}>Pax {pc}: ${(detail.totals[`pax_${pc}`] || 0).toFixed(2)}</span>
                    ))}
                  </div>
                  {(detail.totals.cancel_advance > 0 || detail.totals.cancel_same_day > 0 || detail.totals.cancel_late > 0) && (
                    <>
                      <p className="font-medium mt-1">Cancel Windows:</p>
                      <div className="flex gap-3 flex-wrap">
                        <span>Advance: ${(detail.totals.cancel_advance || 0).toFixed(2)}</span>
                        <span>Same Day: ${(detail.totals.cancel_same_day || 0).toFixed(2)}</span>
                        <span>Late: ${(detail.totals.cancel_late || 0).toFixed(2)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {detail.grouped && Object.keys(detail.grouped).sort().map((date) => (
                <div key={date} className="border rounded p-3">
                  <p className="text-sm font-medium mb-2">{date}</p>
                  {Object.entries(detail.grouped[date] as Record<string, any[]>).map(([pKey, lines]) => {
                    const [, patientName] = pKey.split("-");
                    return (
                      <div key={pKey} className="mb-2">
                        <p className="text-xs font-medium text-muted-foreground mb-1">{patientName}</p>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Time</TableHead>
                              <TableHead className="text-xs">Leg</TableHead>
                              <TableHead className="text-xs">Route</TableHead>
                              <TableHead className="text-xs">Mi</TableHead>
                              <TableHead className="text-xs">Outcome</TableHead>
                              <TableHead className="text-xs">Pax</TableHead>
                              <TableHead className="text-xs text-right">Rate</TableHead>
                              <TableHead className="text-xs text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(lines as any[]).map((line: any) => (
                              <TableRow key={line.id}>
                                <TableCell className="text-xs">{line.pickupTime || "—"}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs capitalize">{line.legType}</Badge>
                                </TableCell>
                                <TableCell className="text-xs max-w-[160px] truncate">
                                  {line.pickupAddress?.split(",")[0]} → {line.dropoffAddress?.split(",")[0]}
                                </TableCell>
                                <TableCell className="text-xs">{line.distanceMiles ? parseFloat(line.distanceMiles).toFixed(1) : "—"}</TableCell>
                                <TableCell>
                                  <Badge className={`text-xs ${OUTCOME_COLORS[line.outcome] || ""}`}>
                                    {OUTCOME_LABELS[line.outcome] || line.outcome}
                                    {line.cancelWindow && ` (${CANCEL_WINDOW_LABELS[line.cancelWindow] || line.cancelWindow})`}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-center">{line.passengerCount}</TableCell>
                                <TableCell className="text-xs text-right">${line.unitRateSnapshot}</TableCell>
                                <TableCell className="text-xs text-right font-medium">${line.lineTotal}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const DOW_LABELS: Record<number, string> = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday" };
const CYCLE_LABELS: Record<string, string> = { weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly" };

function BillingCycleSettingsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [selectedClinicId, setSelectedClinicId] = useState<string>("");

  const clinicsQ = useQuery<any[]>({
    queryKey: ["/api/clinics"],
    queryFn: () => apiFetch("/api/clinics", token),
    enabled: !!token,
  });

  const settingsQ = useQuery<any>({
    queryKey: ["/api/clinics", selectedClinicId, "billing-settings"],
    queryFn: () => apiFetch(`/api/clinics/${selectedClinicId}/billing-settings`, token),
    enabled: !!token && !!selectedClinicId,
  });

  const [cycle, setCycle] = useState("weekly");
  const [anchorDow, setAnchorDow] = useState("1");
  const [anchorDom, setAnchorDom] = useState("1");
  const [biweeklyMode, setBiweeklyMode] = useState("1_15");
  const [anchorDate, setAnchorDate] = useState("");
  const [tz, setTz] = useState("America/Los_Angeles");
  const [autoGen, setAutoGen] = useState(false);
  const [graceDays, setGraceDays] = useState("0");
  const [lateFeePct, setLateFeePct] = useState("0");

  useEffect(() => {
    if (settingsQ.data) {
      const s = settingsQ.data;
      setCycle(s.billingCycle || "weekly");
      setAnchorDow(String(s.anchorDow ?? 1));
      setAnchorDom(String(s.anchorDom ?? 1));
      setBiweeklyMode(s.biweeklyMode || "1_15");
      setAnchorDate(s.anchorDate || "");
      setTz(s.timezone || "America/Los_Angeles");
      setAutoGen(s.autoGenerate || false);
      setGraceDays(String(s.graceDays ?? 0));
      setLateFeePct(String(s.lateFeePct ?? 0));
    }
  }, [settingsQ.data]);

  const saveMutation = useMutation({
    mutationFn: (data: any) => apiFetch(`/api/clinics/${selectedClinicId}/billing-settings`, token, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinics", selectedClinicId, "billing-settings"] });
      toast({ title: "Billing settings saved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSave = () => {
    saveMutation.mutate({
      billingCycle: cycle,
      anchorDow: cycle === "weekly" ? parseInt(anchorDow) : null,
      anchorDom: cycle === "monthly" ? parseInt(anchorDom) : null,
      biweeklyMode: cycle === "biweekly" ? biweeklyMode : "1_15",
      anchorDate: cycle === "biweekly" && biweeklyMode === "anchor_14" ? anchorDate : null,
      timezone: tz,
      autoGenerate: autoGen,
      graceDays: parseInt(graceDays) || 0,
      lateFeePct: lateFeePct,
    });
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Label>Clinic</Label>
        <Select value={selectedClinicId} onValueChange={setSelectedClinicId}>
          <SelectTrigger className="w-64" data-testid="select-billing-settings-clinic">
            <SelectValue placeholder="Select clinic" />
          </SelectTrigger>
          <SelectContent>
            {(clinicsQ.data || []).map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedClinicId && settingsQ.isLoading && <Skeleton className="h-48" />}

      {selectedClinicId && !settingsQ.isLoading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Billing Cycle Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Billing Cycle</Label>
                <Select value={cycle} onValueChange={setCycle}>
                  <SelectTrigger data-testid="select-billing-cycle">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Biweekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {cycle === "weekly" && (
                <div className="space-y-1">
                  <Label>Anchor Day (start of week)</Label>
                  <Select value={anchorDow} onValueChange={setAnchorDow}>
                    <SelectTrigger data-testid="select-anchor-dow">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1,2,3,4,5,6,7].map(d => (
                        <SelectItem key={d} value={String(d)}>{DOW_LABELS[d]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {cycle === "biweekly" && (
                <div className="space-y-1">
                  <Label>Biweekly Mode</Label>
                  <Select value={biweeklyMode} onValueChange={setBiweeklyMode}>
                    <SelectTrigger data-testid="select-biweekly-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1_15">1st & 15th</SelectItem>
                      <SelectItem value="anchor_14">14-day rolling</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {cycle === "biweekly" && biweeklyMode === "anchor_14" && (
                <div className="space-y-1">
                  <Label>Anchor Date</Label>
                  <Input
                    type="date"
                    value={anchorDate}
                    onChange={(e) => setAnchorDate(e.target.value)}
                    data-testid="input-anchor-date"
                  />
                </div>
              )}

              {cycle === "monthly" && (
                <div className="space-y-1">
                  <Label>Anchor Day of Month (1-28)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={28}
                    value={anchorDom}
                    onChange={(e) => setAnchorDom(e.target.value)}
                    data-testid="input-anchor-dom"
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label>Timezone</Label>
                <Select value={tz} onValueChange={setTz}>
                  <SelectTrigger data-testid="select-timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/Los_Angeles">Pacific</SelectItem>
                    <SelectItem value="America/Denver">Mountain</SelectItem>
                    <SelectItem value="America/Chicago">Central</SelectItem>
                    <SelectItem value="America/New_York">Eastern</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Grace Days</Label>
                <Input
                  type="number"
                  min={0}
                  value={graceDays}
                  onChange={(e) => setGraceDays(e.target.value)}
                  data-testid="input-grace-days"
                />
              </div>

              <div className="space-y-1">
                <Label>Late Fee %</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={lateFeePct}
                  onChange={(e) => setLateFeePct(e.target.value)}
                  data-testid="input-late-fee-pct"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                checked={autoGen}
                onChange={(e) => setAutoGen(e.target.checked)}
                id="auto-generate"
                data-testid="checkbox-auto-generate"
                className="rounded"
              />
              <Label htmlFor="auto-generate" className="cursor-pointer">Auto-generate invoices (display only)</Label>
            </div>

            <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-billing-settings">
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span className="ml-1.5">Save Settings</span>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CycleInvoicesTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [selectedClinicId, setSelectedClinicId] = useState<string>("");
  const [previewData, setPreviewData] = useState<any>(null);
  const [viewInvoice, setViewInvoice] = useState<any>(null);
  const [customPeriodStart, setCustomPeriodStart] = useState("");
  const [customPeriodEnd, setCustomPeriodEnd] = useState("");
  const [useCustomPeriod, setUseCustomPeriod] = useState(false);

  const clinicsQ = useQuery<any[]>({
    queryKey: ["/api/clinics"],
    queryFn: () => apiFetch("/api/clinics", token),
    enabled: !!token,
  });

  const invoicesQ = useQuery<any[]>({
    queryKey: ["/api/clinics", selectedClinicId, "cycle-invoices"],
    queryFn: () => apiFetch(`/api/clinics/${selectedClinicId}/cycle-invoices`, token),
    enabled: !!token && !!selectedClinicId,
  });

  const getPeriodBody = () => {
    if (useCustomPeriod && customPeriodStart && customPeriodEnd) {
      return { periodStart: customPeriodStart, periodEnd: customPeriodEnd };
    }
    return {};
  };

  const previewMutation = useMutation({
    mutationFn: () => apiFetch(`/api/clinics/${selectedClinicId}/cycle-invoices/preview`, token, {
      method: "POST",
      body: JSON.stringify(getPeriodBody()),
    }),
    onSuccess: (data: any) => setPreviewData(data),
    onError: (err: any) => toast({ title: "Preview error", description: err.message, variant: "destructive" }),
  });

  const createDraftMutation = useMutation({
    mutationFn: () => apiFetch(`/api/clinics/${selectedClinicId}/cycle-invoices`, token, {
      method: "POST",
      body: JSON.stringify(getPeriodBody()),
    }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinics", selectedClinicId, "cycle-invoices"] });
      setPreviewData(null);
      if (data.existing) {
        toast({ title: "Draft already exists for this period" });
      } else {
        toast({ title: "Draft invoice created" });
      }
      setViewInvoice(data);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const finalizeMutation = useMutation({
    mutationFn: (invoiceId: number) => apiFetch(`/api/cycle-invoices/${invoiceId}/finalize`, token, {
      method: "POST",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinics", selectedClinicId, "cycle-invoices"] });
      setViewInvoice(null);
      toast({ title: "Invoice finalized" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const voidMutation = useMutation({
    mutationFn: (invoiceId: number) => apiFetch(`/api/cycle-invoices/${invoiceId}/void`, token, {
      method: "POST",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinics", selectedClinicId, "cycle-invoices"] });
      setViewInvoice(null);
      toast({ title: "Invoice voided" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const loadInvoice = async (invoiceId: number) => {
    try {
      const data = await apiFetch(`/api/cycle-invoices/${invoiceId}`, token);
      setViewInvoice(data);
    } catch (err: any) {
      toast({ title: "Error loading invoice", description: err.message, variant: "destructive" });
    }
  };

  const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const statusBadge = (status: string) => {
    switch (status) {
      case "draft": return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Draft</Badge>;
      case "finalized": return <Badge variant="default"><CheckCircle className="w-3 h-3 mr-1" />Finalized</Badge>;
      case "void": return <Badge variant="secondary"><XCircle className="w-3 h-3 mr-1" />Void</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Label>Clinic</Label>
        <Select value={selectedClinicId} onValueChange={(v) => { setSelectedClinicId(v); setPreviewData(null); setViewInvoice(null); }}>
          <SelectTrigger className="w-64" data-testid="select-cycle-invoice-clinic">
            <SelectValue placeholder="Select clinic" />
          </SelectTrigger>
          <SelectContent>
            {(clinicsQ.data || []).map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedClinicId && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="checkbox"
                checked={useCustomPeriod}
                onChange={(e) => setUseCustomPeriod(e.target.checked)}
                id="use-custom-period"
                data-testid="checkbox-custom-period"
                className="rounded"
              />
              <Label htmlFor="use-custom-period" className="cursor-pointer text-sm">Custom period</Label>
              {useCustomPeriod && (
                <>
                  <Input type="date" className="w-40" value={customPeriodStart} onChange={(e) => setCustomPeriodStart(e.target.value)} data-testid="input-period-start" />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input type="date" className="w-40" value={customPeriodEnd} onChange={(e) => setCustomPeriodEnd(e.target.value)} data-testid="input-period-end" />
                </>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending} data-testid="button-preview-cycle">
                {previewMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                <span className="ml-1.5">{useCustomPeriod ? "Preview Custom Period" : "Preview Current Cycle"}</span>
              </Button>
              <Button variant="outline" onClick={() => createDraftMutation.mutate()} disabled={createDraftMutation.isPending} data-testid="button-create-draft">
                {createDraftMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                <span className="ml-1.5">Create Draft</span>
              </Button>
            </div>
          </>
        )}
      </div>

      {previewData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Preview: {previewData.periodStart} to {previewData.periodEnd}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground mb-3">
              {previewData.eligibleTrips?.length || 0} eligible trips &middot; Total: {formatCents(previewData.totalCents || 0)}
            </div>
            {previewData.warnings?.length > 0 && (
              <div className="mb-3 p-2 bg-amber-50 dark:bg-amber-950 rounded text-sm text-amber-700 dark:text-amber-300">
                {previewData.warnings.map((w: string, i: number) => <div key={i}>{w}</div>)}
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trip</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Rider</TableHead>
                  <TableHead>Pickup</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(previewData.eligibleTrips || []).map((t: any) => (
                  <TableRow key={t.tripId} data-testid={`row-preview-trip-${t.tripId}`}>
                    <TableCell className="font-mono text-xs">{t.tripPublicId}</TableCell>
                    <TableCell>{t.date}</TableCell>
                    <TableCell>{t.riderName || "-"}</TableCell>
                    <TableCell className="max-w-48 truncate">{t.pickup}</TableCell>
                    <TableCell className="text-right">{formatCents(t.amountCents)}{t.requiresReview && <span className="text-amber-500 ml-1">*</span>}</TableCell>
                  </TableRow>
                ))}
                {(previewData.eligibleTrips || []).length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No eligible trips in this period</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {viewInvoice && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              Invoice #{viewInvoice.invoice?.id} {statusBadge(viewInvoice.invoice?.status)}
              <span className="text-sm font-normal text-muted-foreground">
                {viewInvoice.invoice?.periodStart} to {viewInvoice.invoice?.periodEnd}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span className="text-sm font-medium">Total: {formatCents(viewInvoice.invoice?.totalCents || 0)}</span>
              {viewInvoice.invoice?.status === "draft" && (
                <Button size="sm" onClick={() => finalizeMutation.mutate(viewInvoice.invoice.id)} disabled={finalizeMutation.isPending} data-testid="button-finalize-invoice">
                  {finalizeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  <span className="ml-1.5">Finalize</span>
                </Button>
              )}
              {viewInvoice.invoice?.status !== "void" && (
                <Button size="sm" variant="outline" onClick={() => voidMutation.mutate(viewInvoice.invoice.id)} disabled={voidMutation.isPending} data-testid="button-void-invoice">
                  <XCircle className="w-4 h-4" />
                  <span className="ml-1.5">Void</span>
                </Button>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(viewInvoice.items || []).map((item: any) => (
                  <TableRow key={item.id} data-testid={`row-invoice-item-${item.id}`}>
                    <TableCell className="text-sm">{item.description}</TableCell>
                    <TableCell className="text-right">{formatCents(item.amountCents)}</TableCell>
                  </TableRow>
                ))}
                {(viewInvoice.items || []).length === 0 && (
                  <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No line items</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {selectedClinicId && !invoicesQ.isLoading && (invoicesQ.data || []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoice History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoicesQ.data || []).map((inv: any) => (
                  <TableRow key={inv.id} data-testid={`row-cycle-invoice-${inv.id}`}>
                    <TableCell className="font-mono text-xs">#{inv.id}</TableCell>
                    <TableCell>{inv.periodStart} - {inv.periodEnd}</TableCell>
                    <TableCell>{statusBadge(inv.status)}</TableCell>
                    <TableCell className="text-right">{formatCents(inv.totalCents)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => loadInvoice(inv.id)} data-testid={`button-view-invoice-${inv.id}`}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {selectedClinicId && invoicesQ.isLoading && <Skeleton className="h-32" />}
    </div>
  );
}

export default function ClinicBillingPage() {
  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <DollarSign className="w-6 h-6" />
        <h1 className="text-xl font-semibold" data-testid="text-clinic-billing-title">Clinic Billing</h1>
      </div>

      <Tabs defaultValue="prices">
        <TabsList data-testid="tabs-clinic-billing">
          <TabsTrigger value="prices" data-testid="tab-prices" className="gap-1.5">
            <DollarSign className="w-4 h-4" />
            Prices
          </TabsTrigger>
          <TabsTrigger value="trips-log" data-testid="tab-trips-log" className="gap-1.5">
            <ClipboardList className="w-4 h-4" />
            Trips Log
          </TabsTrigger>
          <TabsTrigger value="invoices" data-testid="tab-invoices" className="gap-1.5">
            <FileText className="w-4 h-4" />
            Invoices
          </TabsTrigger>
          <TabsTrigger value="billing-settings" data-testid="tab-billing-settings" className="gap-1.5">
            <Settings className="w-4 h-4" />
            Billing Cycles
          </TabsTrigger>
          <TabsTrigger value="cycle-invoices" data-testid="tab-cycle-invoices" className="gap-1.5">
            <Calendar className="w-4 h-4" />
            Cycle Invoices
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prices">
          <PricesTab />
        </TabsContent>
        <TabsContent value="trips-log">
          <TripsLogTab />
        </TabsContent>
        <TabsContent value="invoices">
          <InvoicesTab />
        </TabsContent>
        <TabsContent value="billing-settings">
          <BillingCycleSettingsTab />
        </TabsContent>
        <TabsContent value="cycle-invoices">
          <CycleInvoicesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
