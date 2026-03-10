import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  FileText, DollarSign, Upload, Download, CheckCircle2, Clock,
  Loader2, Send, AlertTriangle, BarChart3, Eye,
} from "lucide-react";

function fmt(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}

function statusBadge(status: string) {
  const map: Record<string, { className: string; label: string }> = {
    GENERATED: { className: "bg-gray-500/10 text-gray-400 border-gray-500/20", label: "Generated" },
    SUBMITTED: { className: "bg-blue-500/10 text-blue-400 border-blue-500/20", label: "Submitted" },
    ACCEPTED: { className: "bg-green-500/10 text-green-400 border-green-500/20", label: "Accepted" },
    REJECTED: { className: "bg-orange-500/10 text-orange-400 border-orange-500/20", label: "Rejected" },
    PAID: { className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", label: "Paid" },
    DENIED: { className: "bg-red-500/10 text-red-400 border-red-500/20", label: "Denied" },
  };
  const s = map[status] || { className: "", label: status };
  return <Badge className={s.className}>{s.label}</Badge>;
}

// ─── Claims Tab ──────────────────────────────────────────────────────────────

function ClaimsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);

  const claimsQuery = useQuery<any>({
    queryKey: ["/api/edi/claims", statusFilter],
    queryFn: () =>
      apiFetch(
        `/api/edi/claims?limit=100${statusFilter !== "all" ? `&status=${statusFilter}` : ""}`,
        token,
      ),
    enabled: !!token,
  });

  const submitMutation = useMutation({
    mutationFn: async (claimId: number) => {
      return apiFetch(`/api/edi/claims/${claimId}/submit`, token, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/edi/claims"] });
      toast({ title: "Claim submitted", description: "Claim has been marked as submitted." });
    },
    onError: (err: any) =>
      toast({ title: "Submit failed", description: err.message, variant: "destructive" }),
  });

  const detailQuery = useQuery<any>({
    queryKey: ["/api/edi/claims", selectedClaimId],
    queryFn: () => apiFetch(`/api/edi/claims/${selectedClaimId}`, token),
    enabled: !!token && !!selectedClaimId,
  });

  const claims = claimsQuery.data?.claims || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="GENERATED">Generated</SelectItem>
            <SelectItem value="SUBMITTED">Submitted</SelectItem>
            <SelectItem value="ACCEPTED">Accepted</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="PAID">Paid</SelectItem>
            <SelectItem value="DENIED">Denied</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {claimsQuery.data?.total || 0} claims
        </span>
      </div>

      {claimsQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim #</TableHead>
                <TableHead>Trip</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Service Date</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Adjustment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No EDI claims found. Generate claims from completed trips.
                  </TableCell>
                </TableRow>
              ) : (
                claims.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.claimNumber}</TableCell>
                    <TableCell className="font-mono text-xs">{c.tripPublicId || `#${c.tripId}`}</TableCell>
                    <TableCell>{c.patientName || "—"}</TableCell>
                    <TableCell>{c.tripScheduledDate || "—"}</TableCell>
                    <TableCell>{c.paymentAmount != null ? fmt(c.paymentAmount) : "—"}</TableCell>
                    <TableCell>{c.adjustmentAmount != null ? fmt(c.adjustmentAmount) : "—"}</TableCell>
                    <TableCell>{statusBadge(c.status)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {c.status === "GENERATED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => submitMutation.mutate(c.id)}
                            disabled={submitMutation.isPending}
                          >
                            {submitMutation.isPending ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Send className="w-3 h-3 mr-1" />
                            )}
                            Submit
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedClaimId(c.id)}
                        >
                          <Eye className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Claim Detail Dialog */}
      <Dialog open={!!selectedClaimId} onOpenChange={(open) => !open && setSelectedClaimId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>EDI Claim Detail</DialogTitle>
          </DialogHeader>
          {detailQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : detailQuery.data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Claim Number</Label>
                  <p className="font-mono">{detailQuery.data.claimNumber}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div>{statusBadge(detailQuery.data.status)}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Patient</Label>
                  <p>{detailQuery.data.patientName || "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Medicaid ID</Label>
                  <p className="font-mono">{detailQuery.data.patientMedicaidId || "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Trip</Label>
                  <p className="font-mono">{detailQuery.data.tripPublicId || "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Service Date</Label>
                  <p>{detailQuery.data.tripScheduledDate || "—"}</p>
                </div>
                {detailQuery.data.paymentAmount != null && (
                  <div>
                    <Label className="text-muted-foreground">Payment</Label>
                    <p className="text-emerald-400 font-bold">{fmt(detailQuery.data.paymentAmount)}</p>
                  </div>
                )}
                {detailQuery.data.adjustmentAmount != null && (
                  <div>
                    <Label className="text-muted-foreground">Adjustment</Label>
                    <p className="text-orange-400">{fmt(detailQuery.data.adjustmentAmount)}</p>
                  </div>
                )}
              </div>

              {detailQuery.data.tripPickupAddress && (
                <div>
                  <Label className="text-muted-foreground">Route</Label>
                  <p className="text-sm">{detailQuery.data.tripPickupAddress} → {detailQuery.data.tripDropoffAddress}</p>
                </div>
              )}

              {detailQuery.data.ediContent && (
                <div>
                  <Label className="text-muted-foreground">EDI 837 Content</Label>
                  <pre className="mt-1 text-xs bg-muted p-3 rounded-md overflow-x-auto max-h-60">
                    {detailQuery.data.ediContent}
                  </pre>
                </div>
              )}

              {detailQuery.data.events?.length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Events</Label>
                  <div className="mt-1 space-y-2">
                    {detailQuery.data.events.map((e: any) => (
                      <div key={e.id} className="flex items-start gap-2 text-sm border-l-2 border-muted pl-3">
                        <Badge variant="outline" className="text-xs shrink-0">{e.eventType}</Badge>
                        <span className="text-muted-foreground">{e.description}</span>
                        <span className="text-xs text-muted-foreground ml-auto shrink-0">
                          {new Date(e.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">Claim not found</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Generate Claims Panel ───────────────────────────────────────────────────

function GeneratePanel() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [tripIdsInput, setTripIdsInput] = useState("");
  const [npi, setNpi] = useState("");
  const [taxId, setTaxId] = useState("");
  const [orgName, setOrgName] = useState("");
  const [payerId, setPayerId] = useState("MEDICAID");
  const [payerName, setPayerName] = useState("MEDICAID");

  const generateMutation = useMutation({
    mutationFn: async () => {
      const tripIds = tripIdsInput
        .split(",")
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !isNaN(id));

      if (tripIds.length === 0) throw new Error("Enter at least one trip ID");
      if (!npi) throw new Error("Provider NPI is required");

      return apiFetch("/api/edi/claims/generate", token, {
        method: "POST",
        body: JSON.stringify({
          tripIds,
          provider: {
            npi,
            taxId: taxId || undefined,
            organizationName: orgName || undefined,
          },
          payer: {
            payerId,
            payerName,
          },
        }),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/edi/claims"] });
      toast({
        title: "EDI Claims Generated",
        description: `Generated ${data.generated} claims, ${data.failed} failed.`,
      });
      setTripIdsInput("");
    },
    onError: (err: any) =>
      toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Generate EDI 837 Claims</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Trip IDs (comma-separated)</Label>
          <Input
            value={tripIdsInput}
            onChange={(e) => setTripIdsInput(e.target.value)}
            placeholder="e.g. 101, 102, 103"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Provider NPI *</Label>
            <Input
              value={npi}
              onChange={(e) => setNpi(e.target.value)}
              placeholder="10-digit NPI"
              maxLength={10}
            />
          </div>
          <div>
            <Label>Tax ID</Label>
            <Input
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="EIN"
            />
          </div>
          <div>
            <Label>Organization Name</Label>
            <Input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Provider name"
            />
          </div>
          <div>
            <Label>Payer ID</Label>
            <Input
              value={payerId}
              onChange={(e) => setPayerId(e.target.value)}
              placeholder="MEDICAID"
            />
          </div>
        </div>
        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="w-full"
        >
          {generateMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <FileText className="w-4 h-4 mr-2" />
          )}
          Generate 837 Claims
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Remittance Tab ──────────────────────────────────────────────────────────

function RemittanceTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [ediInput, setEdiInput] = useState("");
  const [parseResult, setParseResult] = useState<any>(null);

  const parseMutation = useMutation({
    mutationFn: async () => {
      if (!ediInput.trim()) throw new Error("Paste EDI 835 content");
      return apiFetch("/api/edi/remittance/parse", token, {
        method: "POST",
        body: JSON.stringify({ ediContent: ediInput }),
      });
    },
    onSuccess: (data: any) => {
      setParseResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/edi/claims"] });
      queryClient.invalidateQueries({ queryKey: ["/api/edi/remittance/summary"] });
      toast({
        title: "Remittance Processed",
        description: `Matched ${data.matched} claims, ${data.unmatched} unmatched.`,
      });
    },
    onError: (err: any) =>
      toast({ title: "Parse failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Upload EDI 835 Remittance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Paste EDI 835 content</Label>
            <Textarea
              value={ediInput}
              onChange={(e) => setEdiInput(e.target.value)}
              placeholder="ISA*00*          *00*          *ZZ*..."
              rows={8}
              className="font-mono text-xs"
            />
          </div>
          <Button
            onClick={() => parseMutation.mutate()}
            disabled={parseMutation.isPending}
          >
            {parseMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Parse Remittance
          </Button>
        </CardContent>
      </Card>

      {parseResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Parse Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-muted-foreground">Payer</Label>
                <p className="font-medium">{parseResult.payerName || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Check #</Label>
                <p className="font-mono">{parseResult.checkNumber || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Payment Date</Label>
                <p>{parseResult.paymentDate || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Total Payment</Label>
                <p className="text-emerald-400 font-bold">
                  {fmt(parseResult.totalPaymentCents || 0)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-muted-foreground">Claims in File</Label>
                <p className="text-lg font-bold">{parseResult.totalClaimsInFile}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Matched</Label>
                <p className="text-lg font-bold text-green-400">{parseResult.matched}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Unmatched</Label>
                <p className="text-lg font-bold text-orange-400">{parseResult.unmatched}</p>
              </div>
            </div>

            {parseResult.matchedClaims?.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Claim #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead>Adjustment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parseResult.matchedClaims.map((mc: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">{mc.claimNumber}</TableCell>
                        <TableCell>{statusBadge(mc.status)}</TableCell>
                        <TableCell>{fmt(mc.paidCents)}</TableCell>
                        <TableCell>{fmt(mc.adjustmentCents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {parseResult.warnings?.length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-yellow-400" />
                  <span className="font-medium text-yellow-400">Warnings</span>
                </div>
                <ul className="text-sm text-muted-foreground list-disc list-inside">
                  {parseResult.warnings.map((w: string, i: number) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Reports Tab ─────────────────────────────────────────────────────────────

function ReportsTab() {
  const { token } = useAuth();

  const summaryQuery = useQuery<any>({
    queryKey: ["/api/edi/remittance/summary"],
    queryFn: () => apiFetch("/api/edi/remittance/summary", token),
    enabled: !!token,
  });

  if (summaryQuery.isLoading) return <Skeleton className="h-40 w-full" />;

  const s = summaryQuery.data;
  if (!s) return <p className="text-muted-foreground">No EDI data available</p>;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Claims</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{s.totalClaims}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-400">{s.pendingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Paid</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-400">{fmt(s.totalPaidCents)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Adjusted</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-orange-400">{fmt(s.totalAdjustedCents)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Status Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Claim Status Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Generated</p>
              <p className="text-xl font-bold text-gray-400">{s.generatedCount}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Submitted</p>
              <p className="text-xl font-bold text-blue-400">{s.submittedCount}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Accepted</p>
              <p className="text-xl font-bold text-green-400">{s.acceptedCount}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Rejected</p>
              <p className="text-xl font-bold text-orange-400">{s.rejectedCount}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Paid</p>
              <p className="text-xl font-bold text-emerald-400">{s.paidCount}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Denied</p>
              <p className="text-xl font-bold text-red-400">{s.deniedCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function EdiBillingPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold">EDI Billing</h1>
        <Badge variant="outline">837P / 835</Badge>
      </div>

      <Tabs defaultValue="claims">
        <TabsList>
          <TabsTrigger value="claims">
            <FileText className="w-4 h-4 mr-1" />
            Claims
          </TabsTrigger>
          <TabsTrigger value="remittance">
            <Download className="w-4 h-4 mr-1" />
            Remittance
          </TabsTrigger>
          <TabsTrigger value="reports">
            <BarChart3 className="w-4 h-4 mr-1" />
            Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent value="claims" className="mt-4 space-y-4">
          <GeneratePanel />
          <ClaimsTab />
        </TabsContent>

        <TabsContent value="remittance" className="mt-4">
          <RemittanceTab />
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          <ReportsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
