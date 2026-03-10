import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useMemo } from "react";
import {
  Wallet, Star, MapPin, Car, Clock, TrendingUp, Shield,
  Zap, Navigation, Phone, ChevronUp, ChevronDown, Package, Ambulance,
  Accessibility, BedDouble, Weight, Route, Users
} from "lucide-react";
import { useDriverStore, type ServiceFilter } from "../store/driverStore";
import { useReducedMotion } from "../design/accessibility";
import { colors } from "../design/tokens";
import { glowColor } from "../design/theme";
import { GlassCard } from "../components/ui/GlassCard";
import { NeonButton } from "../components/ui/NeonButton";
import { DriverTripMap } from "../components/DriverTripMap";

/* ─── Availability status chip ─── */
function AvailabilityChip() {
  const driverStatus = useDriverStore((s) => s.driverStatus);
  const shiftStatus = useDriverStore((s) => s.shiftStatus);
  const tripPhase = useDriverStore((s) => s.tripPhase);

  let label: string;
  let chipColor: string;
  let dotColor: string;
  let animate = false;

  if (driverStatus === "offline") {
    label = "OFFLINE";
    chipColor = "rgba(255,255,255,0.12)";
    dotColor = "rgba(255,255,255,0.3)";
  } else if (shiftStatus === "offShift") {
    label = "ONLINE";
    chipColor = "rgba(255,170,0,0.2)";
    dotColor = colors.warningNeon;
  } else if (tripPhase !== "none" && tripPhase !== "complete" && tripPhase !== "offer") {
    label = "BUSY";
    chipColor = "rgba(255,0,170,0.2)";
    dotColor = colors.neonMagenta;
  } else {
    label = "AVAILABLE";
    chipColor = "rgba(0,255,136,0.2)";
    dotColor = colors.successNeon;
    animate = true;
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
      style={{ background: chipColor, border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <motion.div
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: dotColor }}
        animate={animate ? { scale: [1, 1.4, 1], opacity: [1, 0.5, 1] } : {}}
        transition={{ duration: 2, repeat: Infinity }}
      />
      <span className="text-[9px] font-bold tracking-[0.2em]" style={{ color: colors.textPrimary, fontFamily: "'Space Grotesk', system-ui" }}>
        {label}
      </span>
    </div>
  );
}

/* ─── Big round connect/start button ─── */
function ConnectButton() {
  const driverStatus = useDriverStore((s) => s.driverStatus);
  const shiftStatus = useDriverStore((s) => s.shiftStatus);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const connectAndStartShift = useDriverStore((s) => s.connectAndStartShift);
  const setOffline = useDriverStore((s) => s.setOffline);
  const endShift = useDriverStore((s) => s.endShift);
  const reduced = useReducedMotion();

  const isFullyOnline = driverStatus === "online" && shiftStatus === "onShift";
  const hasTripActivity = tripPhase !== "none" && tripPhase !== "complete";

  // Don't show the connect button when there's an active trip
  if (hasTripActivity) return null;

  const handlePress = useCallback(() => {
    if (isFullyOnline) {
      endShift();
      setOffline();
    } else {
      connectAndStartShift();
    }
  }, [isFullyOnline, connectAndStartShift, setOffline, endShift]);

  const size = 88;
  const bgColor = isFullyOnline
    ? `linear-gradient(135deg, ${colors.successNeon}, #00cc6a)`
    : `linear-gradient(135deg, ${colors.neonCyan}, ${colors.neonPurple})`;
  const glowShadow = isFullyOnline
    ? `0 0 30px ${glowColor(colors.successNeon, 0.5)}, 0 0 60px ${glowColor(colors.successNeon, 0.2)}`
    : `0 0 30px ${glowColor(colors.neonCyan, 0.5)}, 0 0 60px ${glowColor(colors.neonPurple, 0.2)}`;

  return (
    <div className="flex flex-col items-center gap-2">
      <motion.button
        onClick={handlePress}
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          background: bgColor,
          boxShadow: glowShadow,
          border: "2px solid rgba(255,255,255,0.2)",
        }}
        whileHover={!reduced ? { scale: 1.08 } : undefined}
        whileTap={!reduced ? { scale: 0.92 } : undefined}
        data-testid="btn-connect"
        aria-label={isFullyOnline ? "Disconnect" : "Connect & Start Shift"}
      >
        {/* Pulsing ring */}
        {!isFullyOnline && !reduced && (
          <motion.div
            className="absolute inset-0 rounded-full"
            animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            style={{ border: `2px solid ${colors.neonCyan}`, pointerEvents: "none" }}
          />
        )}
        {isFullyOnline && !reduced && (
          <motion.div
            className="absolute inset-0 rounded-full"
            animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0, 0.3] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            style={{ border: `2px solid ${colors.successNeon}`, pointerEvents: "none" }}
          />
        )}
        <div className="flex flex-col items-center">
          <Zap
            className="w-7 h-7"
            style={{
              color: "#000",
              filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))",
            }}
          />
          <span
            className="text-[8px] font-bold tracking-wider uppercase mt-0.5"
            style={{ color: "rgba(0,0,0,0.7)", fontFamily: "'Space Grotesk', system-ui" }}
          >
            {isFullyOnline ? "STOP" : "GO"}
          </span>
        </div>
      </motion.button>
      <span className="text-[10px] font-medium" style={{ color: colors.textSecondary, fontFamily: "'Space Grotesk', system-ui" }}>
        {isFullyOnline ? "Tap to disconnect" : "Tap to connect & start"}
      </span>
    </div>
  );
}

