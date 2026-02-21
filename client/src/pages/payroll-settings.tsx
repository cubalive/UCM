import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Settings, DollarSign, Clock, AlertTriangle, Loader2, Save } from "lucide-react";

const DAYS_OF_WEEK = [
  { value: "MON", label: "Mon" },
  { value: "TUE", label: "Tue" },
  { value: "WED", label: "Wed" },
  { value: "THU", label: "Thu" },
  { value: "FRI", label: "Fri" },
  { value: "SAT", label: "Sat" },
  { value: "SUN", label: "Sun" },
];

function centsToDollars(cents: number | null | undefined): string {
  if (cents == null || isNaN(cents)) return "";
  return (cents / 100).toFixed(2);
}

function dollarsToCents(dollars: string): number {
  const val = parseFloat(dollars);
  if (isNaN(val)) return 0;
  return Math.round(val * 100);
}

interface PayRules {
  dailyMinEnabled: boolean;
  dailyMinCents: number;
  dailyMinAppliesDays: string[];
  onTimeBonusEnabled: boolean;
  onTimeBonusMode: string;
  onTimeBonusCents: number;
  onTimeThresholdMinutes: number;
  onTimeRequiresConfirmedPickup: boolean;
  noShowPenaltyEnabled: boolean;
  noShowPenaltyCents: number;
  noShowPenaltyReasonCodes: string[];
}

const DEFAULT_RULES: PayRules = {
  dailyMinEnabled: false,
  dailyMinCents: 0,
  dailyMinAppliesDays: ["MON", "TUE", "WED", "THU", "FRI"],
  onTimeBonusEnabled: false,
  onTimeBonusMode: "PER_TRIP",
  onTimeBonusCents: 0,
  onTimeThresholdMinutes: 15,
  onTimeRequiresConfirmedPickup: false,
  noShowPenaltyEnabled: false,
  noShowPenaltyCents: 0,
  noShowPenaltyReasonCodes: [],
};

