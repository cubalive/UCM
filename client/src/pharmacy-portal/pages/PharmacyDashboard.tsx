import { useQuery } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  Package,
  Truck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import { Link } from "wouter";

interface DashboardData {
  today: string;
  summary: {
    totalToday: number;
    delivered: number;
    inTransit: number;
    pending: number;
    failed: number;
    deliveryRate: number;
  };
  statusBreakdown: Record<string, number>;
  recentOrders: any[];
}

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  subtitle,
}: {
  title: string;
  value: number | string;
  icon: any;
  color: string;
  subtitle?: string;
}) {
  const colorMap: Record<string, string> = {
    violet: "from-violet-500/10 to-purple-500/10 border-violet-500/20 text-violet-400",
    emerald: "from-emerald-500/10 to-teal-500/10 border-emerald-500/20 text-emerald-400",
    blue: "from-blue-500/10 to-cyan-500/10 border-blue-500/20 text-blue-400",
    amber: "from-amber-500/10 to-orange-500/10 border-amber-500/20 text-amber-400",
    red: "from-red-500/10 to-rose-500/10 border-red-500/20 text-red-400",
  };

  return (
    <div className={`bg-gradient-to-br ${colorMap[color]} border rounded-xl p-5`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-gray-400 font-medium">{title}</span>
        <Icon className="w-5 h-5 opacity-60" />
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
    </div>
  );
}

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
  STAT: "bg-red-600/20 text-red-400 animate-pulse",
};

export default function PharmacyDashboard() {
  const { token } = useAuth();

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/pharmacy/dashboard"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-20 mb-3" />
              <div className="h-8 bg-gray-700 rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const summary = data?.summary || { totalToday: 0, delivered: 0, inTransit: 0, pending: 0, failed: 0, deliveryRate: 0 };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Pharmacy Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">
            Real-time delivery overview — {data?.today || "Today"}
          </p>
        </div>
        <Link href="/orders/new">
          <button className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
            <Package className="w-4 h-4" />
            New Delivery
          </button>
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Total Today" value={summary.totalToday} icon={Package} color="violet" />
        <StatCard title="Delivered" value={summary.delivered} icon={CheckCircle2} color="emerald" subtitle={`${summary.deliveryRate}% success rate`} />
        <StatCard title="In Transit" value={summary.inTransit} icon={Truck} color="blue" />
        <StatCard title="Pending" value={summary.pending} icon={Clock} color="amber" />
        <StatCard title="Failed" value={summary.failed} icon={AlertTriangle} color="red" />
      </div>

      {/* Recent Orders */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl">
        <div className="px-5 py-4 border-b border-[#1e293b] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Today's Orders</h2>
          <Link href="/orders">
            <span className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 cursor-pointer">
              View all <ArrowRight className="w-3 h-3" />
            </span>
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e293b]">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipient</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
              </tr>
            </thead>
            <tbody>
              {(!data?.recentOrders || data.recentOrders.length === 0) ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-gray-500 text-sm">
                    No orders today yet. Create your first delivery order.
                  </td>
                </tr>
              ) : (
                data.recentOrders.map((order: any) => (
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
                      <p className="text-xs text-gray-500 truncate max-w-[200px]">{order.deliveryAddress}</p>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-400">
                      {order.itemCount} item{order.itemCount !== 1 ? "s" : ""}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${PRIORITY_BADGES[order.priority] || PRIORITY_BADGES.STANDARD}`}>
                        {order.priority}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium border ${STATUS_COLORS[order.status] || STATUS_COLORS.PENDING}`}>
                        {order.status.replace(/_/g, " ")}
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
      </div>

      {/* Delivery Rate Progress */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-violet-400" />
            Today's Delivery Performance
          </h3>
          <span className="text-2xl font-bold text-emerald-400">{summary.deliveryRate}%</span>
        </div>
        <div className="w-full bg-[#1e293b] rounded-full h-3">
          <div
            className="bg-gradient-to-r from-violet-500 to-emerald-500 h-3 rounded-full transition-all duration-500"
            style={{ width: `${summary.deliveryRate}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-gray-600">
          <span>{summary.delivered} delivered</span>
          <span>{summary.totalToday} total</span>
        </div>
      </div>
    </div>
  );
}
