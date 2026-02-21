import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useMemo } from "react";
import {
  Wallet, Star, MapPin, Car, Bell, MessageCircle,
  ChevronRight, Zap, Clock, TrendingUp, Shield
} from "lucide-react";
import { useDriverStore } from "../store/driverStore";
import { useReducedMotion } from "../design/accessibility";
import { colors, glowPresets } from "../design/tokens";
import { glowColor } from "../design/theme";
import { GlassCard } from "../components/ui/GlassCard";
import { NeonButton } from "../components/ui/NeonButton";
import { GlassButton } from "../components/ui/GlassButton";
import { StatusToggle } from "../components/ui/StatusToggle";
import { GlowProgressCircle } from "../components/ui/GlowProgressCircle";
import { NebulaBackground } from "../components/ui/MapOverlay";

function AvailabilityChip() {
  const driverStatus = useDriverStore((s) => s.driverStatus);
  const shiftStatus = useDriverStore((s) => s.shiftStatus);
  const tripPhase = useDriverStore((s) => s.tripPhase);

  let label: string;
  let chipColor: string;
  let glowShadow: string;

  if (driverStatus === "offline") {
    label = "OFFLINE";
    chipColor = "rgba(255,255,255,0.15)";
    glowShadow = "none";
  } else if (shiftStatus === "offShift") {
    label = "OFF SHIFT";
    chipColor = "rgba(255,170,0,0.25)";
    glowShadow = `0 0 12px ${glowColor(colors.warningNeon, 0.3)}`;
  } else if (tripPhase !== "none" && tripPhase !== "complete") {
    label = "BUSY";
    chipColor = "rgba(255,0,170,0.25)";
    glowShadow = `0 0 12px ${glowColor(colors.neonMagenta, 0.3)}`;
  } else {
    label = "AVAILABLE";
    chipColor = "rgba(0,255,136,0.25)";
    glowShadow = `0 0 12px ${glowColor(colors.successNeon, 0.3)}`;
  }

  return (
    <motion.div
      layout
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
      style={{
        background: chipColor,
        boxShadow: glowShadow,
        border: "1px solid rgba(255,255,255,0.1)",
      }}
      data-testid="chip-availability"
    >
      <motion.div
        className="w-2 h-2 rounded-full"
        style={{ background: label === "AVAILABLE" ? colors.successNeon : label === "BUSY" ? colors.neonMagenta : label === "OFF SHIFT" ? colors.warningNeon : "rgba(255,255,255,0.3)" }}
        animate={label === "AVAILABLE" ? { scale: [1, 1.3, 1], opacity: [1, 0.6, 1] } : {}}
        transition={{ duration: 2, repeat: Infinity }}
      />
      <span
        className="text-[10px] font-bold tracking-[0.2em]"
        style={{ color: colors.textPrimary, fontFamily: "'Space Grotesk', system-ui" }}
      >
        {label}
      </span>
    </motion.div>
  );
}

function StatsRow() {
  const earningsToday = useDriverStore((s) => s.earningsToday);
  const earningsWeek = useDriverStore((s) => s.earningsWeek);
  const rating = useDriverStore((s) => s.rating);
  const completedRides = useDriverStore((s) => s.completedRides);

  return (
    <div className="grid grid-cols-4 gap-2" data-testid="stats-row">
      <StatItem
        icon={<Wallet className="w-4 h-4" />}
        label="Today"
        value={`$${earningsToday.toFixed(0)}`}
        accent={colors.neonCyan}
        testID="stat-earnings-today"
      />
      <StatItem
        icon={<TrendingUp className="w-4 h-4" />}
        label="Week"
        value={`$${earningsWeek.toFixed(0)}`}
        accent={colors.neonPurple}
        testID="stat-earnings-week"
      />
      <StatItem
        icon={<Star className="w-4 h-4" />}
        label="Rating"
        value={rating.toFixed(2)}
        accent={colors.warningNeon}
        testID="stat-rating"
      />
      <StatItem
        icon={<Car className="w-4 h-4" />}
        label="Rides"
        value={String(completedRides)}
        accent={colors.neonMagenta}
        testID="stat-rides"
      />
    </div>
  );
}