export default function PayrollSettingsPage() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [form, setForm] = useState<PayRules>(DEFAULT_RULES);
  const [dailyMinDollars, setDailyMinDollars] = useState("");
  const [onTimeBonusDollars, setOnTimeBonusDollars] = useState("");
  const [noShowPenaltyDollars, setNoShowPenaltyDollars] = useState("");

  const rulesQuery = useQuery<{ rules: PayRules | null }>({
    queryKey: ["/api/company/payroll/pay-rules"],
  });

  const settingsQuery = useQuery<{ settings: any | null }>({
    queryKey: ["/api/company/payroll/settings"],
  });

  useEffect(() => {
    if (rulesQuery.data?.rules) {
      const r = rulesQuery.data.rules;
      setForm(r);
      setDailyMinDollars(centsToDollars(r.dailyMinCents));
      setOnTimeBonusDollars(centsToDollars(r.onTimeBonusCents));
      setNoShowPenaltyDollars(centsToDollars(r.noShowPenaltyCents));
    }
  }, [rulesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        dailyMinCents: dollarsToCents(dailyMinDollars),
        onTimeBonusCents: dollarsToCents(onTimeBonusDollars),
        noShowPenaltyCents: dollarsToCents(noShowPenaltyDollars),
      };
      return apiRequest("PUT", "/api/company/payroll/pay-rules", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/payroll/pay-rules"] });
      toast({ title: "Pay rules saved successfully" });
    },
    onError: (e: any) => {
      toast({ title: "Error saving pay rules", description: e.message, variant: "destructive" });
    },
  });

  function toggleDay(day: string) {
    setForm((prev) => {
      const days = prev.dailyMinAppliesDays.includes(day)
        ? prev.dailyMinAppliesDays.filter((d) => d !== day)
        : [...prev.dailyMinAppliesDays, day];
      return { ...prev, dailyMinAppliesDays: days };
    });
  }

  const settings = settingsQuery.data?.settings;
  const payModeLabel = settings?.payMode === "HOURLY" ? "Hourly" : settings?.payMode === "PER_TRIP" ? "Per Trip" : settings?.payMode || "Not set";
  const cadenceLabel = settings?.cadence || "Not set";

  if (rulesQuery.isLoading || settingsQuery.isLoading) {
    return (
      <div className="p-4 space-y-4 max-w-3xl mx-auto" data-testid="payroll-settings-loading">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 max-w-3xl mx-auto" data-testid="payroll-settings-page">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-payroll-settings-title">Payroll Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Configure pay policy and earnings modifiers for your company.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Settings className="h-5 w-5 text-muted-foreground" />
            Pay Policy
          </CardTitle>
          <Badge variant="outline" data-testid="badge-readonly">Read Only</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground text-xs">Pay Mode</Label>
              <p className="text-sm font-medium mt-1" data-testid="text-pay-mode">{payModeLabel}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Cadence</Label>
              <p className="text-sm font-medium mt-1" data-testid="text-cadence">{cadenceLabel}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            Earnings Modifiers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium text-sm">Daily Minimum Guarantee</p>
                <p className="text-xs text-muted-foreground">Ensure drivers earn at least a minimum amount per day.</p>
              </div>
              <Switch
                checked={form.dailyMinEnabled}
                onCheckedChange={(v) => setForm((p) => ({ ...p, dailyMinEnabled: v }))}
                data-testid="switch-daily-min"
              />
            </div>
            {form.dailyMinEnabled && (
              <div className="pl-4 border-l-2 border-muted space-y-3">
                <div>
                  <Label htmlFor="daily-min-amount" className="text-sm">Minimum Amount ($)</Label>
                  <Input
                    id="daily-min-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={dailyMinDollars}
                    onChange={(e) => setDailyMinDollars(e.target.value)}
                    className="max-w-48 mt-1"
                    data-testid="input-daily-min-amount"
                  />
                </div>
                <div>
                  <Label className="text-sm">Applies on Days</Label>
                  <div className="flex flex-wrap gap-3 mt-2">
                    {DAYS_OF_WEEK.map((day) => (
                      <label key={day.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <Checkbox
                          checked={form.dailyMinAppliesDays.includes(day.value)}
                          onCheckedChange={() => toggleDay(day.value)}
                          data-testid={`checkbox-day-${day.value}`}
                        />
                        {day.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <hr className="border-muted" />

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium text-sm flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  On-time Bonus
                </p>
                <p className="text-xs text-muted-foreground">Reward drivers for arriving on time.</p>
              </div>
              <Switch
                checked={form.onTimeBonusEnabled}
                onCheckedChange={(v) => setForm((p) => ({ ...p, onTimeBonusEnabled: v }))}
                data-testid="switch-on-time-bonus"
              />
            </div>
            {form.onTimeBonusEnabled && (
              <div className="pl-4 border-l-2 border-muted space-y-3">
                <div>
                  <Label htmlFor="on-time-mode" className="text-sm">Mode</Label>
                  <Select
                    value={form.onTimeBonusMode}
                    onValueChange={(v) => setForm((p) => ({ ...p, onTimeBonusMode: v }))}
                  >
                    <SelectTrigger className="max-w-48 mt-1" data-testid="select-on-time-mode">
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PER_TRIP">Per Trip</SelectItem>
                      <SelectItem value="WEEKLY">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="on-time-amount" className="text-sm">Bonus Amount ($)</Label>
                  <Input
                    id="on-time-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={onTimeBonusDollars}
                    onChange={(e) => setOnTimeBonusDollars(e.target.value)}
                    className="max-w-48 mt-1"
                    data-testid="input-on-time-amount"
                  />
                </div>
                <div>
                  <Label htmlFor="on-time-threshold" className="text-sm">Threshold (minutes before pickup)</Label>
                  <Input
                    id="on-time-threshold"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="15"
                    value={form.onTimeThresholdMinutes}
                    onChange={(e) => setForm((p) => ({ ...p, onTimeThresholdMinutes: parseInt(e.target.value) || 0 }))}
                    className="max-w-48 mt-1"
                    data-testid="input-on-time-threshold"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={form.onTimeRequiresConfirmedPickup}
                    onCheckedChange={(v) => setForm((p) => ({ ...p, onTimeRequiresConfirmedPickup: !!v }))}
                    data-testid="checkbox-requires-confirmed-pickup"
                  />
                  Requires confirmed pickup
                </label>
              </div>
            )}
          </div>

          <hr className="border-muted" />

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium text-sm flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  No-show Penalty
                </p>
                <p className="text-xs text-muted-foreground">Deduct from driver pay for no-show trips.</p>
              </div>
              <Switch
                checked={form.noShowPenaltyEnabled}
                onCheckedChange={(v) => setForm((p) => ({ ...p, noShowPenaltyEnabled: v }))}
                data-testid="switch-no-show-penalty"
              />
            </div>
            {form.noShowPenaltyEnabled && (
              <div className="pl-4 border-l-2 border-muted space-y-3">
                <div>
                  <Label htmlFor="no-show-amount" className="text-sm">Penalty Amount ($)</Label>
                  <Input
                    id="no-show-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={noShowPenaltyDollars}
                    onChange={(e) => setNoShowPenaltyDollars(e.target.value)}
                    className="max-w-48 mt-1"
                    data-testid="input-no-show-amount"
                  />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          data-testid="button-save-pay-rules"
        >
          {saveMutation.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1 h-4 w-4" />
          )}
          Save Pay Rules
        </Button>
      </div>
    </div>
  );
}
