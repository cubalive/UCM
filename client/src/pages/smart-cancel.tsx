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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Ban, Shield, History, Settings, Loader2 } from "lucide-react";

function PoliciesTab() {
  const { token } = useAuth();
  const { toast } = useToast();

  const policiesQuery = useQuery<any>({
    queryKey: ["/api/smart-cancel/policies"],
    queryFn: () => apiFetch("/api/smart-cancel/policies", token),
  });

  const policies = policiesQuery.data?.policies || [];
  if (policiesQuery.isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Policy Name</TableHead>
              <TableHead>Max Cancellations</TableHead>
              <TableHead>Window (days)</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {policies.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No cancellation policies configured</TableCell></TableRow>
            ) : (
              policies.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name || `Policy #${p.id}`}</TableCell>
                  <TableCell>{p.maxCancellations || "—"}</TableCell>
                  <TableCell>{p.windowDays || "—"} days</TableCell>
                  <TableCell><Badge variant="outline">{p.action || "warn"}</Badge></TableCell>
                  <TableCell><Badge variant={p.active ? "default" : "secondary"}>{p.active ? "Active" : "Inactive"}</Badge></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CancellationHistoryTab() {
  const { token } = useAuth();

  const historyQuery = useQuery<any>({
    queryKey: ["/api/smart-cancel/history"],
    queryFn: () => apiFetch("/api/smart-cancel/history", token),
  });

  const history = historyQuery.data?.history || [];
  if (historyQuery.isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Cancellations</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{historyQuery.data?.totalCancellations || 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Auto-Suspended</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-red-400">{historyQuery.data?.autoSuspended || 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">On Hold</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-amber-400">{historyQuery.data?.onHold || 0}</p></CardContent>
        </Card>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Trip</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Action Taken</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No cancellation history</TableCell></TableRow>
            ) : (
              history.map((h: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{h.date ? new Date(h.date).toLocaleDateString("en-US") : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{h.tripPublicId || "—"}</TableCell>
                  <TableCell>{h.patientName || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{h.cancelType || "single"}</Badge></TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs">{h.reason || "—"}</TableCell>
                  <TableCell><Badge variant={h.actionTaken === "suspended" ? "destructive" : "secondary"}>{h.actionTaken || "none"}</Badge></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function SmartCancelPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Ban className="h-6 w-6 text-orange-400" />
        <h1 className="text-2xl font-bold">Smart Cancellation</h1>
      </div>

      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history"><History className="w-4 h-4 mr-1" />History</TabsTrigger>
          <TabsTrigger value="policies"><Shield className="w-4 h-4 mr-1" />Policies</TabsTrigger>
        </TabsList>
        <TabsContent value="history" className="mt-4"><CancellationHistoryTab /></TabsContent>
        <TabsContent value="policies" className="mt-4"><PoliciesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
