import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeftRight,
  RefreshCw,
  Check,
  X,
  Loader2,
} from "lucide-react";

const statusBadgeClass: Record<string, string> = {
  PENDING_TARGET: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  DECLINED_TARGET: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  ACCEPTED_TARGET: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  PENDING_DISPATCH: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  APPROVED_DISPATCH: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  REJECTED_DISPATCH: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  CANCELLED: "bg-muted text-muted-foreground",
};

const statusLabels: Record<string, string> = {
  PENDING_TARGET: "Pending Driver",
  DECLINED_TARGET: "Declined by Driver",
  ACCEPTED_TARGET: "Accepted by Driver",
  PENDING_DISPATCH: "Pending Dispatch",
  APPROVED_DISPATCH: "Approved",
  REJECTED_DISPATCH: "Rejected",
  CANCELLED: "Cancelled",
};

export default function DispatchSwapsPage() {
  const { token, selectedCity } = useAuth();
  const cityId = selectedCity?.id;
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("PENDING_DISPATCH");
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [decisionAction, setDecisionAction] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [decisionNote, setDecisionNote] = useState("");

  const { data, isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/dispatch/swaps", cityId, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (cityId) params.set("cityId", String(cityId));
      if (statusFilter && statusFilter !== "all") {
        params.set("status", statusFilter === "pending" ? "pending" : statusFilter);
      }
      return apiFetch(`/api/dispatch/swaps?${params.toString()}`, token);
    },
    enabled: !!token,
  });

  const decideMutation = useMutation({
    mutationFn: (payload: { id: number; decision: "APPROVE" | "REJECT"; note?: string }) =>
      apiFetch(`/api/dispatch/swaps/${payload.id}/decide`, token, {
        method: "POST",
        body: JSON.stringify({ decision: payload.decision, note: payload.note }),
      }),
    onSuccess: () => {
      toast({ title: `Swap ${decisionAction.toLowerCase()}d` });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/swaps"] });
      setDecidingId(null);
      setDecisionNote("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const swaps = data || [];

  function openDecisionDialog(id: number, action: "APPROVE" | "REJECT") {
    setDecidingId(id);
    setDecisionAction(action);
    setDecisionNote("");
  }

  function confirmDecision() {
    if (!decidingId) return;
    if (decisionAction === "REJECT" && !decisionNote.trim()) {
      toast({ title: "Required", description: "A note is required when rejecting", variant: "destructive" });
      return;
    }
    decideMutation.mutate({ id: decidingId, decision: decisionAction, note: decisionNote.trim() || undefined });
  }

  if (!cityId) {
    return (
      <div className="p-6 text-center text-muted-foreground" data-testid="text-no-city">
        Please select a working city to view shift swaps.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="page-dispatch-swaps">
      <div className="flex items-center gap-2 flex-wrap">
        <ArrowLeftRight className="w-5 h-5" />
        <h1 className="text-xl font-semibold">Shift Swap Requests</h1>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-swap-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING_DISPATCH">Pending Dispatch</SelectItem>
            <SelectItem value="PENDING_TARGET">Pending Driver</SelectItem>
            <SelectItem value="APPROVED_DISPATCH">Approved</SelectItem>
            <SelectItem value="REJECTED_DISPATCH">Rejected</SelectItem>
            <SelectItem value="DECLINED_TARGET">Declined by Driver</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-swap-refresh">
          <RefreshCw className="w-4 h-4" />
        </Button>
        <Badge variant="secondary" data-testid="badge-swap-count">{swaps.length} swap{swaps.length !== 1 ? "s" : ""}</Badge>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : swaps.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground" data-testid="text-no-swaps">No swap requests found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {swaps.map((swap: any) => (
            <Card key={swap.id} data-testid={`card-swap-${swap.id}`}>
              <CardContent className="py-3 space-y-2">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={statusBadgeClass[swap.status] || ""} data-testid={`badge-swap-status-${swap.id}`}>
                        {statusLabels[swap.status] || swap.status}
                      </Badge>
                    </div>
                    <div className="text-sm space-y-0.5">
                      <p data-testid={`text-swap-date-${swap.id}`}>
                        <span className="font-medium">Date:</span> {swap.shiftDate}
                        {swap.shiftStart && ` (${swap.shiftStart}${swap.shiftEnd ? ` - ${swap.shiftEnd}` : ""})`}
                      </p>
                      <p data-testid={`text-swap-requester-${swap.id}`}>
                        <span className="font-medium">Requester:</span> {swap.requesterDriverName}
                      </p>
                      <p data-testid={`text-swap-target-${swap.id}`}>
                        <span className="font-medium">Target:</span> {swap.targetDriverName}
                      </p>
                      <p className="text-muted-foreground text-xs" data-testid={`text-swap-reason-${swap.id}`}>
                        Reason: {swap.reason}
                      </p>
                      <p className="text-xs text-muted-foreground/60">Submitted {new Date(swap.createdAt).toLocaleDateString()}</p>
                    </div>
                    {swap.targetDecisionNote && (
                      <div className="text-xs bg-muted/50 rounded-md px-2 py-1" data-testid={`text-swap-target-note-${swap.id}`}>
                        <span className="font-medium">Driver note:</span> {swap.targetDecisionNote}
                      </div>
                    )}
                    {swap.dispatchDecisionNote && (
                      <div className="text-xs bg-muted/50 rounded-md px-2 py-1" data-testid={`text-swap-dispatch-note-${swap.id}`}>
                        <span className="font-medium">Dispatch note:</span> {swap.dispatchDecisionNote}
                      </div>
                    )}
                  </div>
                  {swap.status === "PENDING_DISPATCH" && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" onClick={() => openDecisionDialog(swap.id, "APPROVE")} data-testid={`button-approve-swap-${swap.id}`}>
                        <Check className="w-4 h-4 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openDecisionDialog(swap.id, "REJECT")} data-testid={`button-reject-swap-${swap.id}`}>
                        <X className="w-4 h-4 mr-1" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={decidingId !== null} onOpenChange={(open) => { if (!open) setDecidingId(null); }}>
        <DialogContent data-testid="dialog-swap-decision">
          <DialogHeader>
            <DialogTitle>{decisionAction === "APPROVE" ? "Approve" : "Reject"} Shift Swap</DialogTitle>
            <DialogDescription>
              {decisionAction === "REJECT"
                ? "A note is required when rejecting a swap."
                : "Add an optional note for the drivers."
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="swap-decision-note">Note {decisionAction === "REJECT" && "*"}</Label>
              <Textarea
                id="swap-decision-note"
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder={decisionAction === "REJECT" ? "Explain why this swap is being rejected..." : "Optional note..."}
                rows={3}
                data-testid="input-swap-decision-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecidingId(null)} data-testid="button-cancel-swap-decision">Cancel</Button>
            <Button
              onClick={confirmDecision}
              disabled={decideMutation.isPending || (decisionAction === "REJECT" && !decisionNote.trim())}
              variant={decisionAction === "APPROVE" ? "default" : "destructive"}
              data-testid="button-confirm-swap-decision"
            >
              {decideMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Confirm {decisionAction === "APPROVE" ? "Approval" : "Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
