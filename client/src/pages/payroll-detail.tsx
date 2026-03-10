import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, AlertTriangle, DollarSign, Calendar, Clock } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/timezone";
import { DriverRef } from "@/components/entity-ref";

const RUN_STATUS_VARIANTS: Record<string, string> = {
  DRAFT: "secondary",
  FINALIZED: "default",
  PAID: "default",
  CANCELLED: "destructive",
};

const ITEM_STATUS_VARIANTS: Record<string, string> = {
  DRAFT: "secondary",
  FINALIZED: "default",
  PAID: "default",
  FAILED: "destructive",
};

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}


export default function PayrollDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { token } = useAuth();

  const { data, isLoading, error } = useQuery<{ run: any; items: any[] }>({
    queryKey: ["/api/company/payroll/runs", runId],
    queryFn: () => apiFetch(`/api/company/payroll/runs/${runId}`, token),
    enabled: !!token && runId > 0,
  });

  const run = data?.run;
  const items = data?.items || [];

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <Button variant="ghost" onClick={() => navigate("/tp-payroll")} data-testid="button-back-payroll">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Payroll
        </Button>
        <Card className="mt-4">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground" data-testid="text-payroll-not-found">Payroll run not found or access denied.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalCents = items.reduce((sum: number, item: any) => sum + (item.totalCents || 0), 0);
  const totalHours = items.reduce((sum: number, item: any) => sum + parseFloat(item.totalHours || "0"), 0);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto overflow-y-auto h-full" data-testid="payroll-detail-page">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" onClick={() => navigate("/tp-payroll")} data-testid="button-back-payroll">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <DollarSign className="w-5 h-5 text-muted-foreground" />
          <span className="text-lg font-semibold" data-testid="text-payroll-title">
            Payroll Run #{run.id}
          </span>
          <Badge variant={(RUN_STATUS_VARIANTS[run.status] as any) || "secondary"} data-testid="badge-payroll-status">
            {run.status}
          </Badge>
        </div>
      </div>

      <Card>
        <CardContent className="py-4 space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Run Details</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Period:</span>
              <span data-testid="text-payroll-period">
                {formatDate(run.periodStart)} — {formatDate(run.periodEnd)}
              </span>
            </div>

            <div className="flex items-center gap-2 text-sm flex-wrap">
              <DollarSign className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Total Amount:</span>
              <span className="font-semibold" data-testid="text-payroll-total">{formatCents(totalCents)}</span>
            </div>

            <div className="flex items-center gap-2 text-sm flex-wrap">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Total Hours:</span>
              <span data-testid="text-payroll-hours">{totalHours.toFixed(2)}</span>
            </div>

            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-muted-foreground">Drivers:</span>
              <span data-testid="text-payroll-driver-count">{items.length}</span>
            </div>

            {run.createdAt && (
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <span className="text-muted-foreground">Created:</span>
                <span data-testid="text-payroll-created">{formatDate(run.createdAt)}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Driver Payouts</h3>
          {items.length > 0 ? (
            <div className="space-y-1">
              {items.map((item: any, idx: number) => (
                <div
                  key={item.id || idx}
                  className="flex items-center justify-between gap-2 py-2 border-b last:border-b-0 flex-wrap"
                  data-testid={`row-payout-${item.id || idx}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {item.driverUserId && (
                      <span className="text-xs font-mono text-muted-foreground" data-testid={`text-user-id-${item.id}`}>
                        #{item.driverUserId}
                      </span>
                    )}
                    <DriverRef id={item.driverId} label={item.driverName} />
                    <Badge variant={(ITEM_STATUS_VARIANTS[item.status] as any) || "secondary"} data-testid={`badge-payout-status-${item.id}`}>
                      {item.status}
                    </Badge>
                    {item.stripePayoutsEnabled ? (
                      <Badge variant="default" className="text-[10px]">Stripe Active</Badge>
                    ) : item.stripeStatus ? (
                      <Badge variant="secondary" className="text-[10px]">{item.stripeStatus}</Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs text-muted-foreground" data-testid={`text-payout-hours-${item.id}`}>
                      {parseFloat(item.totalHours || "0").toFixed(2)} hrs
                    </span>
                    <span className="text-sm font-medium" data-testid={`text-payout-amount-${item.id}`}>
                      {formatCents(item.totalCents)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-no-payouts">No driver payouts in this run.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
