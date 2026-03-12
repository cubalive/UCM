import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { useCallback, useMemo, useState, useEffect } from "react";
import {
  Wallet, Star, MapPin, Car, Clock, TrendingUp, Shield,
  Zap, Navigation, Phone, ChevronUp, ChevronDown, Package, Ambulance,
  Accessibility, BedDouble, Weight, Route, Users, Check, X, Loader2
} from "lucide-react";
import { useDriverStore, type ServiceFilter } from "../store/driverStore";
import { useReducedMotion } from "../design/accessibility";
import { colors } from "../design/tokens";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { glowColor, statusGradient } from "../design/theme";
import { GlassCard } from "../components/ui/GlassCard";
import { NeonButton } from "../components/ui/NeonButton";
import { DriverTripMap } from "../components/DriverTripMap";

/* ─── Availability status pill ─── */
function StatusPill() {
  const driverStatus = useDriverStore((s) => s.driverStatus);
  const shiftStatus = useDriverStore((s) => s.shiftStatus);
  const tripPhase = useDriverStore((s) => s.tripPhase);

  let label: string;
  let bgColor: string;
  let textColor: string;
  let dotColor: string;
  let animate = false;

  if (driverStatus === "offline") {
    label = "Offline";
    bgColor = "rgba(0,0,0,0.06)";
    textColor = colors.textTertiary;
    dotColor = colors.textTertiary;
  } else if (shiftStatus === "offShift") {
    label = "Online";
    bgColor = "rgba(255,149,0,0.12)";
    textColor = colors.warning;
    dotColor = colors.warning;
  } else if (tripPhase !== "none" && tripPhase !== "complete" && tripPhase !== "offer") {
    label = "In Trip";
    bgColor = "rgba(74,144,217,0.12)";
    textColor = colors.sky;
    dotColor = colors.sky;
  } else {
    label = "Available";
    bgColor = "rgba(52,199,89,0.12)";
    textColor = colors.success;
    dotColor = colors.success;
    animate = true;
  }

  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
      style={{ background: bgColor }}
    >
      <motion.div
        className="w-2 h-2 rounded-full"
        style={{ background: dotColor }}
        animate={animate ? { scale: [1, 1.4, 1], opacity: [1, 0.5, 1] } : {}}
        transition={{ duration: 2, repeat: Infinity }}
      />
      <span className="text-xs font-semibold" style={{ color: textColor }}>
        {label}
      </span>
    </div>
  );
}

/* ─── Connect / Go Online button ─── */
function ConnectButton() {
  const driverStatus = useDriverStore((s) => s.driverStatus);
  const shiftStatus = useDriverStore((s) => s.shiftStatus);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const actionLoading = useDriverStore((s) => s.actionLoading);
  const connectAndStartShift = useDriverStore((s) => s.connectAndStartShift);
  const setOffline = useDriverStore((s) => s.setOffline);
  const endShift = useDriverStore((s) => s.endShift);
  const reduced = useReducedMotion();
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  const isFullyOnline = driverStatus === "online" && shiftStatus === "onShift";
  const hasTripActivity = tripPhase !== "none" && tripPhase !== "complete";

  if (hasTripActivity) return null;

  const handlePress = useCallback(() => {
    if (actionLoading) return;
    if (isFullyOnline) {
      setShowEndConfirm(true);
    } else {
      connectAndStartShift();
    }
  }, [isFullyOnline, actionLoading, connectAndStartShift]);

  const confirmEndShift = useCallback(() => {
    setShowEndConfirm(false);
    endShift().then(() => setOffline());
  }, [endShift, setOffline]);

  return (
    <>
      <div className="flex flex-col items-center gap-3">
        <motion.button
          onClick={handlePress}
          className="relative flex items-center justify-center rounded-full"
          style={{
            width: 80,
            height: 80,
            background: isFullyOnline
              ? `linear-gradient(135deg, ${colors.success}, #2BB84E)`
              : `linear-gradient(135deg, ${colors.sunrise}, ${colors.golden})`,
            boxShadow: isFullyOnline
              ? `0 8px 32px rgba(52,199,89,0.4)`
              : `0 8px 32px rgba(255,107,53,0.35)`,
            border: "4px solid rgba(255,255,255,0.9)",
            opacity: actionLoading ? 0.7 : 1,
          }}
          whileHover={!reduced && !actionLoading ? { scale: 1.08 } : undefined}
          whileTap={!reduced && !actionLoading ? { scale: 0.92 } : undefined}
          data-testid="btn-connect"
          aria-label={isFullyOnline ? "Go Offline" : "Go Online"}
          disabled={actionLoading}
        >
          {/* Pulse ring */}
          {!reduced && !actionLoading && (
            <motion.div
              className="absolute inset-[-6px] rounded-full"
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.3, 0, 0.3],
              }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
              style={{
                border: `2px solid ${isFullyOnline ? colors.success : colors.sunrise}`,
                pointerEvents: "none",
              }}
            />
          )}
          <div className="flex flex-col items-center">
            {actionLoading ? (
              <Loader2 className="w-7 h-7 text-white animate-spin" />
            ) : (
              <Zap className="w-7 h-7 text-white" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.2))" }} />
            )}
            <span className="text-[9px] font-bold tracking-wider uppercase text-white/80 mt-0.5">
              {actionLoading ? "..." : isFullyOnline ? "STOP" : "GO"}
            </span>
          </div>
        </motion.button>
        <span className="text-xs font-medium" style={{ color: colors.textSecondary }}>
          {actionLoading ? "Please wait..." : isFullyOnline ? "Tap to go offline" : "Tap to go online"}
        </span>
      </div>
      <ConfirmDialog
        open={showEndConfirm}
        title="End Shift?"
        message="Make sure all your trips are complete before ending your shift. This will set you offline."
        confirmLabel="End Shift"
        cancelLabel="Keep Working"
        variant="danger"
        onConfirm={confirmEndShift}
        onCancel={() => setShowEndConfirm(false)}
      />
    </>
  );
}

