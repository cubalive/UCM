import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import {
  KpiCard,
  GlowAreaChart,
  GlowBarChart,
  DonutChart,
  AnimatedNumber,
} from "@/components/charts/futuristic-charts";
import {
  DollarSign,
  TrendingUp,
  Route,
  CheckCircle,
  XCircle,
  UserX,
  Car,
  MapPin,
  BarChart3,
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
    queryFn: () =>
      apiFetch(
        `/api/financial/daily?date=${todayStr}${cityParam}`,
        token
      ),
    enabled: !!token && !!selectedCity?.id,
    refetchInterval: 60000,
  });

  const { data: rangeData, isLoading: rangeLoading } = useQuery<any>({
    queryKey: ["/api/financial/range", selectedCity?.id, startDate, endDate],
    queryFn: () =>
      apiFetch(
        `/api/financial/range?startDate=${startDate}&endDate=${endDate}${cityParam}`,
        token
      ),
    enabled: !!token && !!selectedCity?.id && !!startDate && !!endDate,
  });

  if (!selectedCity?.id) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <h1
          className="text-xl font-semibold mb-4"
          data-testid="text-financial-title"
        >
          Financial Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Please select a city to view financial data.
        </p>
      </div>
    );
  }

  // Prepare chart data from range days
  const chartDays = (rangeData?.days || []).map((d: any) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    revenue: d.estimatedRevenue,
  }));

  // Donut data for today's trip distribution
  const donutData =
    todayStats && todayStats.totalTrips > 0
      ? [
          {
            name: "Completed",
            value: todayStats.completed || 0,
            color: "emerald" as const,
          },
          {
            name: "Cancelled",
            value: todayStats.cancelled || 0,
            color: "rose" as const,
          },
          {
            name: "No-Show",
            value: todayStats.noShow || 0,
            color: "amber" as const,
          },
          {
            name: "Other",
            value: Math.max(
              0,
              (todayStats.totalTrips || 0) -
                (todayStats.completed || 0) -
                (todayStats.cancelled || 0) -
                (todayStats.noShow || 0)
            ),
            color: "emerald" as const,
          },
        ].filter((d) => d.value > 0)
      : [];

  return (
    <div className="p-4 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <DollarSign className="w-6 h-6" />
        <h1
          className="text-xl font-semibold"
          data-testid="text-financial-title"
        >
          Financial Dashboard
        </h1>
        {selectedCity && (
          <Badge variant="secondary">
            <MapPin className="w-3 h-3 mr-1" />
            {selectedCity.name}
          </Badge>
        )}
        <InfoTooltip content="Financial overview — today's summary refreshes every 60 seconds. Use the date range selector below for historical analysis." />
      </div>

      {/* Today's KPI Cards */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Today's Summary
        </h2>
        {todayLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[100px] w-full rounded-xl" />
            ))}
          </div>
        ) : todayStats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              title="Total Trips"
              value={todayStats.totalTrips || 0}
              icon={<Route className="w-4 h-4 text-emerald-500" />}
              color="emerald"
              tooltip="All trips scheduled for today regardless of status"
            />
            <KpiCard
              title="Completed"
              value={todayStats.completed || 0}
              icon={<CheckCircle className="w-4 h-4 text-emerald-500" />}
              color="emerald"
              tooltip="Trips successfully completed today"
            />
            <KpiCard
              title="Revenue"
              value={todayStats.estimatedRevenue || 0}
              prefix="$"
              decimals={2}
              icon={<DollarSign className="w-4 h-4 text-emerald-500" />}
              color="emerald"
              tooltip="Estimated revenue from completed trips based on billing rates"
            />
            <KpiCard
              title="Active Drivers"
              value={todayStats.activeDrivers || 0}
              icon={<Car className="w-4 h-4 text-purple-500" />}
              color="purple"
              tooltip="Unique drivers who had at least one trip today"
            />
            <KpiCard
              title="Cancelled"
              value={todayStats.cancelled || 0}
              icon={<XCircle className="w-4 h-4 text-rose-500" />}
              color="rose"
              tooltip="Trips cancelled today — high rates may indicate scheduling issues"
            />
            <KpiCard
              title="No-Show"
              value={todayStats.noShow || 0}
              icon={<UserX className="w-4 h-4 text-amber-500" />}
              color="amber"
              tooltip="Patient no-shows — may trigger strike policies after threshold"
            />
            <KpiCard
              title="Total Miles"
              value={todayStats.totalMiles || 0}
              icon={<MapPin className="w-4 h-4 text-cyan-500" />}
              color="cyan"
              tooltip="Sum of estimated miles for all completed trips today"
            />
            <KpiCard
              title="Miles/Driver"
              value={todayStats.milesPerDriver || 0}
              decimals={1}
              icon={<TrendingUp className="w-4 h-4 text-emerald-500" />}
              color="emerald"
              tooltip="Average miles per active driver — efficiency metric"
            />
          </div>
        ) : null}
      </div>

      {/* Today's donut chart */}
      {donutData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm">Today's Trip Distribution</CardTitle>
                <InfoTooltip content="Proportional breakdown of today's trips by final status." />
              </div>
            </CardHeader>
            <CardContent>
              <DonutChart data={donutData} height={200} />
            </CardContent>
          </Card>
          <Card className="flex flex-col justify-center">
            <CardContent className="py-6">
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">Completion Rate</p>
                <p className="text-4xl font-bold text-emerald-500">
                  <AnimatedNumber
                    value={
                      todayStats && todayStats.totalTrips > 0
                        ? (todayStats.completed / todayStats.totalTrips) * 100
                        : 0
                    }
                    decimals={1}
                    suffix="%"
                  />
                </p>
                <p className="text-xs text-muted-foreground">
                  {todayStats?.completed || 0} of {todayStats?.totalTrips || 0} trips completed
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Date Range Section */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          Date Range Report
          <InfoTooltip content="Select a custom date range to see daily breakdown with charts. Data includes trips, revenue, and driver activity." />
        </h2>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Label>From</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-auto"
              data-testid="input-financial-start"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label>To</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-auto"
              data-testid="input-financial-end"
            />
          </div>
        </div>

        {rangeLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rangeData ? (
          <div className="space-y-4">
            {/* Period Totals */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">
                    Period Totals ({startDate} to {endDate})
                  </CardTitle>
                  <InfoTooltip content="Aggregated totals for the selected date range." />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Total Trips
                    </p>
                    <p
                      className="text-lg font-bold"
                      data-testid="text-range-total-trips"
                    >
                      <AnimatedNumber value={rangeData.totals?.totalTrips || 0} />
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Completed</p>
                    <p
                      className="text-lg font-bold text-green-600 dark:text-green-400"
                      data-testid="text-range-completed"
                    >
                      <AnimatedNumber value={rangeData.totals?.completed || 0} />
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Cancelled</p>
                    <p
                      className="text-lg font-bold text-red-600 dark:text-red-400"
                      data-testid="text-range-cancelled"
                    >
                      <AnimatedNumber value={rangeData.totals?.cancelled || 0} />
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">No-Show</p>
                    <p
                      className="text-lg font-bold text-amber-600 dark:text-amber-400"
                      data-testid="text-range-noshow"
                    >
                      <AnimatedNumber value={rangeData.totals?.noShow || 0} />
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Revenue</p>
                    <p
                      className="text-lg font-bold text-emerald-600 dark:text-emerald-400"
                      data-testid="text-range-revenue"
                    >
                      <AnimatedNumber
                        value={rangeData.totals?.estimatedRevenue || 0}
                        prefix="$"
                        decimals={2}
                      />
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Miles</p>
                    <p
                      className="text-lg font-bold"
                      data-testid="text-range-miles"
                    >
                      <AnimatedNumber value={rangeData.totals?.totalMiles || 0} />
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Charts */}
            {chartDays.length > 1 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        Revenue Trend
                      </CardTitle>
                      <InfoTooltip content="Daily revenue from completed trips over the selected period. Rising trend indicates growing service volume." />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <GlowAreaChart
                      data={chartDays}
                      dataKeys={[
                        {
                          key: "revenue",
                          color: "emerald",
                          label: "Revenue ($)",
                        },
                      ]}
                      xAxisKey="label"
                      height={220}
                      showLegend={false}
                      formatTooltip={(v) => `$${v.toFixed(2)}`}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <BarChart3 className="w-4 h-4" />
                        Trip Volume by Status
                      </CardTitle>
                      <InfoTooltip content="Daily stacked bar chart showing completed, cancelled, and no-show trips. Helps identify patterns in cancellations." />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <GlowBarChart
                      data={chartDays}
                      dataKeys={[
                        {
                          key: "completed",
                          color: "emerald",
                          label: "Completed",
                        },
                        {
                          key: "cancelled",
                          color: "rose",
                          label: "Cancelled",
                        },
                        {
                          key: "noShow",
                          color: "amber",
                          label: "No Show",
                        },
                      ]}
                      xAxisKey="label"
                      height={220}
                      stacked
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Daily Breakdown Table */}
            {rangeData.days && rangeData.days.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm">Daily Breakdown</CardTitle>
                    <InfoTooltip content="Detailed daily table with all financial metrics. Click column headers to understand each metric." />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table
                      className="w-full text-sm"
                      data-testid="table-daily-breakdown"
                    >
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
                          <tr
                            key={day.date}
                            className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                            data-testid={`row-financial-${day.date}`}
                          >
                            <td className="py-2 pr-4 font-mono text-xs">
                              {day.date}
                            </td>
                            <td className="text-right py-2 px-2">
                              {day.totalTrips}
                            </td>
                            <td className="text-right py-2 px-2 text-green-600 dark:text-green-400">
                              {day.completed}
                            </td>
                            <td className="text-right py-2 px-2 text-red-600 dark:text-red-400">
                              {day.cancelled}
                            </td>
                            <td className="text-right py-2 px-2 text-amber-600 dark:text-amber-400">
                              {day.noShow}
                            </td>
                            <td className="text-right py-2 px-2">
                              ${day.estimatedRevenue.toFixed(2)}
                            </td>
                            <td className="text-right py-2 px-2">
                              {day.totalMiles}
                            </td>
                            <td className="text-right py-2 pl-2">
                              {day.activeDrivers}
                            </td>
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
