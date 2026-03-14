import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { Link } from "wouter";
import { Plus, Search, Filter } from "lucide-react";

const STATUSES = ["ALL", "OPEN", "BIDDING", "AWARDED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED", "DISPUTED"];

export default function BrokerTripRequests() {
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/trip-requests", status, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (status !== "ALL") params.set("status", status);
      const res = await fetch(resolveUrl(`/api/broker/trip-requests?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Trip Requests</h1>
        <Link href="/trip-requests/new">
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Request
          </button>
        </Link>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => { setStatus(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              status === s
                ? "bg-blue-600 text-white"
                : "bg-[#1e293b] text-gray-400 hover:text-white"
            }`}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs uppercase border-b border-[#1e293b]">
              <th scope="col" className="text-left p-3">ID</th>
              <th scope="col" className="text-left p-3">Member</th>
              <th scope="col" className="text-left p-3">Date</th>
              <th scope="col" className="text-left p-3">Time</th>
              <th scope="col" className="text-left p-3">Service</th>
              <th scope="col" className="text-left p-3">Status</th>
              <th scope="col" className="text-left p-3">Priority</th>
              <th scope="col" className="text-left p-3">Budget</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e293b]">
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}>
                  <td colSpan={8} className="p-3"><div className="h-4 bg-[#1e293b] rounded animate-pulse" /></td>
                </tr>
              ))
            ) : (data?.requests || []).map((req: any) => (
              <tr key={req.id} className="hover:bg-white/5 transition-colors">
                <td className="p-3">
                  <Link href={`/trip-requests/${req.id}`}>
                    <span className="text-blue-400 hover:underline cursor-pointer font-mono text-xs">{req.publicId}</span>
                  </Link>
                </td>
                <td className="p-3 text-white">{req.memberName}</td>
                <td className="p-3 text-gray-400">{req.requestedDate}</td>
                <td className="p-3 text-gray-400">{req.requestedPickupTime}</td>
                <td className="p-3 text-gray-400 capitalize">{req.serviceType}</td>
                <td className="p-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${getStatusStyle(req.status)}`}>
                    {req.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="p-3 text-gray-400">{req.priority}</td>
                <td className="p-3 text-gray-400">{req.maxBudget ? `$${Number(req.maxBudget).toFixed(2)}` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {data && data.total > 50 && (
          <div className="p-3 border-t border-[#1e293b] flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Showing {((page - 1) * 50) + 1}-{Math.min(page * 50, data.total)} of {data.total}
            </p>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 bg-[#1e293b] text-gray-400 rounded text-xs disabled:opacity-30"
              >
                Previous
              </button>
              <button
                disabled={page * 50 >= data.total}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 bg-[#1e293b] text-gray-400 rounded text-xs disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getStatusStyle(status: string): string {
  const map: Record<string, string> = {
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
  return map[status] || map.OPEN;
}
