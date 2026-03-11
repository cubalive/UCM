import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useMemo, useState, useEffect } from "react";
import {
  MapPin, Phone, Navigation, AlertTriangle, Clock,
  ChevronRight, User, FileText, Shield, CheckCircle2,
  Award, Route, Timer, ArrowRight, Star, Milestone
} from "lucide-react";
import { useDriverStore, TripPhase } from "../store/driverStore";
import { useReducedMotion } from "../design/accessibility";
import { colors } from "../design/tokens";
import { glowColor } from "../design/theme";
import { GlassCard } from "../components/ui/GlassCard";
import { NeonButton } from "../components/ui/NeonButton";
import { GlowProgressCircle } from "../components/ui/GlowProgressCircle";
import { GlassButton } from "../components/ui/GlassButton";
import { NebulaBackground } from "../components/ui/MapOverlay";
import { DriverTripMap } from "../components/DriverTripMap";

const PHASE_STEPS: { key: TripPhase; label: string; icon: typeof MapPin }[] = [
  { key: "toPickup", label: "En Route", icon: Navigation },
  { key: "arrivedPickup", label: "At Pickup", icon: MapPin },
  { key: "waiting", label: "Waiting", icon: Timer },
  { key: "toDropoff", label: "Transporting", icon: Route },
  { key: "arrivedDropoff", label: "At Dropoff", icon: Milestone },
  { key: "complete", label: "Done", icon: CheckCircle2 },
];

