import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, Clock, CheckCircle, XCircle, AlertTriangle, Gauge } from "lucide-react";
import { useLocation } from "wouter";
import { getGrade, getGradeColor } from "@shared/driverPerformance";
import { apiFetch } from "@/lib/api";

export default function DriverPerformancePage() {
  const [, setLocation] = useLocation();

  const token = localStorage.getItem("ucm_driver_token");
  const performanceQuery = useQuery({
    queryKey: ["/api/driver/performance/current-shift"],
    queryFn: async () => {
      const res = await apiFetch("/api/driver/performance/current-shift", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (res.status === 403) return null;
        throw new Error("Failed to fetch performance");
      }
      return res.json();
    },
    refetchInterval: 60000,
    enabled: !!token,
  });

  const data = performanceQuery.data;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/driver")} data-testid="button-back-performance">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-semibold" data-testid="text-performance-title">Performance</h1>
      </div>

      <div className="p-4 space-y-4 max-w-lg mx-auto">
        {performanceQuery.isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {data === null && (
          <Card>
            <CardContent className="py-8 text-center">
              <Gauge className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground" data-testid="text-performance-disabled">Performance tracking is not enabled for your account.</p>
            </CardContent>
          </Card>
        )}

        {data && (
          <>
            <Card data-testid="card-turn-score">
              <CardContent className="py-6 text-center">
                <p className="text-sm text-muted-foreground mb-1">Turn Score</p>
                <div className="text-6xl font-bold mb-2" data-testid="text-turn-score">{data.score}</div>
                <Badge
                  variant="outline"
                  className={`text-lg px-4 py-1 ${getGradeColor(data.grade)}`}
                  data-testid="badge-grade"
                >
                  Grade: {data.grade}
                </Badge>
                <p className="text-xs text-muted-foreground mt-2">
                  Shift: {data.shiftDurationMinutes} min{data.activeShiftId ? " (Active)" : " (Last 8hr)"}
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-kpis">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> KPIs
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <KPIRow
                  icon={<CheckCircle className="w-4 h-4 text-emerald-500" />}
                  label="On-Time Rate"
                  value={`${Math.round(data.kpis.onTimeRate * 100)}%`}
                  testId="kpi-ontime"
                />
                <KPIRow
                  icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
                  label="Late Arrivals"
                  value={String(data.kpis.lateCount)}
                  testId="kpi-late"
                />
                <KPIRow
                  icon={<TrendingUp className="w-4 h-4 text-blue-500" />}
                  label="Acceptance Rate"
                  value={`${Math.round(data.kpis.acceptanceRate * 100)}%`}
                  testId="kpi-acceptance"
                />
                <KPIRow
                  icon={<Clock className="w-4 h-4 text-gray-500" />}
                  label="Idle Time"
                  value={`${data.kpis.idleMinutes} min`}
                  testId="kpi-idle"
                />
                <KPIRow
                  icon={<XCircle className="w-4 h-4 text-red-500" />}
                  label="Cancellations"
                  value={String(data.kpis.cancelCount)}
                  testId="kpi-cancels"
                />
                <KPIRow
                  icon={<Gauge className="w-4 h-4 text-indigo-500" />}
                  label="Compliance Rate"
                  value={`${Math.round(data.kpis.complianceRate * 100)}%`}
                  testId="kpi-compliance"
                />
              </CardContent>
            </Card>

            <Card data-testid="card-trip-summary">
              <CardContent className="py-4">
                <p className="text-sm text-muted-foreground">Total Trips This Shift</p>
                <p className="text-2xl font-bold" data-testid="text-total-trips">{data.kpis.totalTrips}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function KPIRow({ icon, label, value, testId }: { icon: any; label: string; value: string; testId: string }) {
  return (
    <div className="flex items-center justify-between" data-testid={testId}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <span className="font-semibold text-sm">{value}</span>
    </div>
  );
}
