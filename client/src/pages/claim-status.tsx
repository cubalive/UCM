import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText, Search, Clock, CheckCircle2, XCircle, AlertTriangle, Loader2, BarChart3,
} from "lucide-react";

function fmt(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}

function claimStatusBadge(status: string) {
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

function ClaimTimeline({ claimId }: { claimId: number }) {
  const { token } = useAuth();

  const timelineQuery = useQuery<any>({
    queryKey: ["/api/edi/claims", claimId, "timeline"],
    queryFn: () => apiFetch(`/api/edi/claims/${claimId}/timeline`, token),
    enabled: !!token && !!claimId,
  });

  if (timelineQuery.isLoading) return <Skeleton className="h-24 w-full" />;

  const claim = timelineQuery.data?.claim;
  const events = timelineQuery.data?.events || [];

  return (
    <div className="space-y-4">
      {claim && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Claim Number</p>
            <p className="font-mono text-sm font-medium">{claim.claimNumber}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            {claimStatusBadge(claim.status)}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="font-medium">{fmt(claim.paymentAmount || 0)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Trip ID</p>
            <p className="text-sm">{claim.tripId}</p>
          </div>
        </div>
      )}
      <div>
        <p className="text-sm font-medium mb-2">Status Timeline</p>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded</p>
        ) : (
          <div className="space-y-3">
            {events.map((evt: any) => (
              <div key={evt.id} className="flex gap-3 items-start" data-testid={`event-${evt.id}`}>
                <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{evt.eventType}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(evt.createdAt).toLocaleString()}</span>
                  </div>
                  {evt.description && <p className="text-sm text-muted-foreground mt-1">{evt.description}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ClaimStatusPage() {
  const { token } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);

  // Dashboard summary
  const dashboardQuery = useQuery<any>({
    queryKey: ["/api/edi/claims/dashboard"],
    queryFn: () => apiFetch("/api/edi/claims/dashboard", token),
    enabled: !!token,
  });

  // Search results
  const searchQ = useQuery<any>({
    queryKey: ["/api/edi/claims/search", searchQuery, statusFilter],
    queryFn: () =>
      apiFetch(
        `/api/edi/claims/search?${new URLSearchParams({
          ...(searchQuery ? { q: searchQuery } : {}),
          ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        }).toString()}`,
        token
      ),
    enabled: !!token,
  });

  const summary = dashboardQuery.data?.summary || {};
  const claims = searchQ.data?.claims || [];

  const statusCards = [
    { key: "SUBMITTED", label: "Submitted", icon: Clock, color: "text-blue-500" },
    { key: "ACCEPTED", label: "Accepted", icon: CheckCircle2, color: "text-green-500" },
    { key: "DENIED", label: "Denied", icon: XCircle, color: "text-red-500" },
    { key: "PAID", label: "Paid", icon: CheckCircle2, color: "text-emerald-500" },
  ];

  // Denial analysis
  const deniedCount = summary["DENIED"]?.count || 0;
  const rejectedCount = summary["REJECTED"]?.count || 0;
  const totalSubmitted = Object.values(summary).reduce((sum: number, s: any) => sum + (s.count || 0), 0);
  const denialRate = totalSubmitted > 0 ? Math.round(((deniedCount + rejectedCount) / totalSubmitted) * 100) : 0;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2" data-testid="text-page-title">
          <FileText className="w-6 h-6" />
          Claim Status Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track EDI claims through their lifecycle
        </p>
      </div>

      {/* Summary Cards */}
      {dashboardQuery.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {statusCards.map(({ key, label, icon: Icon, color }) => (
              <Card key={key} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter(key)}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
                  <Icon className={`w-4 h-4 ${color}`} />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold" data-testid={`text-count-${key}`}>{summary[key]?.count || 0}</p>
                  <p className="text-xs text-muted-foreground">{fmt(summary[key]?.totalAmountCents || 0)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Denial Analysis Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-base">Denial Analysis</CardTitle>
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold" data-testid="text-denial-rate">{denialRate}%</p>
                  <p className="text-xs text-muted-foreground">Denial Rate</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-red-500" data-testid="text-denied-count">{deniedCount}</p>
                  <p className="text-xs text-muted-foreground">Denied Claims</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-orange-500" data-testid="text-rejected-count">{rejectedCount}</p>
                  <p className="text-xs text-muted-foreground">Rejected Claims</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Search & Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by claim number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-claims"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
            <SelectValue placeholder="All statuses" />
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
      </div>

      {/* Claims Table */}
      <Card>
        <CardContent className="p-0">
          {searchQ.isLoading ? (
            <div className="p-6"><Skeleton className="h-40 w-full" /></div>
          ) : claims.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No claims found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Claim #</TableHead>
                  <TableHead>Trip ID</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map((claim: any) => (
                  <TableRow key={claim.id} data-testid={`row-claim-${claim.id}`}>
                    <TableCell className="font-mono text-sm">{claim.claimNumber}</TableCell>
                    <TableCell>{claim.tripId}</TableCell>
                    <TableCell>{fmt(claim.paymentAmount || 0)}</TableCell>
                    <TableCell>{claimStatusBadge(claim.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(claim.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedClaimId(claim.id)}
                        data-testid={`button-view-${claim.id}`}
                      >
                        Timeline
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Timeline Dialog */}
      <Dialog open={!!selectedClaimId} onOpenChange={() => setSelectedClaimId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Claim Timeline</DialogTitle></DialogHeader>
          {selectedClaimId && <ClaimTimeline claimId={selectedClaimId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