function TripProgress({ currentPhase }: { currentPhase: TripPhase }) {
  const currentIndex = PHASE_STEPS.findIndex((s) => s.key === currentPhase);

  return (
    <div className="flex items-center gap-1 py-2" data-testid="trip-progress-bar">
      {PHASE_STEPS.map((step, i) => {
        const isActive = i === currentIndex;
        const isDone = i < currentIndex;
        const Icon = step.icon;
        return (
          <div key={step.key} className="flex-1 flex flex-col items-center gap-1">
            <div className="flex items-center justify-center w-full gap-0.5">
              {isDone || isActive ? (
                <Icon className="w-3 h-3" style={{ color: colors.neonCyan, filter: isActive ? `drop-shadow(0 0 4px ${colors.neonCyan})` : "none" }} />
              ) : null}
            </div>
            <div
              className="w-full h-1.5 rounded-full transition-all duration-500"
              style={{
                background: isDone
                  ? colors.neonCyan
                  : isActive
                  ? `linear-gradient(90deg, ${colors.neonCyan}, ${colors.neonPurple})`
                  : "rgba(255,255,255,0.08)",
                boxShadow: isDone || isActive ? `0 0 8px ${glowColor(colors.neonCyan, 0.4)}` : "none",
              }}
            />
            <span
              className="text-[8px] uppercase tracking-wider font-medium"
              style={{
                color: isDone ? colors.neonCyan : isActive ? "#fff" : colors.textTertiary,
                fontFamily: "'Space Grotesk', system-ui",
              }}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TripCompleteSummary({ trip, onDone }: { trip: any; onDone: () => void }) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className="flex flex-col items-center justify-center min-h-screen px-6"
      initial={reduced ? {} : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 25 }}
    >
      <motion.div
        initial={reduced ? {} : { scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 300 }}
        className="mb-6"
      >
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${colors.successNeon}22, ${colors.neonCyan}22)`,
            border: `2px solid ${colors.successNeon}44`,
            boxShadow: `0 0 30px ${colors.successNeon}33`,
          }}
        >
          <CheckCircle2 className="w-10 h-10" style={{ color: colors.successNeon }} />
        </div>
      </motion.div>

      <h2 className="text-xl font-bold mb-1" style={{ color: colors.textPrimary, fontFamily: "'Space Grotesk', system-ui" }}>
        Trip Complete!
      </h2>
      <p className="text-sm mb-6" style={{ color: colors.textSecondary }}>
        Great work, driver!
      </p>

      <GlassCard variant="elevated" className="!p-5 w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4" style={{ color: colors.neonCyan }} />
            <span className="text-sm font-medium" style={{ color: colors.textPrimary }}>
              {trip?.passengerName || "Patient"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Star className="w-3.5 h-3.5" style={{ color: colors.warningNeon }} />
            <Star className="w-3.5 h-3.5" style={{ color: colors.warningNeon }} />
            <Star className="w-3.5 h-3.5" style={{ color: colors.warningNeon }} />
            <Star className="w-3.5 h-3.5" style={{ color: colors.warningNeon }} />
            <Star className="w-3.5 h-3.5" style={{ color: colors.warningNeon }} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: colors.successNeon }} />
            <div className="flex-1">
              <span className="text-[9px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>Pickup</span>
              <p className="text-xs" style={{ color: colors.textSecondary }}>{trip?.pickupAddress || "—"}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: colors.neonMagenta }} />
            <div className="flex-1">
              <span className="text-[9px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>Dropoff</span>
              <p className="text-xs" style={{ color: colors.textSecondary }}>{trip?.dropoffAddress || "—"}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-center py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.03)" }}>
            <p className="text-lg font-bold" style={{ color: colors.neonCyan }}>{trip?.etaMinutes || "—"}m</p>
            <p className="text-[9px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>Duration</p>
          </div>
          <div className="text-center py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.03)" }}>
            <p className="text-lg font-bold" style={{ color: colors.successNeon }}>Medical</p>
            <p className="text-[9px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>Trip Type</p>
          </div>
        </div>
      </GlassCard>

      <NeonButton
        title="Back to Dashboard"
        onPress={onDone}
        variant="primary"
        testID="btn-back-after-complete"
        icon={<ArrowRight className="w-5 h-5" />}
      />
    </motion.div>
  );
}

export function ActiveTrip({ onBack }: { onBack: () => void }) {
  const activeTrip = useDriverStore((s) => s.activeTrip);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const driverLat = useDriverStore((s) => s.driverLat);
  const driverLng = useDriverStore((s) => s.driverLng);
  const driverHeading = useDriverStore((s) => s.driverHeading);
  const store = useDriverStore();
  const reduced = useReducedMotion();
  const [showComplete, setShowComplete] = useState(false);
  const [completedTrip, setCompletedTrip] = useState<any>(null);

  const nextAction = useMemo(() => store.getNextAction(), [tripPhase]);

  // Capture trip data when completing and show summary
  useEffect(() => {
    if (tripPhase === "complete" && activeTrip) {
      setCompletedTrip({ ...activeTrip });
      setTimeout(() => setShowComplete(true), 500);
    }
  }, [tripPhase]);

  const handleAction = useCallback(() => {
    const fn = (store as any)[nextAction.actionKey];
    if (typeof fn === "function") fn();
  }, [nextAction.actionKey, store]);

  if (showComplete && completedTrip) {
    return (
      <NebulaBackground>
        <TripCompleteSummary trip={completedTrip} onDone={() => { setShowComplete(false); setCompletedTrip(null); onBack(); }} />
      </NebulaBackground>
    );
  }

  if (!activeTrip || tripPhase === "none") {
    return (
      <NebulaBackground>
        <div className="flex flex-col items-center justify-center min-h-screen px-6">
          <MapPin className="w-12 h-12 mb-4" style={{ color: colors.textTertiary }} />
          <p className="text-lg font-semibold" style={{ color: colors.textSecondary }}>No active trip</p>
          <button onClick={onBack} className="mt-4 text-sm underline" style={{ color: colors.neonCyan }}>
            Back to Dashboard
          </button>
        </div>
      </NebulaBackground>
    );
  }

  const isPickupPhase = ["toPickup", "arrivedPickup", "waiting"].includes(tripPhase);
  const isMovingPhase = ["toPickup", "toDropoff"].includes(tripPhase);

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

  const destLabel = isPickupPhase ? "Pickup" : "Dropoff";
  const destAddress = isPickupPhase ? activeTrip.pickupAddress : activeTrip.dropoffAddress;

  return (
    <NebulaBackground className="flex flex-col min-h-screen">
      <div className="max-w-md mx-auto w-full flex flex-col flex-1">
        {/* Map area */}
        <div className="relative flex-1" style={{ minHeight: 320 }}>
          <div className="absolute inset-0" data-testid="active-trip-map">
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
          </div>

          {/* Top bar */}
          <div className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between">
            <button
              onClick={onBack}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs"
              style={{
                background: "rgba(255,255,255,0.1)",
                backdropFilter: "blur(20px)",
                color: colors.textPrimary,
                border: "1px solid rgba(255,255,255,0.1)",
              }}
              data-testid="btn-back-dashboard"
            >
              ← Dashboard
            </button>
            <GlassButton
              icon={<AlertTriangle className="w-4 h-4" style={{ color: colors.dangerNeon }} />}
              onPress={() => store.reportEmergency()}
              label="Emergency"
              size={38}
              accentColor={colors.dangerNeon}
              testID="btn-emergency"
            />
          </div>

          {/* Start Navigation FAB - prominent button on the map */}
          {isMovingPhase && (
            <motion.button
              onClick={handleNavigate}
              className="absolute bottom-4 right-4 z-30 flex items-center gap-2 px-5 py-3 rounded-2xl"
              style={{
                background: `linear-gradient(135deg, ${isPickupPhase ? colors.successNeon : colors.neonMagenta}, ${isPickupPhase ? "#00cc6a" : "#cc0088"})`,
                boxShadow: `0 4px 20px ${isPickupPhase ? colors.successNeon : colors.neonMagenta}55, 0 0 40px ${isPickupPhase ? colors.successNeon : colors.neonMagenta}22`,
                border: "1px solid rgba(255,255,255,0.2)",
              }}
              initial={reduced ? {} : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3, type: "spring", stiffness: 300 }}
              data-testid="btn-start-navigation"
              aria-label={`Navigate to ${destLabel}`}
            >
              <Navigation className="w-5 h-5 text-white" />
              <span className="text-sm font-bold text-white" style={{ fontFamily: "'Space Grotesk', system-ui" }}>
                Navigate
              </span>
            </motion.button>
          )}

          {/* Destination pill overlay on map */}
          <div className="absolute bottom-4 left-4 z-30">
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{
                background: "rgba(0,0,0,0.75)",
                backdropFilter: "blur(20px)",
                border: `1px solid ${isPickupPhase ? colors.successNeon : colors.neonMagenta}33`,
              }}
            >
              <MapPin className="w-3.5 h-3.5" style={{ color: isPickupPhase ? colors.successNeon : colors.neonMagenta }} />
              <div>
                <p className="text-[9px] uppercase tracking-wider font-medium" style={{ color: isPickupPhase ? colors.successNeon : colors.neonMagenta }}>
                  {destLabel}
                </p>
                <p className="text-[10px] max-w-[160px] truncate" style={{ color: colors.textSecondary }}>
                  {destAddress}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom panel */}
        <motion.div
          className="relative z-20 px-4 pb-6 space-y-3 -mt-6"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 60%, transparent 100%)",
          }}
          initial={reduced ? {} : { y: 40 }}
          animate={{ y: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 25 }}
        >
          <TripProgress currentPhase={tripPhase} />

          <GlassCard variant="elevated" testID="card-trip-details" className="!p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <User className="w-4 h-4" style={{ color: colors.neonCyan }} />
                  <span className="text-sm font-semibold" style={{ color: colors.textPrimary }}>
                    {activeTrip.passengerName}
                  </span>
                </div>
                {activeTrip.scheduledTime && (
                  <div className="flex items-center gap-1.5 mb-2">
                    <Clock className="w-3 h-3" style={{ color: colors.textTertiary }} />
                    <span className="text-[10px]" style={{ color: colors.textTertiary }}>
                      Scheduled: {new Date(activeTrip.scheduledTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: isPickupPhase ? colors.neonCyan : colors.successNeon }} />
                    <div>
                      <span className="text-[9px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>
                        {isPickupPhase ? "Heading to Pickup" : "Pickup (done)"}
                      </span>
                      <p className="text-xs" style={{ color: isPickupPhase ? colors.textPrimary : colors.textTertiary }}>
                        {activeTrip.pickupAddress}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: !isPickupPhase ? colors.neonMagenta : "rgba(255,255,255,0.2)" }} />
                    <div>
                      <span className="text-[9px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>Dropoff</span>
                      <p className="text-xs" style={{ color: !isPickupPhase ? colors.textPrimary : colors.textTertiary }}>
                        {activeTrip.dropoffAddress}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <GlowProgressCircle
                progress={tripPhase === "toPickup" ? 0.2 : tripPhase === "arrivedPickup" ? 0.4 : tripPhase === "waiting" ? 0.5 : tripPhase === "toDropoff" ? 0.7 : 0.9}
                label={`${activeTrip.etaMinutes}m`}
                size={64}
                accentColor={isPickupPhase ? colors.neonCyan : colors.neonMagenta}
                sublabel="ETA"
                testID="progress-active-eta"
              />
            </div>

            {activeTrip.notes && (
              <div className="flex items-start gap-2 px-2 py-1.5 rounded-lg mb-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: colors.textTertiary }} />
                <p className="text-xs italic" style={{ color: colors.textTertiary }}>{activeTrip.notes}</p>
              </div>
            )}

            <div className="flex gap-2 mt-2">
              <GlassButton icon={<Phone className="w-4 h-4" />} onPress={() => {
                if (activeTrip.passengerPhone) {
                  window.open(`tel:${activeTrip.passengerPhone}`, "_self");
                }
              }} label="Call Passenger" size={40} testID="btn-call" />
              <GlassButton icon={<Navigation className="w-4 h-4" />} onPress={handleNavigate} label="Navigate" size={40} accentColor={colors.neonCyan} testID="btn-navigate" />
              <GlassButton icon={<AlertTriangle className="w-3.5 h-3.5" />} onPress={() => {
                store.reportEmergency("Driver reported issue during trip");
              }} label="Report Issue" size={40} accentColor={colors.warningNeon} testID="btn-issue" />
            </div>
          </GlassCard>

          <NeonButton
            title={nextAction.label}
            onPress={handleAction}
            disabled={nextAction.disabled}
            variant={nextAction.variant}
            testID="btn-trip-action"
            icon={<ChevronRight className="w-5 h-5" />}
          />

          {nextAction.hint && (
            <p className="text-center text-xs" style={{ color: colors.textTertiary }}>{nextAction.hint}</p>
          )}
        </motion.div>
      </div>
    </NebulaBackground>
  );
}