/* ─── Stats Card ─── */
function QuickStats() {
  const earningsToday = useDriverStore((s) => s.earningsToday);
  const completedRides = useDriverStore((s) => s.completedRides);
  const rating = useDriverStore((s) => s.rating);

  return (
    <div className="flex items-center gap-2">
      {[
        { icon: <Wallet className="w-3.5 h-3.5" />, value: `$${earningsToday.toFixed(0)}`, color: colors.sunrise },
        { icon: <Star className="w-3.5 h-3.5" />, value: rating.toFixed(1), color: colors.warning },
        { icon: <Car className="w-3.5 h-3.5" />, value: String(completedRides), color: colors.sky },
      ].map((stat, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl"
          style={{
            background: "rgba(255,255,255,0.80)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(0,0,0,0.04)",
            boxShadow: colors.shadowSm,
          }}
        >
          <span style={{ color: stat.color }}>{stat.icon}</span>
          <span className="text-xs font-bold" style={{ color: colors.textPrimary }}>
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Offer Countdown Hook ─── */
function useOfferCountdown(): number {
  const expiresAt = useDriverStore((s) => s.offerExpiresAt);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!expiresAt) { setSeconds(0); return; }
    const update = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSeconds(remaining);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return seconds;
}

/* ─── Swipeable Trip Offer Card ─── */
function SwipeableTripOffer() {
  const activeTrip = useDriverStore((s) => s.activeTrip);
  const pendingOffer = useDriverStore((s) => s.pendingOffer);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const acceptOffer = useDriverStore((s) => s.acceptOffer);
  const declineOffer = useDriverStore((s) => s.declineOffer);
  const actionLoading = useDriverStore((s) => s.actionLoading);
  const reduced = useReducedMotion();
  const countdown = useOfferCountdown();

  const x = useMotionValue(0);
  const rotateZ = useTransform(x, [-200, 0, 200], [-8, 0, 8]);
  const acceptOpacity = useTransform(x, [0, 100], [0, 1]);
  const declineOpacity = useTransform(x, [-100, 0], [1, 0]);

  if (tripPhase !== "offer" || !activeTrip) return null;

  const etaToPickup = pendingOffer?.etaToPickupMinutes || activeTrip.etaMinutes || 12;
  const estimatedTrip = pendingOffer?.estimatedTripMinutes || 25;

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.x > 120) {
      acceptOffer();
    } else if (info.offset.x < -120) {
      declineOffer();
    }
  };

  return (
    <motion.div
      initial={reduced ? {} : { y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={reduced ? {} : { y: 80, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className="absolute bottom-0 left-0 right-0 z-40 px-4 pb-4"
    >
      {/* Swipe hint indicators */}
      <div className="flex items-center justify-between px-6 mb-2">
        <motion.div
          className="flex items-center gap-1 px-3 py-1 rounded-full"
          style={{ opacity: declineOpacity, background: colors.dangerLight }}
        >
          <X className="w-3.5 h-3.5" style={{ color: colors.danger }} />
          <span className="text-[10px] font-semibold" style={{ color: colors.danger }}>Decline</span>
        </motion.div>
        <motion.div
          className="flex items-center gap-1 px-3 py-1 rounded-full"
          style={{ opacity: acceptOpacity, background: colors.successLight }}
        >
          <Check className="w-3.5 h-3.5" style={{ color: colors.success }} />
          <span className="text-[10px] font-semibold" style={{ color: colors.success }}>Accept</span>
        </motion.div>
      </div>

      {/* Draggable card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        onDragEnd={handleDragEnd}
        style={{ x, rotateZ }}
        className="cursor-grab active:cursor-grabbing"
        data-testid="card-trip-offer"
      >
        <div
          className="rounded-3xl overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(0,0,0,0.06)",
            boxShadow: colors.shadowXl,
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-2">
            <div className="flex items-center gap-2">
              <motion.div
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: `linear-gradient(135deg, ${colors.sunrise}, ${colors.golden})` }}
                animate={!reduced ? { scale: [1, 1.1, 1] } : {}}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Zap className="w-4 h-4 text-white" />
              </motion.div>
              <span className="text-sm font-bold" style={{ color: colors.textPrimary }}>
                {activeTrip.tripType === "Delivery" ? "New Delivery" : "New Trip Request"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {countdown > 0 && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums"
                  style={{
                    background: countdown <= 10 ? "rgba(255,59,48,0.1)" : "rgba(255,149,0,0.1)",
                    color: countdown <= 10 ? colors.danger : colors.warning,
                  }}
                >
                  {countdown}s
                </span>
              )}
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{
                background: "rgba(255,107,53,0.1)",
                color: colors.sunrise,
              }}>
                Swipe to respond
              </span>
            </div>
          </div>

          {/* ETA badges */}
          <div className="flex gap-3 px-5 py-3">
            <div
              className="flex-1 flex items-center gap-2.5 px-3.5 py-3 rounded-2xl"
              style={{
                background: "rgba(52,199,89,0.08)",
                border: "1px solid rgba(52,199,89,0.12)",
              }}
            >
              <Navigation className="w-4 h-4" style={{ color: colors.success }} />
              <div>
                <p className="text-lg font-bold leading-none" style={{ color: colors.success }}>
                  {etaToPickup} min
                </p>
                <p className="text-[9px] uppercase tracking-wider font-medium" style={{ color: colors.textTertiary }}>
                  To Pickup
                </p>
              </div>
            </div>
            <div
              className="flex-1 flex items-center gap-2.5 px-3.5 py-3 rounded-2xl"
              style={{
                background: "rgba(74,144,217,0.08)",
                border: "1px solid rgba(74,144,217,0.12)",
              }}
            >
              <Clock className="w-4 h-4" style={{ color: colors.sky }} />
              <div>
                <p className="text-lg font-bold leading-none" style={{ color: colors.sky }}>
                  {estimatedTrip} min
                </p>
                <p className="text-[9px] uppercase tracking-wider font-medium" style={{ color: colors.textTertiary }}>
                  Trip Duration
                </p>
              </div>
            </div>
          </div>

          {/* Addresses */}
          <div className="px-5 space-y-2.5 pb-3">
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center gap-0.5 pt-1">
                <div className="w-3 h-3 rounded-full" style={{ background: colors.success, boxShadow: `0 2px 6px ${glowColor(colors.success, 0.3)}` }} />
                <div className="w-0.5 h-6 rounded-full" style={{ background: "rgba(0,0,0,0.08)" }} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: colors.textTertiary }}>Pickup</span>
                <p className="text-sm truncate font-medium" style={{ color: colors.textPrimary }}>{activeTrip.pickupAddress}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center pt-1">
                <div className="w-3 h-3 rounded-full" style={{ background: colors.sunrise, boxShadow: `0 2px 6px ${glowColor(colors.sunrise, 0.3)}` }} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: colors.textTertiary }}>Dropoff</span>
                <p className="text-sm truncate font-medium" style={{ color: colors.textPrimary }}>{activeTrip.dropoffAddress}</p>
              </div>
            </div>
          </div>

          {/* Patient info */}
          <div className="flex items-center gap-2 px-5 pb-3">
            <Shield className="w-3.5 h-3.5" style={{ color: colors.textTertiary }} />
            <span className="text-xs" style={{ color: colors.textSecondary }}>
              {activeTrip.passengerName} • {activeTrip.tripType || "Medical"}
            </span>
          </div>

          {/* Fallback buttons (for non-gesture users) */}
          <div className="flex gap-3 px-5 pb-5">
            <motion.button
              onClick={() => declineOffer()}
              className="flex-1 py-3 rounded-2xl text-sm font-semibold"
              style={{
                background: colors.dangerLight,
                color: colors.danger,
                border: `1px solid rgba(255,59,48,0.15)`,
                opacity: actionLoading ? 0.6 : 1,
              }}
              whileTap={!reduced ? { scale: 0.95 } : undefined}
              data-testid="btn-decline-offer"
              disabled={actionLoading}
            >
              Decline
            </motion.button>
            <motion.button
              onClick={() => acceptOffer()}
              className="flex-[2] py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2"
              style={{
                background: `linear-gradient(135deg, ${colors.success}, #2BB84E)`,
                color: "#fff",
                boxShadow: `0 4px 16px rgba(52,199,89,0.3)`,
                opacity: actionLoading ? 0.7 : 1,
              }}
              whileHover={!reduced && !actionLoading ? { scale: 1.02 } : undefined}
              whileTap={!reduced && !actionLoading ? { scale: 0.95 } : undefined}
              data-testid="btn-accept-offer"
              disabled={actionLoading}
            >
              {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              Accept Trip
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Active Trip Bottom Card ─── */
function ActiveTripMapCard({ onOpenTrip }: { onOpenTrip: () => void }) {
  const activeTrip = useDriverStore((s) => s.activeTrip);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const store = useDriverStore();
  const reduced = useReducedMotion();

  const activePhasesVisible = ["toPickup", "arrivedPickup", "waiting", "toDropoff", "arrivedDropoff"];
  if (!activeTrip || !activePhasesVisible.includes(tripPhase)) return null;

  const isPickupPhase = ["toPickup", "arrivedPickup", "waiting"].includes(tripPhase);
  const phaseLabel = isPickupPhase ? "En route to pickup" : "Transporting patient";
  const address = isPickupPhase ? activeTrip.pickupAddress : activeTrip.dropoffAddress;
  const nextAction = store.getNextAction();

  const handleAction = () => {
    const fn = (store as any)[nextAction.actionKey];
    if (typeof fn === "function") fn();
  };

  const handleNavigate = () => {
    const destLat = isPickupPhase ? activeTrip.pickupLatLng.lat : activeTrip.dropoffLatLng.lat;
    const destLng = isPickupPhase ? activeTrip.pickupLatLng.lng : activeTrip.dropoffLatLng.lng;
    const pref = store.navPreference;

    if (pref === "waze") {
      window.open(`https://waze.com/ul?ll=${destLat},${destLng}&navigate=yes`, "_blank");
    } else if (pref === "apple") {
      window.open(`maps://maps.apple.com/?daddr=${destLat},${destLng}&dirflg=d`, "_blank");
    } else {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}&travelmode=driving`, "_blank");
    }
  };

  return (
    <motion.div
      initial={reduced ? {} : { y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="absolute bottom-0 left-0 right-0 z-40 px-4 pb-4"
    >
      <div
        className="rounded-3xl overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.95)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(0,0,0,0.06)",
          boxShadow: colors.shadowXl,
        }}
        data-testid="card-active-trip"
      >
        {/* Phase header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <motion.div
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: isPickupPhase ? colors.success : colors.sky }}
              animate={{ scale: [1, 1.4, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <span className="text-xs font-bold" style={{ color: isPickupPhase ? colors.success : colors.sky }}>
              {phaseLabel}
            </span>
          </div>
          <span className="text-lg font-bold" style={{ color: colors.textPrimary }}>
            {activeTrip.etaMinutes}m
          </span>
        </div>

        {/* Address & Patient */}
        <div className="px-5 pb-3">
          <p className="text-sm truncate font-medium" style={{ color: colors.textPrimary }}>{address}</p>
          <p className="text-[10px] mt-0.5" style={{ color: colors.textTertiary }}>
            {activeTrip.passengerName} • {activeTrip.id}
          </p>
        </div>

        {/* Action buttons row */}
        <div className="flex gap-2 px-5 pb-4">
          <motion.button
            onClick={handleNavigate}
            className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-2xl"
            style={{
              background: isPickupPhase
                ? `linear-gradient(135deg, ${colors.success}, #2BB84E)`
                : `linear-gradient(135deg, ${colors.sky}, ${colors.ocean})`,
              color: "#fff",
              boxShadow: isPickupPhase
                ? `0 4px 16px rgba(52,199,89,0.3)`
                : `0 4px 16px rgba(74,144,217,0.3)`,
            }}
            whileTap={!reduced ? { scale: 0.95 } : undefined}
            data-testid="btn-navigate"
          >
            <Navigation className="w-4 h-4" />
            <span className="text-xs font-semibold">Navigate</span>
          </motion.button>

          <motion.button
            onClick={() => onOpenTrip()}
            className="flex items-center justify-center px-3 py-3 rounded-2xl"
            style={{
              background: "rgba(0,0,0,0.04)",
              border: "1px solid rgba(0,0,0,0.06)",
            }}
            whileTap={!reduced ? { scale: 0.95 } : undefined}
            data-testid="btn-trip-details"
          >
            <ChevronUp className="w-4 h-4" style={{ color: colors.textSecondary }} />
          </motion.button>

          <motion.button
            onClick={handleAction}
            className="flex-1 py-3 rounded-2xl text-xs font-bold"
            style={{
              background: `linear-gradient(135deg, ${colors.sunrise}, ${colors.golden})`,
              color: "#fff",
              boxShadow: `0 4px 16px rgba(255,107,53,0.3)`,
            }}
            whileTap={!reduced ? { scale: 0.95 } : undefined}
            data-testid="btn-trip-action"
          >
            {nextAction.label}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Waiting indicator ─── */
function WaitingIndicator() {
  const driverStatus = useDriverStore((s) => s.driverStatus);
  const shiftStatus = useDriverStore((s) => s.shiftStatus);
  const tripPhase = useDriverStore((s) => s.tripPhase);

  if (driverStatus !== "online" || shiftStatus !== "onShift" || tripPhase !== "none") return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 px-4 py-2.5 rounded-full"
      style={{
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(52,199,89,0.15)",
        boxShadow: colors.shadowSm,
      }}
    >
      <motion.div
        className="w-2 h-2 rounded-full"
        style={{ background: colors.success }}
        animate={{ opacity: [1, 0.3, 1] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
      <span className="text-xs font-medium" style={{ color: colors.textSecondary }}>
        Searching for trips nearby...
      </span>
    </motion.div>
  );
}

/* ─── Service type filter ─── */
function ServiceFilterBar() {
  const serviceFilter = useDriverStore((s) => s.serviceFilter);
  const setServiceFilter = useDriverStore((s) => s.setServiceFilter);
  const driverStatus = useDriverStore((s) => s.driverStatus);
  const shiftStatus = useDriverStore((s) => s.shiftStatus);
  const tripPhase = useDriverStore((s) => s.tripPhase);

  if (driverStatus !== "online" || shiftStatus !== "onShift") return null;
  if (tripPhase !== "none" && tripPhase !== "offer") return null;

  const options: { value: ServiceFilter; label: string; icon: React.ReactNode }[] = [
    { value: "all", label: "All", icon: <Car className="w-3.5 h-3.5" /> },
    { value: "ambulatory", label: "Ambulatory", icon: <Ambulance className="w-3.5 h-3.5" /> },
    { value: "wheelchair", label: "Wheelchair", icon: <Accessibility className="w-3.5 h-3.5" /> },
    { value: "stretcher", label: "Stretcher", icon: <BedDouble className="w-3.5 h-3.5" /> },
    { value: "bariatric", label: "Bariatric", icon: <Weight className="w-3.5 h-3.5" /> },
    { value: "gurney", label: "Gurney", icon: <BedDouble className="w-3.5 h-3.5" /> },
    { value: "long_distance", label: "Long Dist", icon: <Route className="w-3.5 h-3.5" /> },
    { value: "multi_load", label: "Multi-Load", icon: <Users className="w-3.5 h-3.5" /> },
    { value: "delivery", label: "Delivery", icon: <Package className="w-3.5 h-3.5" /> },
  ];

  return (
    <div
      className="flex items-center gap-1 p-1 rounded-2xl overflow-x-auto no-scrollbar"
      style={{
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(0,0,0,0.04)",
        boxShadow: colors.shadowSm,
        maxWidth: "100vw",
      }}
      data-testid="service-filter-bar"
    >
      {options.map((opt) => {
        const isActive = serviceFilter === opt.value;
        return (
          <motion.button
            key={opt.value}
            onClick={() => setServiceFilter(opt.value)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl whitespace-nowrap"
            style={{
              background: isActive
                ? `linear-gradient(135deg, rgba(255,107,53,0.12), rgba(255,179,71,0.08))`
                : "transparent",
              border: isActive ? "1px solid rgba(255,107,53,0.2)" : "1px solid transparent",
              color: isActive ? colors.sunrise : colors.textTertiary,
            }}
            whileTap={{ scale: 0.95 }}
          >
            {opt.icon}
            <span className="text-[10px] font-semibold uppercase tracking-wider">
              {opt.label}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

/* ─── Map background ─── */
function MapBackground() {
  const activeTrip = useDriverStore((s) => s.activeTrip);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const driverLat = useDriverStore((s) => s.driverLat);
  const driverLng = useDriverStore((s) => s.driverLng);
  const driverHeading = useDriverStore((s) => s.driverHeading);

  const hasTrip = activeTrip && tripPhase !== "none" && tripPhase !== "complete";

  if (hasTrip) {
    return (
      <DriverTripMap
        pickupLat={activeTrip.pickupLatLng.lat}
        pickupLng={activeTrip.pickupLatLng.lng}
        dropoffLat={activeTrip.dropoffLatLng.lat}
        dropoffLng={activeTrip.dropoffLatLng.lng}
        driverLat={driverLat}
        driverLng={driverLng}
        driverHeading={driverHeading}
        phase={tripPhase}
        routePolyline={activeTrip.routePolyline}
        className="w-full h-full"
      />
    );
  }

  return (
    <DriverTripMap
      pickupLat={driverLat || 25.7617}
      pickupLng={driverLng || -80.1918}
      dropoffLat={driverLat || 25.7617}
      dropoffLng={driverLng || -80.1918}
      driverLat={driverLat}
      driverLng={driverLng}
      driverHeading={driverHeading}
      phase="none"
      className="w-full h-full"
    />
  );
}

/* ─── Main Dashboard ─── */
export function Dashboard({ onNavigate }: { onNavigate?: (screen: string) => void }) {
  const driverName = useDriverStore((s) => s.driverName);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const driverStatus = useDriverStore((s) => s.driverStatus);
  const shiftStatus = useDriverStore((s) => s.shiftStatus);

  const hasTripActivity = tripPhase !== "none" && tripPhase !== "complete";
  const showOffer = tripPhase === "offer";
  const showActiveTrip = hasTripActivity && !showOffer;
  const showConnectBtn = !hasTripActivity;

  const handleOpenTrip = useCallback(() => {
    onNavigate?.("activeTrip");
  }, [onNavigate]);

  return (
    <div className="relative w-full" style={{ height: "100%", minHeight: "100%" }}>
      {/* Full-screen map */}
      <div className="absolute inset-0 z-0">
        <MapBackground />
      </div>

      {/* Top bar overlay */}
      <div
        className="absolute top-0 left-0 right-0 z-30 px-4 pt-4 pb-8"
        style={{
          background: "linear-gradient(to bottom, rgba(250,250,248,0.92) 0%, rgba(250,250,248,0.4) 70%, transparent 100%)",
        }}
      >
        <div className="flex items-center justify-between">
          {/* Greeting + status */}
          <div>
            <p className="text-lg font-bold" style={{ color: colors.textPrimary }}>
              {getGreeting()}, {(driverName || "Driver").split(" ")[0]}
            </p>
            <StatusPill />
          </div>
          {/* Quick stats */}
          <QuickStats />
        </div>
      </div>

      {/* Service type filter */}
      <div className="absolute top-24 left-0 right-0 z-25 flex justify-center pointer-events-none">
        <div className="pointer-events-auto">
          <ServiceFilterBar />
        </div>
      </div>

      {/* Center content: connect button + waiting indicator */}
      {showConnectBtn && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none">
          <div className="pointer-events-auto">
            <ConnectButton />
          </div>
          <div className="mt-6 pointer-events-auto">
            <WaitingIndicator />
          </div>
        </div>
      )}

      {/* Trip offer overlay - swipeable */}
      <AnimatePresence>
        {showOffer && <SwipeableTripOffer key="trip-offer" />}
      </AnimatePresence>

      {/* Active trip card */}
      <AnimatePresence>
        {showActiveTrip && <ActiveTripMapCard key="active-trip" onOpenTrip={handleOpenTrip} />}
      </AnimatePresence>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
