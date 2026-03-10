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
import { CheckSquare, BarChart3, Play, Clock, DollarSign, AlertTriangle, Loader2 } from "lucide-react";

function fmt(cents: number) { return "$" + (cents / 100).toFixed(2); }

function DashboardTab() {
  const { token } = useAuth();
  const dashQuery = useQuery<any>({
    queryKey: ["/api/reconciliation/dashboard"],
    queryFn: () => apiFetch("/api/reconciliation/dashboard", token),
  });

  if (dashQuery.isLoading) return <Skeleton className="h-40 w-full" />;
  const d = dashQuery.data;
  if (!d) return <p className="text-muted-foreground">No data</p>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Runs</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold">{d.totalRuns || 0}</p></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Matched</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold text-emerald-400">{d.matchedCount || 0}</p></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Unmatched</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold text-red-400">{d.unmatchedCount || 0}</p></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Disputed</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold text-amber-400">{d.disputedCount || 0}</p></CardContent>
      </Card>
    </div>
  );
}

function RunsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split("T")[0];
  });
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().split("T")[0]);

  const runsQuery = useQuery<any>({
    queryKey: ["/api/reconciliation/runs"],
    queryFn: () => apiFetch("/api/reconciliation/runs", token),
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reconciliation/run", { periodStart, periodEnd });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reconciliation"] });
      toast({ title: "Reconciliation complete", description: `Matched: ${data.matched || 0}, Unmatched: ${data.unmatched || 0}` });
    },
    onError: (err: any) => toast({ title: "Run failed", description: err.message, variant: "destructive" }),
  });

  const runs = runsQuery.data?.runs || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div><label className="text-xs text-muted-foreground">Period Start</label><Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-40" /></div>
        <div><label className="text-xs text-muted-foreground">Period End</label><Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-40" /></div>
        <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
          {runMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          Run Reconciliation
        </Button>
      </div>

      {runsQuery.isLoading ? <Skeleton className="h-40 w-full" /> : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run ID</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Matched</TableHead>
                <TableHead>Unmatched</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No reconciliation runs yet</TableCell></TableRow>
              ) : (
                runs.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">#{r.id}</TableCell>
                    <TableCell className="text-xs">{r.periodStart} — {r.periodEnd}</TableCell>
                    <TableCell className="text-emerald-400">{r.matchedCount || 0}</TableCell>
                    <TableCell className="text-red-400">{r.unmatchedCount || 0}</TableCell>
                    <TableCell><Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                    <TableCell className="text-xs">{r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-US") : "—"}</TableCell>
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

function AgingTab() {
  const { token } = useAuth();
  const agingQuery = useQuery<any>({
    queryKey: ["/api/reconciliation/aging"],
    queryFn: () => apiFetch("/api/reconciliation/aging", token),
  });

  if (agingQuery.isLoading) return <Skeleton className="h-40 w-full" />;
  const buckets = agingQuery.data?.buckets || [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {buckets.map((b: any, i: number) => (
        <Card key={i}>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{b.label || `${b.minDays}-${b.maxDays} days`}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{b.count || 0} items</p>
            <p className="text-sm text-muted-foreground">{fmt(b.totalCents || 0)}</p>
          </CardContent>
        </Card>
      ))}
      {buckets.length === 0 && <p className="text-muted-foreground col-span-4">No aging data available</p>}
    </div>
  );
}

export default function ReconciliationPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <CheckSquare className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold">Payment Reconciliation</h1>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard"><BarChart3 className="w-4 h-4 mr-1" />Dashboard</TabsTrigger>
          <TabsTrigger value="runs"><Play className="w-4 h-4 mr-1" />Runs</TabsTrigger>
          <TabsTrigger value="aging"><Clock className="w-4 h-4 mr-1" />Aging Report</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-4"><DashboardTab /></TabsContent>
        <TabsContent value="runs" className="mt-4"><RunsTab /></TabsContent>
        <TabsContent value="aging" className="mt-4"><AgingTab /></TabsContent>
      </Tabs>
    </div>
  );
}