/* ─── Mini stats bar (overlay on map) ─── */
function StatsBar() {
  const earningsToday = useDriverStore((s) => s.earningsToday);
  const completedRides = useDriverStore((s) => s.completedRides);
  const rating = useDriverStore((s) => s.rating);

  return (
    <div
      className="flex items-center justify-around py-2 px-3 rounded-2xl"
      style={{
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
      data-testid="stats-bar"
    >
      <div className="flex items-center gap-1.5">
        <Wallet className="w-3.5 h-3.5" style={{ color: colors.neonCyan }} />
        <span className="text-xs font-bold" style={{ color: colors.textPrimary, fontFamily: "'Space Grotesk', system-ui" }}>
          ${earningsToday.toFixed(0)}
        </span>
      </div>
      <div className="w-px h-4" style={{ background: "rgba(255,255,255,0.1)" }} />
      <div className="flex items-center gap-1.5">
        <Star className="w-3.5 h-3.5" style={{ color: colors.warningNeon }} />
        <span className="text-xs font-bold" style={{ color: colors.textPrimary, fontFamily: "'Space Grotesk', system-ui" }}>
          {rating.toFixed(1)}
        </span>
      </div>
      <div className="w-px h-4" style={{ background: "rgba(255,255,255,0.1)" }} />
      <div className="flex items-center gap-1.5">
        <Car className="w-3.5 h-3.5" style={{ color: colors.neonMagenta }} />
        <span className="text-xs font-bold" style={{ color: colors.textPrimary, fontFamily: "'Space Grotesk', system-ui" }}>
          {completedRides}
        </span>
      </div>
    </div>
  );
}

/* ─── Trip Offer Card with ETA + Duration ─── */
function TripOfferCard() {
  const activeTrip = useDriverStore((s) => s.activeTrip);
  const pendingOffer = useDriverStore((s) => s.pendingOffer);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const acceptOffer = useDriverStore((s) => s.acceptOffer);
  const declineOffer = useDriverStore((s) => s.declineOffer);
  const reduced = useReducedMotion();

  if (tripPhase !== "offer" || !activeTrip) return null;

  const etaToPickup = pendingOffer?.etaToPickupMinutes || activeTrip.etaMinutes || 12;
  const estimatedTrip = pendingOffer?.estimatedTripMinutes || 25;

  return (
    <motion.div
      initial={reduced ? {} : { y: 100, opacity: 0, scale: 0.9 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={reduced ? {} : { y: 100, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className="absolute bottom-0 left-0 right-0 z-40 px-4 pb-6"
    >
      <div
        className="rounded-3xl overflow-hidden"
        style={{
          background: "rgba(10,0,21,0.92)",
          backdropFilter: "blur(30px)",
          WebkitBackdropFilter: "blur(30px)",
          border: `1px solid ${glowColor(colors.neonCyan, 0.3)}`,
          boxShadow: `0 -8px 40px rgba(0,0,0,0.6), 0 0 30px ${glowColor(colors.neonCyan, 0.15)}`,
        }}
        data-testid="card-trip-offer"
      >
        {/* Header with pulse */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <motion.div
              animate={!reduced ? { scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <Zap className="w-5 h-5" style={{ color: colors.neonCyan, filter: `drop-shadow(0 0 6px ${colors.neonCyan})` }} />
            </motion.div>
            <span className="text-sm font-bold tracking-wider uppercase" style={{ color: colors.neonCyan, fontFamily: "'Space Grotesk', system-ui" }}>
              {activeTrip.tripType === "Delivery" ? "New Delivery Request" : "New Trip Request"}
            </span>
          </div>
        </div>

        {/* ETA badges - prominent */}
        <div className="flex gap-3 px-5 pb-3">
          <div
            className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-2xl"
            style={{
              background: `linear-gradient(135deg, ${glowColor(colors.neonCyan, 0.15)}, ${glowColor(colors.neonCyan, 0.05)})`,
              border: `1px solid ${glowColor(colors.neonCyan, 0.2)}`,
            }}
          >
            <Navigation className="w-4 h-4" style={{ color: colors.neonCyan }} />
            <div>
              <p className="text-lg font-bold leading-none" style={{ color: colors.neonCyan, fontFamily: "'Space Grotesk', system-ui" }}>
                {etaToPickup} min
              </p>
              <p className="text-[9px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>
                To Pickup
              </p>
            </div>
          </div>
          <div
            className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-2xl"
            style={{
              background: `linear-gradient(135deg, ${glowColor(colors.neonPurple, 0.15)}, ${glowColor(colors.neonPurple, 0.05)})`,
              border: `1px solid ${glowColor(colors.neonPurple, 0.2)}`,
            }}
          >
            <Clock className="w-4 h-4" style={{ color: colors.neonPurple }} />
            <div>
              <p className="text-lg font-bold leading-none" style={{ color: colors.neonPurple, fontFamily: "'Space Grotesk', system-ui" }}>
                {estimatedTrip} min
              </p>
              <p className="text-[9px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>
                Trip Duration
              </p>
            </div>
          </div>
        </div>

        {/* Addresses */}
        <div className="px-5 space-y-2 pb-3">
          <div className="flex items-start gap-2">
            <div className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0" style={{ background: colors.successNeon, boxShadow: `0 0 6px ${colors.successNeon}` }} />
            <div className="flex-1 min-w-0">
              <span className="text-[9px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>Pickup</span>
              <p className="text-sm truncate" style={{ color: colors.textPrimary }}>{activeTrip.pickupAddress}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0" style={{ background: colors.neonMagenta, boxShadow: `0 0 6px ${colors.neonMagenta}` }} />
            <div className="flex-1 min-w-0">
              <span className="text-[9px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>Dropoff</span>
              <p className="text-sm truncate" style={{ color: colors.textPrimary }}>{activeTrip.dropoffAddress}</p>
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

        {/* Action buttons */}
        <div className="flex gap-3 px-5 pb-5">
          <motion.button
            onClick={() => declineOffer()}
            className="flex-1 py-3.5 rounded-2xl text-sm font-bold uppercase tracking-wider"
            style={{
              background: "rgba(255,51,85,0.12)",
              color: colors.dangerNeon,
              border: `1px solid ${glowColor(colors.dangerNeon, 0.3)}`,
              fontFamily: "'Space Grotesk', system-ui",
            }}
            whileTap={!reduced ? { scale: 0.95 } : undefined}
            data-testid="btn-decline-offer"
          >
            Decline
          </motion.button>
          <motion.button
            onClick={() => acceptOffer()}
            className="flex-[2] py-3.5 rounded-2xl text-sm font-bold uppercase tracking-wider"
            style={{
              background: `linear-gradient(135deg, ${colors.neonCyan}, ${colors.successNeon})`,
              color: "#000",
              boxShadow: `0 0 20px ${glowColor(colors.neonCyan, 0.4)}, 0 0 40px ${glowColor(colors.successNeon, 0.15)}`,
              fontFamily: "'Space Grotesk', system-ui",
            }}
            whileHover={!reduced ? { scale: 1.02 } : undefined}
            whileTap={!reduced ? { scale: 0.95 } : undefined}
            data-testid="btn-accept-offer"
          >
            Accept Trip
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Active Trip Bottom Card (mini card on map) ─── */
function ActiveTripMapCard({ onOpenTrip }: { onOpenTrip: () => void }) {
  const activeTrip = useDriverStore((s) => s.activeTrip);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const store = useDriverStore();
  const reduced = useReducedMotion();

  const activePhasesVisible = ["toPickup", "arrivedPickup", "waiting", "toDropoff", "arrivedDropoff"];
  if (!activeTrip || !activePhasesVisible.includes(tripPhase)) return null;

  const isPickupPhase = ["toPickup", "arrivedPickup", "waiting"].includes(tripPhase);
  const phaseLabel = isPickupPhase ? "En Route to Pickup" : "En Route to Dropoff";
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
      className="absolute bottom-0 left-0 right-0 z-40 px-4 pb-6"
    >
      <div
        className="rounded-3xl overflow-hidden"
        style={{
          background: "rgba(10,0,21,0.92)",
          backdropFilter: "blur(30px)",
          WebkitBackdropFilter: "blur(30px)",
          border: `1px solid ${glowColor(isPickupPhase ? colors.neonCyan : colors.neonMagenta, 0.3)}`,
          boxShadow: `0 -8px 40px rgba(0,0,0,0.6)`,
        }}
        data-testid="card-active-trip"
      >
        {/* Phase header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <motion.div
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: isPickupPhase ? colors.neonCyan : colors.neonMagenta }}
              animate={{ scale: [1, 1.4, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <span className="text-xs font-bold tracking-wider uppercase" style={{ color: isPickupPhase ? colors.neonCyan : colors.neonMagenta, fontFamily: "'Space Grotesk', system-ui" }}>
              {phaseLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold" style={{ color: colors.textPrimary, fontFamily: "'Space Grotesk', system-ui" }}>
              {activeTrip.etaMinutes}m
            </span>
          </div>
        </div>

        {/* Address & Patient */}
        <div className="px-5 pb-3">
          <p className="text-sm truncate" style={{ color: colors.textPrimary }}>{address}</p>
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
              background: `linear-gradient(135deg, ${isPickupPhase ? colors.successNeon : colors.neonMagenta}, ${isPickupPhase ? "#00cc6a" : "#cc0088"})`,
              color: "#fff",
              fontFamily: "'Space Grotesk', system-ui",
              boxShadow: `0 4px 16px ${isPickupPhase ? colors.successNeon : colors.neonMagenta}44`,
            }}
            whileTap={!reduced ? { scale: 0.95 } : undefined}
            data-testid="btn-navigate"
          >
            <Navigation className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider">Navigate</span>
          </motion.button>

          <motion.button
            onClick={() => onOpenTrip()}
            className="flex items-center justify-center px-3 py-3 rounded-2xl"
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
            whileTap={!reduced ? { scale: 0.95 } : undefined}
            data-testid="btn-trip-details"
          >
            <ChevronUp className="w-4 h-4" style={{ color: colors.textSecondary }} />
          </motion.button>

          <motion.button
            onClick={handleAction}
            className="flex-1 py-3 rounded-2xl text-xs font-bold uppercase tracking-wider"
            style={{
              background: colors.neonCyan,
              color: "#000",
              boxShadow: `0 0 16px ${glowColor(colors.neonCyan, 0.4)}`,
              fontFamily: "'Space Grotesk', system-ui",
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

/* ─── Waiting for trips indicator ─── */
function WaitingIndicator() {
  const driverStatus = useDriverStore((s) => s.driverStatus);
  const shiftStatus = useDriverStore((s) => s.shiftStatus);
  const tripPhase = useDriverStore((s) => s.tripPhase);

  if (driverStatus !== "online" || shiftStatus !== "onShift" || tripPhase !== "none") return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 px-4 py-2 rounded-full"
      style={{
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(20px)",
        border: `1px solid ${glowColor(colors.successNeon, 0.2)}`,
      }}
    >
      <motion.div
        className="w-2 h-2 rounded-full"
        style={{ background: colors.successNeon }}
        animate={{ opacity: [1, 0.3, 1] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
      <span className="text-xs font-medium" style={{ color: colors.textSecondary, fontFamily: "'Space Grotesk', system-ui" }}>
        Waiting for trip requests...
      </span>
    </motion.div>
  );
}

/* ─── Service type filter (Trips / Deliveries / All) ─── */
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
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.08)",
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all"
            style={{
              background: isActive
                ? `linear-gradient(135deg, ${colors.neonCyan}22, ${colors.neonPurple}22)`
                : "transparent",
              border: isActive
                ? `1px solid ${colors.neonCyan}44`
                : "1px solid transparent",
              color: isActive ? colors.neonCyan : colors.textTertiary,
              fontFamily: "'Space Grotesk', system-ui",
            }}
            whileTap={{ scale: 0.95 }}
          >
            {opt.icon}
            <span className="text-[10px] font-bold uppercase tracking-wider">
              {opt.label}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

/* ─── Map background component ─── */
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

  // Driver-only map: show driver location on dark map
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
  const driverInitials = useDriverStore((s) => s.driverInitials);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const driverStatus = useDriverStore((s) => s.driverStatus);
  const shiftStatus = useDriverStore((s) => s.shiftStatus);

  const isFullyOnline = driverStatus === "online" && shiftStatus === "onShift";
  const hasTripActivity = tripPhase !== "none" && tripPhase !== "complete";
  const showOffer = tripPhase === "offer";
  const showActiveTrip = hasTripActivity && !showOffer;
  const showConnectBtn = !hasTripActivity;

  const handleOpenTrip = useCallback(() => {
    onNavigate?.("activeTrip");
  }, [onNavigate]);

  return (
    <div className="relative w-full" style={{ height: "100vh", maxHeight: "100dvh" }}>
      {/* Full-screen map */}
      <div className="absolute inset-0 z-0">
        <MapBackground />
      </div>

      {/* Top bar overlay */}
      <div
        className="absolute top-0 left-0 right-0 z-30 px-4 pt-4 pb-8"
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.3) 70%, transparent 100%)",
        }}
      >
        <div className="flex items-center justify-between">
          {/* Hamburger + Avatar */}
          <div className="flex items-center gap-3">
            <motion.button
              onClick={() => onNavigate?.("menu")}
              className="flex items-center justify-center w-10 h-10 rounded-full"
              style={{
                background: "rgba(255,255,255,0.1)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
              whileTap={{ scale: 0.9 }}
              data-testid="btn-hamburger"
              aria-label="Menu"
            >
              <div className="flex flex-col gap-[3px]">
                <div className="w-4 h-[2px] rounded-full" style={{ background: colors.textPrimary }} />
                <div className="w-3 h-[2px] rounded-full" style={{ background: colors.textPrimary }} />
                <div className="w-4 h-[2px] rounded-full" style={{ background: colors.textPrimary }} />
              </div>
            </motion.button>
            <div>
              <p className="text-sm font-semibold" style={{ color: colors.textPrimary, fontFamily: "'Space Grotesk', system-ui" }}>
                {driverName || "Driver"}
              </p>
              <AvailabilityChip />
            </div>
          </div>

          {/* Stats bar */}
          <StatsBar />
        </div>
      </div>

      {/* Service type filter */}
      <div className="absolute top-20 left-0 right-0 z-25 flex justify-center pointer-events-none">
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

      {/* Trip offer overlay */}
      <AnimatePresence>
        {showOffer && <TripOfferCard key="trip-offer" />}
      </AnimatePresence>

      {/* Active trip card */}
      <AnimatePresence>
        {showActiveTrip && <ActiveTripMapCard key="active-trip" onOpenTrip={handleOpenTrip} />}
      </AnimatePresence>
    </div>
  );
}
