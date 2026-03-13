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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeftRight, MapPin, Truck, CheckCircle2, Clock, XCircle } from "lucide-react";

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    REQUESTED: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    DRIVERS_ASSIGNED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    LEG1_IN_PROGRESS: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    AT_TRANSFER_POINT: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    LEG2_IN_PROGRESS: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
    COMPLETED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    CANCELLED: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return <Badge className={colors[status] || ""}>{status.replace(/_/g, " ")}</Badge>;
}

export default function InterCityPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState("ALL");

  const transfersQuery = useQuery<any>({
    queryKey: ["/api/inter-city/transfers", statusFilter],
    queryFn: () => apiFetch(`/api/inter-city/transfers?status=${statusFilter === "ALL" ? "" : statusFilter}`, token),
  });

  const statsQuery = useQuery<any>({
    queryKey: ["/api/inter-city/stats"],
    queryFn: () => apiFetch("/api/inter-city/stats", token),
  });

  const transfers = transfersQuery.data?.transfers || [];
  const stats = statsQuery.data;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <ArrowLeftRight className="h-6 w-6 text-indigo-400" />
        <h1 className="text-2xl font-bold">{t("interCity.title")}</h1>
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("interCity.activeTransfers")}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{stats.activeCount || 0}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("interCity.completed")}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-emerald-400">{stats.completedCount || 0}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("interCity.avgHandoffTime")}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{stats.avgHandoffMinutes || 0} min</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("interCity.citiesConnected")}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{stats.citiesConnected || 0}</p></CardContent>
          </Card>
        </div>
      )}

      <div className="flex gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["ALL", "REQUESTED", "DRIVERS_ASSIGNED", "LEG1_IN_PROGRESS", "AT_TRANSFER_POINT", "LEG2_IN_PROGRESS", "COMPLETED", "CANCELLED"].map(s => (
              <SelectItem key={s} value={s}>{s === "ALL" ? t("interCity.allStatuses") : s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {transfersQuery.isLoading ? <Skeleton className="h-64 w-full" /> : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.id")}</TableHead>
                <TableHead>{t("interCity.originCity")}</TableHead>
                <TableHead>{t("interCity.destinationCity")}</TableHead>
                <TableHead>{t("interCity.transferPoint")}</TableHead>
                <TableHead>{t("interCity.leg1Driver")}</TableHead>
                <TableHead>{t("interCity.leg2Driver")}</TableHead>
                <TableHead>{t("interCity.status")}</TableHead>
                <TableHead>{t("interCity.created")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">{t("interCity.noTransfers")}</TableCell></TableRow>
              ) : (
                transfers.map((tr: any) => (
                  <TableRow key={tr.id}>
                    <TableCell className="font-mono text-xs">#{tr.id}</TableCell>
                    <TableCell>{tr.originCityName || `City #${tr.originCityId}`}</TableCell>
                    <TableCell>{tr.destinationCityName || `City #${tr.destinationCityId}`}</TableCell>
                    <TableCell className="text-xs max-w-[150px] truncate">{tr.transferPointAddress || t("interCity.tbd")}</TableCell>
                    <TableCell>{tr.leg1DriverName || t("interCity.unassigned")}</TableCell>
                    <TableCell>{tr.leg2DriverName || t("interCity.unassigned")}</TableCell>
                    <TableCell>{statusBadge(tr.status)}</TableCell>
                    <TableCell className="text-xs">{tr.createdAt ? new Date(tr.createdAt).toLocaleDateString() : "—"}</TableCell>
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
