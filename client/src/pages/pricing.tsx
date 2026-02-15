import { useState } from "react";
import { useAuth, authHeaders } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign,
  Save,
  RotateCcw,
  Calculator,
  History,
  Truck,
  Accessibility,
  ArrowLeftRight,
  Clock,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";

interface PricingRule {
  id: number;
  profileId: number;
  key: string;
  valueNumeric: string | null;
  valueText: string | null;
  enabled: boolean;
  updatedBy: number | null;
  updatedAt: string | null;
}

interface ActivePricingData {
  profileId: number;
  profileName: string;
  source: string;
  rates: Record<string, number>;
  rules: PricingRule[];
  ruleLabels: Record<string, string>;
  allKeys: string[];
}

interface AuditEntry {
  id: number;
  profileId: number;
  key: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: number | null;
  changedAt: string;
  note: string | null;
}

const RULE_DISPLAY: Record<string, { label: string; unit: string; category: string }> = {
  base_fare_cents: { label: "Base Fare", unit: "cents", category: "core" },
  per_mile_cents: { label: "Per Mile Rate", unit: "cents", category: "core" },
  minimum_fare_cents: { label: "Minimum Fare", unit: "cents", category: "core" },
  max_fare_cents: { label: "Maximum Fare", unit: "cents", category: "core" },
  buffer_percent: { label: "Distance Buffer", unit: "%", category: "core" },
  round_trip_multiplier: { label: "Round Trip Multiplier", unit: "×", category: "core" },
  peak_surcharge_percent: { label: "Peak Hour Surcharge", unit: "%", category: "surcharges" },
  wheelchair_surcharge_cents: { label: "Wheelchair Surcharge", unit: "cents", category: "surcharges" },
  cancel_fee_cents: { label: "Cancellation Fee", unit: "cents", category: "fees" },
  no_show_fee_cents: { label: "No-Show Fee", unit: "cents", category: "fees" },
  wait_per_minute_cents: { label: "Wait Time / Minute", unit: "cents", category: "fees" },
  peak_start_hour_1: { label: "Peak Window 1 Start", unit: "hour", category: "peak" },
  peak_end_hour_1: { label: "Peak Window 1 End", unit: "hour", category: "peak" },
  peak_start_hour_2: { label: "Peak Window 2 Start", unit: "hour", category: "peak" },
  peak_end_hour_2: { label: "Peak Window 2 End", unit: "hour", category: "peak" },
};

function formatCentsDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function PricingPage() {
  const { token, user, cities } = useAuth();
  const { toast } = useToast();
  const [cityName, setCityName] = useState<string>("");
  const [mainTab, setMainTab] = useState("tariffs");
  const [editedValues, setEditedValues] = useState<Record<string, number>>({});
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [previewMiles, setPreviewMiles] = useState("10");
  const [previewMinutes, setPreviewMinutes] = useState("20");
  const [previewWheelchair, setPreviewWheelchair] = useState(false);
  const [previewRoundTrip, setPreviewRoundTrip] = useState(false);
  const [previewTime, setPreviewTime] = useState("10:00");

  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const canEdit = user?.role === "SUPER_ADMIN" || user?.role === "DISPATCH";

  const { data: pricingData, isLoading } = useQuery<ActivePricingData>({
    queryKey: ["/api/pricing/active", cityName],
    queryFn: async () => {
      if (!cityName) return null;
      const res = await fetch(`/api/pricing/active?city=${encodeURIComponent(cityName)}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load pricing");
      return res.json();
    },
    enabled: !!cityName && !!token,
  });

  const { data: auditData } = useQuery<AuditEntry[]>({
    queryKey: ["/api/pricing/audit", pricingData?.profileId],
    queryFn: async () => {
      if (!pricingData?.profileId) return [];
      const res = await fetch(`/api/pricing/audit?profileId=${pricingData.profileId}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!pricingData?.profileId,
  });

  const { data: previewData, refetch: refetchPreview, isFetching: previewLoading } = useQuery({
    queryKey: ["/api/pricing/preview-quote", cityName, previewMiles, previewMinutes, previewWheelchair, previewRoundTrip, previewTime],
    queryFn: async () => {
      if (!cityName) return null;
      const res = await fetch("/api/pricing/preview-quote", {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          miles: parseFloat(previewMiles) || 0,
          minutes: parseFloat(previewMinutes) || 0,
          isWheelchair: previewWheelchair,
          roundTrip: previewRoundTrip,
          scheduledTime: previewTime,
          city: cityName,
        }),
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: false,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!pricingData) throw new Error("No pricing data");
      const rules = Object.entries(editedValues).map(([key, valueNumeric]) => ({
        key,
        valueNumeric,
      }));
      return apiFetch("/api/pricing/rules", token, {
        method: "PUT",
        body: JSON.stringify({ profileId: pricingData.profileId, rules }),
      });
    },
    onSuccess: () => {
      toast({ title: "Tariffs saved successfully" });
      setEditedValues({});
      queryClient.invalidateQueries({ queryKey: ["/api/pricing/active", cityName] });
      queryClient.invalidateQueries({ queryKey: ["/api/pricing/audit"] });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!pricingData) throw new Error("No pricing data");
      return apiFetch("/api/pricing/reset-defaults", token, {
        method: "POST",
        body: JSON.stringify({ profileId: pricingData.profileId }),
      });
    },
    onSuccess: () => {
      toast({ title: "Tariffs reset to defaults" });
      setResetDialogOpen(false);
      setEditedValues({});
      queryClient.invalidateQueries({ queryKey: ["/api/pricing/active", cityName] });
      queryClient.invalidateQueries({ queryKey: ["/api/pricing/audit"] });
    },
    onError: (err: any) => {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    },
  });

  const getRuleValue = (key: string): number => {
    if (key in editedValues) return editedValues[key];
    const rule = pricingData?.rules.find(r => r.key === key);
    return rule?.valueNumeric ? parseFloat(rule.valueNumeric) : 0;
  };

  const handleValueChange = (key: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setEditedValues(prev => ({ ...prev, [key]: num }));
    } else if (value === "" || value === "-") {
      setEditedValues(prev => ({ ...prev, [key]: 0 }));
    }
  };

  const hasChanges = Object.keys(editedValues).length > 0;

  const renderCategory = (category: string, title: string, icon: React.ReactNode) => {
    const keys = Object.entries(RULE_DISPLAY).filter(([_, v]) => v.category === category);
    return (
      <Card data-testid={`card-category-${category}`}>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          {icon}
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          {keys.map(([key, display]) => {
            const val = getRuleValue(key);
            const isEdited = key in editedValues;
            return (
              <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3" data-testid={`rule-${key}`}>
                <Label className="text-xs text-muted-foreground sm:w-48 flex-shrink-0">
                  {display.label}
                </Label>
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    type="number"
                    step={display.unit === "×" ? "0.01" : display.unit === "%" ? "1" : "1"}
                    value={isEdited ? editedValues[key] : val}
                    onChange={(e) => handleValueChange(key, e.target.value)}
                    className="w-32"
                    disabled={!canEdit}
                    data-testid={`input-${key}`}
                  />
                  <span className="text-xs text-muted-foreground">{display.unit}</span>
                  {display.unit === "cents" && val > 0 && (
                    <Badge variant="outline" className="text-[10px]">{formatCentsDisplay(val)}</Badge>
                  )}
                  {isEdited && (
                    <Badge variant="secondary" className="text-[10px]">modified</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto" data-testid="page-pricing">
      <div className="flex flex-row flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Pricing / Tariffs</h1>
        <div className="flex flex-row flex-wrap items-center gap-2">
          {canEdit && hasChanges && (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid="button-save"
            >
              <Save className="mr-1 h-4 w-4" />
              {saveMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          )}
          {isSuperAdmin && pricingData && (
            <Button
              variant="outline"
              onClick={() => setResetDialogOpen(true)}
              data-testid="button-reset"
            >
              <RotateCcw className="mr-1 h-4 w-4" />
              Reset to Defaults
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-row flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">City</Label>
          <Select value={cityName} onValueChange={(v) => { setCityName(v); setEditedValues({}); }}>
            <SelectTrigger className="w-[200px]" data-testid="select-city">
              <SelectValue placeholder="Select city" />
            </SelectTrigger>
            <SelectContent>
              {cities.map((c) => (
                <SelectItem key={c.id} value={c.name} data-testid={`select-city-option-${c.id}`}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {pricingData && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" data-testid="badge-profile-name">
              {pricingData.profileName}
            </Badge>
            <Badge variant={pricingData.source === "city" ? "default" : "secondary"} data-testid="badge-profile-source">
              {pricingData.source === "city" ? "City-specific" : "Global Default"}
            </Badge>
          </div>
        )}
      </div>

      {!cityName && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            <DollarSign className="mx-auto h-8 w-8 mb-2 opacity-50" />
            Select a city to view and edit pricing tariffs
          </CardContent>
        </Card>
      )}

      {cityName && isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {cityName && pricingData && (
        <Tabs value={mainTab} onValueChange={setMainTab}>
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="tariffs" data-testid="tab-tariffs">Tariffs</TabsTrigger>
            <TabsTrigger value="preview" data-testid="tab-preview">Preview Quote</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="tariffs" className="mt-4 space-y-4">
            {renderCategory("core", "Core Rates", <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />)}
            {renderCategory("surcharges", "Surcharges", <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400" />)}
            {renderCategory("fees", "Fees & Wait Time", <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />)}
            {renderCategory("peak", "Peak Hour Windows", <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400" />)}

            {hasChanges && (
              <Card className="border-amber-500/50" data-testid="card-unsaved">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-sm">You have unsaved changes ({Object.keys(editedValues).length} fields modified)</span>
                  </div>
                  <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-bottom">
                    <Save className="mr-1 h-4 w-4" />
                    {saveMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="preview" className="mt-4">
            <Card data-testid="card-preview">
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <Calculator className="h-4 w-4" />
                <CardTitle className="text-sm">Quote Preview</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-4">
                <p className="text-xs text-muted-foreground">
                  Enter trip parameters to preview the calculated price using current tariffs. No data is saved.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Miles</Label>
                    <Input
                      type="number"
                      value={previewMiles}
                      onChange={(e) => setPreviewMiles(e.target.value)}
                      step="0.1"
                      data-testid="input-preview-miles"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Minutes</Label>
                    <Input
                      type="number"
                      value={previewMinutes}
                      onChange={(e) => setPreviewMinutes(e.target.value)}
                      data-testid="input-preview-minutes"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Pickup Time</Label>
                    <Input
                      type="time"
                      value={previewTime}
                      onChange={(e) => setPreviewTime(e.target.value)}
                      data-testid="input-preview-time"
                    />
                  </div>
                </div>
                <div className="flex flex-row flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={previewWheelchair}
                      onChange={(e) => setPreviewWheelchair(e.target.checked)}
                      data-testid="checkbox-preview-wheelchair"
                    />
                    <Accessibility className="h-4 w-4" />
                    Wheelchair
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={previewRoundTrip}
                      onChange={(e) => setPreviewRoundTrip(e.target.checked)}
                      data-testid="checkbox-preview-roundtrip"
                    />
                    <ArrowLeftRight className="h-4 w-4" />
                    Round Trip
                  </label>
                </div>
                <Button onClick={() => refetchPreview()} disabled={previewLoading} data-testid="button-preview-calculate">
                  <Calculator className="mr-1 h-4 w-4" />
                  {previewLoading ? "Calculating..." : "Calculate Quote"}
                </Button>

                {previewData && (
                  <Card className="mt-3" data-testid="card-preview-result">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">Estimated Total</span>
                        <span className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-preview-total">
                          {previewData.totalFormatted}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {previewData.breakdown.baseFareCents > 0 && (
                          <div className="flex justify-between gap-2">
                            <span>Base fare</span>
                            <span>{formatCentsDisplay(previewData.breakdown.baseFareCents)}</span>
                          </div>
                        )}
                        <div className="flex justify-between gap-2">
                          <span>Distance charge</span>
                          <span>{formatCentsDisplay(previewData.breakdown.mileChargeCents)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span>Buffer</span>
                          <span>{formatCentsDisplay(previewData.breakdown.bufferCents)}</span>
                        </div>
                        {previewData.breakdown.isPeak && (
                          <div className="flex justify-between gap-2">
                            <span>Peak surcharge</span>
                            <span>{formatCentsDisplay(previewData.breakdown.peakCents)}</span>
                          </div>
                        )}
                        {previewData.breakdown.wavCents > 0 && (
                          <div className="flex justify-between gap-2">
                            <span>Wheelchair surcharge</span>
                            <span>{formatCentsDisplay(previewData.breakdown.wavCents)}</span>
                          </div>
                        )}
                        {previewData.breakdown.roundTripMultiplier > 1 && (
                          <div className="flex justify-between gap-2">
                            <span>Round trip multiplier</span>
                            <span>{previewData.breakdown.roundTripMultiplier}×</span>
                          </div>
                        )}
                        {previewData.breakdown.minimumApplied && (
                          <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 mt-1">
                            <AlertTriangle className="h-3 w-3" />
                            Minimum fare applied
                          </div>
                        )}
                        {previewData.breakdown.maximumApplied && (
                          <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 mt-1">
                            <AlertTriangle className="h-3 w-3" />
                            Maximum fare cap applied
                          </div>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-2">
                        Profile: {previewData.profileName}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <Card data-testid="card-audit">
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <History className="h-4 w-4" />
                <CardTitle className="text-sm">Change History</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {!auditData || auditData.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No pricing changes recorded yet
                  </div>
                ) : (
                  <div className="divide-y max-h-[500px] overflow-y-auto">
                    {auditData.map((entry) => {
                      const display = RULE_DISPLAY[entry.key];
                      const label = display?.label || entry.key;
                      const unit = display?.unit || "";
                      return (
                        <div key={entry.id} className="px-4 py-3 text-xs" data-testid={`audit-entry-${entry.id}`}>
                          <div className="flex flex-row flex-wrap items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{label}</Badge>
                            <span className="text-muted-foreground">
                              {entry.oldValue}{unit !== "cents" ? ` ${unit}` : ""} 
                              {" "}&rarr;{" "}
                              {entry.newValue}{unit !== "cents" ? ` ${unit}` : ""}
                            </span>
                            {unit === "cents" && entry.oldValue && entry.newValue && (
                              <span className="text-muted-foreground">
                                ({formatCentsDisplay(parseFloat(entry.oldValue))} &rarr; {formatCentsDisplay(parseFloat(entry.newValue))})
                              </span>
                            )}
                          </div>
                          <div className="flex flex-row flex-wrap items-center gap-2 mt-1 text-muted-foreground">
                            <span>{new Date(entry.changedAt).toLocaleString()}</span>
                            {entry.note && <Badge variant="secondary" className="text-[10px]">{entry.note}</Badge>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent data-testid="dialog-reset">
          <DialogHeader>
            <DialogTitle>Reset to Default Tariffs</DialogTitle>
            <DialogDescription>
              This will reset all pricing rules for "{pricingData?.profileName}" back to the system defaults.
              This action is logged and cannot be undone automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              data-testid="button-confirm-reset"
            >
              {resetMutation.isPending ? "Resetting..." : "Reset All Tariffs"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
