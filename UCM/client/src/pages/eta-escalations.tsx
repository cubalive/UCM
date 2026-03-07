import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Clock, MapPin, BellOff, CheckCircle, Info } from "lucide-react";
import { formatPickupTimeDisplay } from "@/lib/timezone";

type EscalationLevel = "WARN" | "CLINIC" | "DISPATCH";

interface EtaEscalation {
  id: number;
  publicId: string;
  companyId: number | null;
  cityId: number | null;
  driverId: number | null;
  status: string;
  pickupTime: string | null;
  scheduledDate: string | null;
  estimatedArrivalTime: string | null;
  etaEscalationLevel: EscalationLevel;
  etaVarianceSeconds: number | null;
  originalEtaSeconds: number | null;
  etaLastCheckedAt: string | null;
  etaEscalationLastAt: string | null;
  pickupAddress: string | null;
  dropoffAddress: string | null;
}

const LEVEL_CONFIG: Record<EscalationLevel, { label: string; className: string }> = {
  WARN: { label: "WARN", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  CLINIC: { label: "CLINIC", className: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" },
  DISPATCH: { label: "DISPATCH", className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
};

function formatVariance(seconds: number | null): string {
  if (seconds == null) return "—";
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const sign = seconds < 0 ? "-" : "";
  return `${sign}${m}m ${s}s`;
}

export default function EtaEscalationsPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [activeLevels, setActiveLevels] = useState<Set<EscalationLevel>>(
    new Set(["WARN", "CLINIC", "DISPATCH"])
  );

  const toggleLevel = (level: EscalationLevel) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const levelParam = Array.from(activeLevels).join(",");

  const escalationsQuery = useQuery<EtaEscalation[]>({
    queryKey: ["/api/eta-escalations", levelParam],
    queryFn: () =>
      apiFetch(
        `/api/eta-escalations?level=${encodeURIComponent(levelParam)}&limit=50`,
        token
      ),
    enabled: !!token && activeLevels.size > 0,
    refetchInterval: 30000,
  });

  const muteMutation = useMutation({
    mutationFn: (tripId: number) =>
      apiFetch(`/api/eta-escalations/${tripId}/mute`, token, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Alert muted", description: "Muted for 30 minutes" });
      queryClient.invalidateQueries({ queryKey: ["/api/eta-escalations"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (tripId: number) =>
      apiFetch(`/api/eta-escalations/${tripId}/resolve`, token, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Alert resolved" });
      queryClient.invalidateQueries({ queryKey: ["/api/eta-escalations"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const escalations = escalationsQuery.data || [];

  return (
    <div className="p-4 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <AlertTriangle className="w-6 h-6" />
        <h1 className="text-xl font-semibold" data-testid="text-eta-escalations-title">
          ETA Variance Escalations
        </h1>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(["WARN", "CLINIC", "DISPATCH"] as EscalationLevel[]).map((level) => {
          const active = activeLevels.has(level);
          const config = LEVEL_CONFIG[level];
          return (
            <Button
              key={level}
              variant={active ? "default" : "outline"}
              size="sm"
              onClick={() => toggleLevel(level)}
              className={active ? config.className : ""}
              data-testid={`button-filter-${level.toLowerCase()}`}
            >
              {config.label}
            </Button>
          );
        })}
      </div>

      {escalationsQuery.isLoading && (
        <div className="space-y-3" data-testid="loading-skeleton">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {!escalationsQuery.isLoading && activeLevels.size === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <Info className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground" data-testid="text-no-filters">
              Select at least one escalation level to view alerts.
            </p>
          </CardContent>
        </Card>
      )}

      {!escalationsQuery.isLoading && activeLevels.size > 0 && escalations.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <CheckCircle className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground" data-testid="text-empty-state">
              No escalated trips at the moment. All ETAs are within acceptable thresholds.
            </p>
          </CardContent>
        </Card>
      )}

      {!escalationsQuery.isLoading && escalations.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Escalated Trips
              <Badge variant="secondary">{escalations.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-escalations">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-2">Trip ID</th>
                    <th className="text-left py-2 px-2">Pickup Time</th>
                    <th className="text-left py-2 px-2">Scheduled Date</th>
                    <th className="text-left py-2 px-2">Level</th>
                    <th className="text-left py-2 px-2">Variance</th>
                    <th className="text-left py-2 px-2">Pickup</th>
                    <th className="text-left py-2 px-2">Dropoff</th>
                    <th className="text-right py-2 pl-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {escalations.map((trip) => {
                    const levelConfig = LEVEL_CONFIG[trip.etaEscalationLevel] || LEVEL_CONFIG.WARN;
                    return (
                      <tr
                        key={trip.id}
                        className="border-b last:border-0 hover-elevate cursor-pointer"
                        onClick={() => setLocation(`/trips/${trip.id}`)}
                        data-testid={`row-escalation-${trip.id}`}
                      >
                        <td className="py-2 pr-2 font-mono text-xs" data-testid={`text-trip-id-${trip.id}`}>
                          {trip.publicId}
                        </td>
                        <td className="py-2 px-2">{formatPickupTimeDisplay(trip.pickupTime)}</td>
                        <td className="py-2 px-2">{trip.scheduledDate || "—"}</td>
                        <td className="py-2 px-2">
                          <Badge
                            variant="secondary"
                            className={levelConfig.className}
                            data-testid={`badge-level-${trip.id}`}
                          >
                            {trip.etaEscalationLevel}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 font-mono text-xs" data-testid={`text-variance-${trip.id}`}>
                          {formatVariance(trip.etaVarianceSeconds)}
                        </td>
                        <td className="py-2 px-2 max-w-[200px] truncate" title={trip.pickupAddress || ""}>
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {trip.pickupAddress || "—"}
                          </span>
                        </td>
                        <td className="py-2 px-2 max-w-[200px] truncate" title={trip.dropoffAddress || ""}>
                          {trip.dropoffAddress || "—"}
                        </td>
                        <td className="py-2 pl-2 text-right">
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                muteMutation.mutate(trip.id);
                              }}
                              disabled={muteMutation.isPending}
                              data-testid={`button-mute-${trip.id}`}
                            >
                              <BellOff className="w-3 h-3" />
                              Mute 30min
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                resolveMutation.mutate(trip.id);
                              }}
                              disabled={resolveMutation.isPending}
                              data-testid={`button-resolve-${trip.id}`}
                            >
                              <CheckCircle className="w-3 h-3" />
                              Mark Resolved
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
