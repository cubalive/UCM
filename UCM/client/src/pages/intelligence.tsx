import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Shield,
  CheckCircle2,
  Activity,
  BarChart3,
  Users,
  Building2,
  Clock,
  DollarSign,
  Target,
  Eye,
  CheckCheck,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

function getDateRange(days: number) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  };
}

function getWeekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

function ScoreBar({ label, score, maxScore = 100 }: { label: string; score: number | null; maxScore?: number }) {
  const pct = score != null ? Math.min(Math.max((Number(score) / maxScore) * 100, 0), 100) : 0;
  const color = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-500" : pct >= 40 ? "bg-orange-500" : "bg-red-500";

  return (
    <div className="space-y-1" data-testid={`score-bar-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-medium">{score != null ? Number(score).toFixed(1) : "N/A"}</span>
      </div>
      <div className="w-full h-2 rounded-full bg-muted">
        <div className={`h-full rounded-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TrendIndicator({ current, previous }: { current: number; previous?: number }) {
  if (previous === undefined || previous === null) return <Minus className="h-4 w-4 text-muted-foreground" />;
  const diff = current - previous;
  if (diff > 0) return <ArrowUpRight className="h-4 w-4 text-green-500" />;
  if (diff < 0) return <ArrowDownRight className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

export default function IntelligencePage() {
  const { user, selectedCity, token } = useAuth();
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState("7");
  const [entityType, setEntityType] = useState<"drivers" | "clinics">("drivers");
  const [alertStatus, setAlertStatus] = useState("OPEN");

  const cityId = selectedCity?.id;
  const cityParam = cityId ? `&city_id=${cityId}` : "";
  const range = getDateRange(parseInt(dateRange));
  const weekStart = getWeekStart();

  const rollupsQuery = useQuery({
    queryKey: ["/api/intel/rollups", range.from, range.to, cityId],
    queryFn: () => apiFetch(`/api/intel/rollups?from=${range.from}&to=${range.to}${cityParam}`, token),
    refetchInterval: 60000,
  });

  const rankingsQuery = useQuery({
    queryKey: ["/api/intel/rankings", entityType, weekStart, cityId],
    queryFn: () => apiFetch(`/api/intel/rankings/${entityType}?week_start=${weekStart}${cityParam}`, token),
  });

  const alertsQuery = useQuery({
    queryKey: ["/api/intel/cost-leak-alerts", alertStatus, cityId],
    queryFn: () => apiFetch(`/api/intel/cost-leak-alerts?status=${alertStatus}${cityParam}`, token),
  });

  const certsQuery = useQuery({
    queryKey: ["/api/intel/certifications", cityId],
    queryFn: () => apiFetch(`/api/intel/certifications?${cityParam.replace("&", "")}`, token),
  });

  const triQuery = useQuery({
    queryKey: ["/api/intel/tri-scores", range.from, range.to, cityId],
    queryFn: () => apiFetch(`/api/intel/tri-scores?from=${range.from}&to=${range.to}${cityParam}`, token),
  });

  const ackMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/intel/cost-leak-alerts/${id}/acknowledge`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intel/cost-leak-alerts"] });
      toast({ title: "Alert acknowledged" });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/intel/cost-leak-alerts/${id}/resolve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intel/cost-leak-alerts"] });
      toast({ title: "Alert resolved" });
    },
  });

  const rollups = rollupsQuery.data?.rollups || [];
  const rankings = rankingsQuery.data?.rankings || [];
  const alerts = alertsQuery.data?.alerts || [];
  const certs = certsQuery.data?.certifications || [];
  const triScoresData = triQuery.data?.triScores || [];

  const summary = useMemo(() => {
    if (!rollups.length) return null;
    return rollups.reduce(
      (acc: any, r: any) => ({
        tripsTotal: acc.tripsTotal + (r.tripsTotal || 0),
        tripsCompleted: acc.tripsCompleted + (r.tripsCompleted || 0),
        tripsCancelled: acc.tripsCancelled + (r.tripsCancelled || 0),
        tripsNoShow: acc.tripsNoShow + (r.tripsNoShow || 0),
        onTimePickupCount: acc.onTimePickupCount + (r.onTimePickupCount || 0),
        latePickupCount: acc.latePickupCount + (r.latePickupCount || 0),
        gpsVerifiedCount: acc.gpsVerifiedCount + (r.gpsVerifiedCount || 0),
        revenueCents: acc.revenueCents + (r.revenueCents || 0),
        estCostCents: acc.estCostCents + (r.estCostCents || 0),
        marginCents: acc.marginCents + (r.marginCents || 0),
      }),
      {
        tripsTotal: 0, tripsCompleted: 0, tripsCancelled: 0, tripsNoShow: 0,
        onTimePickupCount: 0, latePickupCount: 0, gpsVerifiedCount: 0,
        revenueCents: 0, estCostCents: 0, marginCents: 0,
      }
    );
  }, [rollups]);

  const completionRate = summary && summary.tripsTotal > 0
    ? ((summary.tripsCompleted / summary.tripsTotal) * 100).toFixed(1)
    : "0.0";
  const onTimeRate = summary && (summary.onTimePickupCount + summary.latePickupCount > 0)
    ? ((summary.onTimePickupCount / (summary.onTimePickupCount + summary.latePickupCount)) * 100).toFixed(1)
    : "0.0";
  const gpsRate = summary && summary.tripsTotal > 0
    ? ((summary.gpsVerifiedCount / summary.tripsTotal) * 100).toFixed(1)
    : "0.0";

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="intelligence-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Brain className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">UCM Intelligence</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[130px]" data-testid="select-date-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {rollupsQuery.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card data-testid="card-total-trips">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Trips</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-trips">{summary?.tripsTotal || 0}</div>
              <p className="text-xs text-muted-foreground">{summary?.tripsCompleted || 0} completed, {summary?.tripsCancelled || 0} cancelled</p>
            </CardContent>
          </Card>

          <Card data-testid="card-completion-rate">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Completion Rate</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-completion-rate">{completionRate}%</div>
              <p className="text-xs text-muted-foreground">{summary?.tripsNoShow || 0} no-shows</p>
            </CardContent>
          </Card>

          <Card data-testid="card-on-time-rate">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">On-Time Rate</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-on-time-rate">{onTimeRate}%</div>
              <p className="text-xs text-muted-foreground">{summary?.latePickupCount || 0} late pickups</p>
            </CardContent>
          </Card>

          <Card data-testid="card-gps-rate">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">GPS Verified</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-gps-rate">{gpsRate}%</div>
              <p className="text-xs text-muted-foreground">{summary?.gpsVerifiedCount || 0} verified trips</p>
            </CardContent>
          </Card>
        </div>
      )}

      {rollups.length > 0 && (
        <Card data-testid="card-daily-trends">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Daily Trends</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={rollups}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="metricDate" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <Tooltip />
                <Legend />
                <Bar dataKey="tripsCompleted" name="Completed" fill="hsl(var(--chart-1))" radius={[2, 2, 0, 0]} />
                <Bar dataKey="tripsCancelled" name="Cancelled" fill="hsl(var(--chart-2))" radius={[2, 2, 0, 0]} />
                <Bar dataKey="tripsNoShow" name="No-Show" fill="hsl(var(--chart-3))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card data-testid="card-rankings">
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">
              {entityType === "drivers" ? "Driver Rankings" : "Clinic Rankings"}
            </CardTitle>
            <Select value={entityType} onValueChange={(v) => setEntityType(v as any)}>
              <SelectTrigger className="w-[120px]" data-testid="select-entity-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="drivers">Drivers</SelectItem>
                <SelectItem value="clinics">Clinics</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {rankingsQuery.isLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : rankings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-rankings">
                No ranking data available for this week
              </p>
            ) : (
              <div className="space-y-3">
                {rankings.slice(0, 10).map((r: any, i: number) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 flex-wrap"
                    data-testid={`ranking-row-${i}`}
                  >
                    <span className="text-sm font-medium w-6 text-right text-muted-foreground">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.entityName}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <span>DPI: {r.dpiScore != null ? Number(r.dpiScore).toFixed(0) : "—"}</span>
                        <span>CRI: {r.criScore != null ? Number(r.criScore).toFixed(0) : "—"}</span>
                        <span>TRI: {r.triScore != null ? Number(r.triScore).toFixed(0) : "—"}</span>
                      </div>
                    </div>
                    <Badge variant={Number(r.dpiScore || 0) >= 80 ? "default" : Number(r.dpiScore || 0) >= 60 ? "secondary" : "destructive"}>
                      {r.dpiScore != null ? Number(r.dpiScore).toFixed(0) : "—"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-cost-leak-alerts">
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <CardTitle className="text-base">Cost Leak Alerts</CardTitle>
              {alerts.length > 0 && (
                <Badge variant="destructive">{alerts.length}</Badge>
              )}
            </div>
            <Select value={alertStatus} onValueChange={setAlertStatus}>
              <SelectTrigger className="w-[140px]" data-testid="select-alert-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
                <SelectItem value="ALL">All</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {alertsQuery.isLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}
              </div>
            ) : alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="text-no-alerts">
                <CheckCircle2 className="h-8 w-8 text-green-500 mb-2" />
                <p className="text-sm text-muted-foreground">No cost leak alerts</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {alerts.map((a: any) => (
                  <div key={a.id} className="flex items-start gap-3 p-2 rounded-md border" data-testid={`alert-row-${a.id}`}>
                    <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${a.severity === "RED" ? "text-red-500" : "text-yellow-500"}`} />
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm font-medium">{a.alertType.replace(/_/g, " ")}</p>
                      <p className="text-xs text-muted-foreground">{a.metricDate}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {a.status === "OPEN" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => ackMutation.mutate(a.id)}
                          disabled={ackMutation.isPending}
                          data-testid={`button-ack-${a.id}`}
                        >
                          <Eye className="h-3 w-3 mr-1" /> Ack
                        </Button>
                      )}
                      {(a.status === "OPEN" || a.status === "ACKNOWLEDGED") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => resolveMutation.mutate(a.id)}
                          disabled={resolveMutation.isPending}
                          data-testid={`button-resolve-${a.id}`}
                        >
                          <CheckCheck className="h-3 w-3 mr-1" /> Resolve
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {triScoresData.length > 0 && (
          <Card data-testid="card-tri-scores">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">TRI Score Trend</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={triScoresData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="periodStart" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <Tooltip />
                  <Line type="monotone" dataKey="triScore" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <Card data-testid="card-certifications">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Clinic Certifications</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {certsQuery.isLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : certs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-certs">
                No certification records yet
              </p>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto">
                {certs.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-3 flex-wrap" data-testid={`cert-row-${c.id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.clinicName}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.periodStart} to {c.periodEnd}
                      </p>
                    </div>
                    <Badge variant={c.status === "CERTIFIED" ? "default" : c.status === "PROVISIONAL" ? "secondary" : "destructive"}>
                      {c.status}
                    </Badge>
                    {c.triScore && (
                      <span className="text-xs text-muted-foreground">TRI: {Number(c.triScore).toFixed(0)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {summary && (
        <Card data-testid="card-financial-summary">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              <CardTitle className="text-base">Financial Summary</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Revenue</p>
                <p className="text-lg font-semibold" data-testid="text-revenue">${(summary.revenueCents / 100).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Est. Cost</p>
                <p className="text-lg font-semibold" data-testid="text-cost">${(summary.estCostCents / 100).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Margin</p>
                <p className={`text-lg font-semibold ${summary.marginCents >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-margin">
                  ${(summary.marginCents / 100).toFixed(2)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
