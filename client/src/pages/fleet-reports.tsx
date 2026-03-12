import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Truck, Users, Route, BarChart3, Wrench, AlertTriangle, RefreshCw, TrendingUp,
} from "lucide-react";

const PERIOD_OPTIONS = [
  { label: "7 Days", value: 7 },
  { label: "14 Days", value: 14 },
  { label: "30 Days", value: 30 },
  { label: "90 Days", value: 90 },
];

export default function FleetReportsPage() {
  const { token } = useAuth();
  const [days, setDays] = useState(30);

  const reportQuery = useQuery<any>({
    queryKey: ["/api/fleet/reports", days],
    queryFn: () => apiFetch(`/api/fleet/reports?days=${days}`, token),
    enabled: !!token,
  });

  const data = reportQuery.data;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2" data-testid="text-page-title">
            <BarChart3 className="w-6 h-6" />
            Fleet Utilization Reports
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Vehicle utilization, driver productivity, and fleet capacity metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  days === opt.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
                data-testid={`button-period-${opt.value}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button size="icon" variant="ghost" onClick={() => reportQuery.refetch()} data-testid="button-refresh">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {reportQuery.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : !data ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No data available</CardContent></Card>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm text-muted-foreground">Total Vehicles</CardTitle>
                <Truck className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="text-total-vehicles">{data.fleet.totalVehicles}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm text-muted-foreground">Utilization Rate</CardTitle>
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="text-utilization">{data.fleet.utilizationRate}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm text-muted-foreground">Active Drivers</CardTitle>
                <Users className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="text-active-drivers">{data.drivers.activeDrivers}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm text-muted-foreground">Avg Trips/Day</CardTitle>
                <Route className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="text-avg-trips-day">{data.drivers.avgTripsPerDay}</p>
              </CardContent>
            </Card>
          </div>

          {/* Vehicle Status Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vehicle Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.vehicleStatusBreakdown.map((item: any) => {
                    const pct = data.fleet.totalVehicles > 0
                      ? Math.round((item.count / data.fleet.totalVehicles) * 100)
                      : 0;
                    const colors: Record<string, string> = {
                      ACTIVE: "bg-emerald-500",
                      MAINTENANCE: "bg-amber-500",
                      OUT_OF_SERVICE: "bg-red-500",
                    };
                    const icons: Record<string, any> = {
                      ACTIVE: Truck,
                      MAINTENANCE: Wrench,
                      OUT_OF_SERVICE: AlertTriangle,
                    };
                    const Icon = icons[item.status] || Truck;
                    return (
                      <div key={item.status} className="space-y-1" data-testid={`status-${item.status}`}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <Icon className="w-4 h-4" />
                            {item.status.replace(/_/g, " ")}
                          </span>
                          <span className="font-medium">{item.count} ({pct}%)</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div className={`${colors[item.status] || "bg-gray-500"} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Driver Productivity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold" data-testid="text-total-trips">{data.drivers.totalTrips}</p>
                    <p className="text-xs text-muted-foreground">Total Trips ({days}d)</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold" data-testid="text-avg-per-driver">{data.drivers.avgTripsPerDriver}</p>
                    <p className="text-xs text-muted-foreground">Avg Trips/Driver</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top Drivers Table */}
          {data.drivers.topDrivers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Drivers by Trip Count</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rank</TableHead>
                      <TableHead>Driver ID</TableHead>
                      <TableHead className="text-right">Total Trips</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">Completion Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.drivers.topDrivers.map((d: any, idx: number) => {
                      const completionRate = d.tripCount > 0 ? Math.round((d.completedCount / d.tripCount) * 100) : 0;
                      return (
                        <TableRow key={d.driverId || idx} data-testid={`row-driver-${d.driverId}`}>
                          <TableCell className="font-medium">#{idx + 1}</TableCell>
                          <TableCell>Driver #{d.driverId}</TableCell>
                          <TableCell className="text-right">{d.tripCount}</TableCell>
                          <TableCell className="text-right">{d.completedCount}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={completionRate >= 90 ? "default" : completionRate >= 70 ? "secondary" : "destructive"}>
                              {completionRate}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
