import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  Clock,
  DollarSign,
} from "lucide-react";
import { useState } from "react";

export default function BrokerSLAMonitoring() {
  const [tab, setTab] = useState<"overview" | "violations" | "contracts">("overview");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/sla/summary"],
    queryFn: async () => {
      const res = await fetch(resolveUrl("/api/broker/sla/summary"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-[#1e293b] rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 h-28 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const complianceRate = data?.complianceRate ?? 0;
  const targetRate = data?.targetRate ?? 95;
  const isCompliant = complianceRate >= targetRate;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Shield className="w-5 h-5" /> SLA Monitoring
        </h1>
        <p className="text-sm text-gray-400 mt-1">Service level agreement compliance & performance</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`bg-[#111827] border rounded-xl p-4 ${isCompliant ? "border-green-500/30" : "border-red-500/30"}`}>
          <div className="flex items-center gap-2 mb-2">
            {isCompliant ? (
              <CheckCircle className="w-4 h-4 text-green-400" />
            ) : (
              <XCircle className="w-4 h-4 text-red-400" />
            )}
            <p className="text-xs text-gray-500 uppercase">Compliance Rate</p>
          </div>
          <p className={`text-3xl font-bold ${isCompliant ? "text-green-400" : "text-red-400"}`}>
            {complianceRate}%
          </p>
          <p className="text-xs text-gray-500 mt-1">Target: {targetRate}%</p>
        </div>

        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <p className="text-xs text-gray-500 uppercase">On-Time</p>
          </div>
          <p className="text-3xl font-bold text-white">{data?.onTimeCount ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">of {data?.totalCompleted ?? 0} trips</p>
        </div>

        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <p className="text-xs text-gray-500 uppercase">Late/Violations</p>
          </div>
          <p className="text-3xl font-bold text-amber-400">{data?.lateCount ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">Last 30 days</p>
        </div>

        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-red-400" />
            <p className="text-xs text-gray-500 uppercase">Total Penalties</p>
          </div>
          <p className="text-3xl font-bold text-red-400">${data?.totalPenalties ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">Estimated</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0f172a] rounded-lg p-1 w-fit">
        {(["overview", "violations", "contracts"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            {t === "overview" ? "Performance Trend" : t === "violations" ? "Violations" : "Contract SLAs"}
          </button>
        ))}
      </div>

      {/* Performance Trend */}
      {tab === "overview" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Weekly Performance Trend
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase border-b border-[#1e293b]">
                  <th className="text-left p-2">Week</th>
                  <th className="text-right p-2">On-Time Rate</th>
                  <th className="text-right p-2">Total Trips</th>
                  <th className="text-right p-2">Violations</th>
                  <th className="text-right p-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e293b]">
                {(data?.weeklyTrend || []).map((w: any, idx: number) => {
                  const rate = Number(w.onTimeRate);
                  return (
                    <tr key={idx} className="hover:bg-white/5">
                      <td className="p-2 text-white">{w.week}</td>
                      <td className={`p-2 text-right font-medium ${rate >= 95 ? "text-green-400" : rate >= 90 ? "text-amber-400" : "text-red-400"}`}>
                        {w.onTimeRate}%
                      </td>
                      <td className="p-2 text-right text-gray-400">{w.totalTrips}</td>
                      <td className="p-2 text-right text-gray-400">{w.violations}</td>
                      <td className="p-2 text-right">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          rate >= 95
                            ? "bg-green-500/20 text-green-400"
                            : rate >= 90
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-red-500/20 text-red-400"
                        }`}>
                          {rate >= 95 ? "COMPLIANT" : rate >= 90 ? "WARNING" : "VIOLATION"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Visual bar chart */}
          <div className="mt-6">
            <h3 className="text-xs text-gray-500 uppercase mb-3">On-Time Rate Trend</h3>
            <div className="flex items-end gap-2 h-32">
              {(data?.weeklyTrend || []).map((w: any, idx: number) => {
                const rate = Number(w.onTimeRate);
                const height = Math.max(10, (rate / 100) * 100);
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-gray-500">{rate}%</span>
                    <div
                      className={`w-full rounded-t ${
                        rate >= 95 ? "bg-green-500/60" : rate >= 90 ? "bg-amber-500/60" : "bg-red-500/60"
                      }`}
                      style={{ height: `${height}%` }}
                    />
                    <span className="text-[9px] text-gray-600 truncate w-full text-center">
                      W{idx + 1}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Target line indicator */}
            <div className="flex items-center gap-2 mt-2">
              <div className="h-[1px] flex-1 border-t border-dashed border-blue-500/50" />
              <span className="text-[10px] text-blue-400">Target: {targetRate}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Violations */}
      {tab === "violations" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" /> SLA Violations
          </h2>
          {(data?.violations || []).length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No SLA violations recorded. Great job!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(data?.violations || []).map((v: any) => (
                <div key={v.id} className="flex items-center justify-between p-3 bg-[#0f172a] rounded-lg border border-[#1e293b]">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      v.severity === "HIGH" ? "bg-red-400" : v.severity === "MEDIUM" ? "bg-amber-400" : "bg-yellow-400"
                    }`} />
                    <div>
                      <p className="text-sm text-white">{v.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500">{v.tripRequestId}</span>
                        <span className="text-xs text-gray-600">|</span>
                        <span className="text-xs text-gray-500">{v.requestedDate}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      v.severity === "HIGH"
                        ? "bg-red-500/20 text-red-400"
                        : v.severity === "MEDIUM"
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-yellow-500/20 text-yellow-400"
                    }`}>
                      {v.severity}
                    </span>
                    <p className="text-[10px] text-gray-500 mt-1">{v.type?.replace(/_/g, " ")}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Contract SLA Thresholds */}
      {tab === "contracts" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Contract SLA Thresholds
          </h2>
          {(data?.contractThresholds || []).length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No active contracts with SLA thresholds.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {(data?.contractThresholds || []).map((ct: any) => {
                const met = ct.actualOnTimeRate >= ct.targetOnTimeRate;
                return (
                  <div key={ct.contractId} className="p-4 bg-[#0f172a] rounded-lg border border-[#1e293b]">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-medium text-white">{ct.contractName}</p>
                        <p className="text-xs text-gray-500">{ct.companyName}</p>
                      </div>
                      <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${
                        met ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                      }`}>
                        {met ? "SLA MET" : "SLA BREACH"}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-xs text-gray-500">Target</p>
                        <p className="text-lg font-bold text-white">{ct.targetOnTimeRate}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Actual</p>
                        <p className={`text-lg font-bold ${met ? "text-green-400" : "text-red-400"}`}>
                          {ct.actualOnTimeRate.toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Penalty/Violation</p>
                        <p className="text-lg font-bold text-gray-300">${ct.penaltyPerViolation}</p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-3">
                      <div className="w-full bg-[#1e293b] rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${met ? "bg-green-500" : "bg-red-500"}`}
                          style={{ width: `${Math.min(100, ct.actualOnTimeRate)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
