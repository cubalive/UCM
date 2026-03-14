import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { DollarSign, TrendingUp, Calendar, ChevronLeft, Clock, CreditCard, Loader2, ChevronDown, Wallet, BarChart3, Settings } from "lucide-react";
import { useDriverStore } from "../store/driverStore";
import { colors } from "../design/tokens";
import { glowColor } from "../design/theme";
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
  serviceType?: string;
}

interface ServiceBreakdown {
  serviceType: string;
  count: number;
  totalAmount: number;
}

interface SummaryStats {
  weeklyTotal: number;
  weeklyTrips: number;
  weeklyHours: number;
  monthlyTotal: number;
  monthlyTrips: number;
  monthlyHours: number;
}

interface PaymentMethod {
  id: string;
  type: string;
  last4: string;
  brand: string;
  isDefault: boolean;
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

  // Pagination
  const [historyOffset, setHistoryOffset] = useState(0);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const HISTORY_PAGE_SIZE = 10;

  // Service breakdown
  const [serviceBreakdown, setServiceBreakdown] = useState<ServiceBreakdown[]>([]);

  // Summary stats
  const [summaryStats, setSummaryStats] = useState<SummaryStats>({
    weeklyTotal: 0, weeklyTrips: 0, weeklyHours: 0,
    monthlyTotal: 0, monthlyTrips: 0, monthlyHours: 0,
  });