function StatItem({ icon, label, value, accent, testID }: {
  icon: React.ReactNode; label: string; value: string; accent: string; testID: string;
}) {
  return (
    <div
      data-testid={testID}
      className="flex flex-col items-center gap-1 py-3 px-1 rounded-2xl"
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div style={{ color: accent }}>{icon}</div>
      <span className="text-base font-bold" style={{ color: colors.textPrimary, fontFamily: "'Space Grotesk', system-ui" }}>
        {value}
      </span>
      <span className="text-[9px] uppercase tracking-[0.15em]" style={{ color: colors.textTertiary }}>
        {label}
      </span>
    </div>
  );
}

function TripOfferCard() {
  const activeTrip = useDriverStore((s) => s.activeTrip);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const reduced = useReducedMotion();

  if (tripPhase !== "offer" || !activeTrip) return null;

  return (
    <motion.div
      initial={reduced ? {} : { y: 60, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={reduced ? {} : { y: -30, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
    >
      <GlassCard variant="elevated" glowAccent={colors.neonCyan} testID="card-trip-offer">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" style={{ color: colors.neonCyan }} />
              <span className="text-xs font-bold tracking-[0.15em] uppercase" style={{ color: colors.neonCyan }}>
                New Trip Offer
              </span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(0,240,255,0.15)", color: colors.neonCyan }}>
              {activeTrip.etaMinutes} min away
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: colors.successNeon }} />
              <div>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>Pickup</span>
                <p className="text-sm" style={{ color: colors.textPrimary }}>{activeTrip.pickupAddress}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: colors.dangerNeon }} />
              <div>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>Dropoff</span>
                <p className="text-sm" style={{ color: colors.textPrimary }}>{activeTrip.dropoffAddress}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Shield className="w-3.5 h-3.5" style={{ color: colors.textTertiary }} />
            <span className="text-xs" style={{ color: colors.textSecondary }}>
              {activeTrip.passengerName} • {activeTrip.tripType || "Standard"}
            </span>
          </div>
          {activeTrip.notes && (
            <p className="text-xs italic px-2 py-1.5 rounded-lg" style={{ color: colors.textTertiary, background: "rgba(255,255,255,0.04)" }}>
              {activeTrip.notes}
            </p>
          )}
        </div>
      </GlassCard>
    </motion.div>
  );
}

