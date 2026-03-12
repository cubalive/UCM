import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Package,
  Truck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ShieldAlert,
  Thermometer,
  MapPin,
  User,
  UserPlus,
  RefreshCw,
  Search,
  Pill,
  ChevronRight,
  XCircle,
  Loader2,
} from "lucide-react";

// --- Types ---

interface PharmacyDelivery {
  id: number;
  publicId: string;
  pharmacyName: string;
  priority: "STAT" | "URGENT" | "EXPRESS" | "STANDARD";
  recipientName: string;
  deliveryAddress: string;
  status: string;
  isControlledSubstance: boolean;
  temperatureRequirement: string; // AMBIENT | COLD | FROZEN
  assignedDriverId: number | null;
  assignedDriverName: string | null;
  createdAt: string;
  notes: string | null;
  estimatedDeliveryTime: string | null;
}

interface AvailableDriver {
  id: number;
  name: string;
  vehicleType: string;
  currentLocation: string | null;
  activeDeliveries: number;
}

// --- Status config ---

const DELIVERY_STATUSES: Record<string, { label: string; color: string; bgColor: string; dotColor: string }> = {
  READY_FOR_PICKUP: {
    label: "Awaiting Assignment",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10 border-yellow-500/30",
    dotColor: "bg-yellow-400",
  },
  DRIVER_ASSIGNED: {
    label: "Driver Assigned",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10 border-blue-500/30",
    dotColor: "bg-blue-400",
  },
  EN_ROUTE_PICKUP: {
    label: "En Route to Pickup",
    color: "text-indigo-400",
    bgColor: "bg-indigo-500/10 border-indigo-500/30",
    dotColor: "bg-indigo-400",
  },
  PICKED_UP: {
    label: "Picked Up",
    color: "text-violet-400",
    bgColor: "bg-violet-500/10 border-violet-500/30",
    dotColor: "bg-violet-400",
  },
  EN_ROUTE_DELIVERY: {
    label: "En Route to Delivery",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10 border-purple-500/30",
    dotColor: "bg-purple-400",
  },
  DELIVERED: {
    label: "Delivered",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10 border-emerald-500/30",
    dotColor: "bg-emerald-400",
  },
  FAILED: {
    label: "Failed",
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/30",
    dotColor: "bg-red-400",
  },
};

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  STAT: { label: "STAT", className: "bg-red-500/20 text-red-400 border-red-500/40" },
  URGENT: { label: "URGENT", className: "bg-orange-500/20 text-orange-400 border-orange-500/40" },
  EXPRESS: { label: "EXPRESS", className: "bg-blue-500/20 text-blue-400 border-blue-500/40" },
  STANDARD: { label: "STANDARD", className: "bg-gray-500/20 text-gray-400 border-gray-500/40" },
};

