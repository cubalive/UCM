import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, Map, DollarSign, User, X, Navigation,
  Car, Shield, FileText, Phone, Settings, LogOut
} from "lucide-react";
import { useReducedMotion } from "./design/accessibility";
import { colors } from "./design/tokens";
import { glowColor } from "./design/theme";
import { useDriverStore } from "./store/driverStore";
import { useAuth } from "@/lib/auth";

import { Onboarding } from "./screens/Onboarding";
import { Dashboard } from "./screens/Dashboard";
import { ActiveTrip } from "./screens/ActiveTrip";
import { Earnings } from "./screens/Earnings";
import { Profile } from "./screens/Profile";

type Screen = "onboarding" | "dashboard" | "activeTrip" | "earnings" | "profile";

/* ─── Slide-out Drawer Menu ─── */
function DrawerMenu({
  isOpen,
  onClose,
  onNavigate,
  activeScreen,
}: {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (screen: Screen) => void;
  activeScreen: Screen;
}) {
  const reduced = useReducedMotion();
  const driverName = useDriverStore((s) => s.driverName);
  const driverInitials = useDriverStore((s) => s.driverInitials);
  const rating = useDriverStore((s) => s.rating);
  const completedRides = useDriverStore((s) => s.completedRides);
  const earningsWeek = useDriverStore((s) => s.earningsWeek);
  const driverStatus = useDriverStore((s) => s.driverStatus);
  const shiftStatus = useDriverStore((s) => s.shiftStatus);

  const menuItems: { key: Screen; icon: typeof Home; label: string }[] = [
    { key: "dashboard", icon: Home, label: "Home" },
    { key: "activeTrip", icon: Map, label: "Active Trip" },
    { key: "earnings", icon: DollarSign, label: "Earnings" },
    { key: "profile", icon: User, label: "Profile & Settings" },
  ];

  const handleNav = (screen: Screen) => {
    onNavigate(screen);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[100]"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Drawer panel */}
          <motion.div
            className="fixed top-0 left-0 bottom-0 z-[101] w-[280px] flex flex-col"
            style={{
              background: "linear-gradient(135deg, #0a0015 0%, #0d001a 50%, #000000 100%)",
              borderRight: `1px solid ${glowColor(colors.neonCyan, 0.15)}`,
              boxShadow: `4px 0 40px rgba(0,0,0,0.8), 0 0 30px ${glowColor(colors.neonCyan, 0.05)}`,
            }}
            initial={reduced ? {} : { x: -280 }}
            animate={{ x: 0 }}
            exit={reduced ? {} : { x: -280 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1 rounded-full"
              style={{ background: "rgba(255,255,255,0.08)" }}
              data-testid="btn-close-drawer"
            >
              <X className="w-5 h-5" style={{ color: colors.textSecondary }} />
            </button>

            {/* Driver profile header */}
            <div className="px-5 pt-8 pb-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold mb-3"
                style={{
                  background: `linear-gradient(135deg, ${colors.neonCyan}, ${colors.neonPurple})`,
                  color: "#000",
                  boxShadow: `0 0 20px ${glowColor(colors.neonCyan, 0.3)}`,
                  fontFamily: "'Space Grotesk', system-ui",
                }}
              >
                {driverInitials || "DR"}
              </div>
              <p className="text-base font-bold" style={{ color: colors.textPrimary, fontFamily: "'Space Grotesk', system-ui" }}>
                {driverName || "Driver"}
              </p>
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-xs flex items-center gap-1" style={{ color: colors.warningNeon }}>
                  ★ {rating.toFixed(1)}
                </span>
                <span className="text-xs" style={{ color: colors.textTertiary }}>
                  {completedRides} rides
                </span>
              </div>
              {/* Quick stats */}
              <div className="flex gap-3 mt-3">
                <div className="flex-1 py-2 rounded-xl text-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <p className="text-sm font-bold" style={{ color: colors.neonCyan, fontFamily: "'Space Grotesk', system-ui" }}>
                    ${earningsWeek.toFixed(0)}
                  </p>
                  <p className="text-[8px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>This Week</p>
                </div>
                <div className="flex-1 py-2 rounded-xl text-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <p className="text-sm font-bold" style={{
                    color: driverStatus === "online" && shiftStatus === "onShift" ? colors.successNeon : colors.textTertiary,
                    fontFamily: "'Space Grotesk', system-ui",
                  }}>
                    {driverStatus === "online" ? (shiftStatus === "onShift" ? "ON" : "ONLINE") : "OFF"}
                  </p>
                  <p className="text-[8px] uppercase tracking-wider" style={{ color: colors.textTertiary }}>Status</p>
                </div>
              </div>
            </div>

            {/* Navigation items */}
            <div className="flex-1 py-3 px-3">
              {menuItems.map((item) => {
                const isActive = activeScreen === item.key;
                const Icon = item.icon;
                return (
                  <motion.button
                    key={item.key}
                    onClick={() => handleNav(item.key)}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl mb-1 transition-colors"
                    style={{
                      background: isActive ? glowColor(colors.neonCyan, 0.1) : "transparent",
                      border: isActive ? `1px solid ${glowColor(colors.neonCyan, 0.15)}` : "1px solid transparent",
                    }}
                    whileTap={{ scale: 0.97 }}
                    data-testid={`menu-${item.key}`}
                  >
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center"
                      style={{
                        background: isActive ? glowColor(colors.neonCyan, 0.15) : "rgba(255,255,255,0.05)",
                      }}
                    >
                      <Icon
                        className="w-4 h-4"
                        style={{
                          color: isActive ? colors.neonCyan : colors.textTertiary,
                          filter: isActive ? `drop-shadow(0 0 4px ${colors.neonCyan})` : "none",
                        }}
                      />
                    </div>
                    <span
                      className="text-sm font-medium"
                      style={{
                        color: isActive ? colors.neonCyan : colors.textPrimary,
                        fontFamily: "'Space Grotesk', system-ui",
                      }}
                    >
                      {item.label}
                    </span>
                  </motion.button>
                );
              })}
            </div>

            {/* Bottom section */}
            <div className="px-5 pb-6" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <button
                className="flex items-center gap-3 w-full py-3 mt-2"
                style={{ color: colors.textTertiary }}
                data-testid="menu-support"
              >
                <Phone className="w-4 h-4" />
                <span className="text-sm">Support</span>
              </button>
              <p className="text-[9px] mt-2" style={{ color: "rgba(255,255,255,0.2)" }}>
                UCM Driver • v4.0
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ─── Main App Container ─── */
export function DriverAppV4() {
  const [screen, setScreen] = useState<Screen>("onboarding");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const reduced = useReducedMotion();
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const { user, token } = useAuth();
  const initialize = useDriverStore((s) => s.initialize);
  const pollOffers = useDriverStore((s) => s.pollOffers);
  const pollActiveTrip = useDriverStore((s) => s.pollActiveTrip);
  const updateLocation = useDriverStore((s) => s.updateLocation);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const geoRef = useRef<number | null>(null);

  const isAuthenticated = !!user && !!token;

  // Initialize store when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      setScreen("dashboard");
      initialize();
    }
  }, [isAuthenticated, initialize]);

  // Poll for offers and active trip every 10 seconds
  useEffect(() => {
    if (!isAuthenticated) return;
    pollRef.current = setInterval(() => {
      if (tripPhase === "none") {
        pollOffers();
      } else if (tripPhase !== "offer" && tripPhase !== "complete") {
        pollActiveTrip();
      }
    }, 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isAuthenticated, tripPhase, pollOffers, pollActiveTrip]);

  // GPS tracking
  useEffect(() => {
    if (!isAuthenticated || !navigator.geolocation) return;
    geoRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        updateLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.heading ?? undefined);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
    return () => { if (geoRef.current !== null) navigator.geolocation.clearWatch(geoRef.current); };
  }, [isAuthenticated, updateLocation]);

  // Auto-navigate to active trip screen when trip is accepted
  useEffect(() => {
    if (tripPhase === "toPickup" && screen === "dashboard") {
      // Stay on dashboard — the active trip card with navigation shows on the map
    }
  }, [tripPhase, screen]);

  const navigate = useCallback((target: string) => {
    if (target === "menu") {
      setDrawerOpen(true);
      return;
    }
    setScreen(target as Screen);
  }, []);

  const handleContinue = useCallback(() => {
    setScreen("dashboard");
  }, []);

  if (!isAuthenticated) {
    return <Onboarding onContinue={handleContinue} />;
  }

  return (
    <div className="relative" style={{ maxWidth: 430, margin: "0 auto", height: "100vh", maxHeight: "100dvh", overflow: "hidden" }}>
      {/* Drawer menu */}
      <DrawerMenu
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNavigate={(s) => setScreen(s)}
        activeScreen={screen}
      />

      {/* Screen content — no bottom padding needed, map fills all */}
      <AnimatePresence mode="wait">
        <motion.div
          key={screen}
          initial={reduced ? {} : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduced ? {} : { opacity: 0 }}
          transition={{ duration: 0.15 }}
          style={{ height: "100%" }}
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
    </div>
  );
}
