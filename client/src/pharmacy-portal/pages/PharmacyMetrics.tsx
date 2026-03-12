import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BarChart3, TrendingUp, Calendar, DollarSign, Users, MapPin, Clock, Target } from "lucide-react";

export default function PharmacyMetrics() {
  const { token } = useAuth();
  const [period, setPeriod] = useState("7d");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/pharmacy/metrics", period],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/metrics?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load metrics");
      return res.json();
    },
  });

  // Aggregate daily stats
  const dailyMap = new Map<string, { total: number; delivered: number; failed: number; cancelled: number }>();
  if (data?.dailyStats) {
    for (const row of data.dailyStats) {
      const existing = dailyMap.get(row.date) || { total: 0, delivered: 0, failed: 0, cancelled: 0 };
      existing.total += Number(row.count);
      if (row.status === "DELIVERED") existing.delivered += Number(row.count);
      if (row.status === "FAILED") existing.failed += Number(row.count);
      if (row.status === "CANCELLED") existing.cancelled += Number(row.count);
      dailyMap.set(row.date, existing);
    }
  }

  const dailyData = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, stats]) => ({ date, ...stats, rate: stats.total > 0 ? Math.round((stats.delivered / stats.total) * 100) : 0 }));

  const totals = dailyData.reduce(
    (acc, d) => ({
      total: acc.total + d.total,
      delivered: acc.delivered + d.delivered,
      failed: acc.failed + d.failed,
      cancelled: acc.cancelled + d.cancelled,
    }),
    { total: 0, delivered: 0, failed: 0, cancelled: 0 },
  );

  const avgRate = totals.total > 0 ? Math.round((totals.delivered / totals.total) * 100) : 0;
  const maxDailyTotal = Math.max(...dailyData.map(d => d.total), 1);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <BarChart3 className="w-6 h-6 text-violet-400" />
            Analytics
          </h1>
          <p className="text-sm text-gray-400 mt-1">Delivery performance and trends</p>
        </div>
        <div className="flex gap-2">
          {["7d", "14d", "30d"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                period === p
                  ? "bg-violet-600 text-white"
                  : "bg-[#111827] text-gray-400 hover:text-white border border-[#1e293b]"
              }`}
            >
              {p === "7d" ? "7 Days" : p === "14d" ? "14 Days" : "30 Days"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
          <p className="text-xs text-gray-500 uppercase">Total Orders</p>
          <p className="text-3xl font-bold text-white mt-2">{totals.total}</p>
        </div>
        <div className="bg-[#111827] border border-emerald-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-500 uppercase">Delivered</p>
          <p className="text-3xl font-bold text-emerald-400 mt-2">{totals.delivered}</p>
        </div>
        <div className="bg-[#111827] border border-red-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-500 uppercase">Failed</p>
          <p className="text-3xl font-bold text-red-400 mt-2">{totals.failed}</p>
        </div>
        <div className="bg-[#111827] border border-violet-500/20 rounded-xl p-5">
          <p className="text-xs text-gray-500 uppercase">Success Rate</p>
          <p className="text-3xl font-bold text-violet-400 mt-2">{avgRate}%</p>
        </div>
      </div>

      {/* Bar Chart (CSS-based) */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-6">
          <TrendingUp className="w-4 h-4 text-violet-400" />
          Daily Volume
        </h3>
        {isLoading ? (
          <div className="h-48 flex items-end gap-2">
            {[...Array(7)].map((_, i) => (
              <div key={i} className="flex-1 bg-gray-800 rounded-t animate-pulse" style={{ height: `${30 + Math.random() * 70}%` }} />
            ))}
          </div>
        ) : dailyData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
            No data for this period
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-end gap-2 h-48">
              {dailyData.map((d) => {
                const heightPct = (d.total / maxDailyTotal) * 100;
                const deliveredPct = d.total > 0 ? (d.delivered / d.total) * heightPct : 0;
                const failedPct = d.total > 0 ? (d.failed / d.total) * heightPct : 0;
                const otherPct = heightPct - deliveredPct - failedPct;

                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center group" title={`${d.date}: ${d.total} orders, ${d.delivered} delivered`}>
                    <div className="w-full flex flex-col-reverse rounded-t overflow-hidden" style={{ height: `${heightPct}%`, minHeight: d.total > 0 ? "4px" : "0" }}>
                      {deliveredPct > 0 && <div className="bg-emerald-500" style={{ height: `${(deliveredPct / heightPct) * 100}%` }} />}
                      {failedPct > 0 && <div className="bg-red-500" style={{ height: `${(failedPct / heightPct) * 100}%` }} />}
                      {otherPct > 0 && <div className="bg-violet-500/50" style={{ height: `${(otherPct / heightPct) * 100}%` }} />}
                    </div>
                    <span className="text-[9px] text-gray-600 mt-2 -rotate-45 origin-top-left whitespace-nowrap">
                      {d.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-sm" /> Delivered</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-500 rounded-sm" /> Failed</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-violet-500/50 rounded-sm" /> Other</span>
            </div>
          </div>
        )}
      </div>

      {/* Daily Breakdown Table */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-x-auto">
        <div className="px-5 py-4 border-b border-[#1e293b]">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Calendar className="w-4 h-4 text-violet-400" />
            Daily Breakdown
          </h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1e293b]">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Date</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Total</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Delivered</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Failed</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Cancelled</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Rate</th>
            </tr>
          </thead>
          <tbody>
            {dailyData.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-gray-600 text-sm">No data</td>
              </tr>
            ) : (
              dailyData.map((d) => (
                <tr key={d.date} className="border-b border-[#1e293b]/50 hover:bg-white/[0.02]">
                  <td className="px-5 py-3 text-sm text-white">{d.date}</td>
                  <td className="px-5 py-3 text-sm text-gray-400 text-right">{d.total}</td>
                  <td className="px-5 py-3 text-sm text-emerald-400 text-right">{d.delivered}</td>
                  <td className="px-5 py-3 text-sm text-red-400 text-right">{d.failed}</td>
                  <td className="px-5 py-3 text-sm text-gray-500 text-right">{d.cancelled}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`text-xs font-medium ${d.rate >= 90 ? "text-emerald-400" : d.rate >= 70 ? "text-amber-400" : "text-red-400"}`}>
                      {d.rate}%
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Advanced Analytics Section */}
      <AdvancedAnalytics token={token!} period={period} />
    </div>
  );
}

function AdvancedAnalytics({ token, period }: { token: string; period: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/pharmacy/analytics", period],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/analytics?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load analytics");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-32 mb-4" />
            <div className="h-32 bg-gray-800 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!data) return null;

  const formatCents = (c: number) => `$${(c / 100).toFixed(2)}`;
  const maxHourOrders = Math.max(...(data.peakHours?.map((h: any) => h.orderCount) || [1]), 1);

  return (
    <div className="space-y-6">
      {/* Cost & SLA Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="w-4 h-4 text-violet-400" />
            <span className="text-xs text-gray-500 uppercase">Avg Cost Per Delivery</span>
          </div>
          <p className="text-3xl font-bold text-white">{formatCents(data.costPerDelivery?.avgTotalFeeCents || 0)}</p>
          <p className="text-xs text-gray-500 mt-1">{data.costPerDelivery?.totalDeliveries || 0} deliveries in period</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-violet-400" />
            <span className="text-xs text-gray-500 uppercase">SLA Compliance</span>
          </div>
          <p className="text-3xl font-bold text-emerald-400">{data.slaCompliance?.percentage || 100}%</p>
          <p className="text-xs text-gray-500 mt-1">{data.slaCompliance?.onTime || 0}/{data.slaCompliance?.total || 0} on-time deliveries</p>
          <div className="w-full bg-[#1e293b] rounded-full h-2 mt-2">
            <div
              className="bg-gradient-to-r from-violet-500 to-emerald-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${data.slaCompliance?.percentage || 0}%` }}
            />
          </div>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="w-4 h-4 text-violet-400" />
            <span className="text-xs text-gray-500 uppercase">Delivery Heatmap</span>
          </div>
          <p className="text-3xl font-bold text-white">{data.heatmapData?.length || 0}</p>
          <p className="text-xs text-gray-500 mt-1">delivery locations tracked</p>
        </div>
      </div>

      {/* Success Rate by Priority */}
      {data.priorityBreakdown && data.priorityBreakdown.length > 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-violet-400" />
            Success Rate by Priority Level
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {data.priorityBreakdown.map((p: any) => {
              const colors: Record<string, string> = {
                STANDARD: "from-gray-500 to-gray-600",
                EXPRESS: "from-blue-500 to-blue-600",
                URGENT: "from-amber-500 to-amber-600",
                STAT: "from-red-500 to-red-600",
              };
              const textColors: Record<string, string> = {
                STANDARD: "text-gray-400",
                EXPRESS: "text-blue-400",
                URGENT: "text-amber-400",
                STAT: "text-red-400",
              };
              return (
                <div key={p.priority} className="bg-[#0a0f1e] rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-bold uppercase ${textColors[p.priority] || "text-gray-400"}`}>{p.priority}</span>
                    <span className={`text-lg font-bold ${p.successRate >= 90 ? "text-emerald-400" : p.successRate >= 70 ? "text-amber-400" : "text-red-400"}`}>
                      {p.successRate}%
                    </span>
                  </div>
                  <div className="w-full bg-[#1e293b] rounded-full h-2">
                    <div className={`bg-gradient-to-r ${colors[p.priority] || colors.STANDARD} h-2 rounded-full`} style={{ width: `${p.successRate}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-600 mt-1.5">
                    <span>{p.delivered} delivered</span>
                    <span>{p.total} total</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Peak Hour Analysis */}
      {data.peakHours && data.peakHours.length > 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-violet-400" />
            Peak Hour Analysis
          </h3>
          <div className="flex items-end gap-1 h-32">
            {Array.from({ length: 24 }, (_, h) => {
              const hourData = data.peakHours.find((p: any) => p.hour === h);
              const count = hourData?.orderCount || 0;
              const heightPct = (count / maxHourOrders) * 100;
              const isActive = h >= 8 && h <= 20;
              return (
                <div key={h} className="flex-1 flex flex-col items-center group" title={`${h}:00 - ${count} orders`}>
                  <div
                    className={`w-full rounded-t transition-all ${count > 0 ? (isActive ? "bg-violet-500" : "bg-violet-500/50") : "bg-[#1e293b]"}`}
                    style={{ height: `${Math.max(heightPct, 2)}%` }}
                  />
                  {h % 3 === 0 && (
                    <span className="text-[8px] text-gray-600 mt-1">{h}:00</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 text-[10px] text-gray-500 mt-3">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-violet-500 rounded-sm" /> Business Hours</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-violet-500/50 rounded-sm" /> Off Hours</span>
          </div>
        </div>
      )}

      {/* Driver Performance */}
      {data.driverPerformance && data.driverPerformance.length > 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-x-auto">
          <div className="px-5 py-4 border-b border-[#1e293b]">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-violet-400" />
              Driver Performance
            </h3>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e293b]">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Driver</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Total</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Delivered</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Failed</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Success Rate</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Per Day</th>
              </tr>
            </thead>
            <tbody>
              {data.driverPerformance.map((d: any) => (
                <tr key={d.driverId} className="border-b border-[#1e293b]/50 hover:bg-white/[0.02]">
                  <td className="px-5 py-3 text-sm text-white">{d.driverName}</td>
                  <td className="px-5 py-3 text-sm text-gray-400 text-right">{d.deliveryCount}</td>
                  <td className="px-5 py-3 text-sm text-emerald-400 text-right">{d.deliveredCount}</td>
                  <td className="px-5 py-3 text-sm text-red-400 text-right">{d.failedCount}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`text-xs font-medium ${d.successRate >= 90 ? "text-emerald-400" : d.successRate >= 70 ? "text-amber-400" : "text-red-400"}`}>
                      {d.successRate}%
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-violet-400 text-right">{d.deliveriesPerDay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
