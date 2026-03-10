import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import {
  Package,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

const STATUS_OPTIONS = [
  "ALL",
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "DRIVER_ASSIGNED",
  "EN_ROUTE_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_DELIVERY",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
];

const PRIORITY_OPTIONS = ["ALL", "STANDARD", "EXPRESS", "URGENT", "STAT"];

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  CONFIRMED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  PREPARING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  READY_FOR_PICKUP: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  DRIVER_ASSIGNED: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  EN_ROUTE_PICKUP: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  PICKED_UP: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  EN_ROUTE_DELIVERY: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  DELIVERED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  FAILED: "bg-red-500/10 text-red-400 border-red-500/20",
  CANCELLED: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

const PRIORITY_BADGES: Record<string, string> = {
  STANDARD: "bg-gray-700 text-gray-300",
  EXPRESS: "bg-blue-600/20 text-blue-400",
  URGENT: "bg-amber-600/20 text-amber-400",
  STAT: "bg-red-600/20 text-red-400",
};

export default function PharmacyOrders() {
  const { token } = useAuth();
  const [status, setStatus] = useState("ALL");
  const [priority, setPriority] = useState("ALL");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/pharmacy/orders", status, priority, date, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (status !== "ALL") params.set("status", status);
      if (priority !== "ALL") params.set("priority", priority);
      if (date) params.set("date", date);
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/orders?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load orders");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const orders = data?.orders || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / 25);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Orders</h1>
          <p className="text-sm text-gray-400">Manage pharmacy delivery orders</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-400"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <Link href="/orders/new">
            <button className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium flex items-center gap-2">
              <Package className="w-4 h-4" />
              New Order
            </button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-gray-500" />
        <input
          type="date"
          value={date}
          onChange={(e) => { setDate(e.target.value); setPage(1); }}
          className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s === "ALL" ? "All Statuses" : s.replace(/_/g, " ")}</option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => { setPriority(e.target.value); setPage(1); }}
          className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>{p === "ALL" ? "All Priorities" : p}</option>
          ))}
        </select>
        <span className="text-xs text-gray-500 ml-auto">{total} orders found</span>
      </div>

      {/* Table */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1e293b]">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order ID</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipient</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Delivery Address</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Temp</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-[#1e293b]/50">
                  <td colSpan={8} className="px-5 py-4">
                    <div className="h-4 bg-gray-700 rounded animate-pulse w-full" />
                  </td>
                </tr>
              ))
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-16 text-center text-gray-500">
                  <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No orders found for the selected filters</p>
                </td>
              </tr>
            ) : (
              orders.map((order: any) => (
                <tr key={order.id} className="border-b border-[#1e293b]/50 hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-3">
                    <Link href={`/orders/${order.id}`}>
                      <span className="text-sm font-mono text-violet-400 hover:text-violet-300 cursor-pointer">
                        {order.publicId}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-sm text-white">{order.recipientName}</p>
                    {order.recipientPhone && (
                      <p className="text-xs text-gray-500">{order.recipientPhone}</p>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-xs text-gray-400 truncate max-w-[200px]">{order.deliveryAddress}</p>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-400">
                    {order.itemCount}
                    {order.isControlledSubstance && (
                      <span className="ml-1 text-[9px] text-red-400 font-bold">CII</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${PRIORITY_BADGES[order.priority]}`}>
                      {order.priority}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium border ${STATUS_COLORS[order.status]}`}>
                      {order.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-gray-500">
                      {order.temperatureRequirement === "AMBIENT" ? "RT" : order.temperatureRequirement?.charAt(0)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">
                    {new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Page {page} of {totalPages} ({total} total)
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="p-2 rounded-lg bg-[#111827] border border-[#1e293b] text-gray-400 disabled:opacity-30 hover:bg-white/5"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="p-2 rounded-lg bg-[#111827] border border-[#1e293b] text-gray-400 disabled:opacity-30 hover:bg-white/5"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
