import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/timezone";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronLeft,
  ChevronRight,
  DollarSign,
  TrendingUp,
  Wallet,
  Clock,
} from "lucide-react";

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateISO(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatWeekLabel(weekStart: string): string {
  const start = new Date(weekStart + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function adjustmentBadgeVariant(type: string): "default" | "destructive" | "secondary" | "outline" {
  switch (type) {
    case "NO_SHOW_PENALTY":
      return "destructive";
    default:
      return "secondary";
  }
}

function adjustmentBadgeClass(type: string): string {
  switch (type) {
    case "ON_TIME_BONUS":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "NO_SHOW_PENALTY":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    case "DAILY_MIN_TOPUP":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200";
    case "MANUAL_ADJUSTMENT":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    default:
      return "";
  }
}

function formatAdjustmentType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface CompletedTrip {
  tripId: number;
  payoutCents: number;
  status: string;
  completedAt: string;
  publicId: string;
}

interface Adjustment {
  id: number;
  type: string;
  amountCents: number;
  relatedTripId: number | null;
  periodDate: string;
  metadata: { reason?: string; [key: string]: unknown };
  createdAt: string;
}

interface WeeklyEarnings {
  weekStart: string;
  weekEnd: string;
  baseEarningsCents: number;
  modifiersCents: number;
  totalCents: number;
  completedTrips: CompletedTrip[];
  adjustments: Adjustment[];
  projectedOpenTripsCents: number;
}

export default function DriverEarningsPage() {
  const { token } = useAuth();

  const [weekStart, setWeekStart] = useState<string>(() => {
    return formatDateISO(getMonday(new Date()));
  });

  const earningsQuery = useQuery<WeeklyEarnings>({
    queryKey: ["/api/drivers/me/weekly-earnings", weekStart],
    queryFn: async () => {
      const res = await fetch(`/api/drivers/me/weekly-earnings?weekStart=${weekStart}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    enabled: !!token,
  });

  const data = earningsQuery.data;

  function navigateWeek(direction: -1 | 1) {
    const current = new Date(weekStart + "T00:00:00");
    current.setDate(current.getDate() + direction * 7);
    setWeekStart(formatDateISO(current));
  }

  const hasData = data && (data.completedTrips.length > 0 || data.adjustments.length > 0);

  return (
    <div className="p-4 space-y-4 max-w-[1400px] mx-auto" data-testid="driver-earnings-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-earnings-title">My Earnings</h1>
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={() => navigateWeek(-1)}
            data-testid="button-prev-week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[200px] text-center" data-testid="text-week-label">
            {formatWeekLabel(weekStart)}
          </span>
          <Button
            size="icon"
            variant="outline"
            onClick={() => navigateWeek(1)}
            data-testid="button-next-week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {earningsQuery.isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-green-200 dark:border-green-800">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Base Earnings</CardTitle>
                <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-700 dark:text-green-300" data-testid="text-base-earnings">
                  {data ? formatCents(data.baseEarningsCents) : "$0.00"}
                </div>
              </CardContent>
            </Card>

            <Card className={data && data.modifiersCents < 0
              ? "border-red-200 dark:border-red-800"
              : "border-emerald-200 dark:border-emerald-800"
            }>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Modifiers</CardTitle>
                <TrendingUp className={`h-4 w-4 ${data && data.modifiersCents < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`} />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${data && data.modifiersCents < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}
                  data-testid="text-modifiers"
                >
                  {data ? formatCents(data.modifiersCents) : "$0.00"}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Earnings</CardTitle>
                <Wallet className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-earnings">
                  {data ? formatCents(data.totalCents) : "$0.00"}
                </div>
              </CardContent>
            </Card>

            <Card className="border-dashed">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Projected (Open Trips)</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-muted-foreground" data-testid="text-projected">
                  {data ? formatCents(data.projectedOpenTripsCents) : "$0.00"}
                </div>
              </CardContent>
            </Card>
          </div>

          {!hasData && !earningsQuery.isLoading ? (
            <Card>
              <CardContent className="py-12">
                <p className="text-center text-muted-foreground" data-testid="text-no-earnings">
                  No earnings for this period
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {data && data.completedTrips.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Completed Trips</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Trip ID</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Completed At</TableHead>
                          <TableHead>Payout</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.completedTrips.map((trip) => (
                          <TableRow key={trip.tripId} data-testid={`row-trip-${trip.tripId}`}>
                            <TableCell className="font-medium" data-testid={`text-trip-id-${trip.tripId}`}>
                              {trip.publicId}
                            </TableCell>
                            <TableCell>
                              <Badge variant="default" data-testid={`badge-trip-status-${trip.tripId}`}>
                                {trip.status}
                              </Badge>
                            </TableCell>
                            <TableCell data-testid={`text-trip-completed-${trip.tripId}`}>
                              {formatDateTime(trip.completedAt)}
                            </TableCell>
                            <TableCell className="font-medium" data-testid={`text-trip-payout-${trip.tripId}`}>
                              {formatCents(trip.payoutCents)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {data && data.adjustments.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Adjustments</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TooltipProvider>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Related Trip</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.adjustments.map((adj) => (
                            <TableRow key={adj.id} data-testid={`row-adjustment-${adj.id}`}>
                              <TableCell>
                                <Badge
                                  variant={adjustmentBadgeVariant(adj.type)}
                                  className={adjustmentBadgeClass(adj.type)}
                                  data-testid={`badge-adj-type-${adj.id}`}
                                >
                                  {formatAdjustmentType(adj.type)}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-medium" data-testid={`text-adj-amount-${adj.id}`}>
                                {formatCents(adj.amountCents)}
                              </TableCell>
                              <TableCell data-testid={`text-adj-trip-${adj.id}`}>
                                {adj.relatedTripId ? `#${adj.relatedTripId}` : "-"}
                              </TableCell>
                              <TableCell data-testid={`text-adj-date-${adj.id}`}>
                                {formatDate(adj.periodDate)}
                              </TableCell>
                              <TableCell>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      className="cursor-help text-sm truncate max-w-[200px] inline-block"
                                      data-testid={`text-adj-reason-${adj.id}`}
                                    >
                                      {adj.metadata?.reason || "-"}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <pre className="text-xs max-w-[300px] whitespace-pre-wrap">
                                      {JSON.stringify(adj.metadata, null, 2)}
                                    </pre>
                                  </TooltipContent>
                                </Tooltip>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TooltipProvider>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
