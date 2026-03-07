import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch, rawAuthFetch } from "@/lib/api";
import { downloadWithAuth } from "@/lib/export";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  TrendingUp,
  Download,
  AlertTriangle,
  Clock,
  Users,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  CalendarDays,
  X,
} from "lucide-react";

function getDefaultDates() {
  const now = new Date();
  const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const from = now.toISOString().split("T")[0];
  return { from, to };
}

function riskBadgeVariant(risk: string): "default" | "secondary" | "destructive" | "outline" {
  switch (risk) {
    case "critical": return "destructive";
    case "high": return "destructive";
    case "moderate": return "secondary";
    default: return "default";
  }
}

function riskBorderColor(level: string) {
  switch (level) {
    case "red": return "border-red-500/40 hover:border-red-500/70";
    case "yellow": return "border-yellow-500/40 hover:border-yellow-500/70";
    default: return "border-green-500/40 hover:border-green-500/70";
  }
}

export default function PredictionPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const defaults = getDefaultDates();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [riskFilter, setRiskFilter] = useState<string>("");

  const predQuery = useQuery({
    queryKey: ["/api/intelligence/prediction", dateFrom, dateTo],
    queryFn: () => apiFetch(`/api/intelligence/prediction?dateFrom=${dateFrom}&dateTo=${dateTo}`, token),
    enabled: !!dateFrom && !!dateTo,
  });

  const data = predQuery.data;
  const lateRisk = data?.lateRisk;
  const staffingRisk = data?.staffingRisk;

  const handleExportPdf = async () => {
    await downloadWithAuth(
      `/api/intelligence/prediction/export.pdf?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      `UCM_Prediction_${dateFrom}_${dateTo}.pdf`,
      "application/pdf",
      rawAuthFetch,
      (msg) => toast({ title: "Error", description: msg, variant: "destructive" }),
    );
  };

  const goToTrip = (tripId: number) => navigate(`/trips/${tripId}`);
  const goToSchedule = (date: string) => navigate(`/schedule?date=${date}`);

  const allTrips: any[] = lateRisk?.riskyTrips || [];

  const tripsForLevel = useMemo(() => {
    return {
      red: allTrips.filter((t: any) => t.riskLevel === "red"),
      yellow: allTrips.filter((t: any) => t.riskLevel === "yellow"),
      green: allTrips.filter((t: any) => t.riskLevel === "green"),
    };
  }, [allTrips]);

  function handleRiskClick(level: "red" | "yellow" | "green") {
    const trips = tripsForLevel[level];
    if (trips.length === 1) {
      goToTrip(trips[0].tripId);
      return;
    }
    setRiskFilter(riskFilter === level ? "" : level);
  }

  const filteredTrips = useMemo(() => {
    if (!riskFilter) return allTrips;
    return allTrips.filter((t: any) => t.riskLevel === riskFilter);
  }, [allTrips, riskFilter]);

  const filterLabel = riskFilter === "red" ? "High Risk" : riskFilter === "yellow" ? "Moderate" : riskFilter === "green" ? "Low Risk" : "";

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="prediction-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Predictions</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-[150px]"
            data-testid="input-date-from"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-[150px]"
            data-testid="input-date-to"
          />
          <Button variant="outline" onClick={handleExportPdf} data-testid="button-export-pdf">
            <Download className="h-4 w-4 mr-2" />
            Export PDF
          </Button>
        </div>
      </div>

      {predQuery.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-60" />
          <Skeleton className="h-60" />
        </div>
      ) : !data ? (
        <Card data-testid="card-no-data">
          <CardContent className="py-8">
            <div className="flex flex-col items-center text-center">
              <TrendingUp className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Select a date range to view predictions.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card data-testid="card-late-risk">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-yellow-500" />
                <CardTitle className="text-base">Late Risk Forecast</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <button
                  className={`text-center p-3 rounded-md border transition-colors cursor-pointer ${
                    riskFilter === "red"
                      ? "border-red-500 bg-red-500/10 ring-2 ring-red-500/30"
                      : "border-red-500/30 hover:border-red-500/60 hover:bg-red-500/5"
                  }`}
                  onClick={() => handleRiskClick("red")}
                  data-testid="late-risk-red"
                >
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">{lateRisk?.summaryRed ?? 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">High Risk</p>
                </button>
                <button
                  className={`text-center p-3 rounded-md border transition-colors cursor-pointer ${
                    riskFilter === "yellow"
                      ? "border-yellow-500 bg-yellow-500/10 ring-2 ring-yellow-500/30"
                      : "border-yellow-500/30 hover:border-yellow-500/60 hover:bg-yellow-500/5"
                  }`}
                  onClick={() => handleRiskClick("yellow")}
                  data-testid="late-risk-yellow"
                >
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{lateRisk?.summaryYellow ?? 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">Moderate</p>
                </button>
                <button
                  className={`text-center p-3 rounded-md border transition-colors cursor-pointer ${
                    riskFilter === "green"
                      ? "border-green-500 bg-green-500/10 ring-2 ring-green-500/30"
                      : "border-green-500/30 hover:border-green-500/60 hover:bg-green-500/5"
                  }`}
                  onClick={() => handleRiskClick("green")}
                  data-testid="late-risk-green"
                >
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">{lateRisk?.summaryGreen ?? 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">Low Risk</p>
                </button>
              </div>

              {filteredTrips.length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {riskFilter ? `${filterLabel} Trips` : "Risky Trips"}
                    </p>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px]">
                        {filteredTrips.length} trip{filteredTrips.length !== 1 ? "s" : ""}
                      </Badge>
                      {riskFilter && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 px-1"
                          onClick={() => setRiskFilter("")}
                          data-testid="button-clear-risk-filter"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {filteredTrips.slice(0, 30).map((t: any) => (
                    <button
                      key={t.tripId}
                      className={`flex items-center gap-2 p-2 rounded-md border text-sm flex-wrap w-full text-left transition-colors cursor-pointer hover:bg-muted/50 ${riskBorderColor(t.riskLevel)}`}
                      onClick={() => goToTrip(t.tripId)}
                      data-testid={`risky-trip-${t.tripId}`}
                    >
                      <Badge
                        variant={t.riskLevel === "red" ? "destructive" : t.riskLevel === "yellow" ? "secondary" : "default"}
                      >
                        {t.riskLevel === "red" ? "High" : t.riskLevel === "yellow" ? "Moderate" : "Low"}
                      </Badge>
                      <span className="flex-1 min-w-0 truncate font-medium">Trip #{t.tripId}</span>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
                        {t.reasons?.map((r: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-xs">{r}</Badge>
                        ))}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    </button>
                  ))}
                </div>
              ) : riskFilter ? (
                <div className="flex flex-col items-center gap-2 justify-center py-4" data-testid="text-no-filtered-trips">
                  <span className="text-sm text-muted-foreground">No {filterLabel.toLowerCase()} trips found</span>
                  <Button variant="link" size="sm" onClick={() => setRiskFilter("")}>Show all</Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 justify-center py-4" data-testid="text-no-risky-trips">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="text-sm text-muted-foreground">No high-risk trips detected</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-staffing-risk">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-500" />
                <CardTitle className="text-base">Staffing Forecast</CardTitle>
              </div>
              {staffingRisk && (
                <Badge variant={riskBadgeVariant(staffingRisk.overallRisk)} data-testid="badge-overall-risk">
                  {staffingRisk.overallRisk}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {staffingRisk && (
                <>
                  <div className="p-3 rounded-md border space-y-2" data-testid="staffing-summary">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-sm text-muted-foreground">Shortage Days</span>
                      <span className="text-sm font-semibold">{staffingRisk.shortageCount}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{staffingRisk.recommendation}</p>
                  </div>

                  {staffingRisk.days && staffingRisk.days.length > 0 && (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      <p className="text-xs font-medium text-muted-foreground">Daily Breakdown</p>
                      {staffingRisk.days.map((d: any) => (
                        <button
                          key={d.date}
                          className={`flex items-center gap-3 p-2 rounded-md border text-sm flex-wrap w-full text-left transition-colors cursor-pointer hover:bg-muted/50 ${d.shortage ? "border-red-500/40 hover:border-red-500/70" : "hover:border-primary/40"}`}
                          onClick={() => goToSchedule(d.date)}
                          data-testid={`staffing-day-${d.date}`}
                        >
                          <CalendarDays className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="text-xs text-muted-foreground w-20">{d.date}</span>
                          <div className="flex items-center gap-2 flex-1 flex-wrap">
                            <span className="text-xs">Trips: {d.tripCount}</span>
                            <span className="text-xs">Drivers: {d.driverCount}</span>
                            <span className="text-xs">Ratio: {d.ratio?.toFixed(1)}</span>
                          </div>
                          <Badge variant={d.shortage ? "destructive" : "default"}>
                            {d.shortage ? "Shortage" : "OK"}
                          </Badge>
                          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