function ActiveTripMiniCard() {
  const activeTrip = useDriverStore((s) => s.activeTrip);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const reduced = useReducedMotion();

  const activePhasesVisible = ["toPickup", "arrivedPickup", "waiting", "pickedUp", "toDropoff", "arrivedDropoff"];
  if (!activeTrip || !activePhasesVisible.includes(tripPhase)) return null;

  const isPickupPhase = ["toPickup", "arrivedPickup", "waiting"].includes(tripPhase);
  const address = isPickupPhase ? activeTrip.pickupAddress : activeTrip.dropoffAddress;
  const phaseLabel = isPickupPhase ? "En Route to Pickup" : "En Route to Dropoff";

  return (
    <motion.div
      initial={reduced ? {} : { y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
    >
      <GlassCard variant="default" glowAccent={colors.neonMagenta} testID="card-active-trip-mini">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <motion.div
                className="w-2 h-2 rounded-full"
                style={{ background: colors.neonMagenta }}
                animate={{ scale: [1, 1.4, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              <span className="text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: colors.neonMagenta }}>
                {phaseLabel}
              </span>
            </div>
            <p className="text-sm truncate" style={{ color: colors.textPrimary }}>
              {address}
            </p>
            <p className="text-xs mt-0.5" style={{ color: colors.textTertiary }}>
              {activeTrip.passengerName} • {activeTrip.id}
            </p>
          </div>
          <GlowProgressCircle
            progress={0.65}
            label={`${activeTrip.etaMinutes}m`}
            size={56}
            accentColor={colors.neonMagenta}
            testID="progress-trip-eta"
          />
        </div>
      </GlassCard>
    </motion.div>
  );
}

export function Dashboard({ onNavigate }: { onNavigate?: (screen: string) => void }) {
  const driverStatus = useDriverStore((s) => s.driverStatus);
  const shiftStatus = useDriverStore((s) => s.shiftStatus);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const setOnline = useDriverStore((s) => s.setOnline);
  const setOffline = useDriverStore((s) => s.setOffline);
  const startShift = useDriverStore((s) => s.startShift);
  const endShift = useDriverStore((s) => s.endShift);
  const store = useDriverStore();

  const nextAction = useMemo(() => store.getNextAction(), [driverStatus, shiftStatus, tripPhase]);

  const handleNextAction = useCallback(() => {
    const fn = (store as any)[nextAction.actionKey];
    if (typeof fn === "function") fn();
  }, [nextAction.actionKey, store]);

  const isOnline = driverStatus === "online";
  const showTripOffer = tripPhase === "offer";

  return (
    <NebulaBackground className="flex flex-col">
      <div className="relative flex-1 flex flex-col min-h-screen max-w-md mx-auto w-full">
        <div className="relative w-full flex-1" style={{ minHeight: 200 }}>
          <div
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(circle at 30% 40%, rgba(0,240,255,0.03) 0%, transparent 60%),
                radial-gradient(circle at 70% 60%, rgba(168,85,247,0.03) 0%, transparent 60%)
              `,
            }}
            data-testid="map-placeholder"
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center" style={{ color: colors.textTertiary }}>
                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <span className="text-xs tracking-wider uppercase opacity-30">Map View</span>
              </div>
            </div>
          </div>

          <div className="absolute top-0 left-0 right-0 z-30 px-4 pt-4 pb-2"
            style={{
              background: "linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.4) 70%, transparent 100%)",
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{
                    background: `linear-gradient(135deg, ${colors.neonCyan}, ${colors.neonPurple})`,
                    color: "#000",
                    boxShadow: `0 0 16px ${glowColor(colors.neonCyan, 0.3)}`,
                    fontFamily: "'Space Grotesk', system-ui",
                  }}
                  data-testid="avatar-ring"
                >
                  JD
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: colors.textPrimary }}>
                    John Driver
                  </p>
                  <AvailabilityChip />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <GlassButton
                  icon={<Wallet className="w-4.5 h-4.5" />}
                  onPress={() => onNavigate?.("earnings")}
                  label="Wallet"
                  testID="btn-wallet"
                  size={38}
                />
                <GlassButton
                  icon={<Bell className="w-4.5 h-4.5" />}
                  onPress={() => {}}
                  label="Notifications"
                  badge={3}
                  testID="btn-notifications"
                  size={38}
                />
              </div>
            </div>
          </div>
        </div>

        <div
          className="relative z-20 px-4 pb-6 space-y-3 -mt-8"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 60%, transparent 100%)",
          }}
        >
          <GlassCard variant="elevated" testID="card-controls" className="!p-4">
            <div className="flex items-center justify-between mb-3">
              <StatusToggle
                value={isOnline}
                onChange={(val) => (val ? setOnline() : setOffline())}
                testID="toggle-online"
              />
              {isOnline && (
                <motion.button
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => (shiftStatus === "offShift" ? startShift() : endShift())}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wider uppercase"
                  style={{
                    background: shiftStatus === "onShift" ? "rgba(0,255,136,0.15)" : "rgba(255,170,0,0.15)",
                    color: shiftStatus === "onShift" ? colors.successNeon : colors.warningNeon,
                    border: `1px solid ${shiftStatus === "onShift" ? glowColor(colors.successNeon, 0.3) : glowColor(colors.warningNeon, 0.3)}`,
                    fontFamily: "'Space Grotesk', system-ui",
                  }}
                  whileTap={{ scale: 0.95 }}
                  data-testid="btn-shift"
                >
                  <Clock className="w-3.5 h-3.5" />
                  {shiftStatus === "onShift" ? "End Shift" : "Start Shift"}
                </motion.button>
              )}
            </div>

            <StatsRow />
          </GlassCard>

          <AnimatePresence mode="wait">
            {showTripOffer && <TripOfferCard key="trip-offer" />}
          </AnimatePresence>

          <ActiveTripMiniCard />

          <NeonButton
            title={nextAction.label}
            onPress={handleNextAction}
            disabled={nextAction.disabled}
            variant={nextAction.variant}
            testID="btn-next-action"
            icon={nextAction.actionKey === "simulateTripOffer" ? <Zap className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          />

          {nextAction.hint && (
            <p className="text-center text-xs" style={{ color: colors.textTertiary }}>
              {nextAction.hint}
            </p>
          )}

          <div className="flex justify-center gap-4 pt-1">
            <GlassButton
              icon={<MessageCircle className="w-4 h-4" />}
              onPress={() => {}}
              label="Support"
              testID="btn-support"
              size={40}
              accentColor={colors.neonPurple}
            />
          </div>
        </div>
      </div>
    </NebulaBackground>
  );
}
