import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft,
  Package,
  Truck,
  User,
  MapPin,
  Phone,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Thermometer,
  ShieldCheck,
  FileText,
  Pill,
} from "lucide-react";

const STATUS_FLOW = [
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "DRIVER_ASSIGNED",
  "EN_ROUTE_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_DELIVERY",
  "DELIVERED",
];

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-500",
  CONFIRMED: "bg-blue-500",
  PREPARING: "bg-amber-500",
  READY_FOR_PICKUP: "bg-purple-500",
  DRIVER_ASSIGNED: "bg-cyan-500",
  EN_ROUTE_PICKUP: "bg-blue-500",
  PICKED_UP: "bg-indigo-500",
  EN_ROUTE_DELIVERY: "bg-violet-500",
  DELIVERED: "bg-emerald-500",
  FAILED: "bg-red-500",
  CANCELLED: "bg-gray-600",
};

const PHARMACY_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY_FOR_PICKUP", "CANCELLED"],
  READY_FOR_PICKUP: [],
};

export default function PharmacyOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/pharmacy/orders", id],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/orders/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load order");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ status, notes }: { status: string; notes?: string }) => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/orders/${id}/status`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/orders", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/dashboard"] });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-700 rounded w-48" />
          <div className="h-64 bg-gray-800 rounded-xl" />
        </div>
      </div>
    );
  }

  const order = data?.order;
  const items = data?.items || [];
  const events = data?.events || [];
  const driver = data?.driver;

  if (!order) {
    return (
      <div className="p-6 text-center text-gray-500">Order not found</div>
    );
  }

  const currentStepIndex = STATUS_FLOW.indexOf(order.status);
  const availableTransitions = PHARMACY_TRANSITIONS[order.status] || [];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Back button + Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate("/orders")}
          className="p-2 hover:bg-white/5 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white font-mono">{order.publicId}</h1>
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium text-white ${STATUS_COLORS[order.status]}`}>
              {order.status.replace(/_/g, " ")}
            </span>
            {order.priority !== "STANDARD" && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-600/20 text-amber-400">
                {order.priority}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Created {new Date(order.createdAt).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Status Progress */}
      {order.status !== "CANCELLED" && order.status !== "FAILED" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
          <h3 className="text-xs font-medium text-gray-500 uppercase mb-4">Delivery Progress</h3>
          <div className="flex items-center gap-1">
            {STATUS_FLOW.map((step, i) => {
              const isCompleted = i <= currentStepIndex;
              const isCurrent = i === currentStepIndex;
              return (
                <div key={step} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center flex-1">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold
                        ${isCurrent ? "bg-violet-500 text-white ring-2 ring-violet-500/30" : isCompleted ? "bg-emerald-500 text-white" : "bg-[#1e293b] text-gray-600"}
                      `}
                    >
                      {isCompleted && !isCurrent ? <CheckCircle2 className="w-3 h-3" /> : i + 1}
                    </div>
                    <span className={`text-[9px] mt-1 text-center leading-tight ${isCurrent ? "text-violet-400" : isCompleted ? "text-emerald-400" : "text-gray-600"}`}>
                      {step.replace(/_/g, " ")}
                    </span>
                  </div>
                  {i < STATUS_FLOW.length - 1 && (
                    <div className={`h-0.5 flex-1 ${isCompleted && i < currentStepIndex ? "bg-emerald-500" : "bg-[#1e293b]"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {availableTransitions.length > 0 && (
        <div className="flex gap-3">
          {availableTransitions.map((nextStatus) => (
            <button
              key={nextStatus}
              onClick={() => updateStatus.mutate({ status: nextStatus })}
              disabled={updateStatus.isPending}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                nextStatus === "CANCELLED"
                  ? "bg-red-600/10 text-red-400 border border-red-600/20 hover:bg-red-600/20"
                  : "bg-violet-600 text-white hover:bg-violet-700"
              }`}
            >
              {nextStatus === "CANCELLED" ? "Cancel Order" : `Mark as ${nextStatus.replace(/_/g, " ")}`}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Delivery Info */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <MapPin className="w-4 h-4 text-violet-400" />
            Delivery Details
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase text-gray-500 font-medium">Recipient</label>
              <p className="text-sm text-white flex items-center gap-2">
                <User className="w-3 h-3 text-gray-500" />
                {order.recipientName}
              </p>
              {order.recipientPhone && (
                <p className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
                  <Phone className="w-3 h-3 text-gray-500" />
                  {order.recipientPhone}
                </p>
              )}
            </div>
            <div>
              <label className="text-[10px] uppercase text-gray-500 font-medium">Pickup (Pharmacy)</label>
              <p className="text-xs text-gray-400">{order.pickupAddress}</p>
            </div>
            <div>
              <label className="text-[10px] uppercase text-gray-500 font-medium">Delivery Address</label>
              <p className="text-xs text-white">{order.deliveryAddress}</p>
            </div>
            {order.deliveryInstructions && (
              <div>
                <label className="text-[10px] uppercase text-gray-500 font-medium">Instructions</label>
                <p className="text-xs text-amber-400">{order.deliveryInstructions}</p>
              </div>
            )}
            <div className="flex gap-4">
              <div>
                <label className="text-[10px] uppercase text-gray-500 font-medium">Delivery Date</label>
                <p className="text-xs text-white">{order.requestedDeliveryDate}</p>
              </div>
              {order.requestedDeliveryWindow && (
                <div>
                  <label className="text-[10px] uppercase text-gray-500 font-medium">Window</label>
                  <p className="text-xs text-white">{order.requestedDeliveryWindow}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Requirements & Driver */}
        <div className="space-y-6">
          {/* Requirements */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-violet-400" />
              Requirements
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div className={`px-3 py-2 rounded-lg text-xs ${order.requiresSignature ? "bg-amber-500/10 text-amber-400" : "bg-gray-800 text-gray-500"}`}>
                <FileText className="w-3 h-3 inline mr-1" />
                Signature {order.requiresSignature ? "Required" : "Not required"}
              </div>
              <div className={`px-3 py-2 rounded-lg text-xs ${order.requiresIdVerification ? "bg-red-500/10 text-red-400" : "bg-gray-800 text-gray-500"}`}>
                <ShieldCheck className="w-3 h-3 inline mr-1" />
                ID Check {order.requiresIdVerification ? "Required" : "Not required"}
              </div>
              <div className={`px-3 py-2 rounded-lg text-xs ${order.isControlledSubstance ? "bg-red-500/10 text-red-400" : "bg-gray-800 text-gray-500"}`}>
                <Pill className="w-3 h-3 inline mr-1" />
                {order.isControlledSubstance ? "Controlled Substance" : "Non-controlled"}
              </div>
              <div className={`px-3 py-2 rounded-lg text-xs ${order.temperatureRequirement !== "AMBIENT" ? "bg-blue-500/10 text-blue-400" : "bg-gray-800 text-gray-500"}`}>
                <Thermometer className="w-3 h-3 inline mr-1" />
                {order.temperatureRequirement}
              </div>
            </div>
          </div>

          {/* Driver Info */}
          {driver && (
            <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Truck className="w-4 h-4 text-violet-400" />
                Assigned Driver
              </h3>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-violet-600 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                  {driver.firstName[0]}{driver.lastName[0]}
                </div>
                <div>
                  <p className="text-sm text-white font-medium">{driver.firstName} {driver.lastName}</p>
                  <p className="text-xs text-gray-400">{driver.phone}</p>
                </div>
                {driver.lastLat && driver.lastLng && (
                  <div className="ml-auto text-right">
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                      Live
                    </span>
                    <p className="text-[10px] text-gray-500">
                      Last seen {driver.lastSeenAt ? new Date(driver.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "N/A"}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Items */}
      {items.length > 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl">
          <div className="px-5 py-4 border-b border-[#1e293b]">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-violet-400" />
              Order Items ({items.length})
            </h3>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e293b]">
                <th className="px-5 py-2 text-left text-xs font-medium text-gray-500">Medication</th>
                <th className="px-5 py-2 text-left text-xs font-medium text-gray-500">NDC</th>
                <th className="px-5 py-2 text-left text-xs font-medium text-gray-500">Qty</th>
                <th className="px-5 py-2 text-left text-xs font-medium text-gray-500">Rx #</th>
                <th className="px-5 py-2 text-left text-xs font-medium text-gray-500">Flags</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any) => (
                <tr key={item.id} className="border-b border-[#1e293b]/50">
                  <td className="px-5 py-2 text-sm text-white">{item.medicationName}</td>
                  <td className="px-5 py-2 text-xs text-gray-400 font-mono">{item.ndc || "—"}</td>
                  <td className="px-5 py-2 text-sm text-gray-400">{item.quantity} {item.unit}</td>
                  <td className="px-5 py-2 text-xs text-gray-400 font-mono">{item.rxNumber || "—"}</td>
                  <td className="px-5 py-2 space-x-1">
                    {item.isControlled && <span className="text-[9px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">CTRL</span>}
                    {item.requiresRefrigeration && <span className="text-[9px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">COLD</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Timeline */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-violet-400" />
          Event Timeline
        </h3>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500">No events recorded yet</p>
        ) : (
          <div className="space-y-3">
            {events.map((event: any, i: number) => (
              <div key={event.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-2 h-2 rounded-full ${i === 0 ? "bg-violet-400" : "bg-gray-600"}`} />
                  {i < events.length - 1 && <div className="w-px h-8 bg-[#1e293b]" />}
                </div>
                <div className="flex-1 pb-2">
                  <p className="text-xs text-white">{event.description || event.eventType.replace(/_/g, " ")}</p>
                  <p className="text-[10px] text-gray-500">
                    {new Date(event.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
