import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { Package, Clock, Truck, CheckCircle, XCircle, AlertTriangle, Pill } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-500/10 text-yellow-500",
  CONFIRMED: "bg-blue-500/10 text-blue-500",
  PREPARING: "bg-indigo-500/10 text-indigo-500",
  READY_FOR_PICKUP: "bg-cyan-500/10 text-cyan-500",
  IN_TRANSIT: "bg-violet-500/10 text-violet-500",
  DELIVERED: "bg-green-500/10 text-green-500",
  CANCELLED: "bg-red-500/10 text-red-500",
  FAILED: "bg-red-500/10 text-red-500",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PREPARING: "Preparing",
  READY_FOR_PICKUP: "Ready",
  IN_TRANSIT: "In Transit",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

const PRIORITY_COLORS: Record<string, string> = {
  STANDARD: "bg-gray-500/10 text-gray-500",
  URGENT: "bg-orange-500/10 text-orange-500",
  STAT: "bg-red-500/10 text-red-500",
};

export default function AdminPharmacyOrdersPage() {
  const [statusFilter, setStatusFilter] = useState("ALL");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/pharmacy-orders", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const res = await fetch(resolveUrl(`/api/admin/pharmacy-orders?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const orders = data?.orders || [];
  const stats = data?.stats || {};

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500">
          <Package className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Pharmacy Orders</h1>
          <p className="text-sm text-muted-foreground">Monitor all pharmacy delivery orders across the platform</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: "Total", value: stats.total || 0, icon: Package, color: "violet" },
          { label: "Pending", value: stats.pending || 0, icon: Clock, color: "yellow" },
          { label: "Confirmed", value: stats.confirmed || 0, icon: CheckCircle, color: "blue" },
          { label: "Ready", value: stats.readyForPickup || 0, icon: Pill, color: "cyan" },
          { label: "In Transit", value: stats.inTransit || 0, icon: Truck, color: "violet" },
          { label: "Delivered", value: stats.delivered || 0, icon: CheckCircle, color: "green" },
          { label: "Cancelled", value: stats.cancelled || 0, icon: XCircle, color: "red" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-3 flex items-center gap-2">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg bg-${s.color}-500/10`}>
                <s.icon className={`w-4 h-4 text-${s.color}-500`} />
              </div>
              <div>
                <p className="text-lg font-bold">{s.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {["ALL", "PENDING", "CONFIRMED", "READY_FOR_PICKUP", "IN_TRANSIT", "DELIVERED", "CANCELLED"].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => setStatusFilter(s)}
          >
            {s === "ALL" ? "All" : STATUS_LABELS[s] || s}
          </Button>
        ))}
      </div>

      {/* Orders List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading orders...</div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="w-12 h-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">No pharmacy orders found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {orders.map((o: any) => (
            <Card key={o.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold font-mono">{o.publicId}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_COLORS[o.status] || "bg-gray-500/10 text-gray-500"}`}>
                        {STATUS_LABELS[o.status] || o.status}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${PRIORITY_COLORS[o.priority] || "bg-gray-500/10 text-gray-500"}`}>
                        {o.priority}
                      </span>
                      {o.temperatureRequirement && o.temperatureRequirement !== "AMBIENT" && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-500">
                          {o.temperatureRequirement}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-muted-foreground">
                      <div>
                        <span className="text-xs text-muted-foreground/60">Pharmacy:</span>{" "}
                        <span className="font-medium text-foreground">{o.pharmacyName || "—"}</span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground/60">Recipient:</span>{" "}
                        <span className="font-medium text-foreground">{o.recipientName}</span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground/60">Delivery Date:</span>{" "}
                        <span className="font-medium text-foreground">{o.requestedDeliveryDate}</span>
                        {o.requestedDeliveryWindow && <span className="ml-1">({o.requestedDeliveryWindow})</span>}
                      </div>
                    </div>
                    {o.rxNumber && (
                      <p className="text-xs text-muted-foreground/60 mt-1">Rx: {o.rxNumber}</p>
                    )}
                    <div className="flex gap-4 mt-1 text-xs text-muted-foreground/60">
                      <span className="truncate max-w-[200px]">From: {o.pickupAddress}</span>
                      <span className="truncate max-w-[200px]">To: {o.deliveryAddress}</span>
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <p className="text-xs text-muted-foreground">
                      {o.createdAt ? new Date(o.createdAt).toLocaleDateString() : ""}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
