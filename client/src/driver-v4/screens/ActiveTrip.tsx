import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useMemo } from "react";
import {
  MapPin, Phone, Navigation, AlertTriangle, Clock,
  ChevronRight, User, FileText, Shield
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

const PHASE_STEPS: { key: TripPhase; label: string }[] = [
  { key: "toPickup", label: "En Route" },
  { key: "arrivedPickup", label: "Arrived" },
  { key: "waiting", label: "Waiting" },
  { key: "toDropoff", label: "Transporting" },
  { key: "arrivedDropoff", label: "Arrived" },
  { key: "complete", label: "Done" },
];

function TripProgress({ currentPhase }: { currentPhase: TripPhase }) {
  const currentIndex = PHASE_STEPS.findIndex((s) => s.key === currentPhase);

  return (
    <div className="flex items-center gap-1 py-2" data-testid="trip-progress-bar">
      {PHASE_STEPS.map((step, i) => {
        const isActive = i === currentIndex;
        const isDone = i < currentIndex;
        return (
          <div key={step.key} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full h-1 rounded-full"
              style={{
                background: isDone
                  ? colors.neonCyan
                  : isActive
                  ? `linear-gradient(90deg, ${colors.neonCyan}, ${colors.neonPurple})`
                  : "rgba(255,255,255,0.1)",
                boxShadow: isDone || isActive ? `0 0 6px ${glowColor(colors.neonCyan, 0.3)}` : "none",
              }}
            />
            <span
              className="text-[8px] uppercase tracking-wider"
              style={{
                color: isDone || isActive ? colors.neonCyan : colors.textTertiary,
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

export function ActiveTrip({ onBack }: { onBack: () => void }) {
  const activeTrip = useDriverStore((s) => s.activeTrip);
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const store = useDriverStore();
  const reduced = useReducedMotion();

  const nextAction = useMemo(() => store.getNextAction(), [tripPhase]);

  const handleAction = useCallback(() => {
    const fn = (store as any)[nextAction.actionKey];
    if (typeof fn === "function") fn();
  }, [nextAction.actionKey, store]);

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

  const handleNavigate = useCallback(() => {
    const destLat = isPickupPhase ? activeTrip.pickupLatLng.lat : activeTrip.dropoffLatLng.lat;
    const destLng = isPickupPhase ? activeTrip.pickupLatLng.lng : activeTrip.dropoffLatLng.lng;
    const label = isPickupPhase ? "Pickup" : "Dropoff";
    const pref = store.navPreference;

    if (pref === "waze") {
      window.open(`https://waze.com/ul?ll=${destLat},${destLng}&navigate=yes`, "_blank");
    } else if (pref === "apple") {
      window.open(`maps://maps.apple.com/?daddr=${destLat},${destLng}&dirflg=d`, "_blank");
    } else {
      // Default to Google Maps (works on both mobile and desktop)
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}&travelmode=driving`, "_blank");
    }
  }, [activeTrip, isPickupPhase, store.navPreference]);

  return (
    <NebulaBackground className="flex flex-col min-h-screen">
      <div className="max-w-md mx-auto w-full flex flex-col flex-1">
        <div className="relative flex-1" style={{ minHeight: 280 }}>
          <div className="absolute inset-0" data-testid="active-trip-map">
            <DriverTripMap
              pickupLat={activeTrip.pickupLatLng.lat}
              pickupLng={activeTrip.pickupLatLng.lng}
              dropoffLat={activeTrip.dropoffLatLng.lat}
              dropoffLng={activeTrip.dropoffLatLng.lng}
              phase={tripPhase}
              className="w-full h-full"
            />
          </div>

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
              onPress={() => {}}
              label="Emergency"
              size={38}
              accentColor={colors.dangerNeon}
              testID="btn-emergency"
            />
          </div>
        </div>

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
                <div className="flex items-center gap-2 mb-2">
                  <User className="w-4 h-4" style={{ color: colors.neonCyan }} />
                  <span className="text-sm font-semibold" style={{ color: colors.textPrimary }}>
                    {activeTrip.passengerName}
                  </span>
                </div>
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
                progress={tripPhase === "toPickup" ? 0.3 : tripPhase === "arrivedPickup" ? 0.5 : tripPhase === "waiting" ? 0.55 : tripPhase === "toDropoff" ? 0.75 : 0.95}
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
              <GlassButton icon={<Phone className="w-4 h-4" />} onPress={() => {}} label="Call Passenger" size={40} testID="btn-call" />
              <GlassButton icon={<Navigation className="w-4 h-4" />} onPress={handleNavigate} label="Navigate" size={40} accentColor={colors.neonCyan} testID="btn-navigate" />
              <GlassButton icon={<AlertTriangle className="w-3.5 h-3.5" />} onPress={() => {}} label="Report Issue" size={40} accentColor={colors.warningNeon} testID="btn-issue" />
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
