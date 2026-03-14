import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Route, TrendingDown, BarChart3, Zap, Loader2 } from "lucide-react";

function FleetEfficiencyTab() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const efficiencyQuery = useQuery<any>({
    queryKey: ["/api/dead-mile/fleet-efficiency", date],
    queryFn: () => apiFetch(`/api/dead-mile/fleet-efficiency?date=${date}`, token),
  });

  const data = efficiencyQuery.data;
  if (efficiencyQuery.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />

      {data?.summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("deadMile.totalDeadMiles")}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-red-400">{(data.summary.totalDeadMiles || 0).toFixed(1)} mi</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("deadMile.totalRevenueMiles")}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-emerald-400">{(data.summary.totalRevenueMiles || 0).toFixed(1)} mi</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("deadMile.efficiencyRatio")}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{((data.summary.efficiencyRatio || 0) * 100).toFixed(1)}%</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("deadMile.driversTracked")}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{data.summary.driversTracked || 0}</p></CardContent>
          </Card>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("deadMile.driver")}</TableHead>
              <TableHead>{t("deadMile.deadMiles")}</TableHead>
              <TableHead>{t("deadMile.revenueMiles")}</TableHead>
              <TableHead>{t("deadMile.efficiency")}</TableHead>
              <TableHead>{t("deadMile.trips")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.drivers || []).map((d: any) => (
              <TableRow key={d.driverId}>
                <TableCell className="font-medium">{d.driverName || `Driver #${d.driverId}`}</TableCell>
                <TableCell className="text-red-400">{(d.deadMiles || 0).toFixed(1)} mi</TableCell>
                <TableCell className="text-emerald-400">{(d.revenueMiles || 0).toFixed(1)} mi</TableCell>
                <TableCell>
                  <Badge variant={d.efficiency >= 0.7 ? "default" : d.efficiency >= 0.5 ? "secondary" : "destructive"}>
                    {((d.efficiency || 0) * 100).toFixed(0)}%
                  </Badge>
                </TableCell>
                <TableCell>{d.tripCount || 0}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function OptimizationTab() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const { toast } = useToast();
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const savingsQuery = useQuery<any>({
    queryKey: ["/api/dead-mile/optimization/savings", date],
    queryFn: () => apiFetch(`/api/dead-mile/optimization/savings?date=${date}`, token),
  });

  const batchOptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/dead-mile/optimization/batch?date=${date}`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dead-mile"] });
      toast({ title: t("deadMile.optimizationComplete"), description: t("deadMile.routesImproved", { count: data.optimized || 0 }) });
    },
    onError: (err: any) => toast({ title: t("deadMile.optimizationFailed"), description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        <Button onClick={() => batchOptMutation.mutate()} disabled={batchOptMutation.isPending}>
          {batchOptMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
          {t("deadMile.runBatchOptimization")}
        </Button>
      </div>

      {savingsQuery.data && (
        <Card>
          <CardHeader><CardTitle>{t("deadMile.potentialSavings")}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-lg">{t("deadMile.estimatedSavings", { miles: (savingsQuery.data.potentialSavingsMiles || 0).toFixed(1) })}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function DeadMilePage() {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <TrendingDown className="h-6 w-6 text-red-400" />
        <h1 className="text-2xl font-bold">{t("deadMile.title")}</h1>
      </div>

      <Tabs defaultValue="efficiency">
        <TabsList>
          <TabsTrigger value="efficiency"><BarChart3 className="w-4 h-4 mr-1" />{t("deadMile.fleetEfficiency")}</TabsTrigger>
          <TabsTrigger value="optimization"><Zap className="w-4 h-4 mr-1" />{t("deadMile.routeOptimization")}</TabsTrigger>
        </TabsList>
        <TabsContent value="efficiency" className="mt-4"><FleetEfficiencyTab /></TabsContent>
        <TabsContent value="optimization" className="mt-4"><OptimizationTab /></TabsContent>
      </Tabs>
    </div>
  );
}
