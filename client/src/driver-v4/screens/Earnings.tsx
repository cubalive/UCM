import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { DollarSign, TrendingUp, Calendar, ChevronLeft, Clock } from "lucide-react";
import { useDriverStore } from "../store/driverStore";
import { colors } from "../design/tokens";
import { GlassCard } from "../components/ui/GlassCard";
import { GlowProgressCircle } from "../components/ui/GlowProgressCircle";
import { NebulaBackground } from "../components/ui/MapOverlay";
import { resolveUrl, getStoredToken } from "@/lib/api";
import { DRIVER_TOKEN_KEY } from "@/lib/hostDetection";

interface TripHistoryItem {
  id: string;
  time: string;
  passenger: string;
  amount: number;
  distance: string;
  duration: string;
}

function MiniChart({ chartData }: { chartData?: number[] }) {
  const data = chartData && chartData.length > 1 ? chartData : [0, 0];
  const max = Math.max(...data, 1);
  const width = 280;
  const height = 60;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full" data-testid="earnings-chart">
      <defs>
        <linearGradient id="chartGradSunrise" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.sunrise} stopOpacity="0.2" />
          <stop offset="100%" stopColor={colors.sunrise} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`M 0 ${height} ${data.map((d, i) => `L ${(i / (data.length - 1)) * width} ${height - (d / max) * height}`).join(" ")} L ${width} ${height} Z`}
        fill="url(#chartGradSunrise)"
      />
      <path
        d={data.map((d, i) => `${i === 0 ? "M" : "L"} ${(i / (data.length - 1)) * width} ${height - (d / max) * height}`).join(" ")}
        fill="none"
        stroke={colors.sunrise}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Earnings({ onBack }: { onBack: () => void }) {
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const earningsToday = useDriverStore((s) => s.earningsToday);
  const earningsWeek = useDriverStore((s) => s.earningsWeek);
  const completedRides = useDriverStore((s) => s.completedRides);
  const [tripHistory, setTripHistory] = useState<TripHistoryItem[]>([]);
  const [stats, setStats] = useState<{ avgPerTrip: number; onlineHours: number; perHour: number }>({ avgPerTrip: 0, onlineHours: 0, perHour: 0 });
  const [chartData, setChartData] = useState<number[]>([]);
  const [monthlyEarnings, setMonthlyEarnings] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem(DRIVER_TOKEN_KEY) || getStoredToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(resolveUrl("/api/driver/trip-history?limit=10"), { headers })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.trips?.length) {
          setTripHistory(data.trips.map((t: any) => ({
            id: t.publicId || `TRP-${t.id}`,
            time: t.completedAt ? new Date(t.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
            passenger: t.patientName || "Patient",
            amount: (t.totalCents || 0) / 100,
            distance: t.distanceMiles ? `${t.distanceMiles.toFixed(1)} mi` : "-",
            duration: t.durationMinutes ? `${t.durationMinutes} min` : "-",
          })));
        }
      })
      .catch(() => {});

    fetch(resolveUrl(`/api/driver/earnings?range=${period}`), { headers })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          const total = (data.totalCents || 0) / 100;
          const trips = data.tripCount || completedRides || 1;
          const hours = data.onlineHours || 0;
          setStats({
            avgPerTrip: trips > 0 ? total / trips : 0,
            onlineHours: hours,
            perHour: hours > 0 ? total / hours : 0,
          });
          if (data.dailyBreakdown && Array.isArray(data.dailyBreakdown)) {
            setChartData(data.dailyBreakdown.map((d: any) => (d.totalCents || 0) / 100));
          }
        }
      })
      .catch(() => {});

    if (period === "month") {
      fetch(resolveUrl("/api/driver/earnings?range=month"), { headers })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data) setMonthlyEarnings((data.totalCents || 0) / 100);
        })
        .catch(() => {});
    }
  }, [period, completedRides]);

  const displayAmount = period === "day" ? earningsToday : period === "week" ? earningsWeek : (monthlyEarnings || earningsWeek * 4);

  return (
    <NebulaBackground className="min-h-screen">
      <div className="max-w-md mx-auto w-full px-4 py-6 space-y-4 overflow-y-auto" style={{ maxHeight: "100%" }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-9 h-9 rounded-full"
            style={{ background: "rgba(255,255,255,0.80)", color: colors.textPrimary, boxShadow: colors.shadowSm, border: "1px solid rgba(0,0,0,0.04)" }}
            data-testid="btn-back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold" style={{ color: colors.textPrimary }}>
            Earnings
          </h1>
        </div>

        {/* Period toggle */}
        <div className="flex gap-1 p-1 rounded-2xl" style={{ background: "rgba(255,255,255,0.60)", border: "1px solid rgba(0,0,0,0.04)" }} data-testid="period-filter">
          {(["day", "week", "month"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold capitalize transition-all"
              style={{
                background: period === p ? "white" : "transparent",
                color: period === p ? colors.sunrise : colors.textTertiary,
                boxShadow: period === p ? colors.shadowSm : "none",
              }}
              data-testid={`filter-${p}`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Summary card */}
        <GlassCard variant="elevated" testID="card-earnings-summary">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider mb-1 font-medium" style={{ color: colors.textTertiary }}>
                Total Earnings
              </p>
              <motion.p
                key={displayAmount}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-3xl font-bold"
                style={{ color: colors.textPrimary }}
              >
                ${displayAmount.toFixed(2)}
              </motion.p>
            </div>
            <GlowProgressCircle
              progress={completedRides / 20}
              label={String(completedRides)}
              sublabel="Rides"
              size={64}
              accentColor={colors.sunrise}
              testID="progress-rides"
            />
          </div>
          <MiniChart chartData={chartData} />
        </GlassCard>

        {/* Quick stats */}
        <GlassCard variant="default" testID="card-quick-stats" className="!p-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="w-8 h-8 rounded-xl mx-auto mb-1.5 flex items-center justify-center" style={{ background: "rgba(255,107,53,0.08)" }}>
                <DollarSign className="w-4 h-4" style={{ color: colors.sunrise }} />
              </div>
              <p className="text-sm font-bold" style={{ color: colors.textPrimary }}>${stats.avgPerTrip.toFixed(2)}</p>
              <p className="text-[9px] uppercase tracking-wider font-medium" style={{ color: colors.textTertiary }}>Avg/Trip</p>
            </div>
            <div className="text-center">
              <div className="w-8 h-8 rounded-xl mx-auto mb-1.5 flex items-center justify-center" style={{ background: "rgba(74,144,217,0.08)" }}>
                <Clock className="w-4 h-4" style={{ color: colors.sky }} />
              </div>
              <p className="text-sm font-bold" style={{ color: colors.textPrimary }}>{stats.onlineHours.toFixed(1)}h</p>
              <p className="text-[9px] uppercase tracking-wider font-medium" style={{ color: colors.textTertiary }}>Online</p>
            </div>
            <div className="text-center">
              <div className="w-8 h-8 rounded-xl mx-auto mb-1.5 flex items-center justify-center" style={{ background: "rgba(52,199,89,0.08)" }}>
                <TrendingUp className="w-4 h-4" style={{ color: colors.success }} />
              </div>
              <p className="text-sm font-bold" style={{ color: colors.textPrimary }}>${stats.perHour.toFixed(2)}</p>
              <p className="text-[9px] uppercase tracking-wider font-medium" style={{ color: colors.textTertiary }}>$/Hour</p>
            </div>
          </div>
        </GlassCard>

        {/* Trip history */}
        <div>
          <h2 className="text-sm font-semibold mb-3 px-1" style={{ color: colors.textSecondary }}>
            Trip History
          </h2>
          <div className="space-y-2" data-testid="trip-history-list">
            {tripHistory.length === 0 && (
              <p className="text-center text-xs py-4" style={{ color: colors.textTertiary }}>No trip history yet</p>
            )}
            {tripHistory.map((trip, i) => (
              <motion.div
                key={trip.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <GlassCard variant="default" className="!p-3 !rounded-2xl" testID={`trip-history-${trip.id}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center"
                        style={{ background: "rgba(255,107,53,0.08)" }}
                      >
                        <Calendar className="w-4 h-4" style={{ color: colors.sunrise }} />
                      </div>
                      <div>
                        <p className="text-sm font-medium" style={{ color: colors.textPrimary }}>{trip.passenger}</p>
                        <p className="text-[10px]" style={{ color: colors.textTertiary }}>
                          {trip.time} • {trip.distance} • {trip.duration}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-bold" style={{ color: colors.success }}>
                      +${trip.amount.toFixed(2)}
                    </span>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </NebulaBackground>
  );
}
