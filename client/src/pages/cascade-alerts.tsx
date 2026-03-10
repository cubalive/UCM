import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Bell, CheckCircle2, Clock, Loader2 } from "lucide-react";

function severityBadge(severity: string) {
  const map: Record<string, string> = {
    LOW: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    MEDIUM: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    HIGH: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    CRITICAL: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return <Badge className={map[severity] || ""}>{severity}</Badge>;
}

export default function CascadeAlertsPage() {
  const { token } = useAuth();
  const { toast } = useToast();

  const dashQuery = useQuery<any>({
    queryKey: ["/api/cascade-alerts/dashboard"],
    queryFn: () => apiFetch("/api/cascade-alerts/dashboard", token),
  });

  const activeQuery = useQuery<any>({
    queryKey: ["/api/cascade-alerts/active"],
    queryFn: () => apiFetch("/api/cascade-alerts/active", token),
  });

  const ackMutation = useMutation({
    mutationFn: async (alertId: number) => {
      const res = await apiRequest("POST", `/api/cascade-alerts/${alertId}/acknowledge`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cascade-alerts"] });
      toast({ title: "Alert acknowledged" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const dash = dashQuery.data;
  const alerts = activeQuery.data?.alerts || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-6 w-6 text-orange-400" />
        <h1 className="text-2xl font-bold">Cascade Delay Alerts</h1>
        {alerts.length > 0 && <Badge variant="destructive">{alerts.length} Active</Badge>}
      </div>

      {dashQuery.isLoading ? <Skeleton className="h-20 w-full" /> : dash && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Active Alerts</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-red-400">{dash.activeCount || 0}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Acknowledged Today</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-emerald-400">{dash.acknowledgedToday || 0}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Avg Delay (min)</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{(dash.avgDelayMinutes || 0).toFixed(0)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Affected Trips Today</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{dash.affectedTripsToday || 0}</p></CardContent>
          </Card>
        </div>
      )}

      <h2 className="text-lg font-semibold flex items-center gap-2"><Bell className="w-5 h-5" />Active Alerts</h2>

      {activeQuery.isLoading ? <Skeleton className="h-64 w-full" /> : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Trigger Trip</TableHead>
                <TableHead>Affected Trip</TableHead>
                <TableHead>Delay</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8"><CheckCircle2 className="w-5 h-5 inline mr-2 text-emerald-400" />No active cascade alerts</TableCell></TableRow>
              ) : (
                alerts.map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell>{severityBadge(a.severity || "MEDIUM")}</TableCell>
                    <TableCell className="font-medium">{a.driver ? `${a.driver.firstName} ${a.driver.lastName}` : `Driver #${a.driverId}`}</TableCell>
                    <TableCell className="text-xs">
                      {a.triggerTrip?.publicId || `Trip #${a.triggerTripId}`}
                      <span className="text-muted-foreground ml-1">@ {a.triggerTrip?.pickupTime || "—"}</span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {a.affectedTrip?.publicId || `Trip #${a.affectedTripId}`}
                      <span className="text-muted-foreground ml-1">@ {a.affectedTrip?.pickupTime || "—"}</span>
                    </TableCell>
                    <TableCell><Badge variant="destructive">{a.estimatedDelayMinutes || 0} min</Badge></TableCell>
                    <TableCell><Badge variant={a.acknowledged ? "default" : "secondary"}>{a.acknowledged ? "Acked" : "New"}</Badge></TableCell>
                    <TableCell>
                      {!a.acknowledged && (
                        <Button size="sm" variant="outline" onClick={() => ackMutation.mutate(a.id)} disabled={ackMutation.isPending}>
                          {ackMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}Ack
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
