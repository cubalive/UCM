import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Brain,
  MapPin,
  ShieldAlert,
  TrendingUp,
  Eye,
  CheckCircle2,
  XCircle,
  Loader2,
  BarChart3,
} from "lucide-react";

function severityBadge(severity: string) {
  const map: Record<string, string> = {
    LOW: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    MEDIUM: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    HIGH: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    CRITICAL: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return <Badge className={map[severity] || ""}>{severity}</Badge>;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    OPEN: "bg-red-500/10 text-red-400 border-red-500/20",
    INVESTIGATING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    RESOLVED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    DISMISSED: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  };
  return <Badge className={map[status] || ""}>{status}</Badge>;
}

export default function AiDashboardPage() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedHour, setSelectedHour] = useState<string>(new Date().getHours().toString());
  const [selectedCityId, setSelectedCityId] = useState<string>("");
  const [fraudFilter, setFraudFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"demand" | "positioning" | "fraud">("demand");

  const companyId = user?.companyId || "";

  // Demand prediction query
  const demandQuery = useQuery<any>({
    queryKey: ["/api/ai/demand-prediction", selectedCityId, selectedDate, selectedHour],
    queryFn: () =>
      apiFetch(
        `/api/ai/demand-prediction?cityId=${selectedCityId}&date=${selectedDate}&hour=${selectedHour}&companyId=${companyId}`,
        token
      ),
    enabled: activeTab === "demand" && !!selectedCityId,
  });

  // Driver positioning query
  const positioningQuery = useQuery<any>({
    queryKey: ["/api/ai/driver-positioning", selectedCityId, selectedDate, selectedHour],
    queryFn: () =>
      apiFetch(
        `/api/ai/driver-positioning?cityId=${selectedCityId}&date=${selectedDate}&hour=${selectedHour}&companyId=${companyId}`,
        token
      ),
    enabled: activeTab === "positioning" && !!selectedCityId,
  });

  // Fraud alerts query
  const fraudQuery = useQuery<any>({
    queryKey: ["/api/ai/fraud-alerts", fraudFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", String(companyId));
      if (fraudFilter !== "all") params.set("status", fraudFilter);
      return apiFetch(`/api/ai/fraud-alerts?${params.toString()}`, token);
    },
    enabled: activeTab === "fraud",
  });

  // Fraud alert update mutation
  const updateAlertMutation = useMutation({
    mutationFn: async ({ id, status, resolvedNotes }: { id: number; status: string; resolvedNotes?: string }) => {
      const res = await apiRequest("PATCH", `/api/ai/fraud-alerts/${id}`, { status, resolvedNotes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/fraud-alerts"] });
      toast({ title: "Alert updated" });
    },
    onError: (err: any) =>
      toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const tabs = [
    { key: "demand" as const, label: "Demand Forecast", icon: TrendingUp },
    { key: "positioning" as const, label: "Driver Positioning", icon: MapPin },
    { key: "fraud" as const, label: "Fraud Alerts", icon: ShieldAlert },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Brain className="h-6 w-6 text-purple-400" />
        <h1 className="text-2xl font-bold">AI Intelligence Dashboard</h1>
      </div>

      {/* Tab selector */}
      <div className="flex gap-2 border-b pb-2">
        {tabs.map((tab) => (
          <Button
            key={tab.key}
            variant={activeTab === tab.key ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab(tab.key)}
            className="gap-2"
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Filters */}
      {(activeTab === "demand" || activeTab === "positioning") && (
        <div className="flex gap-4 items-end">
          <div>
            <label className="text-sm text-muted-foreground block mb-1">City ID</label>
            <Input
              type="number"
              placeholder="City ID"
              value={selectedCityId}
              onChange={(e) => setSelectedCityId(e.target.value)}
              className="w-32"
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Date</label>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Hour</label>
            <Select value={selectedHour} onValueChange={setSelectedHour}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => (
                  <SelectItem key={i} value={i.toString()}>
                    {i.toString().padStart(2, "0")}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* ─── Demand Forecast Tab ──────────────────────────────────────────── */}
      {activeTab === "demand" && (
        <div className="space-y-4">
          {!selectedCityId ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Enter a City ID to view demand predictions
              </CardContent>
            </Card>
          ) : demandQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : demandQuery.data?.zones?.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Total Predicted Trips</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">
                      {demandQuery.data.zones
                        .reduce((s: number, z: any) => s + z.predictedTrips, 0)
                        .toFixed(1)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Active Zones</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{demandQuery.data.zones.length}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Avg Confidence</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">
                      {(
                        (demandQuery.data.zones.reduce((s: number, z: any) => s + z.confidence, 0) /
                          demandQuery.data.zones.length) *
                        100
                      ).toFixed(0)}
                      %
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Demand by Zone
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Zone</TableHead>
                        <TableHead>Lat</TableHead>
                        <TableHead>Lng</TableHead>
                        <TableHead>Predicted Trips</TableHead>
                        <TableHead>Confidence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {demandQuery.data.zones.slice(0, 20).map((zone: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-sm">{zone.zone}</TableCell>
                          <TableCell>{zone.lat.toFixed(4)}</TableCell>
                          <TableCell>{zone.lng.toFixed(4)}</TableCell>
                          <TableCell>
                            <span className="font-semibold">{zone.predictedTrips}</span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={
                                zone.confidence >= 0.7
                                  ? "bg-emerald-500/10 text-emerald-400"
                                  : zone.confidence >= 0.4
                                  ? "bg-amber-500/10 text-amber-400"
                                  : "bg-red-500/10 text-red-400"
                              }
                            >
                              {(zone.confidence * 100).toFixed(0)}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No demand data available for this selection
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ─── Driver Positioning Tab ───────────────────────────────────────── */}
      {activeTab === "positioning" && (
        <div className="space-y-4">
          {!selectedCityId ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Enter a City ID to view optimal driver positions
              </CardContent>
            </Card>
          ) : positioningQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : positioningQuery.data?.positions?.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Zones Needing Coverage</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{positioningQuery.data.positions.length}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Total Drivers Recommended</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">
                      {positioningQuery.data.positions.reduce(
                        (s: number, p: any) => s + p.recommendedDrivers,
                        0
                      )}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Recommended Positions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Zone</TableHead>
                        <TableHead>Lat</TableHead>
                        <TableHead>Lng</TableHead>
                        <TableHead>Recommended Drivers</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {positioningQuery.data.positions.map((pos: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-sm">{pos.zone}</TableCell>
                          <TableCell>{pos.lat.toFixed(4)}</TableCell>
                          <TableCell>{pos.lng.toFixed(4)}</TableCell>
                          <TableCell>
                            <Badge>{pos.recommendedDrivers}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {pos.reason}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No positioning data available for this selection
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ─── Fraud Alerts Tab ─────────────────────────────────────────────── */}
      {activeTab === "fraud" && (
        <div className="space-y-4">
          <div className="flex gap-4 items-end">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Status Filter</label>
              <Select value={fraudFilter} onValueChange={setFraudFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="INVESTIGATING">Investigating</SelectItem>
                  <SelectItem value="RESOLVED">Resolved</SelectItem>
                  <SelectItem value="DISMISSED">Dismissed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Summary cards */}
          {fraudQuery.data?.summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Open Alerts</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-red-400">
                    {fraudQuery.data.summary
                      .filter((s: any) => s.status === "OPEN")
                      .reduce((a: number, s: any) => a + s.count, 0)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Critical</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-red-400">
                    {fraudQuery.data.summary
                      .filter((s: any) => s.severity === "CRITICAL" && s.status === "OPEN")
                      .reduce((a: number, s: any) => a + s.count, 0)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Investigating</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-amber-400">
                    {fraudQuery.data.summary
                      .filter((s: any) => s.status === "INVESTIGATING")
                      .reduce((a: number, s: any) => a + s.count, 0)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Resolved</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-emerald-400">
                    {fraudQuery.data.summary
                      .filter((s: any) => s.status === "RESOLVED")
                      .reduce((a: number, s: any) => a + s.count, 0)}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Alerts table */}
          {fraudQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5" />
                  Fraud Alerts
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fraudQuery.data?.alerts?.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Severity</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fraudQuery.data.alerts.map((alert: any) => (
                        <TableRow key={alert.id}>
                          <TableCell>{severityBadge(alert.severity)}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {alert.alertType.replace(/_/g, " ")}
                          </TableCell>
                          <TableCell className="max-w-md truncate text-sm">
                            {alert.description}
                          </TableCell>
                          <TableCell>{statusBadge(alert.status)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(alert.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {alert.status === "OPEN" && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      updateAlertMutation.mutate({
                                        id: alert.id,
                                        status: "INVESTIGATING",
                                      })
                                    }
                                    disabled={updateAlertMutation.isPending}
                                  >
                                    <Eye className="h-3 w-3 mr-1" />
                                    Investigate
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      updateAlertMutation.mutate({
                                        id: alert.id,
                                        status: "DISMISSED",
                                      })
                                    }
                                    disabled={updateAlertMutation.isPending}
                                  >
                                    <XCircle className="h-3 w-3" />
                                  </Button>
                                </>
                              )}
                              {alert.status === "INVESTIGATING" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    updateAlertMutation.mutate({
                                      id: alert.id,
                                      status: "RESOLVED",
                                    })
                                  }
                                  disabled={updateAlertMutation.isPending}
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Resolve
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-center py-8 text-muted-foreground">
                    No fraud alerts found
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
