import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  RefreshCw,
  Shield,
  Siren,
  Zap,
  Route,
  Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api";

interface OpsAlert {
  code: string;
  severity: "critical" | "warning" | "info";
  title: string;
  count: number;
  actionUrl?: string;
}

interface OpsHealth {
  overall: "green" | "yellow" | "red";
  cityId: number;
  cityName: string;
  date: string;
  alerts: OpsAlert[];
  lastSmsSentAt?: string | null;
}

interface AlertLogEntry {
  id: number;
  cityId: number;
  date: string;
  alertFingerprint: string;
  overall: string;
  criticalCodes: string[] | null;
  sentAt: string;
  sentTo: string | null;
  providerSid: string | null;
  error: string | null;
}

interface AlertSystemHealth {
  ok: boolean;
  dispatchPhoneConfigured: boolean;
  twilioConfigured: boolean;
  schedulerRunning: boolean;
  cooldownMinutes: number;
  intervalSeconds: number;
}

function StatusBanner({ overall }: { overall: "green" | "yellow" | "red" }) {
  const config = {
    green: { bg: "bg-green-50 dark:bg-green-950/30", border: "border-green-200 dark:border-green-800", text: "text-green-800 dark:text-green-200", icon: CheckCircle, label: "All Clear" },
    yellow: { bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-200 dark:border-yellow-800", text: "text-yellow-800 dark:text-yellow-200", icon: AlertTriangle, label: "Warnings" },
    red: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", text: "text-red-800 dark:text-red-200", icon: XCircle, label: "Critical" },
  };
  const c = config[overall];
  const Icon = c.icon;

  return (
    <div className={`flex items-center gap-3 p-4 rounded-md border ${c.bg} ${c.border}`} data-testid="status-banner-ops">
      <Icon className={`w-6 h-6 ${c.text}`} />
      <span className={`text-lg font-semibold ${c.text}`} data-testid="text-ops-status">{c.label}</span>
    </div>
  );
}

function AlertCard({ alert }: { alert: OpsAlert }) {
  const severityStyles = {
    critical: "border-red-200 dark:border-red-800",
    warning: "border-yellow-200 dark:border-yellow-800",
    info: "border-blue-200 dark:border-blue-800",
  };
  const badgeVariant = alert.severity === "critical" ? "destructive" : alert.severity === "warning" ? "secondary" : "outline";

  return (
    <Card className={`${severityStyles[alert.severity]}`} data-testid={`card-alert-${alert.code}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {alert.severity === "critical" ? (
              <Siren className="w-4 h-4 text-red-500" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
            )}
            <span className="font-medium" data-testid={`text-alert-title-${alert.code}`}>{alert.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={badgeVariant} data-testid={`badge-alert-count-${alert.code}`}>
              {alert.count}
            </Badge>
            <Badge variant="outline">{alert.severity}</Badge>
          </div>
        </div>
        {alert.actionUrl && (
          <a
            href={alert.actionUrl}
            className="text-sm text-blue-600 dark:text-blue-400 underline mt-2 inline-block"
            data-testid={`link-alert-action-${alert.code}`}
          >
            View affected trips
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function CityHealthTab() {
  const { token, selectedCity, user } = useAuth();
  const { toast } = useToast();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const today = new Date().toISOString().slice(0, 10);

  const healthQuery = useQuery<OpsHealth>({
    queryKey: ["/api/ops/health", selectedCity?.id, today],
    queryFn: () => apiFetch(`/api/ops/health?city_id=${selectedCity?.id}&date=${today}`, token),
    enabled: !!selectedCity && !!token,
    refetchInterval: 60000,
  });

  const historyQuery = useQuery<AlertLogEntry[]>({
    queryKey: ["/api/ops/alerts/history", selectedCity?.id, today],
    queryFn: () => apiFetch(`/api/ops/alerts/history?city_id=${selectedCity?.id}&date=${today}`, token),
    enabled: !!selectedCity && !!token,
  });

  const testSmsMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/ops/alerts/test-sms", token, {
        method: "POST",
        body: JSON.stringify({ city_id: selectedCity?.id }),
      }),
    onSuccess: (data: any) => {
      toast({ title: data.ok ? "Test SMS sent" : "SMS failed", description: data.error || data.sid });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/alerts/history"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!selectedCity) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground" data-testid="text-select-city">Select a city to view ops health.</p>
        </CardContent>
      </Card>
    );
  }

  if (healthQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const health = healthQuery.data;
  if (!health) return null;

  return (
    <div className="space-y-4">
      <StatusBanner overall={health.overall} />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {health.cityName} - {health.date}
          </span>
          {health.lastSmsSentAt && (
            <Badge variant="outline" data-testid="badge-last-sms">
              <Clock className="w-3 h-3 mr-1" />
              Last SMS: {new Date(health.lastSmsSentAt).toLocaleTimeString()}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => healthQuery.refetch()}
            data-testid="button-refresh-health"
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
          {isSuperAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => testSmsMutation.mutate()}
              disabled={testSmsMutation.isPending}
              data-testid="button-test-sms"
            >
              <Send className="w-4 h-4 mr-1" />
              {testSmsMutation.isPending ? "Sending..." : "Send Test SMS"}
            </Button>
          )}
        </div>
      </div>

      {health.alerts.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
            <p className="text-muted-foreground" data-testid="text-no-alerts">No active alerts. Operations are running smoothly.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="list-alerts">
          {health.alerts.map((alert) => (
            <AlertCard key={alert.code} alert={alert} />
          ))}
        </div>
      )}

      {(historyQuery.data?.length || 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SMS Alert History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2" data-testid="list-alert-history">
              {historyQuery.data?.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-2 py-2 border-b last:border-0 flex-wrap"
                  data-testid={`row-alert-history-${entry.id}`}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={entry.error ? "destructive" : "outline"}>
                      {entry.error ? "Failed" : "Sent"}
                    </Badge>
                    <span className="text-sm">
                      {entry.criticalCodes?.join(", ") || "N/A"}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.sentAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ClinicHealthTab() {
  const { token, selectedCity } = useAuth();
  const [selectedClinicId, setSelectedClinicId] = useState<string>("");

  const clinicsQuery = useQuery<any[]>({
    queryKey: ["/api/clinics", selectedCity?.id],
    queryFn: () => apiFetch(`/api/clinics?cityId=${selectedCity?.id}`, token),
    enabled: !!selectedCity && !!token,
  });

  const clinicHealthQuery = useQuery<any>({
    queryKey: ["/api/ops/clinic-health", selectedClinicId],
    queryFn: () => apiFetch(`/api/ops/clinic-health?clinic_id=${selectedClinicId}`, token),
    enabled: !!selectedClinicId && !!token,
    refetchInterval: 60000,
  });

  if (!selectedCity) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">Select a city first.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={selectedClinicId} onValueChange={setSelectedClinicId}>
          <SelectTrigger className="w-[280px]" data-testid="select-clinic">
            <SelectValue placeholder="Select a clinic" />
          </SelectTrigger>
          <SelectContent>
            {clinicsQuery.data
              ?.filter((c: any) => c.active && !c.deletedAt)
              .map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)} data-testid={`option-clinic-${c.id}`}>
                  {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {selectedClinicId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => clinicHealthQuery.refetch()}
            data-testid="button-refresh-clinic-health"
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        )}
      </div>

      {!selectedClinicId && (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground" data-testid="text-select-clinic-prompt">Select a clinic to view its health status.</p>
          </CardContent>
        </Card>
      )}

      {selectedClinicId && clinicHealthQuery.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {clinicHealthQuery.data && (
        <div className="space-y-4">
          <StatusBanner overall={clinicHealthQuery.data.overall} />

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {clinicHealthQuery.data.clinicName} - {clinicHealthQuery.data.date}
            </span>
            {clinicHealthQuery.data.lastAlertSentAt && (
              <Badge variant="outline" data-testid="badge-clinic-last-alert">
                <Clock className="w-3 h-3 mr-1" />
                Last alert: {new Date(clinicHealthQuery.data.lastAlertSentAt).toLocaleTimeString()}
              </Badge>
            )}
          </div>

          {clinicHealthQuery.data.alerts.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
                <p className="text-muted-foreground">No active alerts for this clinic.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3" data-testid="list-clinic-alerts">
              {clinicHealthQuery.data.alerts.map((alert: OpsAlert) => (
                <AlertCard key={alert.code} alert={alert} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SystemStatusTab() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const statusQuery = useQuery<AlertSystemHealth>({
    queryKey: ["/api/ops/alerts/health"],
    queryFn: () => apiFetch("/api/ops/alerts/health", token),
    enabled: !!token,
  });

  const runOnceMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/ops/alerts/run-once", token, { method: "POST" }),
    onSuccess: (data: any) => {
      toast({
        title: "Alert cycle completed",
        description: `Ops: ${data.ops?.citiesChecked} cities, ${data.ops?.alertsSent} alerts. Clinics: ${data.clinic?.clinicsChecked} checked, ${data.clinic?.alertsSent} alerts.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/alerts/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/health"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const status = statusQuery.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Alert System Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statusQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : status ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">Dispatch Phone</span>
                  <Badge variant={status.dispatchPhoneConfigured ? "outline" : "destructive"} data-testid="badge-dispatch-phone">
                    {status.dispatchPhoneConfigured ? "Configured" : "Not Set"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">Twilio</span>
                  <Badge variant={status.twilioConfigured ? "outline" : "destructive"} data-testid="badge-twilio">
                    {status.twilioConfigured ? "Connected" : "Not Configured"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">Scheduler</span>
                  <Badge variant={status.schedulerRunning ? "outline" : "destructive"} data-testid="badge-scheduler">
                    {status.schedulerRunning ? "Running" : "Stopped"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">Check Interval</span>
                  <Badge variant="outline">{status.intervalSeconds}s</Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">Cooldown</span>
                  <Badge variant="outline">{status.cooldownMinutes} min</Badge>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isSuperAdmin && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="font-medium">Manual Alert Cycle</p>
                <p className="text-sm text-muted-foreground">Trigger one alert check cycle for all cities and clinics.</p>
              </div>
              <Button
                onClick={() => runOnceMutation.mutate()}
                disabled={runOnceMutation.isPending}
                data-testid="button-run-once"
              >
                {runOnceMutation.isPending ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Activity className="w-4 h-4 mr-1" />
                    Run Now
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function OpsHealthPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";

  return (
    <div className="p-4 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Activity className="w-6 h-6" />
        <h1 className="text-xl font-semibold" data-testid="text-ops-health-title">Ops Health</h1>
      </div>

      <Tabs defaultValue="city" className="space-y-4">
        <TabsList data-testid="tabs-ops-health">
          <TabsTrigger value="city" data-testid="tab-city-health">City Health</TabsTrigger>
          <TabsTrigger value="clinic" data-testid="tab-clinic-health">Clinic Health</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="automation" data-testid="tab-automation">Automation</TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="system" data-testid="tab-system-status">System Status</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="city">
          <CityHealthTab />
        </TabsContent>

        <TabsContent value="clinic">
          <ClinicHealthTab />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="automation">
            <AutomationTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="system">
            <SystemStatusTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function AutomationTab() {
  const { token, selectedCity } = useAuth();
  const today = new Date().toISOString().split("T")[0];
  const cityParam = selectedCity ? `&cityId=${selectedCity.id}` : "";

  const { data: batches, isLoading: batchesLoading } = useQuery<any[]>({
    queryKey: ["/api/route-batches", selectedCity?.id, today],
    queryFn: () => apiFetch(`/api/route-batches?date=${today}${cityParam}`, token),
    enabled: !!selectedCity?.id && !!token,
    refetchInterval: 60000,
  });

  const { data: financialToday, isLoading: financialLoading } = useQuery<any>({
    queryKey: ["/api/financial/daily", selectedCity?.id, today],
    queryFn: () => apiFetch(`/api/financial/daily?date=${today}${cityParam}`, token),
    enabled: !!selectedCity?.id && !!token,
    refetchInterval: 60000,
  });

  if (!selectedCity?.id) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground" data-testid="text-automation-select-city">Select a city to view automation status.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-1">
              <Route className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Route Batches Today</span>
            </div>
            {batchesLoading ? <Skeleton className="h-8 w-16" /> : (
              <p className="text-2xl font-bold" data-testid="text-automation-batches">{batches?.length || 0}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Trips Assigned</span>
            </div>
            {financialLoading ? <Skeleton className="h-8 w-16" /> : (
              <p className="text-2xl font-bold" data-testid="text-automation-assigned">
                {financialToday?.completed || 0}/{financialToday?.totalTrips || 0}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Active Drivers</span>
            </div>
            {financialLoading ? <Skeleton className="h-8 w-16" /> : (
              <p className="text-2xl font-bold" data-testid="text-automation-drivers">{financialToday?.activeDrivers || 0}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Automation Schedulers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { name: "Route Engine", schedule: "5:30 AM (Mon-Sat)", desc: "Groups trips into route batches by city, time window, and ZIP cluster" },
              { name: "Vehicle Auto-Assign", schedule: "6:00 AM (Mon-Sat)", desc: "Assigns vehicles and drivers to scheduled trips" },
              { name: "No-Show Monitor", schedule: "Every 5 min", desc: "Sends T-24h/T-2h confirmations, flags at-risk unconfirmed trips" },
              { name: "ETA Engine", schedule: "Every 2 min", desc: "Calculates live ETAs for en-route trips" },
              { name: "Ops Alert", schedule: "Every 5 min", desc: "Monitors operational health and sends SMS alerts for critical issues" },
            ].map((sched) => (
              <div key={sched.name} className="flex items-center justify-between gap-3 flex-wrap" data-testid={`row-scheduler-${sched.name.toLowerCase().replace(/\s/g, "-")}`}>
                <div className="min-w-0">
                  <p className="font-medium text-sm">{sched.name}</p>
                  <p className="text-xs text-muted-foreground">{sched.desc}</p>
                </div>
                <Badge variant="secondary">
                  <Clock className="w-3 h-3 mr-1" />
                  {sched.schedule}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {batches && batches.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Route className="w-4 h-4" />
              Today's Route Batches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-route-batches">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-3">Batch</th>
                    <th className="text-left py-2 px-3">Window</th>
                    <th className="text-left py-2 px-3">ZIP Cluster</th>
                    <th className="text-right py-2 px-3">Trips</th>
                    <th className="text-left py-2 pl-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch: any) => (
                    <tr key={batch.id} className="border-b last:border-0" data-testid={`row-batch-${batch.id}`}>
                      <td className="py-2 pr-3 font-mono text-xs">#{batch.id}</td>
                      <td className="py-2 px-3 capitalize">{batch.timeWindow}</td>
                      <td className="py-2 px-3">{batch.zipCluster}</td>
                      <td className="py-2 px-3 text-right">{batch.tripCount}</td>
                      <td className="py-2 pl-3">
                        <Badge variant={batch.status === "completed" ? "default" : "secondary"}>
                          {batch.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {batches && batches.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <Route className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground text-sm">No route batches for today yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Route Engine runs at 5:30 AM (Mon-Sat)</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
