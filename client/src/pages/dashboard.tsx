import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import {
  KpiCard,
  GlowAreaChart,
  GlowBarChart,
  DonutChart,
  StatusPulse,
  AnimatedNumber,
  Sparkline,
} from "@/components/charts/futuristic-charts";
import {
  Route,
  Users,
  Truck,
  HeartPulse,
  Building2,
  UserCheck,
  MapPin,
  Activity,
  Radio,
  Clock,
  Navigation,
  WifiOff,
  Eye,
  TrendingUp,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { authHeaders } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { useTranslation } from "react-i18next";

export default function DashboardPage() {
  const { user, token, selectedCity, isSuperAdmin } = useAuth();
  const { t } = useTranslation();

  const cityParam = selectedCity ? `?cityId=${selectedCity.id}` : "";

  const { data: stats, isLoading } = useQuery<any>({
    queryKey: ["/api/stats", selectedCity?.id],
    queryFn: async () => {
      const res = await fetch(`/api/stats${cityParam}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
    enabled: !!token,
  });

  // Trend data for sparklines and charts
  const { data: trendData } = useQuery<any>({
    queryKey: ["/api/analytics/trends", selectedCity?.id],
    queryFn: () =>
      apiFetch(
        `/api/analytics/trends?days=14${selectedCity ? `&cityId=${selectedCity.id}` : ""}`,
        token
      ),
    enabled: !!token,
  });

  const trends = trendData?.trends || [];
  const tripSparkData = trends.map((t: any) => t.total);
  const completedSparkData = trends.map((t: any) => t.completed);
  const cancelledSparkData = trends.map((t: any) => t.cancelled);
  const milesSparkData = trends.map((t: any) => t.totalMiles);

  // Calculate changes from trend data
  function calcChange(data: number[]): number | undefined {
    if (data.length < 2) return undefined;
    const mid = Math.floor(data.length / 2);
    const first = data.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const second = data.slice(mid).reduce((a, b) => a + b, 0) / (data.length - mid);
    if (first === 0) return undefined;
    return ((second - first) / first) * 100;
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-2xl font-semibold tracking-tight"
            data-testid="text-dashboard-title"
          >
            {t("dashboard.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("dashboard.welcomeBack", { name: user?.firstName })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedCity && (
            <Badge variant="secondary" data-testid="badge-city">
              <MapPin className="w-3 h-3 mr-1" />
              {selectedCity.name}
            </Badge>
          )}
          {isSuperAdmin && (
            <Badge variant="default" data-testid="badge-role">
              {t("dashboard.superAdmin")}
            </Badge>
          )}
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-[100px] w-full rounded-xl" />
            ))}
          </>
        ) : (
          <>
            <KpiCard
              title={t("dashboard.totalTrips")}
              value={stats?.trips ?? 0}
              icon={<Route className="w-4 h-4 text-blue-500" />}
              sparkData={tripSparkData}
              color="blue"
              change={calcChange(tripSparkData)}
              changeLabel="vs prev"
              tooltip="Total number of trips in the system for the selected city"
            />
            <KpiCard
              title={t("dashboard.activePatients")}
              value={stats?.patients ?? 0}
              icon={<HeartPulse className="w-4 h-4 text-rose-500" />}
              color="rose"
              tooltip="Patients registered and active in the system"
            />
            <KpiCard
              title={t("dashboard.drivers")}
              value={stats?.drivers ?? 0}
              icon={<UserCheck className="w-4 h-4 text-emerald-500" />}
              color="emerald"
              tooltip="Total registered drivers across all statuses"
            />
            <KpiCard
              title={t("dashboard.vehicles")}
              value={stats?.vehicles ?? 0}
              icon={<Truck className="w-4 h-4 text-amber-500" />}
              color="amber"
              tooltip="Fleet size — total vehicles registered"
            />
            <KpiCard
              title={t("dashboard.clinics")}
              value={stats?.clinics ?? 0}
              icon={<Building2 className="w-4 h-4 text-purple-500" />}
              color="purple"
              tooltip="Healthcare facilities partnered with UCM"
            />
            <KpiCard
              title={t("dashboard.users")}
              value={stats?.users ?? 0}
              icon={<Users className="w-4 h-4 text-cyan-500" />}
              color="cyan"
              tooltip="Platform users across all roles (admin, dispatch, drivers, clinics)"
            />
          </>
        )}
      </div>

      {/* Charts Row */}
      {trends.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-medium">
                  {t("dashboard.tripTrends", { defaultValue: "Trip Trends" })}
                </CardTitle>
                <InfoTooltip content="Daily trip volume over the last 14 days. Shows completed vs total trips to track service delivery." />
              </div>
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <GlowAreaChart
                data={trends}
                dataKeys={[
                  { key: "total", color: "blue", label: "Total" },
                  { key: "completed", color: "emerald", label: "Completed" },
                ]}
                xAxisKey="label"
                height={240}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-medium">
                  {t("dashboard.statusBreakdown", { defaultValue: "Status Breakdown" })}
                </CardTitle>
                <InfoTooltip content="Daily breakdown by trip status — cancelled and no-shows are tracked to identify operational issues." />
              </div>
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <GlowBarChart
                data={trends}
                dataKeys={[
                  { key: "completed", color: "emerald", label: "Completed" },
                  { key: "cancelled", color: "rose", label: "Cancelled" },
                  { key: "noShow", color: "amber", label: "No Show" },
                ]}
                xAxisKey="label"
                height={240}
                stacked
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Driver Presence Panel */}
      {user &&
        ["SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"].includes(
          user.role
        ) && <DriverPresencePanel />}

      {/* Recent Activity & Trip Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-medium">
                {t("dashboard.recentActivity")}
              </CardTitle>
              <InfoTooltip content="Most recent trips — click any trip to view full details, status, and route info." />
            </div>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <RecentTrips />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-medium">
                {t("dashboard.upcomingTrips")}
              </CardTitle>
              <InfoTooltip content="Current trip status distribution — progress bars show the proportion of each status relative to total." />
            </div>
            <Route className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <TripStatusSummary />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RecentTrips() {
  const { token, selectedCity } = useAuth();
  const [, navigate] = useLocation();
  const cityParam = selectedCity
    ? `?cityId=${selectedCity.id}&limit=5`
    : "?limit=5";

  const { data: trips, isLoading } = useQuery<any[]>({
    queryKey: ["/api/trips/recent", selectedCity?.id],
    queryFn: async () => {
      const res = await fetch(`/api/trips${cityParam}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!token,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!trips?.length) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No recent trips
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    SCHEDULED: "secondary",
    ASSIGNED: "default",
    IN_PROGRESS: "default",
    COMPLETED: "secondary",
    CANCELLED: "destructive",
    NO_SHOW: "destructive",
  };

  return (
    <div className="space-y-3">
      {trips.map((trip: any) => (
        <button
          key={trip.id}
          type="button"
          onClick={() => navigate(`/trips/${trip.id}`)}
          className="w-full flex items-center justify-between gap-3 py-2 border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors rounded px-1 text-left"
          data-testid={`button-recent-trip-${trip.id}`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{trip.publicId}</p>
            <p className="text-xs text-muted-foreground truncate">
              {trip.pickupAddress} &rarr; {trip.dropoffAddress}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge
              variant={
                (statusColors[trip.status] as any) || "secondary"
              }
            >
              {trip.status.replace("_", " ")}
            </Badge>
            <Eye className="w-3 h-3 text-muted-foreground" />
          </div>
        </button>
      ))}
    </div>
  );
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function DriverPresencePanel() {
  const { token, selectedCity } = useAuth();
  const { t } = useTranslation();
  const cityId = selectedCity?.id;
  const [tab, setTab] = useState("active");

  const { data: stats, isLoading } = useQuery<any>({
    queryKey: ["/api/dashboard/driver-stats", cityId],
    queryFn: () =>
      apiFetch(
        `/api/dashboard/driver-stats${cityId ? `?cityId=${cityId}` : ""}`,
        token
      ),
    enabled: !!token,
    refetchInterval: 15000,
  });

  const buckets = [
    {
      key: "active",
      label: t("dashboard.online"),
      count: stats?.activeCount ?? 0,
      icon: Radio,
      color: "text-emerald-500",
      dotColor: "bg-emerald-500",
      pulseStatus: "healthy" as const,
    },
    {
      key: "inRoute",
      label: t("dashboard.inRoute"),
      count: stats?.inRouteCount ?? 0,
      icon: Navigation,
      color: "text-blue-500",
      dotColor: "bg-blue-500",
      pulseStatus: "warning" as const,
    },
    {
      key: "offline",
      label: t("dashboard.offHold"),
      count: stats?.offlineHoldCount ?? stats?.offlineOrPausedCount ?? 0,
      icon: WifiOff,
      color: "text-muted-foreground",
      dotColor: "bg-muted-foreground",
      pulseStatus: "offline" as const,
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle
            className="text-base font-medium flex items-center gap-2"
            data-testid="text-driver-presence-title"
          >
            <Radio className="w-4 h-4 text-emerald-500" />
            {t("dashboard.driverPresence")}
          </CardTitle>
          <InfoTooltip content="Real-time driver status — refreshes every 15 seconds. Online = available for dispatch, In Route = currently on a trip, Off/Hold = offline or paused." />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {buckets.map((b) => (
            <div
              key={b.key}
              className={`rounded-xl border p-3 text-center cursor-pointer transition-all duration-200 hover:shadow-md ${
                tab === b.key
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "hover:bg-muted/50"
              }`}
              onClick={() => setTab(b.key)}
              data-testid={`card-bucket-${b.key}`}
            >
              <div className="flex items-center justify-center gap-2 mb-1">
                <StatusPulse status={b.pulseStatus} size="sm" />
                <b.icon className={`w-4 h-4 ${b.color}`} />
              </div>
              {isLoading ? (
                <Skeleton className="h-6 w-8 mx-auto" />
              ) : (
                <p
                  className="text-xl font-bold"
                  data-testid={`text-count-${b.key}`}
                >
                  <AnimatedNumber value={b.count} />
                </p>
              )}
              <p className="text-xs text-muted-foreground">{b.label}</p>
            </div>
          ))}
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger
              value="active"
              className="flex-1"
              data-testid="tab-active"
            >
              {t("dashboard.online")}
              <Badge variant="secondary" className="ml-1">
                {stats?.activeCount ?? 0}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="inRoute"
              className="flex-1"
              data-testid="tab-inroute"
            >
              {t("dashboard.inRoute")}
              <Badge variant="secondary" className="ml-1">
                {stats?.inRouteCount ?? 0}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="offline"
              className="flex-1"
              data-testid="tab-offline"
            >
              {t("dashboard.offHold")}
              <Badge variant="secondary" className="ml-1">
                {stats?.offlineHoldCount ??
                  stats?.offlineOrPausedCount ??
                  0}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            <DriverList
              drivers={stats?.activeDrivers}
              isLoading={isLoading}
              emptyText="No active drivers"
              renderBadge={() => (
                <Badge variant="default" className="bg-emerald-600">
                  ACTIVE
                </Badge>
              )}
              testIdPrefix="active"
            />
          </TabsContent>

          <TabsContent value="inRoute">
            <DriverList
              drivers={stats?.inRouteDrivers}
              isLoading={isLoading}
              emptyText="No drivers in route"
              renderBadge={(d: any) => (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Badge variant="default" className="bg-blue-600">
                    IN ROUTE
                  </Badge>
                  <Badge variant="secondary">
                    {d.tripStatus?.replace(/_/g, " ")}
                  </Badge>
                </div>
              )}
              renderExtra={(d: any) => (
                <span className="text-xs text-muted-foreground">
                  Trip: {d.tripPublicId}
                </span>
              )}
              testIdPrefix="inroute"
            />
          </TabsContent>

          <TabsContent value="offline">
            <DriverList
              drivers={
                stats?.offlineHoldDrivers ?? stats?.offlineOrPausedDrivers
              }
              isLoading={isLoading}
              emptyText="No offline or hold drivers"
              renderBadge={(d: any) => (
                <Badge
                  variant={
                    d.reason === "hold" ? "secondary" : "outline"
                  }
                >
                  {d.reason === "hold"
                    ? "HOLD"
                    : d.reason === "disconnected"
                      ? "DISCONNECTED"
                      : "OFF"}
                </Badge>
              )}
              testIdPrefix="offline"
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function DriverList({
  drivers,
  isLoading,
  emptyText,
  renderBadge,
  renderExtra,
  testIdPrefix,
}: {
  drivers: any[] | undefined;
  isLoading: boolean;
  emptyText: string;
  renderBadge: (d: any) => React.ReactNode;
  renderExtra?: (d: any) => React.ReactNode;
  testIdPrefix: string;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!drivers?.length) {
    return (
      <div
        className="py-6 text-center text-sm text-muted-foreground"
        data-testid={`text-empty-${testIdPrefix}`}
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid={`list-${testIdPrefix}-drivers`}>
      {drivers.map((d: any) => (
        <div
          key={d.id}
          className="flex items-center justify-between gap-3 py-2 border-b last:border-0"
          data-testid={`row-driver-${testIdPrefix}-${d.id}`}
        >
          <div className="min-w-0 flex-1">
            <p
              className="text-sm font-medium truncate"
              data-testid={`text-driver-name-${d.id}`}
            >
              {d.name}
            </p>
            {renderExtra && (
              <div className="flex items-center gap-2 flex-wrap">
                {renderExtra(d)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {renderBadge(d)}
            <span
              className="text-xs text-muted-foreground flex items-center gap-1"
              data-testid={`text-lastseen-${d.id}`}
            >
              <Clock className="w-3 h-3" />
              {formatTimeAgo(d.lastSeenAt)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TripStatusSummary() {
  const { token, selectedCity } = useAuth();
  const cityParam = selectedCity ? `?cityId=${selectedCity.id}` : "";

  const { data: summary, isLoading } = useQuery<any>({
    queryKey: ["/api/stats/trip-status", selectedCity?.id],
    queryFn: async () => {
      const res = await fetch(`/api/stats/trip-status${cityParam}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!token,
  });

  const statuses = [
    { key: "SCHEDULED", label: "Scheduled", color: "bg-blue-500" },
    { key: "ASSIGNED", label: "Assigned", color: "bg-indigo-500" },
    { key: "IN_PROGRESS", label: "In Progress", color: "bg-amber-500" },
    { key: "COMPLETED", label: "Completed", color: "bg-emerald-500" },
    { key: "CANCELLED", label: "Cancelled", color: "bg-red-500" },
    { key: "NO_SHOW", label: "No Show", color: "bg-gray-500" },
  ];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  const total = statuses.reduce(
    (acc, s) => acc + (summary?.[s.key] || 0),
    0
  );

  return (
    <div className="space-y-3">
      {statuses.map((s) => {
        const count = summary?.[s.key] || 0;
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <div key={s.key} className="flex items-center gap-3">
            <div
              className={`w-2.5 h-2.5 rounded-full ${s.color} flex-shrink-0`}
            />
            <span className="text-sm flex-1">{s.label}</span>
            <span className="text-sm font-medium tabular-nums">{count}</span>
            <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden flex-shrink-0">
              <div
                className={`h-full rounded-full ${s.color} transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
