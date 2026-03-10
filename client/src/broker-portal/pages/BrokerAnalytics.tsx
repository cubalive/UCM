import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { BarChart3, TrendingUp, Users, DollarSign } from "lucide-react";

export default function BrokerAnalytics() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/analytics"],
    queryFn: async () => {
      const res = await fetch(resolveUrl("/api/broker/analytics"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-[#1e293b] rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 h-32 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const metrics = data?.monthlyMetrics || [];
  const bidStats = data?.bidStats || {};
  const topCompanies = data?.topCompanies || [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5" /> Analytics
        </h1>
        <p className="text-sm text-gray-400 mt-1">Broker performance metrics & insights</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-green-400" />
            <p className="text-xs text-gray-500 uppercase">Avg Bid Amount</p>
          </div>
          <p className="text-2xl font-bold text-white">
            {bidStats.avgBidAmount ? `$${Number(bidStats.avgBidAmount).toFixed(2)}` : "-"}
          </p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <p className="text-xs text-gray-500 uppercase">Total Bids</p>
          </div>
          <p className="text-2xl font-bold text-white">{bidStats.totalBids || 0}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-purple-400" />
            <p className="text-xs text-gray-500 uppercase">Active Partners</p>
          </div>
          <p className="text-2xl font-bold text-white">{topCompanies.length}</p>
        </div>
      </div>

      {/* Monthly metrics */}
      {metrics.length > 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4">Monthly Performance</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase border-b border-[#1e293b]">
                  <th className="text-left p-2">Period</th>
                  <th className="text-right p-2">Requests</th>
                  <th className="text-right p-2">Awarded</th>
                  <th className="text-right p-2">Completed</th>
                  <th className="text-right p-2">Cancelled</th>
                  <th className="text-right p-2">Award Rate</th>
                  <th className="text-right p-2">Completion Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e293b]">
                {metrics.map((m: any) => {
                  const awardRate = m.totalRequests > 0 ? ((m.totalAwarded / m.totalRequests) * 100).toFixed(1) : "0";
                  const completionRate = m.totalAwarded > 0 ? ((m.totalCompleted / m.totalAwarded) * 100).toFixed(1) : "0";
                  return (
                    <tr key={m.id} className="hover:bg-white/5">
                      <td className="p-2 text-white">{m.period}</td>
                      <td className="p-2 text-right text-gray-400">{m.totalRequests}</td>
                      <td className="p-2 text-right text-gray-400">{m.totalAwarded}</td>
                      <td className="p-2 text-right text-green-400">{m.totalCompleted}</td>
                      <td className="p-2 text-right text-red-400">{m.totalCancelled}</td>
                      <td className="p-2 text-right text-blue-400">{awardRate}%</td>
                      <td className="p-2 text-right text-emerald-400">{completionRate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top companies */}
      {topCompanies.length > 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4">Top Transport Partners</h2>
          <div className="space-y-3">
            {topCompanies.map((company: any, idx: number) => (
              <div key={company.companyId} className="flex items-center justify-between p-3 bg-[#0f172a] rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                    {idx + 1}
                  </div>
                  <p className="text-sm text-white">{company.companyName || `Company #${company.companyId}`}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-white">{company.tripCount} trips</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {metrics.length === 0 && topCompanies.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No analytics data available yet.</p>
          <p className="text-sm mt-1">Start creating trip requests to generate performance data.</p>
        </div>
      )}
    </div>
  );
}
