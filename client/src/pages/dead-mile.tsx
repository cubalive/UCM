import { useState } from "react";
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
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Dead Miles</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-red-400">{(data.summary.totalDeadMiles || 0).toFixed(1)} mi</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Revenue Miles</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-emerald-400">{(data.summary.totalRevenueMiles || 0).toFixed(1)} mi</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Efficiency Ratio</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{((data.summary.efficiencyRatio || 0) * 100).toFixed(1)}%</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Drivers Tracked</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{data.summary.driversTracked || 0}</p></CardContent>
          </Card>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Driver</TableHead>
              <TableHead>Dead Miles</TableHead>
              <TableHead>Revenue Miles</TableHead>
              <TableHead>Efficiency</TableHead>
              <TableHead>Trips</TableHead>
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
      toast({ title: "Route optimization complete", description: `${data.optimized || 0} routes improved` });
    },
    onError: (err: any) => toast({ title: "Optimization failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        <Button onClick={() => batchOptMutation.mutate()} disabled={batchOptMutation.isPending}>
          {batchOptMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
          Run Batch Optimization
        </Button>
      </div>

      {savingsQuery.data && (
        <Card>
          <CardHeader><CardTitle>Potential Savings</CardTitle></CardHeader>
          <CardContent>
            <p className="text-lg">Estimated <span className="text-emerald-400 font-bold">{(savingsQuery.data.potentialSavingsMiles || 0).toFixed(1)} miles</span> could be saved with route reordering</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function DeadMilePage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <TrendingDown className="h-6 w-6 text-red-400" />
        <h1 className="text-2xl font-bold">Dead Mile Analytics</h1>
      </div>

      <Tabs defaultValue="efficiency">
        <TabsList>
          <TabsTrigger value="efficiency"><BarChart3 className="w-4 h-4 mr-1" />Fleet Efficiency</TabsTrigger>
          <TabsTrigger value="optimization"><Zap className="w-4 h-4 mr-1" />Route Optimization</TabsTrigger>
        </TabsList>
        <TabsContent value="efficiency" className="mt-4"><FleetEfficiencyTab /></TabsContent>
        <TabsContent value="optimization" className="mt-4"><OptimizationTab /></TabsContent>
      </Tabs>
    </div>
  );
}
