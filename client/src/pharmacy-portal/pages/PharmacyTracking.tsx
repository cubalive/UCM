import { useQuery } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  Truck,
  MapPin,
  Package,
  Clock,
  Phone,
  Navigation,
  Radio,
} from "lucide-react";
import { Link } from "wouter";

const STATUS_LABELS: Record<string, { label: string; color: string; pulse: boolean }> = {
  DRIVER_ASSIGNED: { label: "Driver Assigned", color: "bg-cyan-500", pulse: false },
  EN_ROUTE_PICKUP: { label: "Heading to Pharmacy", color: "bg-blue-500", pulse: true },
  PICKED_UP: { label: "Package Picked Up", color: "bg-indigo-500", pulse: false },
  EN_ROUTE_DELIVERY: { label: "On the Way", color: "bg-violet-500", pulse: true },
};

export default function PharmacyTracking() {
  const { token } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/pharmacy/active-deliveries"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/active-deliveries`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const deliveries = data?.deliveries || [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Radio className="w-6 h-6 text-violet-400 animate-pulse" />
            Live Tracking
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            {deliveries.length} active deliver{deliveries.length !== 1 ? "ies" : "y"} in progress
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-32 mb-3" />
              <div className="h-20 bg-gray-800 rounded" />
            </div>
          ))}
        </div>
      ) : deliveries.length === 0 ? (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-16 text-center">
          <Truck className="w-16 h-16 mx-auto text-gray-700 mb-4" />
          <h3 className="text-lg font-medium text-gray-400">No Active Deliveries</h3>
          <p className="text-sm text-gray-600 mt-2">When orders are picked up by drivers, they'll appear here with live tracking.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {deliveries.map((delivery: any) => {
            const statusInfo = STATUS_LABELS[delivery.status] || { label: delivery.status, color: "bg-gray-500", pulse: false };
            const driver = delivery.driver;

            return (
              <div
                key={delivery.id}
                className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden hover:border-violet-500/30 transition-colors"
              >
                {/* Status bar */}
                <div className={`h-1 ${statusInfo.color}`} />

                <div className="p-5 space-y-4">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <Link href={`/orders/${delivery.id}`}>
                      <span className="text-sm font-mono text-violet-400 hover:text-violet-300 cursor-pointer font-medium">
                        {delivery.publicId}
                      </span>
                    </Link>
                    <div className="flex items-center gap-2">
                      {statusInfo.pulse && (
                        <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                      )}
                      <span className={`text-xs px-2.5 py-1 rounded-full text-white ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                    </div>
                  </div>

                  {/* Recipient */}
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm text-white">{delivery.recipientName}</p>
                      <p className="text-xs text-gray-500">{delivery.deliveryAddress}</p>
                    </div>
                  </div>

                  {/* Items summary */}
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Package className="w-3 h-3" />
                    {delivery.itemCount} item{delivery.itemCount !== 1 ? "s" : ""}
                    {delivery.itemsSummary && (
                      <span className="text-gray-600 truncate">— {delivery.itemsSummary}</span>
                    )}
                  </div>

                  {/* Driver */}
                  {driver && (
                    <div className="bg-[#0a0f1e] rounded-lg p-3 flex items-center gap-3">
                      <div className="w-9 h-9 bg-gradient-to-br from-violet-600 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0">
                        {driver.firstName[0]}{driver.lastName[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium">{driver.firstName} {driver.lastName}</p>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Phone className="w-3 h-3" />
                          {driver.phone}
                        </div>
                      </div>
                      {driver.lastLat && driver.lastLng && (
                        <div className="text-right shrink-0">
                          <div className="flex items-center gap-1 text-emerald-400 text-[10px]">
                            <Navigation className="w-3 h-3" />
                            GPS Active
                          </div>
                          <p className="text-[10px] text-gray-600 mt-0.5">
                            {driver.lastSeenAt
                              ? new Date(driver.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                              : "—"
                            }
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Timestamps */}
                  <div className="flex items-center gap-4 text-[10px] text-gray-600">
                    {delivery.assignedAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Assigned {new Date(delivery.assignedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                    {delivery.pickedUpAt && (
                      <span className="flex items-center gap-1">
                        <Package className="w-3 h-3" />
                        Picked up {new Date(delivery.pickedUpAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
