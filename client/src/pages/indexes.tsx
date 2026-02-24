import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch, rawAuthFetch } from "@/lib/api";
import { downloadWithAuth } from "@/lib/export";
import { formatPickupTimeDisplay } from "@/lib/timezone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
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
  Activity,
  Shield,
  Users,
  Clock,
  Zap,
  DollarSign,
  Building2,
  TrendingUp,
  AlertTriangle,
  Target,
  Download,
  FileText,
  Loader2,
} from "lucide-react";

function getDefaultDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  };
}

function scoreClass(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 60) return "text-yellow-600 dark:text-yellow-400";
  if (score >= 40) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

function riskBadgeVariant(level: string): "default" | "secondary" | "destructive" | "outline" {
  if (level === "critical" || level === "high") return "destructive";
  if (level === "medium") return "secondary";
  return "outline";
}

interface IndexCardProps {
  icon: typeof Activity;
  title: string;
  value: string;
  subtitle: string;
  colorClass?: string;
  testId: string;
}

function IndexCard({ icon: Icon, title, value, subtitle, colorClass, testId }: IndexCardProps) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-md bg-muted">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground truncate">{title}</p>
              <p className={`text-xl font-bold ${colorClass || ""}`} data-testid={`${testId}-value`}>{value}</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

export default function IndexesPage() {
  const { token, cities: authCities } = useAuth();
  const { toast } = useToast();
  const defaults = getDefaultDates();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [scope, setScope] = useState<"general" | "state" | "city">("general");
  const [selectedState, setSelectedState] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [exporting, setExporting] = useState(false);

  const states = useMemo(() => {
    const stateSet = new Set(authCities.map((c: any) => c.state));
    return Array.from(stateSet).sort();
  }, [authCities]);

  const citiesForState = useMemo(() => {
    if (!selectedState) return authCities;
    return authCities.filter((c: any) => c.state === selectedState);
  }, [authCities, selectedState]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      dateFrom,
      dateTo,
      scope,
    });
    if (scope === "state" && selectedState) params.set("state", selectedState);
    if (scope === "city" && selectedCity) params.set("city", selectedCity);
    return params.toString();
  }, [dateFrom, dateTo, scope, selectedState, selectedCity]);

  const canQuery = scope === "general" || (scope === "state" && selectedState) || (scope === "city" && selectedCity);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/intel/indexes", queryParams],
    queryFn: () => apiFetch(`/api/intel/indexes?${queryParams}`, token),
    enabled: Boolean(token && canQuery),
    staleTime: 60000,
  });

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      await downloadWithAuth(
        `/api/intel/indexes/export.pdf?${queryParams}`,
        `UCM_Indexes_${scope}_${dateFrom}_${dateTo}.pdf`,
        "application/pdf",
        rawAuthFetch,
        (msg) => toast({ title: "Error", description: msg, variant: "destructive" }),
      );
    } finally {
      setExporting(false);
    }
  };

  const s = data?.summary;
  const breakdown = data?.breakdown || [];

  const breakdownLabel = scope === "general" ? "State" : scope === "state" ? "City" : "Clinic";

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6" data-testid="page-indexes">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-indexes-title">Intelligence Indexes</h1>
          <p className="text-sm text-muted-foreground">10 proprietary operational indexes with scope drilldowns</p>
        </div>
        <Button
          onClick={handleExportPdf}
          disabled={exporting || !canQuery || isLoading}
          data-testid="button-export-pdf"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span className="ml-2">Export PDF</span>
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                data-testid="input-date-from"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                data-testid="input-date-to"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Scope</label>
              <Select value={scope} onValueChange={(v) => {
                setScope(v as any);
                if (v === "general") { setSelectedState(""); setSelectedCity(""); }
                if (v === "state") { setSelectedCity(""); }
              }}>
                <SelectTrigger data-testid="select-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="state">State</SelectItem>
                  <SelectItem value="city">City</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope !== "general" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">State</label>
                <Select value={selectedState} onValueChange={(v) => { setSelectedState(v); setSelectedCity(""); }}>
                  <SelectTrigger data-testid="select-state">
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    {states.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {scope === "city" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">City</label>
                <Select value={selectedCity} onValueChange={setSelectedCity}>
                  <SelectTrigger data-testid="select-city-filter">
                    <SelectValue placeholder="Select city" />
                  </SelectTrigger>
                  <SelectContent>
                    {citiesForState.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-md" />
          ))}
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="p-4 text-center text-destructive">
            Failed to load indexes. Please try again.
          </CardContent>
        </Card>
      )}

      {s && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3" data-testid="grid-index-cards">
            <IndexCard
              icon={Shield}
              title="1. TRI Nevada\u2122"
              value={String(s.tri.score)}
              subtitle={`On-time: ${s.tri.onTime} | Late: ${s.tri.late} | No-show: ${s.tri.noShow} | Completed: ${s.tri.completed}`}
              colorClass={scoreClass(s.tri.score)}
              testId="card-tri"
            />
            <IndexCard
              icon={Building2}
              title="2. Clinic Trust Score"
              value={String(s.cts.score)}
              subtitle={`TRI: ${s.cts.triComponent} | Return: ${s.cts.returnReliability}% | Proof: ${s.cts.proofCompleteness}%`}
              colorClass={scoreClass(s.cts.score)}
              testId="card-cts"
            />
            <IndexCard
              icon={Users}
              title="3. Driver Stability"
              value={String(s.driverStability.score)}
              subtitle={`Assigned: ${s.driverStability.assigned} | Completed: ${s.driverStability.completed} | Late: ${s.driverStability.latePickups}`}
              colorClass={scoreClass(s.driverStability.score)}
              testId="card-driver-stability"
            />
            <IndexCard
              icon={Clock}
              title="4. Driver Utilization"
              value={`${s.driverUtilization.percent}%`}
              subtitle={`Active: ${s.driverUtilization.activeTripMinutes} min | Scheduled: ${s.driverUtilization.scheduledMinutes} min`}
              colorClass={scoreClass(s.driverUtilization.percent)}
              testId="card-driver-utilization"
            />
            <IndexCard
              icon={Zap}
              title="5. Dispatch Efficiency"
              value={`${s.dispatchEfficiency.efficiency}%`}
              subtitle={`Auto: ${s.dispatchEfficiency.autoAssigned} | Manual: ${s.dispatchEfficiency.manualOverrideCount} | Reassign: ${s.dispatchEfficiency.reassignmentCount}`}
              colorClass={scoreClass(s.dispatchEfficiency.efficiency)}
              testId="card-dispatch-efficiency"
            />
            <IndexCard
              icon={DollarSign}
              title="6. Revenue Leakage"
              value={`$${s.revenueLeakage.leakageTotal.toLocaleString()}`}
              subtitle={Object.entries(s.revenueLeakage.leakageByReason).map(([k, v]) => `${k}: $${v}`).join(" | ") || "No leakage"}
              colorClass={s.revenueLeakage.leakageTotal > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}
              testId="card-leakage"
            />
            <IndexCard
              icon={Activity}
              title="7. Clinic Load"
              value={String(s.clinicLoad.ratio)}
              subtitle={`Level: ${s.clinicLoad.level.toUpperCase()} | Trips: ${s.clinicLoad.activeTrips} | Drivers: ${s.clinicLoad.scheduledDrivers}`}
              testId="card-clinic-load"
            />
            <IndexCard
              icon={TrendingUp}
              title="8. Weekly Profit"
              value={`$${s.weeklyProfit.profit.toLocaleString()}`}
              subtitle={`Revenue: $${s.weeklyProfit.revenue} | Cost: $${s.weeklyProfit.cost} | Margin: ${s.weeklyProfit.margin}%`}
              colorClass={s.weeklyProfit.profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
              testId="card-profit"
            />
            <IndexCard
              icon={AlertTriangle}
              title="9. Replacement Pressure"
              value={`${s.replacementPressure.shortageCount} shortage`}
              subtitle={`Risk: ${s.replacementPressure.riskLevel.toUpperCase()} | ${s.replacementPressure.recommendedAction}`}
              testId="card-replacement"
            />
            <IndexCard
              icon={Target}
              title="10. Late Risk Predictor"
              value={`${s.lateRisk.summaryRed} red`}
              subtitle={`Yellow: ${s.lateRisk.summaryYellow} | Green: ${s.lateRisk.summaryGreen} | At-risk: ${s.lateRisk.riskyTrips.length}`}
              colorClass={s.lateRisk.summaryRed > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}
              testId="card-late-risk"
            />
          </div>

          {breakdown.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-lg">Breakdown by {breakdownLabel}</CardTitle>
                <Badge variant="secondary">{breakdown.length} {breakdownLabel}s</Badge>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table data-testid="table-breakdown">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{breakdownLabel}</TableHead>
                      <TableHead className="text-right">TRI</TableHead>
                      <TableHead className="text-right">CTS</TableHead>
                      <TableHead className="text-right">Stability</TableHead>
                      <TableHead className="text-right">Util%</TableHead>
                      <TableHead className="text-right">Dispatch%</TableHead>
                      <TableHead className="text-right">Leak$</TableHead>
                      <TableHead className="text-right">Load</TableHead>
                      <TableHead className="text-right">Profit$</TableHead>
                      <TableHead className="text-right">Pressure</TableHead>
                      <TableHead className="text-right">Risk</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breakdown.map((row: any) => (
                      <TableRow key={row.key} data-testid={`row-breakdown-${row.key}`}>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell className={`text-right ${scoreClass(row.tri)}`}>{row.tri.toFixed(1)}</TableCell>
                        <TableCell className={`text-right ${scoreClass(row.cts)}`}>{row.cts.toFixed(1)}</TableCell>
                        <TableCell className={`text-right ${scoreClass(row.driverStability)}`}>{row.driverStability.toFixed(1)}</TableCell>
                        <TableCell className={`text-right ${scoreClass(row.driverUtilization)}`}>{row.driverUtilization.toFixed(1)}</TableCell>
                        <TableCell className={`text-right ${scoreClass(row.dispatchEfficiency)}`}>{row.dispatchEfficiency.toFixed(1)}</TableCell>
                        <TableCell className="text-right">${row.leakage.toFixed(0)}</TableCell>
                        <TableCell className="text-right">{row.load.toFixed(1)}</TableCell>
                        <TableCell className={`text-right ${row.profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>${row.profit.toFixed(0)}</TableCell>
                        <TableCell className="text-right">{row.replacementPressure}</TableCell>
                        <TableCell className="text-right">{row.lateRisk}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {s.lateRisk.riskyTrips.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-lg">Late Risk — At-Risk Trips</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  {s.lateRisk.summaryRed > 0 && <Badge variant="destructive">{s.lateRisk.summaryRed} Red</Badge>}
                  {s.lateRisk.summaryYellow > 0 && <Badge variant="secondary">{s.lateRisk.summaryYellow} Yellow</Badge>}
                  {s.lateRisk.summaryGreen > 0 && <Badge variant="outline">{s.lateRisk.summaryGreen} Green</Badge>}
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table data-testid="table-late-risk">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trip ID</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead>Clinic</TableHead>
                      <TableHead>Driver</TableHead>
                      <TableHead>Reasons</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.lateRisk.riskyTrips.map((trip: any) => (
                      <TableRow key={trip.tripId} data-testid={`row-risk-${trip.tripId}`}>
                        <TableCell className="font-mono text-sm">{trip.publicId}</TableCell>
                        <TableCell>{trip.scheduledDate}</TableCell>
                        <TableCell>{formatPickupTimeDisplay(trip.pickupTime)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={trip.riskScore >= 60 ? "destructive" : trip.riskScore >= 30 ? "secondary" : "outline"}>
                            {trip.riskScore}
                          </Badge>
                        </TableCell>
                        <TableCell>{trip.clinicName}</TableCell>
                        <TableCell>{trip.driverName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[300px]">
                          {trip.reasons.join("; ")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">
                <strong>TRI Nevada&#8482;</strong> = 100*(OnTimeCompleted/Completed) - 0.5*100*(Late/Completed) - 1.0*100*(NoShow/(Completed+NoShow)). Grace: 10 min. Thresholds: {"\u2265"}80 Excellent | {"\u2265"}60 Good | {"\u2265"}40 Fair | {"<"}40 Needs Improvement.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                <strong>CTS</strong> = 50% TRI + 25% Return Reliability + 25% Proof Completeness. <strong>Driver Utilization</strong> = active_trip_min / (8h * drivers * days).
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
