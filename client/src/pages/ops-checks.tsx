import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
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

export default function OpsChecksPage() {
  const { token, cities, selectedCity } = useAuth();
  const [cityId, setCityId] = useState<string>(selectedCity?.id?.toString() || "");
  const effectiveCityId = cityId === "all" ? "" : cityId;
  const [expandedChecks, setExpandedChecks] = useState<Set<string>>(new Set());

  const checksQuery = useQuery<OpsChecksResponse>({
    queryKey: ["/api/ops/checks", effectiveCityId],
    queryFn: () => {
      const params = effectiveCityId ? `?city_id=${effectiveCityId}` : "";
      return apiFetch(`/api/ops/checks${params}`, token);
    },
    enabled: !!token,
    refetchInterval: 30000,
  });

  const data = checksQuery.data;
  const passCount = data?.checks?.filter(c => c.pass).length || 0;
  const totalCount = data?.checks?.length || 0;

  const toggleExpand = (id: string) => {
    setExpandedChecks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
            {data.ok ? (
              <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            )}
            <div>
              <div className="text-lg font-semibold" data-testid="text-summary">
                {data.ok ? "All checks passed" : `${totalCount - passCount} issue(s) detected`}
              </div>
              <div className="text-sm text-muted-foreground">
                {passCount}/{totalCount} checks passing
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
          {data?.checks?.map(check => {
            const expanded = expandedChecks.has(check.id);
            return (
              <Card key={check.id} data-testid={`check-${check.id}`}>
                <CardContent className="p-0">
                  <button
                    className="w-full flex items-center justify-between gap-3 p-4 text-left"
                    onClick={() => check.count > 0 && toggleExpand(check.id)}
                    data-testid={`button-expand-${check.id}`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {check.pass ? (
                        <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium" data-testid={`text-check-name-${check.id}`}>
                          {check.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{check.id}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant={check.pass ? "secondary" : "destructive"} data-testid={`badge-count-${check.id}`}>
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
          })}
        </div>
      )}
    </div>
  );
}
