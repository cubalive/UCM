import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { isDriverHost } from "@/lib/hostDetection";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
  ExternalLink,
  ChevronRight,
  Database,
  Wifi,
  Radio,
  MapPin,
  Truck,
  FileText,
  Eye,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useLocation } from "wouter";

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

interface AlertCodeMeta {
  icon: any;
  module: string;
  route: string;
  filterKey?: string;
  filterValue?: string;
  description: string;
  isExternal?: boolean;
}

const ALERT_CODE_META: Record<string, AlertCodeMeta> = {
  TRIPS_PENDING_APPROVAL: { icon: FileText, module: "Trips", route: "/trips", filterKey: "approvalStatus", filterValue: "pending", description: "Trips waiting for dispatcher approval for more than 15 minutes. These trips need immediate attention to avoid service delays." },
  TRIPS_NO_DRIVER_ASSIGNED: { icon: Truck, module: "Trips", route: "/trips", filterKey: "status", filterValue: "PENDING", description: "Trips within the next 60 minutes that have no driver assigned. Assign a driver immediately to ensure pickup." },
  DRIVER_LATE: { icon: Clock, module: "Dispatch Board", route: "/dispatch", filterKey: "status", filterValue: "late", description: "Drivers who are more than 10 minutes late for their scheduled pickup. Monitor these trips for potential no-shows." },
  TRIPS_NO_ETA: { icon: MapPin, module: "Dispatch Board", route: "/dispatch", filterKey: "status", filterValue: "no-eta", description: "Active trips (assigned or in-progress) within the next 60 minutes that have no ETA calculated. The ETA engine may not be reaching these drivers." },
  TRIPS_CANCELLED_TODAY: { icon: XCircle, module: "Trips", route: "/trips", filterKey: "status", filterValue: "CANCELLED", description: "All trips cancelled today. Review cancellation reasons and check for patterns." },
  UPCOMING_PICKUPS_60_MIN: { icon: Clock, module: "Trips", route: "/trips", filterKey: "upcoming", filterValue: "60min", description: "Trips with pickups in the next 60 minutes. Overview of near-term workload." },
  DB_CONNECTION_ERROR: { icon: Database, module: "System Status", route: "/ops-health", filterKey: "section", filterValue: "system", description: "The database connection has failed. This is a critical infrastructure issue. Check Supabase status and connection pooler." },
  REDIS_CONNECTION_ERROR: { icon: Wifi, module: "System Status", route: "/ops-health", filterKey: "section", filterValue: "system", description: "Redis (Upstash) connection error. Caching, job queues, and rate limiting may be degraded. The system will fall back to in-memory cache." },
  STALE_DRIVER_GPS: { icon: Radio, module: "Fleet Ops", route: "/fleet", description: "Active drivers whose GPS location hasn't updated in over 5 minutes. Their app may be offline or experiencing connectivity issues.", isExternal: true },
  PATIENT_NO_SHOW_RECENT: { icon: Users, module: "Trips", route: "/trips", filterKey: "status", filterValue: "NO_SHOW", description: "Recent patient no-shows. Patterns may indicate scheduling or communication issues." },
  SYSTEM_STATUS: { icon: Shield, module: "System Status", route: "/ops-health", filterKey: "section", filterValue: "system", description: "System infrastructure component status." },
  SMS_DELIVERY_FAILURE: { icon: Send, module: "System Status", route: "/ops-health", filterKey: "section", filterValue: "system", description: "Twilio SMS delivery failures detected. This is an external service issue — check Twilio status page or account balance.", isExternal: true },
  GOOGLE_MAPS_ERROR: { icon: MapPin, module: "System Status", route: "/ops-health", filterKey: "section", filterValue: "system", description: "Google Maps API errors detected. This is an external service issue — check API key quota or Google Cloud status.", isExternal: true },
};

const DEFAULT_META: AlertCodeMeta = { icon: AlertTriangle, module: "Ops Health", route: "/ops-health", description: "Operational alert requiring attention." };

function getAlertMeta(code: string): AlertCodeMeta {
  return ALERT_CODE_META[code] || DEFAULT_META;
}

function getResolvedAlerts(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem("ucm_resolved_alerts") || "{}");
  } catch { return {}; }
}

function markAlertResolved(code: string) {
  const resolved = getResolvedAlerts();
  resolved[code] = new Date().toISOString();
  localStorage.setItem("ucm_resolved_alerts", JSON.stringify(resolved));
}

function unmarkAlertResolved(code: string) {
  const resolved = getResolvedAlerts();
  delete resolved[code];
  localStorage.setItem("ucm_resolved_alerts", JSON.stringify(resolved));
}

