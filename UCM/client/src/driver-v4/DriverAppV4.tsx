import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Home, Map, DollarSign, User, ChevronLeft } from "lucide-react";
import { useReducedMotion } from "./design/accessibility";
import { colors } from "./design/tokens";
import { glowColor } from "./design/theme";
import { useDriverStore } from "./store/driverStore";

import { Onboarding } from "./screens/Onboarding";
import { Dashboard } from "./screens/Dashboard";
import { ActiveTrip } from "./screens/ActiveTrip";
import { Earnings } from "./screens/Earnings";
import { Profile } from "./screens/Profile";

type Screen = "onboarding" | "dashboard" | "activeTrip" | "earnings" | "profile";

const TAB_ITEMS: { key: Screen; icon: typeof Home; label: string }[] = [
  { key: "dashboard", icon: Home, label: "Home" },
  { key: "activeTrip", icon: Map, label: "Trip" },
  { key: "earnings", icon: DollarSign, label: "Earn" },
  { key: "profile", icon: User, label: "Profile" },
];

function BottomTabBar({
  activeTab,
  onTabPress,
}: {
  activeTab: Screen;
  onTabPress: (tab: Screen) => void;
}) {
  const reduced = useReducedMotion();

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex justify-center"
      style={{ pointerEvents: "none" }}
    >
      <nav
        className="flex items-center gap-1 px-3 py-2 mb-4 rounded-3xl max-w-[320px]"
        style={{
          background: "rgba(10,0,21,0.85)",
          backdropFilter: "blur(30px)",
          WebkitBackdropFilter: "blur(30px)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          pointerEvents: "all",
        }}
        data-testid="bottom-tab-bar"
      >
        {TAB_ITEMS.map((item) => {
          const isActive = activeTab === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={() => onTabPress(item.key)}
              className="flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-2xl transition-all"
              style={{
                background: isActive ? glowColor(colors.neonCyan, 0.12) : "transparent",
                minWidth: 56,
              }}
              data-testid={`tab-${item.key}`}
              aria-label={item.label}
            >
              <motion.div
                animate={isActive && !reduced ? { scale: [1, 1.15, 1] } : {}}
                transition={{ duration: 0.3 }}
              >
                <Icon
                  className="w-5 h-5"
                  style={{
                    color: isActive ? colors.neonCyan : colors.textTertiary,
                    filter: isActive ? `drop-shadow(0 0 6px ${glowColor(colors.neonCyan, 0.5)})` : "none",
                  }}
                />
              </motion.div>
              <span
                className="text-[9px] font-semibold tracking-wider uppercase"
                style={{
                  color: isActive ? colors.neonCyan : colors.textTertiary,
                  fontFamily: "'Space Grotesk', system-ui",
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export function DriverAppV4() {
  const [screen, setScreen] = useState<Screen>("onboarding");
  const [authenticated, setAuthenticated] = useState(false);
  const reduced = useReducedMotion();
  const tripPhase = useDriverStore((s) => s.tripPhase);

  const navigate = useCallback((target: string) => {
    setScreen(target as Screen);
  }, []);

  const handleContinue = useCallback(() => {
    setAuthenticated(true);
    setScreen("dashboard");
  }, []);

  if (!authenticated) {
    return <Onboarding onContinue={handleContinue} />;
  }

  const activeTripPhases = ["offer", "toPickup", "arrivedPickup", "waiting", "pickedUp", "toDropoff", "arrivedDropoff"];
  const shouldShowActiveTrip = activeTripPhases.includes(tripPhase);

  return (
    <div className="relative" style={{ maxWidth: 430, margin: "0 auto", minHeight: "100vh" }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={screen}
          initial={reduced ? {} : { opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduced ? {} : { opacity: 0, x: -10 }}
          transition={{ duration: 0.2 }}
          className="pb-20"
        >
          {screen === "dashboard" && (
            <Dashboard onNavigate={navigate} />
          )}
          {screen === "activeTrip" && (
            <ActiveTrip onBack={() => setScreen("dashboard")} />
          )}
          {screen === "earnings" && (
            <Earnings onBack={() => setScreen("dashboard")} />
          )}
          {screen === "profile" && (
            <Profile onBack={() => setScreen("dashboard")} />
          )}
        </motion.div>
      </AnimatePresence>

      <BottomTabBar activeTab={screen} onTabPress={setScreen} />
    </div>
  );
}
