import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  TrendingUp,
  Route,
  CheckCircle,
  XCircle,
  UserX,
  Car,
  MapPin,
} from "lucide-react";
import { apiFetch } from "@/lib/api";

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getWeekAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().split("T")[0];
}

export default function FinancialPage() {
  const { token, selectedCity } = useAuth();
  const [startDate, setStartDate] = useState(getWeekAgo());
  const [endDate, setEndDate] = useState(getToday());

  const todayStr = getToday();
  const cityParam = selectedCity ? `&cityId=${selectedCity.id}` : "";

  const { data: todayStats, isLoading: todayLoading } = useQuery<any>({
    queryKey: ["/api/financial/daily", selectedCity?.id, todayStr],
    queryFn: () => apiFetch(`/api/financial/daily?date=${todayStr}${cityParam}`, token),
    enabled: !!token && !!selectedCity?.id,
    refetchInterval: 60000,
  });

  const { data: rangeData, isLoading: rangeLoading } = useQuery<any>({
    queryKey: ["/api/financial/range", selectedCity?.id, startDate, endDate],
    queryFn: () => apiFetch(`/api/financial/range?startDate=${startDate}&endDate=${endDate}${cityParam}`, token),
    enabled: !!token && !!selectedCity?.id && !!startDate && !!endDate,
  });

  if (!selectedCity?.id) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-xl font-semibold mb-4" data-testid="text-financial-title">Financial Dashboard</h1>
        <p className="text-sm text-muted-foreground">Please select a city to view financial data.</p>
      </div>
    );
  }

  const statCards = todayStats ? [
    { label: "Total Trips", value: todayStats.totalTrips, icon: Route, color: "text-blue-500" },
    { label: "Completed", value: todayStats.completed, icon: CheckCircle, color: "text-green-500" },
    { label: "Cancelled", value: todayStats.cancelled, icon: XCircle, color: "text-red-500" },
    { label: "No-Show", value: todayStats.noShow, icon: UserX, color: "text-amber-500" },
    { label: "Revenue", value: `$${todayStats.estimatedRevenue.toFixed(2)}`, icon: DollarSign, color: "text-emerald-500" },
    { label: "Total Miles", value: todayStats.totalMiles, icon: MapPin, color: "text-indigo-500" },
    { label: "Active Drivers", value: todayStats.activeDrivers, icon: Car, color: "text-purple-500" },
    { label: "Miles/Driver", value: todayStats.milesPerDriver, icon: TrendingUp, color: "text-cyan-500" },
  ] : [];

  return (
    <div className="p-4 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <DollarSign className="w-6 h-6" />
        <h1 className="text-xl font-semibold" data-testid="text-financial-title">Financial Dashboard</h1>
        {selectedCity && (
          <Badge variant="secondary">
            <MapPin className="w-3 h-3 mr-1" />
            {selectedCity.name}
          </Badge>
        )}
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Today's Summary</h2>
        {todayLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {statCards.map((card) => (
              <Card key={card.label}>
                <CardContent className="py-4">
                  <div className="flex items-center gap-2 mb-1">
                    <card.icon className={`w-4 h-4 ${card.color}`} />
                    <span className="text-xs text-muted-foreground">{card.label}</span>
                  </div>
                  <p className="text-xl font-bold" data-testid={`text-financial-${card.label.toLowerCase().replace(/[^a-z]/g, "-")}`}>
                    {card.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Date Range Report</h2>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Label>From</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-auto" data-testid="input-financial-start" />
          </div>
          <div className="flex items-center gap-2">
            <Label>To</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-auto" data-testid="input-financial-end" />
          </div>
        </div>

        {rangeLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rangeData ? (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Period Totals ({startDate} to {endDate})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Total Trips</p>
                    <p className="text-lg font-bold" data-testid="text-range-total-trips">{rangeData.totals?.totalTrips}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Completed</p>
                    <p className="text-lg font-bold text-green-600 dark:text-green-400" data-testid="text-range-completed">{rangeData.totals?.completed}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Cancelled</p>
                    <p className="text-lg font-bold text-red-600 dark:text-red-400" data-testid="text-range-cancelled">{rangeData.totals?.cancelled}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">No-Show</p>
                    <p className="text-lg font-bold text-amber-600 dark:text-amber-400" data-testid="text-range-noshow">{rangeData.totals?.noShow}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Revenue</p>
                    <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-range-revenue">${rangeData.totals?.estimatedRevenue.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Miles</p>
                    <p className="text-lg font-bold" data-testid="text-range-miles">{rangeData.totals?.totalMiles}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {rangeData.days && rangeData.days.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Daily Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="table-daily-breakdown">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="text-left py-2 pr-4">Date</th>
                          <th className="text-right py-2 px-2">Trips</th>
                          <th className="text-right py-2 px-2">Done</th>
                          <th className="text-right py-2 px-2">Cancel</th>
                          <th className="text-right py-2 px-2">No-Show</th>
                          <th className="text-right py-2 px-2">Revenue</th>
                          <th className="text-right py-2 px-2">Miles</th>
                          <th className="text-right py-2 pl-2">Drivers</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rangeData.days.map((day: any) => (
                          <tr key={day.date} className="border-b last:border-0" data-testid={`row-financial-${day.date}`}>
                            <td className="py-2 pr-4 font-mono text-xs">{day.date}</td>
                            <td className="text-right py-2 px-2">{day.totalTrips}</td>
                            <td className="text-right py-2 px-2 text-green-600 dark:text-green-400">{day.completed}</td>
                            <td className="text-right py-2 px-2 text-red-600 dark:text-red-400">{day.cancelled}</td>
                            <td className="text-right py-2 px-2 text-amber-600 dark:text-amber-400">{day.noShow}</td>
                            <td className="text-right py-2 px-2">${day.estimatedRevenue.toFixed(2)}</td>
                            <td className="text-right py-2 px-2">{day.totalMiles}</td>
                            <td className="text-right py-2 pl-2">{day.activeDrivers}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