function isAlertResolved(code: string): boolean {
  const resolved = getResolvedAlerts();
  if (!resolved[code]) return false;
  const resolvedAt = new Date(resolved[code]);
  const hoursSince = (Date.now() - resolvedAt.getTime()) / (1000 * 60 * 60);
  return hoursSince < 24;
}

function readQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    section: params.get("section"),
    severity: params.get("severity"),
    alertCode: params.get("alertCode"),
    status: params.get("status"),
  };
}

function ErrorDetailsDrawer({
  open,
  onClose,
  alert,
  onResolve,
  onUnresolve,
}: {
  open: boolean;
  onClose: () => void;
  alert: OpsAlert | null;
  onResolve?: (code: string) => void;
  onUnresolve?: (code: string) => void;
}) {
  const [, navigate] = useLocation();

  if (!alert) return null;
  const meta = getAlertMeta(alert.code);
  const Icon = meta.icon;
  const resolved = isAlertResolved(alert.code);

  const isExt = meta.isExternal === true;

  const severityConfig = {
    critical: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", text: "text-red-700 dark:text-red-300", badge: "destructive" as const },
    warning: { bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-200 dark:border-yellow-800", text: "text-yellow-700 dark:text-yellow-300", badge: "secondary" as const },
    info: { bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-800", text: "text-blue-700 dark:text-blue-300", badge: "outline" as const },
  };

  const sc = isExt && !resolved
    ? { bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-800", text: "text-amber-700 dark:text-amber-300", badge: "secondary" as const }
    : resolved
      ? { bg: "bg-green-50 dark:bg-green-950/30", border: "border-green-200 dark:border-green-800", text: "text-green-700 dark:text-green-300", badge: "outline" as const }
      : severityConfig[alert.severity];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="sm:max-w-md overflow-y-auto" data-testid="drawer-error-details">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2" data-testid="text-drawer-title">
            <Icon className="w-5 h-5" />
            {resolved ? "Resolved Alert" : "Alert Details"}
          </SheetTitle>
          <SheetDescription data-testid="text-drawer-subtitle">
            {alert.title}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          {isExt && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30" data-testid="div-external-badge">
              <ExternalLink className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-xs text-amber-700 dark:text-amber-300">
                External Service — This issue originates outside the UCM system. You can acknowledge and mark it as resolved once addressed.
              </span>
            </div>
          )}

          {resolved && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30" data-testid="div-resolved-badge">
              <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
              <span className="text-xs text-green-700 dark:text-green-300">
                Marked as resolved. This acknowledgment expires after 24 hours.
              </span>
            </div>
          )}

          <div className={`p-4 rounded-lg border ${sc.bg} ${sc.border}`} data-testid="div-drawer-severity-box">
            <div className="flex items-center justify-between mb-3">
              <Badge variant={sc.badge} data-testid="badge-drawer-severity">
                {resolved ? "RESOLVED" : isExt ? "EXTERNAL" : alert.severity.toUpperCase()}
              </Badge>
              <Badge variant="outline" data-testid="badge-drawer-count">{alert.count} affected</Badge>
            </div>
            <p className={`text-sm font-medium ${sc.text}`} data-testid="text-drawer-alert-title">{alert.title}</p>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Alert Code</h4>
            <code className="text-xs bg-muted px-2 py-1 rounded block" data-testid="text-drawer-code">{alert.code}</code>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Description</h4>
            <p className="text-sm text-muted-foreground" data-testid="text-drawer-description">{meta.description}</p>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Source</h4>
            <div className="flex items-center gap-2">
              <Badge variant={isExt ? "secondary" : "outline"} data-testid="badge-drawer-source">
                {isExt ? "External Service" : "System"}
              </Badge>
              <span className="text-sm" data-testid="text-drawer-module">{meta.module}</span>
            </div>
          </div>

          {isExt && !resolved && (
            <Button
              className="w-full bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => {
                markAlertResolved(alert.code);
                onResolve?.(alert.code);
                onClose();
              }}
              data-testid="button-drawer-resolve"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Mark as Resolved
            </Button>
          )}

          {isExt && resolved && (
            <Button
              variant="outline"
              className="w-full border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
              onClick={() => {
                unmarkAlertResolved(alert.code);
                onUnresolve?.(alert.code);
                onClose();
              }}
              data-testid="button-drawer-unresolve"
            >
              <XCircle className="w-4 h-4 mr-2" />
              Reopen Alert
            </Button>
          )}

          {meta.route !== "/ops-health" && (
            <Button
              variant={isExt ? "outline" : "default"}
              className="w-full"
              onClick={() => {
                onClose();
                const targetUrl = meta.filterKey && meta.filterValue
                  ? `${meta.route}?${meta.filterKey}=${meta.filterValue}`
                  : meta.route;
                navigate(targetUrl);
              }}
              data-testid="button-drawer-navigate"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open in {meta.module}
            </Button>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={onClose}
            data-testid="button-drawer-close"
          >
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StatusBanner({
  overall,
  onClickCritical,
  onClickOk,
}: {
  overall: "green" | "yellow" | "red";
  onClickCritical?: () => void;
  onClickOk?: () => void;
}) {
  const config = {
    green: { bg: "bg-green-50 dark:bg-green-950/30", border: "border-green-200 dark:border-green-800", text: "text-green-800 dark:text-green-200", icon: CheckCircle, label: "All Clear" },
    yellow: { bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-200 dark:border-yellow-800", text: "text-yellow-800 dark:text-yellow-200", icon: AlertTriangle, label: "Warnings" },
    red: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", text: "text-red-800 dark:text-red-200", icon: XCircle, label: "Critical" },
  };
  const c = config[overall];
  const Icon = c.icon;

  const handleClick = () => {
    if (overall === "red" && onClickCritical) {
      onClickCritical();
    } else if (onClickOk) {
      onClickOk();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`w-full flex items-center justify-between gap-3 p-4 rounded-md border transition-colors cursor-pointer hover:shadow-sm ${c.bg} ${c.border}`}
      data-testid="button-status-banner"
    >
      <div className="flex items-center gap-3">
        <Icon className={`w-6 h-6 ${c.text}`} />
        <span className={`text-lg font-semibold ${c.text}`} data-testid="text-ops-status">{c.label}</span>
      </div>
      <div className="flex items-center gap-2">
        {overall === "green" && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Eye className="w-3 h-3" /> View logs
          </span>
        )}
        <ChevronRight className={`w-5 h-5 ${c.text} opacity-50`} />
      </div>
    </button>
  );
}

function AlertCard({
  alert,
  onClickDrawer,
  resolvedCodes,
}: {
  alert: OpsAlert;
  onClickDrawer: (alert: OpsAlert) => void;
  resolvedCodes?: Set<string>;
}) {
  const [, navigate] = useLocation();
  const meta = getAlertMeta(alert.code);
  const Icon = meta.icon;
  const isExt = meta.isExternal === true;
  const resolved = resolvedCodes?.has(alert.code) || isAlertResolved(alert.code);

  const severityStyles = {
    critical: "border-red-200 dark:border-red-800 hover:border-red-300 dark:hover:border-red-700",
    warning: "border-yellow-200 dark:border-yellow-800 hover:border-yellow-300 dark:hover:border-yellow-700",
    info: "border-blue-200 dark:border-blue-800 hover:border-blue-300 dark:hover:border-blue-700",
  };

  const cardStyle = resolved
    ? "border-green-200 dark:border-green-800 hover:border-green-300 dark:hover:border-green-700 opacity-70"
    : isExt
      ? "border-amber-200 dark:border-amber-800 hover:border-amber-300 dark:hover:border-amber-700"
      : severityStyles[alert.severity];

  const badgeVariant = resolved
    ? "outline" as const
    : isExt
      ? "secondary" as const
      : alert.severity === "critical" ? "destructive" as const : alert.severity === "warning" ? "secondary" as const : "outline" as const;

  const handleClick = () => {
    if (alert.severity === "critical" || isExt) {
      onClickDrawer(alert);
    } else {
      const targetUrl = meta.filterKey && meta.filterValue
        ? `${meta.route}?${meta.filterKey}=${meta.filterValue}`
        : meta.route;
      navigate(targetUrl);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full text-left"
      data-testid={`button-alert-${alert.code}`}
    >
      <Card className={`${cardStyle} transition-colors cursor-pointer hover:shadow-sm`} data-testid={`card-alert-${alert.code}`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              {resolved ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : isExt ? (
                <ExternalLink className="w-4 h-4 text-amber-500" />
              ) : alert.severity === "critical" ? (
                <Siren className="w-4 h-4 text-red-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
              )}
              <span className={`font-medium ${resolved ? "line-through opacity-70" : ""}`} data-testid={`text-alert-title-${alert.code}`}>{alert.title}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={badgeVariant} data-testid={`badge-alert-count-${alert.code}`}>
                {alert.count}
              </Badge>
              {isExt && !resolved && (
                <Badge variant="secondary" className="bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700" data-testid={`badge-alert-external-${alert.code}`}>
                  External
                </Badge>
              )}
              {resolved && (
                <Badge variant="outline" className="bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-700" data-testid={`badge-alert-resolved-${alert.code}`}>
                  Resolved
                </Badge>
              )}
              {!isExt && !resolved && (
                <Badge variant="outline" data-testid={`badge-alert-severity-${alert.code}`}>{alert.severity}</Badge>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Icon className="w-3 h-3" />
            <span data-testid={`text-alert-module-${alert.code}`}>{meta.module}</span>
            <span>&rarr;</span>
            <span className={isExt ? "text-amber-600 dark:text-amber-400" : "text-blue-600 dark:text-blue-400"}>
              {resolved ? "View resolved alert" : isExt ? "View external issue" : alert.severity === "critical" ? "View details" : `Go to ${meta.module}`}
            </span>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

function ClickableMetricCard({
  icon: Icon,
  iconColor,
  label,
  value,
  isLoading,
  onClick,
  status,
  testId,
}: {
  icon: any;
  iconColor: string;
  label: string;
  value: string | number;
  isLoading: boolean;
  onClick: () => void;
  status?: "ok" | "critical" | "warning";
  testId: string;
}) {
  const statusBorder = status === "critical" ? "border-red-200 dark:border-red-800" : status === "warning" ? "border-yellow-200 dark:border-yellow-800" : "";

  return (
    <button type="button" onClick={onClick} className="w-full text-left" data-testid={testId}>
      <Card className={`transition-colors cursor-pointer hover:shadow-sm hover:border-foreground/20 ${statusBorder}`}>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`w-4 h-4 ${iconColor}`} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground opacity-50" />
          </div>
          {isLoading ? <Skeleton className="h-8 w-16" /> : (
            <p className="text-2xl font-bold" data-testid={`text-${testId}-value`}>{value}</p>
          )}
        </CardContent>
      </Card>
    </button>
  );
}

function ClickableSystemRow({
  label,
  value,
  badgeVariant,
  onClick,
  testId,
}: {
  label: string;
  value: string;
  badgeVariant: "outline" | "destructive" | "secondary";
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between gap-2 py-1 rounded transition-colors hover:bg-muted/50 cursor-pointer px-1"
      data-testid={testId}
    >
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-1">
        <Badge variant={badgeVariant} data-testid={`badge-${testId}`}>{value}</Badge>
        <ChevronRight className="w-3 h-3 text-muted-foreground opacity-50" />
      </div>
    </button>
  );
}

function CityHealthTab({ autoAlertCode, resolvedCodes, onResolve, onUnresolve }: { autoAlertCode?: string | null; resolvedCodes: Set<string>; onResolve: (code: string) => void; onUnresolve: (code: string) => void }) {
  const { token, selectedCity, user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const today = new Date().toISOString().slice(0, 10);
  const [drawerAlert, setDrawerAlert] = useState<OpsAlert | null>(null);

  const healthQuery = useQuery<OpsHealth>({
    queryKey: ["/api/ops/health", selectedCity?.id, today],
    queryFn: () => apiFetch(`/api/ops/health?city_id=${selectedCity?.id}&date=${today}`, token),
    enabled: !isDriverHost && !!selectedCity && !!token,
    refetchInterval: 60000,
  });

  const historyQuery = useQuery<AlertLogEntry[]>({
    queryKey: ["/api/ops/alerts/history", selectedCity?.id, today],
    queryFn: () => apiFetch(`/api/ops/alerts/history?city_id=${selectedCity?.id}&date=${today}`, token),
    enabled: !isDriverHost && !!selectedCity && !!token,
  });

  useEffect(() => {
    if (autoAlertCode && healthQuery.data) {
      const found = healthQuery.data.alerts.find(a => a.code === autoAlertCode);
      if (found) setDrawerAlert(found);
    }
  }, [autoAlertCode, healthQuery.data]);

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

  const handleBannerClickCritical = () => {
    const firstCritical = healthQuery.data?.alerts.find(a => a.severity === "critical");
    if (firstCritical) setDrawerAlert(firstCritical);
  };

  const handleBannerClickOk = () => {
    navigate("/ops-health?section=city");
  };

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
      <StatusBanner
        overall={health.overall}
        onClickCritical={handleBannerClickCritical}
        onClickOk={handleBannerClickOk}
      />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground" data-testid="text-city-date">
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
            <AlertCard key={alert.code} alert={alert} onClickDrawer={setDrawerAlert} resolvedCodes={resolvedCodes} />
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
                    <Badge variant={entry.error ? "destructive" : "outline"} data-testid={`badge-alert-history-status-${entry.id}`}>
                      {entry.error ? "Failed" : "Sent"}
                    </Badge>
                    <span className="text-sm" data-testid={`text-alert-history-codes-${entry.id}`}>
                      {entry.criticalCodes?.join(", ") || "N/A"}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground" data-testid={`text-alert-history-time-${entry.id}`}>
                    {new Date(entry.sentAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <ErrorDetailsDrawer
        open={!!drawerAlert}
        onClose={() => setDrawerAlert(null)}
        alert={drawerAlert}
        onResolve={onResolve}
        onUnresolve={onUnresolve}
      />
    </div>
  );
}

function ClinicHealthTab({ autoAlertCode, resolvedCodes, onResolve, onUnresolve }: { autoAlertCode?: string | null; resolvedCodes: Set<string>; onResolve: (code: string) => void; onUnresolve: (code: string) => void }) {
  const { token, selectedCity } = useAuth();
  const [, navigate] = useLocation();
  const [selectedClinicId, setSelectedClinicId] = useState<string>("");
  const [drawerAlert, setDrawerAlert] = useState<OpsAlert | null>(null);

  const clinicsQuery = useQuery<any[]>({
    queryKey: ["/api/clinics", selectedCity?.id],
    queryFn: () => apiFetch(`/api/clinics?cityId=${selectedCity?.id}`, token),
    enabled: !!selectedCity && !!token,
  });

  const clinicHealthQuery = useQuery<any>({
    queryKey: ["/api/ops/clinic-health", selectedClinicId],
    queryFn: () => apiFetch(`/api/ops/clinic-health?clinic_id=${selectedClinicId}`, token),
    enabled: !isDriverHost && !!selectedClinicId && !!token,
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (autoAlertCode && clinicHealthQuery.data) {
      const found = clinicHealthQuery.data.alerts?.find((a: OpsAlert) => a.code === autoAlertCode);
      if (found) setDrawerAlert(found);
    }
  }, [autoAlertCode, clinicHealthQuery.data]);

  const handleBannerClickCritical = () => {
    const firstCritical = clinicHealthQuery.data?.alerts?.find((a: OpsAlert) => a.severity === "critical");
    if (firstCritical) setDrawerAlert(firstCritical);
  };

  const handleBannerClickOk = () => {
    navigate("/ops-health?section=clinic");
  };

  if (!selectedCity) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground" data-testid="text-select-city-clinic">Select a city first.</p>
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
          <StatusBanner
            overall={clinicHealthQuery.data.overall}
            onClickCritical={handleBannerClickCritical}
            onClickOk={handleBannerClickOk}
          />

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground" data-testid="text-clinic-date">
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
                <p className="text-muted-foreground" data-testid="text-no-clinic-alerts">No active alerts for this clinic.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3" data-testid="list-clinic-alerts">
              {clinicHealthQuery.data.alerts.map((alert: OpsAlert) => (
                <AlertCard key={alert.code} alert={alert} onClickDrawer={setDrawerAlert} resolvedCodes={resolvedCodes} />
              ))}
            </div>
          )}
        </div>
      )}

      <ErrorDetailsDrawer
        open={!!drawerAlert}
        onClose={() => setDrawerAlert(null)}
        alert={drawerAlert}
        onResolve={onResolve}
        onUnresolve={onUnresolve}
      />
    </div>
  );
}

function SystemStatusTab({ autoAlertCode, resolvedCodes, onResolve, onUnresolve }: { autoAlertCode?: string | null; resolvedCodes: Set<string>; onResolve: (code: string) => void; onUnresolve: (code: string) => void }) {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const [drawerAlert, setDrawerAlert] = useState<OpsAlert | null>(null);

  const statusQuery = useQuery<AlertSystemHealth>({
    queryKey: ["/api/ops/alerts/health"],
    queryFn: () => apiFetch("/api/ops/alerts/health", token),
    enabled: !isDriverHost && !!token,
  });

  const smsHealthQuery = useQuery<any>({
    queryKey: ["/api/admin/sms/health"],
    queryFn: () => apiFetch("/api/admin/sms/health", token),
    enabled: !isDriverHost && !!token && isSuperAdmin,
    refetchInterval: 60000,
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

  useEffect(() => {
    if (autoAlertCode) {
      const syntheticAlert: OpsAlert = { code: autoAlertCode, severity: "info", title: autoAlertCode.replace(/_/g, " "), count: 1 };
      const meta = getAlertMeta(autoAlertCode);
      if (meta !== DEFAULT_META) {
        syntheticAlert.title = meta.description.split(".")[0];
      }
      setDrawerAlert(syntheticAlert);
    }
  }, [autoAlertCode]);

  const status = statusQuery.data;
  const smsHealth = smsHealthQuery.data;

  const smsStateColor = (state: string) => {
    if (state === "HEALTHY") return "text-green-600 dark:text-green-400";
    if (state === "GOOD") return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const smsStateBadgeVariant = (state: string): "outline" | "destructive" | "secondary" => {
    if (state === "HEALTHY") return "outline";
    if (state === "GOOD") return "secondary";
    return "destructive";
  };

  const openDrawer = (title: string, severity: "critical" | "warning" | "info", description: string) => {
    setDrawerAlert({ code: "SYSTEM_STATUS", severity, title, count: 1 });
    ALERT_CODE_META["SYSTEM_STATUS"] = { ...ALERT_CODE_META["SYSTEM_STATUS"], description };
  };

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
                <ClickableSystemRow
                  label="Dispatch Phone"
                  value={status.dispatchPhoneConfigured ? "Configured" : "Not Set"}
                  badgeVariant={status.dispatchPhoneConfigured ? "outline" : "destructive"}
                  onClick={() => openDrawer(
                    "Dispatch Phone",
                    status.dispatchPhoneConfigured ? "info" : "critical",
                    status.dispatchPhoneConfigured
                      ? "Dispatch phone number is configured and ready to receive SMS alerts."
                      : "No dispatch phone number configured. SMS alerts cannot be delivered. Set DISPATCH_PHONE_NUMBER in environment."
                  )}
                  testId="button-system-dispatch-phone"
                />
                <ClickableSystemRow
                  label="Twilio"
                  value={status.twilioConfigured ? "Connected" : "Not Configured"}
                  badgeVariant={status.twilioConfigured ? "outline" : "destructive"}
                  onClick={() => openDrawer(
                    "Twilio SMS Provider",
                    status.twilioConfigured ? "info" : "critical",
                    status.twilioConfigured
                      ? "Twilio is connected and ready to send SMS messages."
                      : "Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER."
                  )}
                  testId="button-system-twilio"
                />
                <ClickableSystemRow
                  label="Scheduler"
                  value={status.schedulerRunning ? "Running" : "Stopped"}
                  badgeVariant={status.schedulerRunning ? "outline" : "destructive"}
                  onClick={() => openDrawer(
                    "Alert Scheduler",
                    status.schedulerRunning ? "info" : "critical",
                    status.schedulerRunning
                      ? `Alert scheduler is running. Checking every ${status.intervalSeconds}s with a ${status.cooldownMinutes}min cooldown.`
                      : "Alert scheduler is stopped. No automatic health checks are running. Restart the server to resume."
                  )}
                  testId="button-system-scheduler"
                />
                <ClickableSystemRow
                  label="Check Interval"
                  value={`${status.intervalSeconds}s`}
                  badgeVariant="outline"
                  onClick={() => openDrawer("Check Interval", "info", `The alert system checks operational health every ${status.intervalSeconds} seconds.`)}
                  testId="button-system-interval"
                />
                <ClickableSystemRow
                  label="Cooldown"
                  value={`${status.cooldownMinutes} min`}
                  badgeVariant="outline"
                  onClick={() => openDrawer("Cooldown Period", "info", `After sending an alert SMS, the system waits ${status.cooldownMinutes} minutes before sending another to prevent spam.`)}
                  testId="button-system-cooldown"
                />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="w-5 h-5" />
              SMS Platform Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            {smsHealthQuery.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : smsHealth ? (
              <div className="space-y-4">
                <button
                  type="button"
                  className="w-full flex items-center justify-between cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => openDrawer(
                    `SMS Health: ${smsHealth.healthState}`,
                    smsHealth.healthState === "HEALTHY" ? "info" : smsHealth.healthState === "GOOD" ? "warning" : "critical",
                    smsHealth.healthReason || "SMS platform health status."
                  )}
                  data-testid="button-sms-health-banner"
                >
                  <div className="flex items-center gap-2">
                    {smsHealth.healthState === "HEALTHY" ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : smsHealth.healthState === "GOOD" ? (
                      <AlertTriangle className="w-5 h-5 text-yellow-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500" />
                    )}
                    <span className={`font-medium ${smsStateColor(smsHealth.healthState)}`} data-testid="text-sms-health-state">
                      {smsHealth.healthState}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={smsStateBadgeVariant(smsHealth.healthState)} data-testid="badge-sms-health">
                      {smsHealth.configured ? `FROM: ${smsHealth.fromNumberMasked}` : "Not Configured"}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-muted-foreground opacity-50" />
                  </div>
                </button>

                <p className="text-sm text-muted-foreground" data-testid="text-sms-health-reason">
                  {smsHealth.healthReason}
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <button
                    type="button"
                    className="text-center p-2 rounded-md bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => openDrawer("SMS Sent (24h)", "info", `${smsHealth.metrics?.sent24h || 0} SMS messages sent in the last 24 hours.`)}
                    data-testid="button-sms-sent-24h"
                  >
                    <p className="text-xl font-bold" data-testid="text-sms-sent-24h">{smsHealth.metrics?.sent24h || 0}</p>
                    <p className="text-xs text-muted-foreground">Sent (24h)</p>
                  </button>
                  <button
                    type="button"
                    className="text-center p-2 rounded-md bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => openDrawer(
                      "SMS Failed (24h)",
                      (smsHealth.metrics?.failed24h || 0) > 0 ? "critical" : "info",
                      `${smsHealth.metrics?.failed24h || 0} SMS messages failed in the last 24 hours.${smsHealth.lastError ? ` Last error: ${smsHealth.lastError.code} - ${smsHealth.lastError.message}` : ""}`
                    )}
                    data-testid="button-sms-failed-24h"
                  >
                    <p className="text-xl font-bold text-red-500" data-testid="text-sms-failed-24h">{smsHealth.metrics?.failed24h || 0}</p>
                    <p className="text-xs text-muted-foreground">Failed (24h)</p>
                  </button>
                  <button
                    type="button"
                    className="text-center p-2 rounded-md bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => openDrawer("Rate Limited (24h)", (smsHealth.metrics?.rateLimited24h || 0) > 0 ? "warning" : "info", `${smsHealth.metrics?.rateLimited24h || 0} messages were rate limited in the last 24 hours.`)}
                    data-testid="button-sms-rate-limited"
                  >
                    <p className="text-xl font-bold" data-testid="text-sms-rate-limited">{smsHealth.metrics?.rateLimited24h || 0}</p>
                    <p className="text-xs text-muted-foreground">Rate Limited</p>
                  </button>
                  <button
                    type="button"
                    className="text-center p-2 rounded-md bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => openDrawer("SMS Fail Rate", parseFloat(smsHealth.metrics?.failRatePct || "0") > 5 ? "critical" : "info", `Current failure rate: ${smsHealth.metrics?.failRatePct || "0.0"}%. Rates above 5% indicate delivery issues.`)}
                    data-testid="button-sms-fail-rate"
                  >
                    <p className="text-xl font-bold" data-testid="text-sms-fail-rate">{smsHealth.metrics?.failRatePct || "0.0"}%</p>
                    <p className="text-xs text-muted-foreground">Fail Rate</p>
                  </button>
                </div>

                {smsHealth.lastError && (
                  <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
                    <p className="text-xs font-medium text-red-600 dark:text-red-400">Last Error</p>
                    <p className="text-xs text-red-700 dark:text-red-300" data-testid="text-sms-last-error">
                      Code: {smsHealth.lastError.code} &mdash; {smsHealth.lastError.message}
                    </p>
                    <p className="text-xs text-red-500">
                      {new Date(smsHealth.lastError.at).toLocaleString()}
                    </p>
                  </div>
                )}

                {smsHealth.credentialErrors?.length > 0 && (
                  <div className="p-3 rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900">
                    <p className="text-xs font-medium text-yellow-600 dark:text-yellow-400">Configuration Warnings</p>
                    {smsHealth.credentialErrors.map((e: string, i: number) => (
                      <p key={i} className="text-xs text-yellow-700 dark:text-yellow-300" data-testid={`text-sms-cred-warn-${i}`}>{e}</p>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => smsHealthQuery.refetch()}
                    data-testid="button-refresh-sms-health"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Refresh
                  </Button>
                  {smsHealth.lastTwilioSid && (
                    <span className="text-xs text-muted-foreground" data-testid="text-last-twilio-sid">
                      Last SID: {smsHealth.lastTwilioSid}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-sms-no-data">Unable to load SMS health data.</p>
            )}
          </CardContent>
        </Card>
      )}

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

      <ErrorDetailsDrawer
        open={!!drawerAlert}
        onClose={() => setDrawerAlert(null)}
        alert={drawerAlert}
        onResolve={onResolve}
        onUnresolve={onUnresolve}
      />
    </div>
  );
}

function AutomationTab({ resolvedCodes, onResolve, onUnresolve }: { resolvedCodes: Set<string>; onResolve: (code: string) => void; onUnresolve: (code: string) => void }) {
  const { token, selectedCity } = useAuth();
  const [, navigate] = useLocation();
  const [drawerAlert, setDrawerAlert] = useState<OpsAlert | null>(null);
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

  const schedulers = [
    { name: "Route Engine", schedule: "5:30 AM (Mon-Sat)", desc: "Groups trips into route batches by city, time window, and ZIP cluster", route: "/fleet", code: "SCHEDULER_ROUTE_ENGINE" },
    { name: "Vehicle Auto-Assign", schedule: "6:00 AM (Mon-Sat)", desc: "Assigns vehicles and drivers to scheduled trips", route: "/assignments", code: "SCHEDULER_VEHICLE_AUTO_ASSIGN" },
    { name: "No-Show Monitor", schedule: "Every 5 min", desc: "Sends T-24h/T-2h confirmations, flags at-risk unconfirmed trips", route: "/trips", code: "SCHEDULER_NO_SHOW_MONITOR" },
    { name: "ETA Engine", schedule: "Every 2 min", desc: "Calculates live ETAs for en-route trips", route: "/dispatch", code: "SCHEDULER_ETA_ENGINE" },
    { name: "Ops Alert", schedule: "Every 5 min", desc: "Monitors operational health and sends SMS alerts for critical issues", route: "/ops-health?section=system", code: "SCHEDULER_OPS_ALERT" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ClickableMetricCard
          icon={Route}
          iconColor="text-blue-500"
          label="Route Batches Today"
          value={batches?.length || 0}
          isLoading={batchesLoading}
          onClick={() => navigate("/fleet")}
          testId="button-metric-batches"
        />
        <ClickableMetricCard
          icon={Zap}
          iconColor="text-green-500"
          label="Trips Assigned"
          value={`${financialToday?.completed || 0}/${financialToday?.totalTrips || 0}`}
          isLoading={financialLoading}
          onClick={() => navigate("/trips")}
          testId="button-metric-assigned"
        />
        <ClickableMetricCard
          icon={Users}
          iconColor="text-purple-500"
          label="Active Drivers"
          value={financialToday?.activeDrivers || 0}
          isLoading={financialLoading}
          onClick={() => navigate("/drivers")}
          testId="button-metric-drivers"
        />
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
            {schedulers.map((sched) => (
              <button
                type="button"
                key={sched.name}
                onClick={() => {
                  setDrawerAlert({
                    code: sched.code,
                    severity: "info",
                    title: sched.name,
                    count: 1,
                  });
                  ALERT_CODE_META[sched.code] = {
                    icon: Zap,
                    module: sched.name,
                    route: sched.route,
                    description: `${sched.desc}. Schedule: ${sched.schedule}.`,
                  };
                }}
                className="w-full flex items-center justify-between gap-3 flex-wrap py-2 px-1 rounded transition-colors hover:bg-muted/50 cursor-pointer"
                data-testid={`button-scheduler-${sched.name.toLowerCase().replace(/\s/g, "-")}`}
              >
                <div className="min-w-0 text-left">
                  <p className="font-medium text-sm">{sched.name}</p>
                  <p className="text-xs text-muted-foreground">{sched.desc}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" data-testid={`badge-scheduler-${sched.name.toLowerCase().replace(/\s/g, "-")}`}>
                    <Clock className="w-3 h-3 mr-1" />
                    {sched.schedule}
                  </Badge>
                  <ChevronRight className="w-4 h-4 text-muted-foreground opacity-50" />
                </div>
              </button>
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
                        <Badge variant={batch.status === "completed" ? "default" : "secondary"} data-testid={`badge-batch-status-${batch.id}`}>
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
            <p className="text-muted-foreground text-sm" data-testid="text-no-batches">No route batches for today yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Route Engine runs at 5:30 AM (Mon-Sat)</p>
          </CardContent>
        </Card>
      )}

      <ErrorDetailsDrawer
        open={!!drawerAlert}
        onClose={() => setDrawerAlert(null)}
        alert={drawerAlert}
        onResolve={onResolve}
        onUnresolve={onUnresolve}
      />
    </div>
  );
}

export default function OpsHealthPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const qp = readQueryParams();
  const initialTab = (qp.section && ["city", "clinic", "automation", "system"].includes(qp.section)) ? qp.section : "city";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [resolvedCodes, setResolvedCodes] = useState<Set<string>>(() => {
    const all = getResolvedAlerts();
    return new Set(Object.keys(all).filter(k => isAlertResolved(k)));
  });

  const handleResolve = (code: string) => {
    markAlertResolved(code);
    setResolvedCodes(prev => new Set([...prev, code]));
  };

  const handleUnresolve = (code: string) => {
    unmarkAlertResolved(code);
    setResolvedCodes(prev => { const next = new Set(prev); next.delete(code); return next; });
  };

  useEffect(() => {
    const handlePopState = () => {
      const newQp = readQueryParams();
      if (newQp.section && ["city", "clinic", "automation", "system"].includes(newQp.section)) {
        setActiveTab(newQp.section);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const alertCodeForTab = activeTab === qp.section ? qp.alertCode : null;

  return (
    <div className="p-4 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Activity className="w-6 h-6" />
        <h1 className="text-xl font-semibold" data-testid="text-ops-health-title">Ops Health</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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
          <CityHealthTab autoAlertCode={activeTab === "city" ? alertCodeForTab : null} resolvedCodes={resolvedCodes} onResolve={handleResolve} onUnresolve={handleUnresolve} />
        </TabsContent>

        <TabsContent value="clinic">
          <ClinicHealthTab autoAlertCode={activeTab === "clinic" ? alertCodeForTab : null} resolvedCodes={resolvedCodes} onResolve={handleResolve} onUnresolve={handleUnresolve} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="automation">
            <AutomationTab resolvedCodes={resolvedCodes} onResolve={handleResolve} onUnresolve={handleUnresolve} />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="system">
            <SystemStatusTab autoAlertCode={activeTab === "system" ? alertCodeForTab : null} resolvedCodes={resolvedCodes} onResolve={handleResolve} onUnresolve={handleUnresolve} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
