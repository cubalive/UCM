import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Heart,
  Play,
  Pause,
  RefreshCw,
  Clock,
  MapPin,
  AlertTriangle,
  CheckCircle,
  Info,
  User,
} from "lucide-react";

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

interface DialysisTrip {
  id: number;
  public_id: string;
  company_id: number;
  city_id: number;
  driver_id: number | null;
  status: string;
  pickup_time: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  auto_assign_status: string | null;
  auto_assign_failure_reason: string | null;
  scheduled_date: string;
  patient_name: string | null;
  driver_name: string | null;
  company_name: string | null;
}

interface DialysisCompany {
  id: number;
  name: string;
  zeroTouchDialysisEnabled: boolean;
}

interface DialysisEvent {
  id?: number;
  type?: string;
  message?: string;
  companyId?: number;
  companyName?: string;
  createdAt?: string;
  timestamp?: string;
  [key: string]: unknown;
}

function AutoStatusChip({ status }: { status: string | null }) {
  if (!status) {
    return (
      <Badge variant="secondary" className="text-xs" data-testid="chip-auto-status-idle">
        IDLE
      </Badge>
    );
  }
  const normalized = status.toLowerCase();
  if (normalized === "assigned" || normalized === "auto" || normalized === "success") {
    return (
      <Badge variant="default" className="text-xs bg-green-600" data-testid="chip-auto-status-auto">
        <CheckCircle className="w-3 h-3 mr-1" />
        AUTO
      </Badge>
    );
  }
  if (normalized === "failed" || normalized === "error" || normalized === "needs_help") {
    return (
      <Badge variant="destructive" className="text-xs" data-testid="chip-auto-status-needs-help">
        <AlertTriangle className="w-3 h-3 mr-1" />
        NEEDS HELP
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs" data-testid="chip-auto-status-idle">
      {status}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  if (["completed", "done"].includes(normalized)) {
    return <Badge variant="default" data-testid={`badge-status-${normalized}`}>{status}</Badge>;
  }
  if (["cancelled", "no_show"].includes(normalized)) {
    return <Badge variant="destructive" data-testid={`badge-status-${normalized}`}>{status}</Badge>;
  }
  if (["in_progress", "en_route", "on_trip"].includes(normalized)) {
    return <Badge variant="default" className="bg-emerald-600" data-testid={`badge-status-${normalized}`}>{status}</Badge>;
  }
  return <Badge variant="secondary" data-testid={`badge-status-${normalized}`}>{status}</Badge>;
}

export default function ZeroTouchDialysisPage() {
  const { token, user, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const [date, setDate] = useState(getToday());
  const [companyFilter, setCompanyFilter] = useState<string>("all");

  const companiesQuery = useQuery<DialysisCompany[]>({
    queryKey: ["/api/dialysis/companies"],
    queryFn: () => apiFetch("/api/dialysis/companies", token),
    enabled: !!token,
  });

  const companyIdParam = companyFilter !== "all" ? companyFilter : "";
  const tripsUrl = `/api/dialysis/today?date=${date}${companyIdParam ? `&companyId=${companyIdParam}` : ""}`;

  const tripsQuery = useQuery<DialysisTrip[]>({
    queryKey: ["/api/dialysis/today", date, companyIdParam],
    queryFn: () => apiFetch(tripsUrl, token),
    enabled: !!token,
  });

  const eventsUrl = `/api/dialysis/events?limit=50${companyIdParam ? `&companyId=${companyIdParam}` : ""}`;

  const eventsQuery = useQuery<DialysisEvent[]>({
    queryKey: ["/api/dialysis/events", companyIdParam],
    queryFn: () => apiFetch(eventsUrl, token),
    enabled: !!token,
  });

  const pauseMutation = useMutation({
    mutationFn: (companyId: number) =>
      apiFetch(`/api/dialysis/company/${companyId}/pause`, token, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Automation paused" });
      queryClient.invalidateQueries({ queryKey: ["/api/dialysis/companies"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (companyId: number) =>
      apiFetch(`/api/dialysis/company/${companyId}/resume`, token, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Automation resumed" });
      queryClient.invalidateQueries({ queryKey: ["/api/dialysis/companies"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const runNowMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/dialysis/run-now", token, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Run triggered", description: "Pre-assign and recheck started" });
      queryClient.invalidateQueries({ queryKey: ["/api/dialysis/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dialysis/events"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const trips = tripsQuery.data || [];
  const companies = companiesQuery.data || [];
  const events = eventsQuery.data || [];

  return (
    <div className="p-4 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Heart className="w-6 h-6 text-red-500" />
        <h1 className="text-xl font-semibold" data-testid="text-dialysis-title">
          Today's Dialysis Runs
        </h1>
        {isSuperAdmin && (
          <Button
            variant="outline"
            onClick={() => runNowMutation.mutate()}
            disabled={runNowMutation.isPending}
            data-testid="button-run-now"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${runNowMutation.isPending ? "animate-spin" : ""}`} />
            {runNowMutation.isPending ? "Running..." : "Run Now"}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-auto"
            data-testid="input-dialysis-date"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-52" data-testid="select-dialysis-company">
              <SelectValue placeholder="All Companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id.toString()}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {companiesQuery.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {companies.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map((company) => (
            <Card key={company.id} data-testid={`card-company-${company.id}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{company.name}</CardTitle>
                <Badge
                  variant={company.zeroTouchDialysisEnabled ? "default" : "secondary"}
                  data-testid={`badge-company-status-${company.id}`}
                >
                  {company.zeroTouchDialysisEnabled ? "Enabled" : "Disabled"}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                  {company.zeroTouchDialysisEnabled ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => pauseMutation.mutate(company.id)}
                      disabled={pauseMutation.isPending}
                      data-testid={`button-pause-${company.id}`}
                    >
                      <Pause className="w-4 h-4 mr-1" />
                      Pause
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resumeMutation.mutate(company.id)}
                      disabled={resumeMutation.isPending}
                      data-testid={`button-resume-${company.id}`}
                    >
                      <Play className="w-4 h-4 mr-1" />
                      Resume
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tripsQuery.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {!tripsQuery.isLoading && trips.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <Info className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground" data-testid="text-dialysis-empty">
              No dialysis trips found for {date}. Trips will appear here once scheduled.
            </p>
          </CardContent>
        </Card>
      )}

      {trips.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Dialysis Trips
              <Badge variant="secondary">{trips.length} trips</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-dialysis-trips">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-2">Trip ID</th>
                    <th className="text-left py-2 px-2">Patient</th>
                    <th className="text-left py-2 px-2">Pickup Time</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-left py-2 px-2">Driver</th>
                    <th className="text-left py-2 px-2">Auto Status</th>
                    <th className="text-left py-2 px-2">Failure Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((trip) => (
                    <tr
                      key={trip.id}
                      className="border-b last:border-0"
                      data-testid={`row-trip-${trip.id}`}
                    >
                      <td className="py-2 pr-2 font-mono text-xs">{trip.public_id}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3 text-muted-foreground" />
                          {trip.patient_name || "—"}
                        </div>
                      </td>
                      <td className="py-2 px-2">{trip.pickup_time || "—"}</td>
                      <td className="py-2 px-2">
                        <StatusBadge status={trip.status} />
                      </td>
                      <td className="py-2 px-2">{trip.driver_name || "—"}</td>
                      <td className="py-2 px-2">
                        <AutoStatusChip status={trip.auto_assign_status} />
                      </td>
                      <td className="py-2 px-2 text-xs text-muted-foreground max-w-[250px] truncate" title={trip.auto_assign_failure_reason || ""}>
                        {trip.auto_assign_failure_reason || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {eventsQuery.isLoading && (
        <Skeleton className="h-48 w-full" />
      )}

      {events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Recent Automation Events
              <Badge variant="secondary">{events.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {events.map((event, idx) => (
                <div
                  key={event.id || idx}
                  className="flex items-start gap-2 text-sm border-b last:border-0 pb-2"
                  data-testid={`row-event-${event.id || idx}`}
                >
                  <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{event.message || event.type || "Event"}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.companyName && <span className="mr-2">{event.companyName}</span>}
                      {(event.createdAt || event.timestamp) && (
                        <span>{new Date(event.createdAt || event.timestamp || "").toLocaleString()}</span>
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
