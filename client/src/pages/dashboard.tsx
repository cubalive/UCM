import { useState, useCallback } from "react";
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
  Download,
  Wifi,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authHeaders } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useRealtimeTrips } from "@/hooks/use-realtime-trips";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Settings } from "lucide-react";

const DASHBOARD_WIDGETS = ["kpis", "charts", "driverPresence", "recentActivity"] as const;
type WidgetKey = typeof DASHBOARD_WIDGETS[number];

const WIDGET_LABELS: Record<WidgetKey, string> = {
  kpis: "KPI Cards",
  charts: "Charts",
  driverPresence: "Driver Presence",
  recentActivity: "Recent Activity",
};

function loadWidgetPrefs(): Record<WidgetKey, boolean> {
  try {
    const raw = localStorage.getItem("ucm_dashboard_widgets");
    if (raw) return JSON.parse(raw);
  } catch {}
  return { kpis: true, charts: true, driverPresence: true, recentActivity: true };
}

function saveWidgetPrefs(prefs: Record<WidgetKey, boolean>) {
  try { localStorage.setItem("ucm_dashboard_widgets", JSON.stringify(prefs)); } catch {}
}

function loadSelectedDays(): number {
  try {
    const raw = localStorage.getItem("ucm_dashboard_days");
    if (raw) return parseInt(raw) || 14;
  } catch {}
  return 14;
}

function saveSelectedDays(days: number) {
  try { localStorage.setItem("ucm_dashboard_days", String(days)); } catch {}
}

const TIME_RANGES = [
  { label: "Hoy", value: 1 },
  { label: "7 Dias", value: 7 },
  { label: "14 Dias", value: 14 },
  { label: "30 Dias", value: 30 },
  { label: "90 Dias", value: 90 },
] as const;

const DASHBOARD_QUERY_KEYS = [
  "/api/stats",
  "/api/analytics/trends",
  "/api/stats/trip-status",
  "/api/dashboard/driver-stats",
  "/api/trips/recent",
];