  // Payment methods
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem(DRIVER_TOKEN_KEY) || getStoredToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }, []);

  const loadTripHistory = useCallback((offset: number, append: boolean = false) => {
    const headers = getHeaders();
    if (!append) setLoadingMore(false);
    else setLoadingMore(true);

    fetch(resolveUrl(`/api/driver/trip-history?limit=${HISTORY_PAGE_SIZE}&offset=${offset}`), { headers })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.trips?.length) {
          const mapped = data.trips.map((t: any) => ({
            id: t.publicId || `TRP-${t.id}`,
            time: t.completedAt ? new Date(t.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
            passenger: t.patientName || "Patient",
            amount: (t.totalCents || 0) / 100,
            distance: t.distanceMiles ? `${t.distanceMiles.toFixed(1)} mi` : "-",
            duration: t.durationMinutes ? `${t.durationMinutes} min` : "-",
            serviceType: t.serviceType || "transport",
          }));
          setTripHistory((prev) => append ? [...prev, ...mapped] : mapped);
          setHasMoreHistory(data.trips.length >= HISTORY_PAGE_SIZE);
          setHistoryOffset(offset + data.trips.length);
        } else {
          if (!append) setTripHistory([]);
          setHasMoreHistory(false);
        }
      })
      .catch(() => { if (!append) setTripHistory([]); })
      .finally(() => setLoadingMore(false));
  }, [getHeaders]);

  useEffect(() => {
    const headers = getHeaders();

    // Load initial trip history
    loadTripHistory(0, false);

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
          // Service type breakdown from earnings response
          if (data.serviceBreakdown && Array.isArray(data.serviceBreakdown)) {
            setServiceBreakdown(data.serviceBreakdown.map((s: any) => ({
              serviceType: s.serviceType || "transport",
              count: s.tripCount || 0,
              totalAmount: (s.totalCents || 0) / 100,
            })));
          }
        }
      })
      .catch(() => {});

    // Weekly + Monthly summary stats
    Promise.all([
      fetch(resolveUrl("/api/driver/earnings?range=week"), { headers }).then((r) => r.ok ? r.json() : null),
      fetch(resolveUrl("/api/driver/earnings?range=month"), { headers }).then((r) => r.ok ? r.json() : null),
    ]).then(([weekData, monthData]) => {
      setSummaryStats({
        weeklyTotal: weekData ? (weekData.totalCents || 0) / 100 : 0,
        weeklyTrips: weekData?.tripCount || 0,
        weeklyHours: weekData?.onlineHours || 0,
        monthlyTotal: monthData ? (monthData.totalCents || 0) / 100 : 0,
        monthlyTrips: monthData?.tripCount || 0,
        monthlyHours: monthData?.onlineHours || 0,
      });
      if (monthData) setMonthlyEarnings((monthData.totalCents || 0) / 100);
    }).catch(() => {});

    // Payment methods
    fetch(resolveUrl("/api/driver/payment-methods"), { headers })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.methods && Array.isArray(data.methods)) {
          setPaymentMethods(data.methods);
        }
      })
      .catch(() => {});
  }, [period, completedRides, getHeaders, loadTripHistory]);

  const handleLoadMore = useCallback(() => {
    loadTripHistory(historyOffset, true);
  }, [historyOffset, loadTripHistory]);

  const displayAmount = period === "day" ? earningsToday : period === "week" ? earningsWeek : (monthlyEarnings || earningsWeek * 4);

  const SERVICE_LABELS: Record<string, string> = {
    transport: "Medical",
    ambulatory: "Ambulatory",
    wheelchair: "Wheelchair",
    stretcher: "Stretcher",
    bariatric: "Bariatric",
    gurney: "Gurney",
    long_distance: "Long Dist",
    delivery: "Delivery",
    multi_load: "Multi-Load",
  };

  const SERVICE_COLORS: Record<string, string> = {
    transport: colors.sunrise,
    ambulatory: colors.success,
    wheelchair: colors.sky,
    stretcher: colors.warning,
    bariatric: colors.coral,
    gurney: colors.ocean,
    long_distance: "#8B5CF6",
    delivery: colors.golden,
    multi_load: "#EC4899",
  };

  return (
    <NebulaBackground>
      <div className="max-w-md mx-auto w-full px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-11 h-11 rounded-full min-h-[44px] min-w-[44px]"
            style={{ background: "rgba(255,255,255,0.80)", color: colors.textPrimary, boxShadow: colors.shadowSm, border: "1px solid rgba(0,0,0,0.04)" }}
            data-testid="btn-back"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5" aria-hidden="true" />
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
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-all min-h-[44px]"
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
                <DollarSign className="w-4 h-4" aria-hidden="true" style={{ color: colors.sunrise }} />
              </div>
              <p className="text-sm font-bold" style={{ color: colors.textPrimary }}>${stats.avgPerTrip.toFixed(2)}</p>
              <p className="text-[9px] uppercase tracking-wider font-medium" style={{ color: colors.textTertiary }}>Avg/Trip</p>
            </div>
            <div className="text-center">
              <div className="w-8 h-8 rounded-xl mx-auto mb-1.5 flex items-center justify-center" style={{ background: "rgba(74,144,217,0.08)" }}>
                <Clock className="w-4 h-4" aria-hidden="true" style={{ color: colors.sky }} />
              </div>
              <p className="text-sm font-bold" style={{ color: colors.textPrimary }}>{stats.onlineHours.toFixed(1)}h</p>
              <p className="text-[9px] uppercase tracking-wider font-medium" style={{ color: colors.textTertiary }}>Online</p>
            </div>
            <div className="text-center">
              <div className="w-8 h-8 rounded-xl mx-auto mb-1.5 flex items-center justify-center" style={{ background: "rgba(52,199,89,0.08)" }}>
                <TrendingUp className="w-4 h-4" aria-hidden="true" style={{ color: colors.success }} />
              </div>
              <p className="text-sm font-bold" style={{ color: colors.textPrimary }}>${stats.perHour.toFixed(2)}</p>
              <p className="text-[9px] uppercase tracking-wider font-medium" style={{ color: colors.textTertiary }}>$/Hour</p>
            </div>
          </div>
        </GlassCard>

        {/* Weekly / Monthly Summary */}
        <GlassCard variant="default" testID="card-period-summary" className="!p-4">
          <p className="text-[10px] uppercase tracking-wider mb-3 px-1 font-semibold" style={{ color: colors.textTertiary }}>
            Summary
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-2xl" style={{ background: "rgba(255,107,53,0.05)", border: "1px solid rgba(255,107,53,0.08)" }}>
              <p className="text-[9px] uppercase tracking-wider font-semibold mb-1" style={{ color: colors.textTertiary }}>This Week</p>
              <p className="text-lg font-bold" style={{ color: colors.sunrise }}>${summaryStats.weeklyTotal.toFixed(2)}</p>
              <p className="text-[10px]" style={{ color: colors.textTertiary }}>
                {summaryStats.weeklyTrips} trips • {summaryStats.weeklyHours.toFixed(1)}h
              </p>
            </div>
            <div className="p-3 rounded-2xl" style={{ background: "rgba(74,144,217,0.05)", border: "1px solid rgba(74,144,217,0.08)" }}>
              <p className="text-[9px] uppercase tracking-wider font-semibold mb-1" style={{ color: colors.textTertiary }}>This Month</p>
              <p className="text-lg font-bold" style={{ color: colors.sky }}>${summaryStats.monthlyTotal.toFixed(2)}</p>
              <p className="text-[10px]" style={{ color: colors.textTertiary }}>
                {summaryStats.monthlyTrips} trips • {summaryStats.monthlyHours.toFixed(1)}h
              </p>
            </div>
          </div>
        </GlassCard>

        {/* Earnings by Service Type */}
        {serviceBreakdown.length > 0 && (
          <GlassCard variant="default" testID="card-service-breakdown" className="!p-4">
            <div className="flex items-center gap-2 mb-3 px-1">
              <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" style={{ color: colors.textTertiary }} />
              <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: colors.textTertiary }}>
                By Service Type
              </p>
            </div>
            <div className="space-y-2.5">
              {serviceBreakdown.map((item) => {
                const color = SERVICE_COLORS[item.serviceType] || colors.sunrise;
                const maxAmount = Math.max(...serviceBreakdown.map((s) => s.totalAmount), 1);
                const barWidth = (item.totalAmount / maxAmount) * 100;
                return (
                  <div key={item.serviceType} data-testid={`breakdown-${item.serviceType}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium" style={{ color: colors.textPrimary }}>
                        {SERVICE_LABELS[item.serviceType] || item.serviceType}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px]" style={{ color: colors.textTertiary }}>{item.count} trips</span>
                        <span className="text-xs font-bold" style={{ color }}>${item.totalAmount.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.04)" }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${barWidth}%` }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                        className="h-full rounded-full"
                        style={{ background: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        )}

        {/* Payment Method */}
        <GlassCard variant="default" testID="card-payment-method" className="!p-4">
          <div className="flex items-center gap-2 mb-2 px-1">
            <CreditCard className="w-3.5 h-3.5" aria-hidden="true" style={{ color: colors.textTertiary }} />
            <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: colors.textTertiary }}>
              Payment Method
            </p>
          </div>
          {paymentMethods.length > 0 ? (
            <div className="space-y-2">
              {paymentMethods.map((pm) => (
                <div
                  key={pm.id}
                  className="flex items-center justify-between py-2.5 px-3 rounded-xl"
                  style={{
                    background: pm.isDefault ? glowColor(colors.sunrise, 0.05) : "rgba(0,0,0,0.02)",
                    border: `1px solid ${pm.isDefault ? glowColor(colors.sunrise, 0.1) : "rgba(0,0,0,0.04)"}`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: "rgba(0,0,0,0.04)" }}
                    >
                      <Wallet className="w-4 h-4" aria-hidden="true" style={{ color: colors.textSecondary }} />
                    </div>
                    <div>
                      <p className="text-xs font-medium" style={{ color: colors.textPrimary }}>
                        {pm.brand} •••• {pm.last4}
                      </p>
                      <p className="text-[10px]" style={{ color: colors.textTertiary }}>
                        {pm.type === "bank_account" ? "Bank Account" : "Card"}
                      </p>
                    </div>
                  </div>
                  {pm.isDefault && (
                    <span
                      className="text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider"
                      style={{ background: glowColor(colors.success, 0.1), color: colors.success }}
                    >
                      Default
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-3 py-3 px-1">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(0,0,0,0.03)" }}
                >
                  <Wallet className="w-4 h-4" aria-hidden="true" style={{ color: colors.textTertiary }} />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium" style={{ color: colors.textSecondary }}>
                    Direct Deposit
                  </p>
                  <p className="text-[10px]" style={{ color: colors.textTertiary }}>
                    Earnings deposited to your account on file
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(0,0,0,0.02)" }}>
                <Settings className="w-3.5 h-3.5" aria-hidden="true" style={{ color: colors.sky }} />
                <p className="text-[10px]" style={{ color: colors.textSecondary }}>
                  To update your payment method, contact your dispatcher or admin.
                </p>
              </div>
            </div>
          )}
        </GlassCard>

        {/* Trip history with pagination */}
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
                key={`${trip.id}-${i}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i, 9) * 0.05 }}
              >
                <GlassCard variant="default" className="!p-3 !rounded-2xl" testID={`trip-history-${trip.id}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center"
                        style={{ background: glowColor(SERVICE_COLORS[trip.serviceType || "transport"] || colors.sunrise, 0.08) }}
                      >
                        <Calendar className="w-4 h-4" aria-hidden="true" style={{ color: SERVICE_COLORS[trip.serviceType || "transport"] || colors.sunrise }} />
                      </div>
                      <div>
                        <p className="text-sm font-medium" style={{ color: colors.textPrimary }}>{trip.passenger}</p>
                        <p className="text-[10px]" style={{ color: colors.textTertiary }}>
                          {trip.time} • {trip.distance} • {trip.duration}
                          {trip.serviceType && trip.serviceType !== "transport" && (
                            <> • {SERVICE_LABELS[trip.serviceType] || trip.serviceType}</>
                          )}
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

            {/* Load More button */}
            {hasMoreHistory && tripHistory.length > 0 && (
              <motion.button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 mt-2 min-h-[44px]"
                style={{
                  background: "rgba(255,255,255,0.72)",
                  border: "1px solid rgba(0,0,0,0.06)",
                  boxShadow: colors.shadowSm,
                  cursor: loadingMore ? "not-allowed" : "pointer",
                  opacity: loadingMore ? 0.6 : 1,
                }}
                whileTap={{ scale: 0.97 }}
                data-testid="btn-load-more"
              >
                {loadingMore ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" style={{ color: colors.sunrise }} />
                ) : (
                  <ChevronDown className="w-4 h-4" aria-hidden="true" style={{ color: colors.sunrise }} />
                )}
                <span className="text-xs font-semibold" style={{ color: colors.sunrise }}>
                  {loadingMore ? "Loading..." : "Load More Trips"}
                </span>
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </NebulaBackground>
  );
}