const FILTER_TABS = [
  { key: "all", label: "All" },
  { key: "awaiting", label: "Awaiting Assignment" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
] as const;

type FilterTab = (typeof FILTER_TABS)[number]["key"];

const STATUS_PROGRESSION = [
  "READY_FOR_PICKUP",
  "DRIVER_ASSIGNED",
  "EN_ROUTE_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_DELIVERY",
  "DELIVERED",
];

function getNextStatus(current: string): string | null {
  const idx = STATUS_PROGRESSION.indexOf(current);
  if (idx === -1 || idx >= STATUS_PROGRESSION.length - 1) return null;
  return STATUS_PROGRESSION[idx + 1];
}

// --- Component ---

export default function DispatchPharmacyDeliveries() {
  const { token, selectedCity } = useAuth();
  const cityId = selectedCity?.id;
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<number | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");

  // Fetch deliveries
  const { data: deliveries, isLoading, refetch } = useQuery<PharmacyDelivery[]>({
    queryKey: ["/api/dispatch/pharmacy-deliveries", cityId, activeTab],
    queryFn: () => {
      const params = new URLSearchParams();
      if (cityId) params.set("cityId", String(cityId));
      if (activeTab !== "all") params.set("filter", activeTab);
      return apiFetch(`/api/dispatch/pharmacy-deliveries?${params.toString()}`, token);
    },
    enabled: !!token,
    refetchInterval: 30000,
  });

  // Fetch available drivers for assignment
  const { data: availableDrivers } = useQuery<AvailableDriver[]>({
    queryKey: ["/api/dispatch/pharmacy-deliveries/available-drivers", cityId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (cityId) params.set("cityId", String(cityId));
      return apiFetch(`/api/dispatch/pharmacy-deliveries/available-drivers?${params.toString()}`, token);
    },
    enabled: !!token && assignModalOpen,
  });

  // Assign driver mutation
  const assignMutation = useMutation({
    mutationFn: async ({ deliveryId, driverId }: { deliveryId: number; driverId: number }) => {
      const res = await apiRequest("POST", `/api/dispatch/pharmacy-deliveries/${deliveryId}/assign`, {
        driverId,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Driver assigned", description: "The delivery has been assigned successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/pharmacy-deliveries"] });
      setAssignModalOpen(false);
      setSelectedDeliveryId(null);
      setSelectedDriverId("");
    },
    onError: (err: Error) => {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    },
  });

  // Status update mutation
  const statusMutation = useMutation({
    mutationFn: async ({ deliveryId, status }: { deliveryId: number; status: string }) => {
      const res = await apiRequest("POST", `/api/dispatch/pharmacy-deliveries/${deliveryId}/status`, {
        status,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Status updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/pharmacy-deliveries"] });
    },
    onError: (err: Error) => {
      toast({ title: "Status update failed", description: err.message, variant: "destructive" });
    },
  });

  // Filter deliveries
  const filtered = (deliveries ?? []).filter((d) => {
    // Tab filter
    if (activeTab === "awaiting" && d.status !== "READY_FOR_PICKUP") return false;
    if (activeTab === "in_progress" && !["DRIVER_ASSIGNED", "EN_ROUTE_PICKUP", "PICKED_UP", "EN_ROUTE_DELIVERY"].includes(d.status)) return false;
    if (activeTab === "completed" && d.status !== "DELIVERED") return false;

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        d.publicId.toLowerCase().includes(q) ||
        d.pharmacyName.toLowerCase().includes(q) ||
        d.recipientName.toLowerCase().includes(q) ||
        d.deliveryAddress.toLowerCase().includes(q) ||
        (d.assignedDriverName && d.assignedDriverName.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Summary stats
  const all = deliveries ?? [];
  const totalPending = all.filter((d) => d.status === "READY_FOR_PICKUP").length;
  const inTransit = all.filter((d) =>
    ["DRIVER_ASSIGNED", "EN_ROUTE_PICKUP", "PICKED_UP", "EN_ROUTE_DELIVERY"].includes(d.status)
  ).length;
  const deliveredToday = all.filter((d) => {
    if (d.status !== "DELIVERED") return false;
    const today = new Date().toISOString().slice(0, 10);
    return d.createdAt?.slice(0, 10) === today;
  }).length;
  const failed = all.filter((d) => d.status === "FAILED").length;

  function openAssignModal(deliveryId: number) {
    setSelectedDeliveryId(deliveryId);
    setSelectedDriverId("");
    setAssignModalOpen(true);
  }

  function handleAssign() {
    if (!selectedDeliveryId || !selectedDriverId) return;
    assignMutation.mutate({ deliveryId: selectedDeliveryId, driverId: Number(selectedDriverId) });
  }

  function handleAdvanceStatus(delivery: PharmacyDelivery) {
    const next = getNextStatus(delivery.status);
    if (!next) return;
    statusMutation.mutate({ deliveryId: delivery.id, status: next });
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-gray-100">
      {/* Header */}
      <div className="border-b border-[#1e293b] bg-[#111827]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/30">
                <Pill className="h-5 w-5 text-violet-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Pharmacy Deliveries</h1>
                <p className="text-sm text-gray-400">Dispatch management for pharmacy orders</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="bg-[#111827] border-[#1e293b] text-gray-300 hover:bg-[#1e293b] hover:text-white"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 text-yellow-400 mb-1">
                <Clock className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wide">Pending</span>
              </div>
              <p className="text-2xl font-bold text-white">{totalPending}</p>
            </div>
            <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 text-violet-400 mb-1">
                <Truck className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wide">In Transit</span>
              </div>
              <p className="text-2xl font-bold text-white">{inTransit}</p>
            </div>
            <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 text-emerald-400 mb-1">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wide">Delivered Today</span>
              </div>
              <p className="text-2xl font-bold text-white">{deliveredToday}</p>
            </div>
            <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 text-red-400 mb-1">
                <XCircle className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wide">Failed</span>
              </div>
              <p className="text-2xl font-bold text-white">{failed}</p>
            </div>
          </div>

          {/* Filter tabs + search */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex gap-1 bg-[#0a0f1e] border border-[#1e293b] rounded-lg p-1">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    activeTab === tab.key
                      ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                      : "text-gray-400 hover:text-gray-200 border border-transparent"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <Input
                placeholder="Search orders, pharmacies, drivers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-[#0a0f1e] border-[#1e293b] text-gray-200 placeholder:text-gray-500 focus:border-violet-500/50 focus:ring-violet-500/20"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Delivery list */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-36 bg-[#111827] rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Package className="h-12 w-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 text-lg">No pharmacy deliveries found</p>
            <p className="text-gray-500 text-sm mt-1">
              {activeTab !== "all"
                ? "Try switching to a different tab or adjusting your search."
                : "Pharmacy orders needing dispatch will appear here."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((delivery) => {
              const statusConfig = DELIVERY_STATUSES[delivery.status] ?? {
                label: delivery.status,
                color: "text-gray-400",
                bgColor: "bg-gray-500/10 border-gray-500/30",
                dotColor: "bg-gray-400",
              };
              const priorityConfig = PRIORITY_CONFIG[delivery.priority] ?? PRIORITY_CONFIG.STANDARD;
              const nextStatus = getNextStatus(delivery.status);

              return (
                <Card
                  key={delivery.id}
                  className="bg-[#111827] border-[#1e293b] hover:border-violet-500/30 transition-colors"
                >
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      {/* Left: order info */}
                      <div className="flex-1 min-w-0 space-y-3">
                        {/* Top row: ID, pharmacy, priority, badges */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-violet-400">
                            {delivery.publicId}
                          </span>
                          <span className="text-gray-500">|</span>
                          <span className="text-sm font-medium text-gray-200">{delivery.pharmacyName}</span>

                          <Badge
                            variant="outline"
                            className={`text-xs ${priorityConfig.className}`}
                          >
                            {priorityConfig.label}
                          </Badge>

                          {delivery.isControlledSubstance && (
                            <Badge
                              variant="outline"
                              className="text-xs bg-red-500/10 text-red-400 border-red-500/30 gap-1"
                            >
                              <ShieldAlert className="h-3 w-3" />
                              Controlled
                            </Badge>
                          )}

                          {delivery.temperatureRequirement && delivery.temperatureRequirement !== "AMBIENT" && (
                            <Badge
                              variant="outline"
                              className="text-xs bg-cyan-500/10 text-cyan-400 border-cyan-500/30 gap-1"
                            >
                              <Thermometer className="h-3 w-3" />
                              {delivery.temperatureRequirement === "COLD"
                                ? "Cold Chain"
                                : delivery.temperatureRequirement === "FROZEN"
                                ? "Frozen"
                                : delivery.temperatureRequirement}
                            </Badge>
                          )}
                        </div>

                        {/* Recipient and address */}
                        <div className="flex flex-col sm:flex-row gap-3 text-sm">
                          <div className="flex items-center gap-2 text-gray-300">
                            <User className="h-4 w-4 text-gray-500 shrink-0" />
                            <span className="truncate">{delivery.recipientName}</span>
                          </div>
                          <div className="flex items-center gap-2 text-gray-400">
                            <MapPin className="h-4 w-4 text-gray-500 shrink-0" />
                            <span className="truncate">{delivery.deliveryAddress}</span>
                          </div>
                        </div>

                        {/* Notes */}
                        {delivery.notes && (
                          <p className="text-xs text-gray-500 italic truncate">
                            Note: {delivery.notes}
                          </p>
                        )}

                        {/* Status + driver */}
                        <div className="flex flex-wrap items-center gap-3">
                          <div
                            className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border ${statusConfig.bgColor}`}
                          >
                            <span className={`h-2 w-2 rounded-full ${statusConfig.dotColor} animate-pulse`} />
                            <span className={statusConfig.color}>{statusConfig.label}</span>
                          </div>

                          {delivery.assignedDriverName ? (
                            <div className="flex items-center gap-1.5 text-sm text-gray-300">
                              <User className="h-3.5 w-3.5 text-violet-400" />
                              {delivery.assignedDriverName}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-500 italic">Unassigned</span>
                          )}
                        </div>
                      </div>

                      {/* Right: actions */}
                      <div className="flex sm:flex-col gap-2 shrink-0">
                        {!delivery.assignedDriverId && (
                          <Button
                            size="sm"
                            onClick={() => openAssignModal(delivery.id)}
                            className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
                          >
                            <UserPlus className="h-4 w-4" />
                            Assign
                          </Button>
                        )}

                        {delivery.assignedDriverId && delivery.status !== "DELIVERED" && delivery.status !== "FAILED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAssignModal(delivery.id)}
                            className="bg-transparent border-[#1e293b] text-gray-300 hover:bg-[#1e293b] hover:text-white gap-1.5"
                          >
                            <UserPlus className="h-4 w-4" />
                            Reassign
                          </Button>
                        )}

                        {nextStatus && delivery.assignedDriverId && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAdvanceStatus(delivery)}
                            disabled={statusMutation.isPending}
                            className="bg-transparent border-violet-500/30 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300 gap-1.5"
                          >
                            {statusMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                            {DELIVERY_STATUSES[nextStatus]?.label ?? nextStatus}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Assign Driver Modal */}
      <Dialog open={assignModalOpen} onOpenChange={setAssignModalOpen}>
        <DialogContent className="bg-[#111827] border-[#1e293b] text-gray-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-violet-400" />
              Assign Driver
            </DialogTitle>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {selectedDeliveryId && (
              <p className="text-sm text-gray-400">
                Select a driver for delivery{" "}
                <span className="text-violet-400 font-mono font-medium">
                  {filtered.find((d) => d.id === selectedDeliveryId)?.publicId ?? `#${selectedDeliveryId}`}
                </span>
              </p>
            )}

            <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
              <SelectTrigger className="bg-[#0a0f1e] border-[#1e293b] text-gray-200 focus:ring-violet-500/30">
                <SelectValue placeholder="Select a driver..." />
              </SelectTrigger>
              <SelectContent className="bg-[#111827] border-[#1e293b]">
                {availableDrivers && availableDrivers.length > 0 ? (
                  availableDrivers.map((driver) => (
                    <SelectItem
                      key={driver.id}
                      value={String(driver.id)}
                      className="text-gray-200 focus:bg-violet-500/10 focus:text-violet-300"
                    >
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-gray-400" />
                        <span>{driver.name}</span>
                        <span className="text-xs text-gray-500">
                          {driver.vehicleType} | {driver.activeDeliveries} active
                        </span>
                      </div>
                    </SelectItem>
                  ))
                ) : (
                  <div className="px-3 py-6 text-center text-gray-500 text-sm">
                    {availableDrivers ? "No drivers available" : "Loading drivers..."}
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setAssignModalOpen(false)}
              className="bg-transparent border-[#1e293b] text-gray-300 hover:bg-[#1e293b]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              disabled={!selectedDriverId || assignMutation.isPending}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {assignMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Assigning...
                </>
              ) : (
                "Assign Driver"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
