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
import { FileText, DollarSign, Upload, Download, AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";

function fmt(cents: number) { return "$" + (cents / 100).toFixed(2); }

function statusBadge(status: string) {
  const map: Record<string, string> = {
    DRAFT: "bg-gray-500/10 text-gray-400 border-gray-500/20",
    SUBMITTED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    ACCEPTED: "bg-green-500/10 text-green-400 border-green-500/20",
    REJECTED: "bg-red-500/10 text-red-400 border-red-500/20",
    PAID: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    DENIED: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return <Badge className={map[status] || ""}>{status}</Badge>;
}

function DashboardTab() {
  const { token } = useAuth();
  const statsQuery = useQuery<any>({
    queryKey: ["/api/medicaid/dashboard"],
    queryFn: () => apiFetch("/api/medicaid/dashboard", token),
  });

  if (statsQuery.isLoading) return <Skeleton className="h-40 w-full" />;
  const s = statsQuery.data;
  if (!s) return <p className="text-muted-foreground">No Medicaid data</p>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Claims</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold">{s.totalClaims || 0}</p></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Pending</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold text-amber-400">{s.pendingClaims || 0}</p></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Paid Amount</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold text-emerald-400">{fmt(s.paidAmountCents || 0)}</p></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Denied</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold text-red-400">{s.deniedClaims || 0}</p></CardContent>
      </Card>
    </div>
  );
}

function ClaimsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("ALL");

  const claimsQuery = useQuery<any>({
    queryKey: ["/api/medicaid/claims", statusFilter],
    queryFn: () => apiFetch(`/api/medicaid/claims?status=${statusFilter === "ALL" ? "" : statusFilter}&limit=100`, token),
  });

  const submitMutation = useMutation({
    mutationFn: async (claimId: number) => {
      const res = await apiRequest("POST", `/api/medicaid/claims/${claimId}/submit`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medicaid/claims"] });
      toast({ title: "Claim submitted" });
    },
    onError: (err: any) => toast({ title: "Submit failed", description: err.message, variant: "destructive" }),
  });

  const claims = claimsQuery.data?.claims || [];
  if (claimsQuery.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["ALL", "DRAFT", "SUBMITTED", "ACCEPTED", "REJECTED", "PAID", "DENIED"].map(s => (
              <SelectItem key={s} value={s}>{s === "ALL" ? "All Statuses" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Claim #</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Service Date</TableHead>
              <TableHead>HCPCS</TableHead>
              <TableHead>Billed</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {claims.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No claims found</TableCell></TableRow>
            ) : (
              claims.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.claimNumber || c.id}</TableCell>
                  <TableCell>{c.patientName || `Patient #${c.patientId}`}</TableCell>
                  <TableCell>{c.serviceDate ? new Date(c.serviceDate).toLocaleDateString("en-US") : "—"}</TableCell>
                  <TableCell><Badge variant="outline">{c.hcpcsCode || "—"}</Badge></TableCell>
                  <TableCell>{fmt(c.billedAmountCents || 0)}</TableCell>
                  <TableCell>{fmt(c.paidAmountCents || 0)}</TableCell>
                  <TableCell>{statusBadge(c.status)}</TableCell>
                  <TableCell>
                    {c.status === "DRAFT" && (
                      <Button size="sm" variant="outline" onClick={() => submitMutation.mutate(c.id)} disabled={submitMutation.isPending}>
                        {submitMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}Submit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CodesTab() {
  const { token } = useAuth();
  const codesQuery = useQuery<any>({
    queryKey: ["/api/medicaid/codes"],
    queryFn: () => apiFetch("/api/medicaid/codes", token),
  });

  const codes = codesQuery.data?.codes || [];
  if (codesQuery.isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>HCPCS Code</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Rate</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {codes.map((c: any) => (
            <TableRow key={c.id}>
              <TableCell className="font-mono font-bold">{c.code}</TableCell>
              <TableCell>{c.description}</TableCell>
              <TableCell>{fmt(c.rateCents || 0)}</TableCell>
              <TableCell>{c.unit || "trip"}</TableCell>
              <TableCell><Badge variant={c.active ? "default" : "secondary"}>{c.active ? "Active" : "Inactive"}</Badge></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function MedicaidBillingPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold">Medicaid Billing</h1>
        <Badge variant="outline">EDI 837/835</Badge>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard"><DollarSign className="w-4 h-4 mr-1" />Dashboard</TabsTrigger>
          <TabsTrigger value="claims"><FileText className="w-4 h-4 mr-1" />Claims</TabsTrigger>
          <TabsTrigger value="codes"><CheckCircle2 className="w-4 h-4 mr-1" />HCPCS Codes</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-4"><DashboardTab /></TabsContent>
        <TabsContent value="claims" className="mt-4"><ClaimsTab /></TabsContent>
        <TabsContent value="codes" className="mt-4"><CodesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