export default function DashboardPage() {
  const { user, token, selectedCity, isSuperAdmin } = useAuth();
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [selectedDays, setSelectedDays] = useState(loadSelectedDays);
  const [widgetPrefs, setWidgetPrefs] = useState(loadWidgetPrefs);
  const queryClient = useQueryClient();

  const handleDaysChange = (days: number) => {
    setSelectedDays(days);
    saveSelectedDays(days);
  };

  const toggleWidget = (key: WidgetKey) => {
    setWidgetPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveWidgetPrefs(next);
      return next;
    });
  };

  // Real-time WebSocket subscription for live dashboard updates
  const { isConnected } = useRealtimeTrips({
    companyId: user?.companyId,
    invalidateKeys: ["/api/stats", "/api/analytics/trends", "/api/stats/trip-status", "/api/dashboard/driver-stats"],
    enabled: !!token && !!user?.companyId,
  });

  const handleRefreshAll = useCallback(() => {
    for (const key of DASHBOARD_QUERY_KEYS) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  }, [queryClient]);

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
    queryKey: ["/api/analytics/trends", selectedCity?.id, selectedDays],
    queryFn: () =>
      apiFetch(
        `/api/analytics/trends?days=${selectedDays}${selectedCity ? `&cityId=${selectedCity.id}` : ""}`,
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
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1
                className="text-2xl font-semibold tracking-tight"
                data-testid="text-dashboard-title"
              >
                {t("dashboard.title")}
              </h1>
              <Badge
                variant={isConnected ? "default" : "secondary"}
                className={`text-[10px] px-1.5 py-0 h-5 ${
                  isConnected
                    ? "bg-emerald-600 hover:bg-emerald-600"
                    : "text-muted-foreground"
                }`}
                data-testid="badge-live-indicator"
              >
                <Wifi className="w-3 h-3 mr-0.5" />
                {isConnected ? "Live" : "Offline"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {t("dashboard.welcomeBack", { name: user?.firstName })}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleRefreshAll}
            className="h-8 w-8"
            title="Refresh all dashboard data"
            data-testid="button-refresh-dashboard"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {/* Time Range Selector */}
          <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border" data-testid="time-range-selector">
            {TIME_RANGES.map((range) => (
              <button
                key={range.value}
                onClick={() => handleDaysChange(range.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  selectedDays === range.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
                data-testid={`button-range-${range.value}`}
              >
                {range.label}
              </button>
            ))}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Dashboard settings" data-testid="button-dashboard-settings">
                <Settings className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56" align="end">
              <p className="text-sm font-medium mb-2">Visible Widgets</p>
              <div className="space-y-2">
                {DASHBOARD_WIDGETS.map((key) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm">{WIDGET_LABELS[key]}</span>
                    <Switch
                      checked={widgetPrefs[key]}
                      onCheckedChange={() => toggleWidget(key)}
                      data-testid={`switch-widget-${key}`}
                    />
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!stats) return;
              const csv = [
                ["Metric", "Value"],
                ["Trips", stats.trips],
                ["Completed", stats.completed],
                ["Cancelled", stats.cancelled],
                ["Active Drivers", stats.activeDrivers],
                ["Active Vehicles", stats.activeVehicles],
                ["Patients", stats.patients],
                ["Clinics", stats.clinics],
                ["Total Miles", stats.totalMiles],
              ].map(r => r.join(",")).join("\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = `dashboard-${selectedDays}d-${new Date().toISOString().slice(0,10)}.csv`;
              a.click(); URL.revokeObjectURL(url);
            }}
            disabled={!stats}
            data-testid="button-export-csv"
          >
            <Download className="w-3.5 h-3.5 mr-1" />
            Export
          </Button>
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
      {widgetPrefs.kpis && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-[100px] w-full rounded-xl" />
            ))}
          </>
        ) : (
          <>
            <button onClick={() => navigate("/trips")} className="cursor-pointer hover:scale-[1.02] transition-transform text-left w-full" data-testid="kpi-trips" aria-label={`Total trips: ${stats?.trips ?? 0}. Click to view all trips`}>
              <KpiCard
                title={t("dashboard.totalTrips")}
                value={stats?.trips ?? 0}
                icon={<Route className="w-4 h-4 text-emerald-500" aria-hidden="true" />}
                sparkData={tripSparkData}
                color="emerald"
                change={calcChange(tripSparkData)}
                changeLabel="vs prev"
                tooltip="Total number of trips in the system for the selected city. Click to view all trips."
              />
            </button>
            <button onClick={() => navigate("/patients")} className="cursor-pointer hover:scale-[1.02] transition-transform text-left w-full" data-testid="kpi-patients" aria-label={`Active patients: ${stats?.patients ?? 0}. Click to view all patients`}>
              <KpiCard
                title={t("dashboard.activePatients")}
                value={stats?.patients ?? 0}
                icon={<HeartPulse className="w-4 h-4 text-rose-500" aria-hidden="true" />}
                color="rose"
                tooltip="Patients registered and active in the system. Click to view all patients."
              />
            </button>
            <button onClick={() => navigate("/drivers")} className="cursor-pointer hover:scale-[1.02] transition-transform text-left w-full" data-testid="kpi-drivers" aria-label={`Drivers: ${stats?.drivers ?? 0}. Click to view all drivers`}>
              <KpiCard
                title={t("dashboard.drivers")}
                value={stats?.drivers ?? 0}
                icon={<UserCheck className="w-4 h-4 text-emerald-500" aria-hidden="true" />}
                color="emerald"
                tooltip="Total registered drivers across all statuses. Click to view all drivers."
              />
            </button>
            <button onClick={() => navigate("/vehicles")} className="cursor-pointer hover:scale-[1.02] transition-transform text-left w-full" data-testid="kpi-vehicles" aria-label={`Vehicles: ${stats?.vehicles ?? 0}. Click to view all vehicles`}>
              <KpiCard
                title={t("dashboard.vehicles")}
                value={stats?.vehicles ?? 0}
                icon={<Truck className="w-4 h-4 text-amber-500" aria-hidden="true" />}
                color="amber"
                tooltip="Fleet size — total vehicles registered. Click to view all vehicles."
              />
            </button>
            <button onClick={() => navigate("/clinics")} className="cursor-pointer hover:scale-[1.02] transition-transform text-left w-full" data-testid="kpi-clinics" aria-label={`Clinics: ${stats?.clinics ?? 0}. Click to view all clinics`}>
              <KpiCard
                title={t("dashboard.clinics")}
                value={stats?.clinics ?? 0}
                icon={<Building2 className="w-4 h-4 text-purple-500" aria-hidden="true" />}
                color="purple"
                tooltip="Healthcare facilities partnered with UCM. Click to view all clinics."
              />
            </button>
            <button onClick={() => navigate("/users")} className="cursor-pointer hover:scale-[1.02] transition-transform text-left w-full" data-testid="kpi-users" aria-label={`Users: ${stats?.users ?? 0}. Click to view all users`}>
              <KpiCard
                title={t("dashboard.users")}
                value={stats?.users ?? 0}
                icon={<Users className="w-4 h-4 text-cyan-500" aria-hidden="true" />}
                color="cyan"
                tooltip="Platform users across all roles (admin, dispatch, drivers, clinics). Click to view all users."
              />
            </button>
          </>
        )}
      </div>}

      {/* Charts Row */}
      {widgetPrefs.charts && trends.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-medium">
                  {t("dashboard.tripTrends", { defaultValue: "Trip Trends" })}
                  <span className="text-xs font-normal text-muted-foreground ml-2">
                    ({selectedDays === 1 ? "Hoy" : `${selectedDays}d`})
                  </span>
                </CardTitle>
                <InfoTooltip content={`Daily trip volume over the last ${selectedDays} days. Shows completed vs total trips to track service delivery.`} />
              </div>
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <GlowAreaChart
                data={trends}
                dataKeys={[
                  { key: "total", color: "emerald", label: "Total" },
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
                  <span className="text-xs font-normal text-muted-foreground ml-2">
                    ({selectedDays === 1 ? "Hoy" : `${selectedDays}d`})
                  </span>
                </CardTitle>
                <InfoTooltip content={`Daily breakdown by trip status over the last ${selectedDays} days — cancelled and no-shows are tracked to identify operational issues.`} />
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
      {widgetPrefs.driverPresence && user &&
        ["SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"].includes(
          user.role
        ) && <DriverPresencePanel />}

      {/* Recent Activity & Trip Summary */}
      {widgetPrefs.recentActivity && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
      </div>}
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
    refetchInterval: 30000,
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
      color: "text-emerald-500",
      dotColor: "bg-emerald-500",
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
                  <Badge variant="default" className="bg-emerald-600">
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
    refetchInterval: 60000,
  });

  const statuses = [
    { key: "SCHEDULED", label: "Scheduled", color: "bg-emerald-500" },
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
