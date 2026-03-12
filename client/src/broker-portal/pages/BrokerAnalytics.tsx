import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import {
  BarChart3,
  TrendingUp,
  Users,
  DollarSign,
  Download,
  Calendar,
  MapPin,
  XCircle,
  AlertTriangle,
} from "lucide-react";

export default function BrokerAnalytics() {
  const [tab, setTab] = useState<"overview" | "enhanced">("overview");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/analytics"],
    queryFn: async () => {
      const res = await fetch(resolveUrl("/api/broker/analytics"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: enhancedData, isLoading: enhancedLoading } = useQuery({
    queryKey: ["/api/broker/analytics/enhanced", startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const res = await fetch(resolveUrl(`/api/broker/analytics/enhanced?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: tab === "enhanced",
  });

  const handleExportCSV = () => {
    if (!enhancedData) return;
    const rows = [
      "Metric,Value",
      `Total Trips,${enhancedData.totalTrips}`,
      `Completed,${enhancedData.completedCount}`,
      `Cancelled,${enhancedData.cancelledCount}`,
      `No-Shows,${enhancedData.noShowCount}`,
      `Cancellation Rate,${enhancedData.cancellationRate}%`,
      `No-Show Rate,${enhancedData.noShowRate}%`,
      `Total Revenue,$${enhancedData.totalRevenue}`,
      `Total Miles,${enhancedData.totalMiles}`,
      `Cost Per Mile,$${enhancedData.costPerMile}`,
      `Cost Per Trip,$${enhancedData.costPerTrip}`,
      "",
      "Provider,Trips,Revenue",
      ...(enhancedData.revenueByProvider || []).map((p: any) =>
        `"${p.companyName}",${p.trips},$${p.revenue}`
      ),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `broker-analytics-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5" /> Analytics
          </h1>
          <p className="text-sm text-gray-400 mt-1">Broker performance metrics & insights</p>
        </div>
        {tab === "enhanced" && (
          <button
            onClick={handleExportCSV}
            disabled={!enhancedData}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0f172a] rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab("overview")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === "overview" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setTab("enhanced")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === "enhanced" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          Enhanced Analytics
        </button>
      </div>

      {tab === "overview" && (
        <>
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
        </>
      )}

      {tab === "enhanced" && (
        <>
          {/* Date range filter */}
          <div className="flex items-center gap-3 bg-[#111827] border border-[#1e293b] rounded-xl p-4">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-400">Date Range:</span>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
            <span className="text-gray-500">to</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
          </div>

          {enhancedLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 h-28 animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {/* Key Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
                  <p className="text-xs text-gray-500 uppercase">Total Trips</p>
                  <p className="text-2xl font-bold text-white mt-1">{enhancedData?.totalTrips ?? 0}</p>
                </div>
                <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
                  <p className="text-xs text-gray-500 uppercase">Total Revenue</p>
                  <p className="text-2xl font-bold text-green-400 mt-1">${enhancedData?.totalRevenue?.toLocaleString() ?? 0}</p>
                </div>
                <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
                  <p className="text-xs text-gray-500 uppercase">Cost / Mile</p>
                  <p className="text-2xl font-bold text-blue-400 mt-1">${enhancedData?.costPerMile ?? "0"}</p>
                </div>
                <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
                  <p className="text-xs text-gray-500 uppercase">Cost / Trip</p>
                  <p className="text-2xl font-bold text-purple-400 mt-1">${enhancedData?.costPerTrip ?? "0"}</p>
                </div>
              </div>

              {/* Cancellation & No-Show */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <XCircle className="w-4 h-4 text-red-400" />
                    <h3 className="text-sm font-semibold text-white">Cancellation Rate</h3>
                  </div>
                  <div className="flex items-end gap-4">
                    <p className="text-3xl font-bold text-red-400">{enhancedData?.cancellationRate ?? 0}%</p>
                    <p className="text-sm text-gray-500 mb-1">{enhancedData?.cancelledCount ?? 0} of {enhancedData?.totalTrips ?? 0} trips</p>
                  </div>
                  <div className="mt-3 w-full bg-[#1e293b] rounded-full h-2">
                    <div
                      className="h-2 rounded-full bg-red-500"
                      style={{ width: `${Math.min(100, Number(enhancedData?.cancellationRate ?? 0))}%` }}
                    />
                  </div>
                </div>

                <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <h3 className="text-sm font-semibold text-white">No-Show Rate</h3>
                  </div>
                  <div className="flex items-end gap-4">
                    <p className="text-3xl font-bold text-amber-400">{enhancedData?.noShowRate ?? 0}%</p>
                    <p className="text-sm text-gray-500 mb-1">{enhancedData?.noShowCount ?? 0} no-shows</p>
                  </div>
                  <div className="mt-3 w-full bg-[#1e293b] rounded-full h-2">
                    <div
                      className="h-2 rounded-full bg-amber-500"
                      style={{ width: `${Math.min(100, Number(enhancedData?.noShowRate ?? 0))}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Revenue per Provider */}
              {(enhancedData?.revenueByProvider || []).length > 0 && (
                <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
                  <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-green-400" /> Revenue by Provider
                  </h2>
                  <div className="space-y-3">
                    {(enhancedData?.revenueByProvider || []).map((provider: any, idx: number) => {
                      const maxRevenue = Math.max(...(enhancedData?.revenueByProvider || []).map((p: any) => p.revenue));
                      const barWidth = maxRevenue > 0 ? (provider.revenue / maxRevenue) * 100 : 0;
                      return (
                        <div key={provider.companyId} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-4">{idx + 1}.</span>
                              <span className="text-sm text-white">{provider.companyName}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs">
                              <span className="text-gray-400">{provider.trips} trips</span>
                              <span className="text-green-400 font-medium">${provider.revenue.toLocaleString()}</span>
                            </div>
                          </div>
                          <div className="w-full bg-[#1e293b] rounded-full h-1.5">
                            <div className="h-1.5 rounded-full bg-green-500/60" style={{ width: `${barWidth}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Geographic Demand Heatmap Data */}
              {(enhancedData?.demandHeatmap || []).length > 0 && (
                <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
                  <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-blue-400" /> Geographic Demand Summary
                  </h2>
                  <p className="text-xs text-gray-400 mb-3">
                    {(enhancedData?.demandHeatmap || []).length} pickup locations recorded in this period
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {/* Group by rough area (round to 1 decimal) */}
                    {(() => {
                      const areas: Record<string, number> = {};
                      for (const point of enhancedData?.demandHeatmap || []) {
                        const key = `${point.lat.toFixed(1)}, ${point.lng.toFixed(1)}`;
                        areas[key] = (areas[key] || 0) + 1;
                      }
                      return Object.entries(areas)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 8)
                        .map(([coords, count]) => (
                          <div key={coords} className="p-3 bg-[#0f172a] rounded-lg text-center">
                            <MapPin className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                            <p className="text-xs text-gray-400 font-mono">{coords}</p>
                            <p className="text-sm font-bold text-white mt-1">{count} trips</p>
                          </div>
                        ));
                    })()}
                  </div>
                </div>
              )}

              {enhancedData?.totalTrips === 0 && (
                <div className="text-center py-16 text-gray-500">
                  <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No data for the selected date range.</p>
                  <p className="text-sm mt-1">Try adjusting the date range filter.</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
