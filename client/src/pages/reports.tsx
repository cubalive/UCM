import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart3,
  Trophy,
  Settings,
  Calculator,
  CheckCircle,
  XCircle,
  Clock,
  UserX,
  TrendingUp,
  Star,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const { token, selectedCity, user } = useAuth();
  const { toast } = useToast();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const isAdmin = user?.role === "ADMIN" || isSuperAdmin;

  const [weekStart, setWeekStart] = useState(getMonday(new Date()));

  return (
    <div className="p-4 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <BarChart3 className="w-6 h-6" />
        <h1 className="text-xl font-semibold" data-testid="text-reports-title">Driver Reports</h1>
      </div>

      <Tabs defaultValue="metrics" className="space-y-4">
        <TabsList data-testid="tabs-reports">
          <TabsTrigger value="metrics" data-testid="tab-metrics">Weekly Metrics</TabsTrigger>
          <TabsTrigger value="scores" data-testid="tab-scores">Driver Scores</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="bonus" data-testid="tab-bonus">Bonus Rules</TabsTrigger>
          )}
          {isSuperAdmin && (
            <TabsTrigger value="compute" data-testid="tab-compute">Compute Bonus</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="metrics">
          <WeeklyMetricsTab token={token} selectedCity={selectedCity} weekStart={weekStart} setWeekStart={setWeekStart} />
        </TabsContent>

        <TabsContent value="scores">
          <DriverScoresTab token={token} selectedCity={selectedCity} weekStart={weekStart} setWeekStart={setWeekStart} isSuperAdmin={isSuperAdmin} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="bonus">
            <BonusRulesTab token={token} selectedCity={selectedCity} />
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="compute">
            <ComputeBonusTab token={token} selectedCity={selectedCity} weekStart={weekStart} setWeekStart={setWeekStart} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function WeeklyMetricsTab({
  token,
  selectedCity,
  weekStart,
  setWeekStart,
}: {
  token: string | null;
  selectedCity: any;
  weekStart: string;
  setWeekStart: (v: string) => void;
}) {
  const cityParam = selectedCity ? `&cityId=${selectedCity.id}` : "";

  const { data: metrics, isLoading } = useQuery<any[]>({
    queryKey: ["/api/reports/drivers/weekly", weekStart, selectedCity?.id],
    queryFn: () => apiFetch(`/api/reports/drivers/weekly?weekStart=${weekStart}${cityParam}`, token),
    enabled: !!token && !!selectedCity?.id,
  });

  if (!selectedCity?.id) {
    return <p className="text-sm text-muted-foreground">Please select a city to view weekly metrics.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Label>Week Starting</Label>
        <Input
          type="date"
          value={weekStart}
          onChange={(e) => setWeekStart(e.target.value)}
          className="w-auto"
          data-testid="input-week-start"
        />
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {metrics && metrics.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="text-no-metrics">No driver data for this week</p>
      )}

      {metrics && metrics.length > 0 && (
        <div className="grid gap-3">
          {metrics.map((m: any) => (
            <Card key={m.driverId} data-testid={`card-driver-metric-${m.driverId}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-1">
                    <p className="font-medium" data-testid={`text-driver-name-${m.driverId}`}>{m.driverName}</p>
                    <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
                      <span data-testid={`text-assigned-${m.driverId}`}>Assigned: {m.assigned}</span>
                      <span data-testid={`text-completed-${m.driverId}`}>Completed: {m.completed}</span>
                      <span data-testid={`text-cancelled-${m.driverId}`}>Cancelled: {m.cancellations}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" data-testid={`badge-completion-${m.driverId}`}>
                      <TrendingUp className="w-3 h-3 mr-1" />
                      {(m.completionRate * 100).toFixed(0)}%
                    </Badge>
                    {m.noShowDriver > 0 && (
                      <Badge variant="destructive" data-testid={`badge-noshow-${m.driverId}`}>
                        <UserX className="w-3 h-3 mr-1" />
                        {m.noShowDriver} no-show
                      </Badge>
                    )}
                    {m.lateDriver > 0 && (
                      <Badge variant="secondary" data-testid={`badge-late-${m.driverId}`}>
                        <Clock className="w-3 h-3 mr-1" />
                        {m.lateDriver} late ({m.avgLateMinutes?.toFixed(0) || 0} min avg)
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function BonusRulesTab({
  token,
  selectedCity,
}: {
  token: string | null;
  selectedCity: any;
}) {
  const { toast } = useToast();
  const cityId = selectedCity?.id;

  const { data: rule, isLoading } = useQuery<any>({
    queryKey: ["/api/bonus-rules", cityId],
    queryFn: () => apiFetch(`/api/bonus-rules/${cityId}`, token),
    enabled: !!token && !!cityId,
  });

  const [editing, setEditing] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [weeklyAmount, setWeeklyAmount] = useState("");
  const [maxNoShow, setMaxNoShow] = useState("");
  const [maxLate, setMaxLate] = useState("");
  const [minCompletion, setMinCompletion] = useState("");

  const startEdit = () => {
    if (rule) {
      setIsEnabled(!!rule.isEnabled);
      setWeeklyAmount(rule.weeklyAmountCents ? (rule.weeklyAmountCents / 100).toFixed(2) : "");
      setMaxNoShow(rule.criteriaJson?.maxNoShowDriver?.toString() || "");
      setMaxLate(rule.criteriaJson?.maxLateDriver?.toString() || "");
      setMinCompletion(rule.criteriaJson?.minCompletionRate?.toString() || "");
    }
    setEditing(true);
  };

  const saveMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch(`/api/bonus-rules/${cityId}`, token, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bonus-rules", cityId] });
      toast({ title: "Bonus rules saved" });
      setEditing(false);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSave = () => {
    const cents = Math.round(parseFloat(weeklyAmount || "0") * 100);
    const criteria: any = {};
    if (maxNoShow) criteria.maxNoShowDriver = parseInt(maxNoShow);
    if (maxLate) criteria.maxLateDriver = parseInt(maxLate);
    if (minCompletion) criteria.minCompletionRate = parseFloat(minCompletion);
    saveMutation.mutate({
      isEnabled,
      weeklyAmountCents: cents,
      criteriaJson: Object.keys(criteria).length > 0 ? criteria : null,
    });
  };

  if (!cityId) {
    return <p className="text-sm text-muted-foreground">Please select a city to manage bonus rules.</p>;
  }

  return (
    <div className="space-y-4">
      {isLoading && <Skeleton className="h-40 w-full" />}

      {rule && !editing && (
        <Card data-testid="card-bonus-rule">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="w-5 h-5" />
              Bonus Rules - {selectedCity?.name}
            </CardTitle>
            <Button size="sm" variant="outline" onClick={startEdit} data-testid="button-edit-bonus-rules">
              <Settings className="w-4 h-4 mr-1" />
              Configure
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              <Badge variant={rule.isEnabled ? "secondary" : "outline"} data-testid="badge-bonus-status">
                {rule.isEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Weekly Amount:</span>
              <span className="text-sm font-medium" data-testid="text-bonus-amount">
                ${(rule.weeklyAmountCents / 100).toFixed(2)}
              </span>
            </div>
            {rule.criteriaJson && (
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground">Criteria:</span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {rule.criteriaJson.maxNoShowDriver != null && (
                    <Badge variant="outline" data-testid="badge-criteria-noshow">
                      Max No-Shows: {rule.criteriaJson.maxNoShowDriver}
                    </Badge>
                  )}
                  {rule.criteriaJson.maxLateDriver != null && (
                    <Badge variant="outline" data-testid="badge-criteria-late">
                      Max Late: {rule.criteriaJson.maxLateDriver}
                    </Badge>
                  )}
                  {rule.criteriaJson.minCompletionRate != null && (
                    <Badge variant="outline" data-testid="badge-criteria-completion">
                      Min Completion: {(rule.criteriaJson.minCompletionRate * 100).toFixed(0)}%
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {editing && (
        <Card data-testid="card-edit-bonus-rule">
          <CardHeader>
            <CardTitle className="text-base">Configure Bonus Rules - {selectedCity?.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch checked={isEnabled} onCheckedChange={setIsEnabled} data-testid="switch-bonus-enabled" />
              <Label>Enable weekly bonus</Label>
            </div>

            <div className="space-y-1">
              <Label>Weekly Bonus Amount ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={weeklyAmount}
                onChange={(e) => setWeeklyAmount(e.target.value)}
                placeholder="e.g. 50.00"
                data-testid="input-bonus-amount"
              />
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-3">Eligibility Criteria (optional)</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>Max No-Shows (driver)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={maxNoShow}
                    onChange={(e) => setMaxNoShow(e.target.value)}
                    placeholder="e.g. 0"
                    data-testid="input-max-noshow"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Max Late Arrivals (driver)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={maxLate}
                    onChange={(e) => setMaxLate(e.target.value)}
                    placeholder="e.g. 2"
                    data-testid="input-max-late"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Min Completion Rate (0-1)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={minCompletion}
                    onChange={(e) => setMinCompletion(e.target.value)}
                    placeholder="e.g. 0.90"
                    data-testid="input-min-completion"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-bonus-rules">
                {saveMutation.isPending ? "Saving..." : "Save Rules"}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)} data-testid="button-cancel-bonus-rules">
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ComputeBonusTab({
  token,
  selectedCity,
  weekStart,
  setWeekStart,
}: {
  token: string | null;
  selectedCity: any;
  weekStart: string;
  setWeekStart: (v: string) => void;
}) {
  const { toast } = useToast();
  const [result, setResult] = useState<any>(null);

  const computeMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/bonuses/compute-week`, token, {
        method: "POST",
        body: JSON.stringify({
          weekStart,
          cityId: selectedCity?.id,
        }),
      }),
    onSuccess: (data: any) => {
      setResult(data);
      toast({ title: "Bonus computation complete" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (!selectedCity?.id) {
    return <p className="text-sm text-muted-foreground">Please select a city to compute bonuses.</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Evaluate which drivers are eligible for the weekly bonus based on configured rules.
            This does not auto-pay; it produces an eligibility report.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <Label>Week Starting</Label>
            <Input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              className="w-auto"
              data-testid="input-compute-week-start"
            />
          </div>
          <Button
            onClick={() => computeMutation.mutate()}
            disabled={computeMutation.isPending}
            data-testid="button-compute-bonus"
          >
            <Calculator className="w-4 h-4 mr-1" />
            {computeMutation.isPending ? "Computing..." : "Compute Eligibility"}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <div className="space-y-4">
          {result.eligible?.length > 0 && (
            <Card data-testid="card-eligible-drivers">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  Eligible Drivers ({result.eligible.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {result.eligible.map((d: any) => (
                    <div key={d.driverId} className="flex items-center justify-between gap-2 p-2 border rounded-md" data-testid={`eligible-driver-${d.driverId}`}>
                      <span className="text-sm font-medium">{d.driverName}</span>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary">
                          {(d.completionRate * 100).toFixed(0)}% complete
                        </Badge>
                        <span className="text-sm font-medium text-green-600">
                          ${(d.bonusAmountCents / 100).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {result.ineligible?.length > 0 && (
            <Card data-testid="card-ineligible-drivers">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-destructive" />
                  Ineligible Drivers ({result.ineligible.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {result.ineligible.map((d: any) => (
                    <div key={d.driverId} className="flex items-center justify-between gap-2 p-2 border rounded-md" data-testid={`ineligible-driver-${d.driverId}`}>
                      <span className="text-sm font-medium">{d.driverName}</span>
                      <div className="flex items-center gap-2 flex-wrap">
                        {d.reasons?.map((r: string, i: number) => (
                          <Badge key={i} variant="destructive">{r}</Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {result.eligible?.length === 0 && result.ineligible?.length === 0 && (
            <p className="text-sm text-muted-foreground">No drivers found for this period.</p>
          )}
        </div>
      )}
    </div>
  );
}

function DriverScoresTab({
  token,
  selectedCity,
  weekStart,
  setWeekStart,
  isSuperAdmin,
}: {
  token: string | null;
  selectedCity: any;
  weekStart: string;
  setWeekStart: (v: string) => void;
  isSuperAdmin: boolean;
}) {
  const { toast } = useToast();
  const cityParam = selectedCity ? `&cityId=${selectedCity.id}` : "";

  const { data: scores, isLoading } = useQuery<any[]>({
    queryKey: ["/api/driver-scores", selectedCity?.id, weekStart],
    queryFn: () => apiFetch(`/api/driver-scores?weekStart=${weekStart}${cityParam}`, token),
    enabled: !!token && !!selectedCity?.id,
  });

  const computeMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/driver-scores/compute", token, {
        method: "POST",
        body: JSON.stringify({ cityId: selectedCity?.id, weekStart }),
      }),
    onSuccess: () => {
      toast({ title: "Scores computed successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/driver-scores"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!selectedCity?.id) {
    return <p className="text-sm text-muted-foreground">Please select a city to view driver scores.</p>;
  }

  function getScoreColor(score: number): string {
    if (score >= 80) return "text-green-600 dark:text-green-400";
    if (score >= 60) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  }

  function getScoreBadge(score: number, driverId: number) {
    if (score >= 80) return <Badge variant="default" data-testid={`badge-score-${driverId}`}>Excellent</Badge>;
    if (score >= 60) return <Badge variant="secondary" data-testid={`badge-score-${driverId}`}>Good</Badge>;
    return <Badge variant="destructive" data-testid={`badge-score-${driverId}`}>Needs Improvement</Badge>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Label>Week Starting</Label>
        <Input
          type="date"
          value={weekStart}
          onChange={(e) => setWeekStart(e.target.value)}
          className="w-auto"
          data-testid="input-score-week-start"
        />
        {isSuperAdmin && (
          <Button
            onClick={() => computeMutation.mutate()}
            disabled={computeMutation.isPending}
            data-testid="button-compute-scores"
          >
            <Calculator className="w-4 h-4 mr-2" />
            {computeMutation.isPending ? "Computing..." : "Compute Scores"}
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {scores && scores.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <Star className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground">No scores computed for this week yet.</p>
            {isSuperAdmin && <p className="text-xs text-muted-foreground mt-1">Use "Compute Scores" to generate weekly scores.</p>}
          </CardContent>
        </Card>
      )}

      {scores && scores.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {scores.map((s: any) => (
            <Card key={s.id} data-testid={`card-driver-score-${s.driverId}`}>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="font-medium" data-testid={`text-score-driver-${s.driverId}`}>Driver #{s.driverId}</p>
                    <p className="text-xs text-muted-foreground">{s.weekStart} to {s.weekEnd}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-2xl font-bold ${getScoreColor(s.score)}`} data-testid={`text-score-value-${s.driverId}`}>{s.score}</p>
                    {getScoreBadge(s.score, s.driverId)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    <span>{s.completedTrips}/{s.totalTrips} completed</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-emerald-500" />
                    <span>{Math.round(s.onTimeRate * 100)}% on-time</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-red-500" />
                    <span>{s.cancellations} cancellations</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <UserX className="w-3 h-3 text-amber-500" />
                    <span>{s.lateCount} late</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
