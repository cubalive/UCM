import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useState, useMemo } from "react";
import {
  Brain, TrendingUp, Users, Clock, AlertTriangle,
  ChevronRight, Calendar, Activity, BarChart3,
  ArrowUp, ArrowDown, Minus, Zap,
} from "lucide-react";

interface ForecastBucket {
  time: string;
  inboundAmb: number;
  inboundWc: number;
  outboundAmb: number;
  outboundWc: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
}

interface CapacityBucket {
  time: string;
  demandTrips: number;
  availableDrivers: number;
  shortage: number;
  utilizationPct: number;
}

function ConfidenceBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    HIGH: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    MEDIUM: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    LOW: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${colors[level] || colors.LOW}`}>
      {level}
    </span>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ClinicScheduling() {
  const { user } = useAuth();
  const [horizon, setHorizon] = useState("180");

  const { data: features } = useQuery<any>({
    queryKey: ["/api/clinic/features"],
    queryFn: () => fetch("/api/clinic/features", { credentials: "include" }).then(r => r.json()),
  });

  const { data: forecastData, isLoading: forecastLoading } = useQuery<any>({
    queryKey: ["/api/clinic/forecast", horizon],
    queryFn: () => fetch(`/api/clinic/forecast?horizonMinutes=${horizon}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60000,
  });

  const { data: capacityData, isLoading: capLoading } = useQuery<any>({
    queryKey: ["/api/clinic/capacity-forecast", horizon],
    queryFn: () => fetch(`/api/clinic/capacity-forecast?horizonMinutes=${horizon}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60000,
  });

  const { data: metricsData } = useQuery<any>({
    queryKey: ["/api/clinic/metrics"],
    queryFn: () => fetch("/api/clinic/metrics", { credentials: "include" }).then(r => r.json()),
  });

  const { data: alertData } = useQuery<any>({
    queryKey: ["/api/clinic/alert-inputs"],
    queryFn: () => fetch("/api/clinic/alert-inputs", { credentials: "include" }).then(r => r.json()),
    refetchInterval: 15000,
  });

  const forecast: ForecastBucket[] = forecastData?.forecast || forecastData?.buckets || [];
  const capacity: CapacityBucket[] = capacityData?.buckets || [];
  const metrics = metricsData || {};
  const alerts = alertData?.alerts || [];

  const peakBucket = useMemo(() => {
    if (!forecast.length) return null;
    let max = 0;
    let peak: ForecastBucket | null = null;
    for (const b of forecast) {
      const total = b.inboundAmb + b.inboundWc + b.outboundAmb + b.outboundWc;
      if (total > max) { max = total; peak = b; }
    }
    return peak;
  }, [forecast]);

  const shortages = useMemo(() => capacity.filter(c => c.shortage > 0), [capacity]);

  const intelligenceEnabled = features?.clinic_intelligence_pack;

  if (!intelligenceEnabled) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-center py-20">
          <div className="w-20 h-20 mx-auto bg-emerald-500/10 rounded-full flex items-center justify-center mb-4">
            <Brain className="w-10 h-10 text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">AI Scheduling & Forecasting</h2>
          <p className="text-gray-400 max-w-md mx-auto mb-6">
            Get predictive demand forecasts, capacity planning, and smart scheduling powered by AI analysis of your historical transport data.
          </p>
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 max-w-sm mx-auto space-y-3 text-left">
            <p className="text-sm font-medium text-white">Intelligence Pack includes:</p>
            <div className="space-y-2">
              {["Demand Forecasting (15-min buckets)", "Driver Capacity Planning", "Smart Alerts & Risk Detection", "Historical Trend Analysis", "No-Show Risk Prediction"].map(f => (
                <div key={f} className="flex items-center gap-2 text-xs text-gray-400">
                  <Zap className="w-3 h-3 text-emerald-400 shrink-0" />
                  {f}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-600 pt-2 border-t border-[#1e293b]">Contact your admin to enable the Intelligence Pack.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Brain className="w-5 h-5 text-emerald-400" />
            AI Scheduling & Forecasting
          </h1>
          <p className="text-sm text-gray-500 mt-1">Predictive demand analysis powered by historical patterns</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Horizon:</span>
          {[
            { val: "60", label: "1h" },
            { val: "180", label: "3h" },
            { val: "360", label: "6h" },
            { val: "720", label: "12h" },
          ].map(h => (
            <button
              key={h.val}
              onClick={() => setHorizon(h.val)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                horizon === h.val
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-[#111827] text-gray-500 border border-[#1e293b] hover:text-white"
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "On-Time Rate", value: metrics.onTimeRate ? `${metrics.onTimeRate}%` : "--", icon: Clock, color: "emerald" },
          { label: "No-Show Rate", value: metrics.noShowRate ? `${metrics.noShowRate}%` : "--", icon: AlertTriangle, color: "amber" },
          { label: "Avg Wait", value: metrics.avgWaitMinutes ? `${metrics.avgWaitMinutes}m` : "--", icon: Activity, color: "cyan" },
          { label: "Peak Demand", value: peakBucket ? `${peakBucket.inboundAmb + peakBucket.inboundWc + peakBucket.outboundAmb + peakBucket.outboundWc} trips` : "--", icon: TrendingUp, color: "violet" },
        ].map(kpi => (
          <div key={kpi.label} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <kpi.icon className={`w-4 h-4 text-${kpi.color}-400`} />
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">{kpi.label}</span>
            </div>
            <p className="text-xl font-bold text-white">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Shortage Alerts */}
      {shortages.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <p className="text-sm font-semibold text-red-400">Driver Shortage Predicted</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {shortages.slice(0, 4).map((s, i) => (
              <div key={i} className="bg-red-500/5 rounded-lg p-2 text-center">
                <p className="text-xs text-gray-400">{s.time}</p>
                <p className="text-sm font-bold text-red-400">-{s.shortage} drivers</p>
                <p className="text-[10px] text-gray-500">{s.demandTrips} trips / {s.availableDrivers} drivers</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Forecast Grid */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#1e293b] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-400" />
            Demand Forecast
          </h3>
          <div className="flex gap-4 text-[10px]">
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-400" /> Inbound Amb</span>
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-400" /> Inbound WC</span>
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-violet-400" /> Outbound Amb</span>
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-amber-400" /> Outbound WC</span>
          </div>
        </div>

        {forecastLoading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-gray-500 text-sm mt-3">Computing forecast...</p>
          </div>
        ) : forecast.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Brain className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No forecast data available yet</p>
            <p className="text-xs mt-1">AI needs historical trip data to generate predictions</p>
          </div>
        ) : (
          <div className="divide-y divide-[#1e293b]">
            {forecast.map((bucket, i) => {
              const total = bucket.inboundAmb + bucket.inboundWc + bucket.outboundAmb + bucket.outboundWc;
              const maxTotal = Math.max(...forecast.map(b => b.inboundAmb + b.inboundWc + b.outboundAmb + b.outboundWc), 1);
              return (
                <div key={i} className="px-4 py-3 flex items-center gap-4 hover:bg-white/[0.02]">
                  <span className="text-xs text-gray-400 w-16 font-mono shrink-0">{bucket.time}</span>
                  <div className="flex-1">
                    <div className="flex gap-1 h-5">
                      {bucket.inboundAmb > 0 && (
                        <div className="bg-emerald-500/30 rounded-sm flex items-center justify-center" style={{ width: `${(bucket.inboundAmb / maxTotal) * 100}%` }}>
                          <span className="text-[8px] text-emerald-400">{bucket.inboundAmb}</span>
                        </div>
                      )}
                      {bucket.inboundWc > 0 && (
                        <div className="bg-blue-500/30 rounded-sm flex items-center justify-center" style={{ width: `${(bucket.inboundWc / maxTotal) * 100}%` }}>
                          <span className="text-[8px] text-blue-400">{bucket.inboundWc}</span>
                        </div>
                      )}
                      {bucket.outboundAmb > 0 && (
                        <div className="bg-violet-500/30 rounded-sm flex items-center justify-center" style={{ width: `${(bucket.outboundAmb / maxTotal) * 100}%` }}>
                          <span className="text-[8px] text-violet-400">{bucket.outboundAmb}</span>
                        </div>
                      )}
                      {bucket.outboundWc > 0 && (
                        <div className="bg-amber-500/30 rounded-sm flex items-center justify-center" style={{ width: `${(bucket.outboundWc / maxTotal) * 100}%` }}>
                          <span className="text-[8px] text-amber-400">{bucket.outboundWc}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-gray-500 w-12 text-right">{total} trips</span>
                  <ConfidenceBadge level={bucket.confidence} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Smart Alerts */}
      {alerts.length > 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#1e293b]">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Smart Alerts ({alerts.length})
            </h3>
          </div>
          <div className="divide-y divide-[#1e293b]">
            {alerts.slice(0, 10).map((alert: any, i: number) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  alert.severity === "danger" ? "bg-red-400" :
                  alert.severity === "warning" ? "bg-amber-400" : "bg-blue-400"
                }`} />
                <div className="flex-1">
                  <p className="text-sm text-white">{alert.title || alert.message}</p>
                  {alert.description && <p className="text-xs text-gray-500 mt-0.5">{alert.description}</p>}
                </div>
                <span className="text-[10px] text-gray-600">{alert.time || ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
