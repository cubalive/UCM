import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Undo2,
} from "lucide-react";

interface OpsCheck {
  id: string;
  name: string;
  pass: boolean;
  count: number;
  details: string[];
}

interface OpsChecksResponse {
  ok: boolean;
  checks: OpsCheck[];
}

interface AlertAck {
  id: number;
  alertCode: string;
  note: string | null;
  acknowledgedByName: string;
  expiresAt: string;
  dismissed: boolean;
  createdAt: string;
}

export default function OpsChecksPage() {
  const { token, cities, selectedCity, user } = useAuth();
  const { toast } = useToast();
  const [cityId, setCityId] = useState<string>(selectedCity?.id?.toString() || "");
  const effectiveCityId = cityId === "all" ? "" : cityId;
  const [expandedChecks, setExpandedChecks] = useState<Set<string>>(new Set());

  const canAcknowledge = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "DISPATCH";

  const checksQuery = useQuery<OpsChecksResponse>({
    queryKey: ["/api/ops/checks", effectiveCityId],
    queryFn: () => {
      const params = effectiveCityId ? `?city_id=${effectiveCityId}` : "";
      return apiFetch(`/api/ops/checks${params}`, token);
    },
    enabled: !!token,
    refetchInterval: 30000,
  });

  const acksQuery = useQuery<AlertAck[]>({
    queryKey: ["/api/ops/alert-acks"],
    queryFn: () => apiFetch("/api/ops/alert-acks", token),
    enabled: !!token && canAcknowledge,
  });

  const ackMutation = useMutation({
    mutationFn: async (alertCode: string) => {
      return apiFetch("/api/ops/alert-acks", token, {
        method: "POST",
        body: JSON.stringify({ alertCode, expiryHours: 12, note: "Marked as seen from Ops Checks" }),
      });
    },
    onSuccess: (_data, alertCode) => {
      toast({ title: "Alert marked as seen", description: `"${alertCode}" will be hidden until it reoccurs or the acknowledgment expires.` });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/alert-acks"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to acknowledge", description: err.message, variant: "destructive" });
    },
  });

  const undoAckMutation = useMutation({
    mutationFn: async (ackId: number) => {
      return apiFetch(`/api/ops/alert-acks/${ackId}`, token, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Acknowledgment removed", description: "The alert is visible again." });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/alert-acks"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const data = checksQuery.data;
  const activeAcks = acksQuery.data || [];
  const ackedCodes = new Set(activeAcks.map(a => a.alertCode));

  const visibleChecks = data?.checks?.filter(c => !ackedCodes.has(c.id)) || [];
  const hiddenChecks = data?.checks?.filter(c => ackedCodes.has(c.id)) || [];
  const [showHidden, setShowHidden] = useState(false);

  const visibleFailCount = visibleChecks.filter(c => !c.pass).length;
  const passCount = visibleChecks.filter(c => c.pass).length;
  const totalVisible = visibleChecks.length;

  const toggleExpand = (id: string) => {
    setExpandedChecks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderCheck = (check: OpsCheck, isHidden: boolean) => {
    const expanded = expandedChecks.has(check.id);
    const ack = activeAcks.find(a => a.alertCode === check.id);

    return (
      <Card key={check.id} className={isHidden ? "opacity-60" : ""} data-testid={`check-${check.id}`}>
        <CardContent className="p-0">
          <button
            className="w-full flex items-center justify-between gap-3 p-4 text-left"
            onClick={() => check.count > 0 && toggleExpand(check.id)}
            data-testid={`button-expand-${check.id}`}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {isHidden ? (
                <EyeOff className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              ) : check.pass ? (
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium" data-testid={`text-check-name-${check.id}`}>
                  {check.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {check.id}
                  {isHidden && ack && (
                    <span className="ml-2">
                      — seen by {ack.acknowledgedByName}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {canAcknowledge && !check.pass && !isHidden && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    ackMutation.mutate(check.id);
                  }}
                  disabled={ackMutation.isPending}
                  data-testid={`button-ack-${check.id}`}
                  title="Mark as seen — hides this alert until it reoccurs"
                >
                  <Eye className="w-3.5 h-3.5 mr-1" />
                  Mark Seen
                </Button>
              )}
              {isHidden && ack && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    undoAckMutation.mutate(ack.id);
                  }}
                  disabled={undoAckMutation.isPending}
                  data-testid={`button-undo-ack-${check.id}`}
                  title="Show this alert again"
                >
                  <Undo2 className="w-3.5 h-3.5 mr-1" />
                  Restore
                </Button>
              )}
              <Badge variant={isHidden ? "outline" : check.pass ? "secondary" : "destructive"} data-testid={`badge-count-${check.id}`}>
                {check.count}
              </Badge>
              {check.count > 0 && (
                expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
              )}
            </div>
          </button>
          {expanded && check.details.length > 0 && (
            <div className="px-4 pb-3 pt-0 border-t">
              <div className="mt-2 space-y-1 max-h-[200px] overflow-y-auto">
                {check.details.map((detail, i) => (
                  <div key={i} className="text-xs text-muted-foreground font-mono py-0.5" data-testid={`detail-${check.id}-${i}`}>
                    {detail}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto" data-testid="page-ops-checks">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-ops-checks-title">
            <ShieldCheck className="w-5 h-5" />
            Ops Checks
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            System invariant checks for driver state and trip consistency
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground sr-only">City</Label>
            <Select value={cityId} onValueChange={setCityId}>
              <SelectTrigger className="w-[180px]" data-testid="select-ops-city">
                <SelectValue placeholder="All cities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Cities</SelectItem>
                {cities.map(c => (
                  <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => checksQuery.refetch()}
            disabled={checksQuery.isFetching}
            data-testid="button-refresh-checks"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${checksQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {data && (
        <Card data-testid="card-summary">
          <CardContent className="p-4 flex items-center gap-3">
            {visibleFailCount === 0 ? (
              <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            )}
            <div className="flex-1">
              <div className="text-lg font-semibold" data-testid="text-summary">
                {visibleFailCount === 0 ? "All checks passed" : `${visibleFailCount} issue(s) detected`}
              </div>
              <div className="text-sm text-muted-foreground">
                {passCount}/{totalVisible} checks passing
                {hiddenChecks.length > 0 && (
                  <span className="ml-1">· {hiddenChecks.length} marked as seen</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {checksQuery.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : (
        <div className="space-y-2" data-testid="list-checks">
          {visibleChecks.map(check => renderCheck(check, false))}

          {hiddenChecks.length > 0 && (
            <div className="pt-2">
              <button
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowHidden(!showHidden)}
                data-testid="button-toggle-hidden"
              >
                <EyeOff className="w-4 h-4" />
                {showHidden ? "Hide" : "Show"} {hiddenChecks.length} acknowledged alert{hiddenChecks.length !== 1 ? "s" : ""}
                {showHidden ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              {showHidden && (
                <div className="space-y-2 mt-2">
                  {hiddenChecks.map(check => renderCheck(check, true))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
