import { useState } from "react";
import { motion } from "framer-motion";
import { DollarSign, TrendingUp, Calendar, ChevronLeft, Clock } from "lucide-react";
import { useDriverStore } from "../store/driverStore";
import { colors } from "../design/tokens";
import { glowColor } from "../design/theme";
import { GlassCard } from "../components/ui/GlassCard";
import { GlowProgressCircle } from "../components/ui/GlowProgressCircle";
import { NebulaBackground } from "../components/ui/MapOverlay";

const MOCK_HISTORY = [
  { id: "TRP-001", time: "2:45 PM", passenger: "Sarah M.", amount: 32.50, distance: "8.2 mi", duration: "22 min" },
  { id: "TRP-002", time: "1:15 PM", passenger: "Robert K.", amount: 28.00, distance: "6.5 mi", duration: "18 min" },
  { id: "TRP-003", time: "11:30 AM", passenger: "Lisa P.", amount: 45.00, distance: "12.1 mi", duration: "35 min" },
  { id: "TRP-004", time: "10:00 AM", passenger: "James W.", amount: 22.50, distance: "4.8 mi", duration: "14 min" },
  { id: "TRP-005", time: "8:45 AM", passenger: "Maria G.", amount: 38.00, distance: "9.7 mi", duration: "28 min" },
  { id: "TRP-006", time: "Yesterday", passenger: "David L.", amount: 31.00, distance: "7.3 mi", duration: "20 min" },
];

function MiniChart() {
  const data = [65, 72, 58, 85, 92, 78, 88, 95, 82, 90, 76, 88];
  const max = Math.max(...data);
  const width = 280;
  const height = 60;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full" data-testid="earnings-chart">
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.neonCyan} stopOpacity="0.3" />
          <stop offset="100%" stopColor={colors.neonCyan} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`M 0 ${height} ${data.map((d, i) => `L ${(i / (data.length - 1)) * width} ${height - (d / max) * height}`).join(" ")} L ${width} ${height} Z`}
        fill="url(#chartGrad)"
      />
      <path
        d={data.map((d, i) => `${i === 0 ? "M" : "L"} ${(i / (data.length - 1)) * width} ${height - (d / max) * height}`).join(" ")}
        fill="none"
        stroke={colors.neonCyan}
        strokeWidth="2"
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 4px ${glowColor(colors.neonCyan, 0.5)})` }}
      />
    </svg>
  );
}

export function Earnings({ onBack }: { onBack: () => void }) {
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const earningsToday = useDriverStore((s) => s.earningsToday);
  const earningsWeek = useDriverStore((s) => s.earningsWeek);
  const completedRides = useDriverStore((s) => s.completedRides);

  const displayAmount = period === "day" ? earningsToday : period === "week" ? earningsWeek : earningsWeek * 3.8;

  return (
    <NebulaBackground className="min-h-screen">
      <div className="max-w-md mx-auto w-full px-4 py-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-8 h-8 rounded-full"
            style={{ background: "rgba(255,255,255,0.08)", color: colors.textPrimary }}
            data-testid="btn-back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold" style={{ color: colors.textPrimary, fontFamily: "'Space Grotesk', system-ui" }}>
            Earnings
          </h1>
        </div>

        <div className="flex gap-1 p-1 rounded-2xl" style={{ background: "rgba(255,255,255,0.06)" }} data-testid="period-filter">
          {(["day", "week", "month"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="flex-1 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all"
              style={{
                background: period === p ? glowColor(colors.neonCyan, 0.2) : "transparent",
                color: period === p ? colors.neonCyan : colors.textTertiary,
                border: period === p ? `1px solid ${glowColor(colors.neonCyan, 0.3)}` : "1px solid transparent",
                fontFamily: "'Space Grotesk', system-ui",
              }}
              data-testid={`filter-${p}`}
            >
              {p}
            </button>
          ))}
        </div>

        <GlassCard variant="elevated" testID="card-earnings-summary">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: colors.textTertiary }}>
                Total Earnings
              </p>
              <motion.p
                key={displayAmount}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-3xl font-bold"
                style={{
                  color: colors.textPrimary,
                  fontFamily: "'Space Grotesk', system-ui",
                  textShadow: `0 0 20px ${glowColor(colors.neonCyan, 0.3)}`,
                }}
              >
                ${displayAmount.toFixed(2)}
              </motion.p>
            </div>
            <GlowProgressCircle
              progress={completedRides / 20}
              label={String(completedRides)}
              sublabel="Rides"
              size={64}
              accentColor={colors.neonPurple}
              testID="progress-rides"
            />
          </div>
          <MiniChart />
        </GlassCard>

        <GlassCard variant="default" testID="card-quick-stats" className="!p-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <DollarSign className="w-4 h-4 mx-auto mb-1" style={{ color: colors.neonCyan }} />
              <p className="text-sm font-bold" style={{ color: colors.textPrimary }}>$13.39</p>
              <p className="text-[9px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>Avg/Trip</p>
            </div>
            <div className="text-center">
              <Clock className="w-4 h-4 mx-auto mb-1" style={{ color: colors.neonPurple }} />
              <p className="text-sm font-bold" style={{ color: colors.textPrimary }}>6.2h</p>
              <p className="text-[9px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>Online</p>
            </div>
            <div className="text-center">
              <TrendingUp className="w-4 h-4 mx-auto mb-1" style={{ color: colors.successNeon }} />
              <p className="text-sm font-bold" style={{ color: colors.textPrimary }}>$30.24</p>
              <p className="text-[9px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>$/Hour</p>
            </div>
          </div>
        </GlassCard>

        <div>
          <h2 className="text-sm font-semibold mb-3 px-1" style={{ color: colors.textSecondary, fontFamily: "'Space Grotesk', system-ui" }}>
            Trip History
          </h2>
          <div className="space-y-2" data-testid="trip-history-list">
            {MOCK_HISTORY.map((trip, i) => (
              <motion.div
                key={trip.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <GlassCard variant="subtle" className="!p-3 !rounded-2xl" testID={`trip-history-${trip.id}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center"
                        style={{ background: "rgba(0,240,255,0.1)" }}
                      >
                        <Calendar className="w-4 h-4" style={{ color: colors.neonCyan }} />
                      </div>
                      <div>
                        <p className="text-sm font-medium" style={{ color: colors.textPrimary }}>{trip.passenger}</p>
                        <p className="text-[10px]" style={{ color: colors.textTertiary }}>
                          {trip.time} • {trip.distance} • {trip.duration}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-bold" style={{ color: colors.successNeon, fontFamily: "'Space Grotesk', system-ui" }}>
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
