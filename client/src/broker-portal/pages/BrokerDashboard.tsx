import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import {
  FileText,
  Clock,
  CheckCircle,
  DollarSign,
  Handshake,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { Link } from "wouter";

export default function BrokerDashboard() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["/api/broker/dashboard"],
    queryFn: async () => {
      const res = await fetch(resolveUrl("/api/broker/dashboard"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    retry: 2,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 animate-pulse h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-white mb-1">Failed to Load Dashboard</h3>
          <p className="text-sm text-gray-400">{(error as Error)?.message || "Something went wrong. Please try again."}</p>
        </div>
      </div>
    );
  }

  const summary = data?.summary || {};

  const statsCards = [
    { label: "Total Requests (30d)", value: summary.totalRequests30d || 0, icon: FileText, color: "blue" },
    { label: "Open / Bidding", value: summary.openRequests || 0, icon: Clock, color: "amber" },
    { label: "Awarded", value: summary.awardedRequests || 0, icon: TrendingUp, color: "emerald" },
    { label: "In Progress", value: summary.inProgressRequests || 0, icon: TrendingUp, color: "cyan" },
    { label: "Completed", value: summary.completedRequests || 0, icon: CheckCircle, color: "green" },
    { label: "Cancelled", value: summary.cancelledRequests || 0, icon: AlertTriangle, color: "red" },
    { label: "Active Contracts", value: summary.activeContracts || 0, icon: Handshake, color: "purple" },
    { label: "Pending Settlements", value: `$${Number(summary.pendingSettlementAmount || 0).toLocaleString()}`, icon: DollarSign, color: "orange" },
  ];

  const colorMap: Record<string, string> = {
    blue: "from-blue-500/20 to-blue-600/5 border-blue-500/20 text-blue-400",
    amber: "from-amber-500/20 to-amber-600/5 border-amber-500/20 text-amber-400",
    emerald: "from-emerald-500/20 to-emerald-600/5 border-emerald-500/20 text-emerald-400",
    cyan: "from-cyan-500/20 to-cyan-600/5 border-cyan-500/20 text-cyan-400",
    green: "from-green-500/20 to-green-600/5 border-green-500/20 text-green-400",
    red: "from-red-500/20 to-red-600/5 border-red-500/20 text-red-400",
    purple: "from-purple-500/20 to-purple-600/5 border-purple-500/20 text-purple-400",
    orange: "from-orange-500/20 to-orange-600/5 border-orange-500/20 text-orange-400",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Broker Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">Transportation marketplace overview</p>
        </div>
        <Link href="/trip-requests/new">
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
            <FileText className="w-4 h-4" />
            New Trip Request
          </button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className={`bg-gradient-to-br ${colorMap[color]} border rounded-xl p-4`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">{label}</p>
                <p className="text-2xl font-bold mt-1">{value}</p>
              </div>
              <Icon className="w-8 h-8 opacity-40" />
            </div>
          </div>
        ))}
      </div>

      {/* Recent Trip Requests */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl">
        <div className="p-4 border-b border-[#1e293b] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Recent Trip Requests</h2>
          <Link href="/trip-requests">
            <button className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              View All <ArrowRight className="w-3 h-3" />
            </button>
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs uppercase">
                <th className="text-left p-3">ID</th>
                <th className="text-left p-3">Member</th>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Pickup</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e293b]">
              {(data?.recentRequests || []).slice(0, 10).map((req: any) => (
                <tr key={req.id} className="hover:bg-white/5 transition-colors">
                  <td className="p-3">
                    <Link href={`/trip-requests/${req.id}`}>
                      <span className="text-blue-400 hover:underline cursor-pointer font-mono text-xs">{req.publicId}</span>
                    </Link>
                  </td>
                  <td className="p-3 text-white">{req.memberName}</td>
                  <td className="p-3 text-gray-400">{req.requestedDate}</td>
                  <td className="p-3 text-gray-400 max-w-[200px] truncate">{req.pickupAddress}</td>
                  <td className="p-3">
                    <StatusBadge status={req.status} />
                  </td>
                  <td className="p-3">
                    <PriorityBadge priority={req.priority} />
                  </td>
                </tr>
              ))}
              {(!data?.recentRequests || data.recentRequests.length === 0) && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
                    No trip requests yet. Create your first one to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    OPEN: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    BIDDING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    AWARDED: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    ASSIGNED: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    IN_PROGRESS: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
    COMPLETED: "bg-green-500/20 text-green-400 border-green-500/30",
    CANCELLED: "bg-red-500/20 text-red-400 border-red-500/30",
    EXPIRED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    DISPUTED: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${styles[status] || styles.OPEN}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    STANDARD: "text-gray-400",
    HIGH: "text-amber-400",
    URGENT: "text-red-400",
    STAT: "text-red-500 font-bold",
  };
  return <span className={`text-xs ${styles[priority] || styles.STANDARD}`}>{priority}</span>;
}
