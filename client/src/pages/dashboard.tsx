import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Route, Users, Truck, HeartPulse, Building2, UserCheck, MapPin, Activity, Radio, Clock, Car } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { authHeaders } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

export default function DashboardPage() {
  const { user, token, selectedCity, isSuperAdmin } = useAuth();

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

  const statCards = [
    { label: "Total Trips", value: stats?.trips ?? 0, icon: Route, color: "text-blue-500" },
    { label: "Active Patients", value: stats?.patients ?? 0, icon: HeartPulse, color: "text-rose-500" },
    { label: "Active Drivers", value: stats?.drivers ?? 0, icon: UserCheck, color: "text-emerald-500" },
    { label: "Vehicles", value: stats?.vehicles ?? 0, icon: Truck, color: "text-amber-500" },
    { label: "Clinics", value: stats?.clinics ?? 0, icon: Building2, color: "text-violet-500" },
    { label: "Users", value: stats?.users ?? 0, icon: Users, color: "text-cyan-500" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-dashboard-title">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Welcome back, {user?.firstName}
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
              Super Admin
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className={`w-4 h-4 ${s.color}`} />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-bold" data-testid={`text-stat-${s.label.toLowerCase().replace(/\s/g, '-')}`}>
                  {s.value}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {user && ["SUPER_ADMIN", "ADMIN", "DISPATCH"].includes(user.role) && (
        <ActiveDriversPanel />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base font-medium">Recent Activity</CardTitle>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <RecentTrips />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base font-medium">Trip Status Overview</CardTitle>
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
  const cityParam = selectedCity ? `?cityId=${selectedCity.id}&limit=5` : "?limit=5";

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
        <div key={trip.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{trip.publicId}</p>
            <p className="text-xs text-muted-foreground truncate">
              {trip.pickupAddress} &rarr; {trip.dropoffAddress}
            </p>
          </div>
          <Badge variant={statusColors[trip.status] as any || "secondary"} className="flex-shrink-0">
            {trip.status.replace("_", " ")}
          </Badge>
        </div>
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

function ActiveDriversPanel() {
  const { token, selectedCity } = useAuth();
  const cityId = selectedCity?.id;

  const { data: activeDrivers, isLoading } = useQuery<any[]>({
    queryKey: ["/api/dispatch/drivers/active", cityId],
    queryFn: () => apiFetch(`/api/dispatch/drivers/active${cityId ? `?cityId=${cityId}` : ""}`, token),
    enabled: !!token,
    refetchInterval: 15000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Radio className="w-4 h-4 text-emerald-500" />
          Active Drivers
          {activeDrivers && (
            <Badge variant="secondary" className="ml-1" data-testid="badge-active-driver-count">
              {activeDrivers.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !activeDrivers?.length ? (
          <div className="py-6 text-center text-sm text-muted-foreground" data-testid="text-no-active-drivers">
            No drivers currently active
          </div>
        ) : (
          <div className="space-y-2" data-testid="list-active-drivers">
            {activeDrivers.map((d: any) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 py-2 border-b last:border-0"
                data-testid={`row-active-driver-${d.id}`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" data-testid={`text-driver-name-${d.id}`}>
                      {d.firstName} {d.lastName}
                    </p>
                    <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                      {d.cityName && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {d.cityName}
                        </span>
                      )}
                      {d.vehicleName && (
                        <span className="flex items-center gap-1">
                          <Car className="w-3 h-3" />
                          {d.vehicleName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0" data-testid={`text-driver-lastseen-${d.id}`}>
                  <Clock className="w-3 h-3" />
                  {formatTimeAgo(d.lastSeenAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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

  const total = statuses.reduce((acc, s) => acc + (summary?.[s.key] || 0), 0);

  return (
    <div className="space-y-3">
      {statuses.map((s) => {
        const count = summary?.[s.key] || 0;
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <div key={s.key} className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${s.color} flex-shrink-0`} />
            <span className="text-sm flex-1">{s.label}</span>
            <span className="text-sm font-medium tabular-nums">{count}</span>
            <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden flex-shrink-0">
              <div className={`h-full rounded-full ${s.color}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
