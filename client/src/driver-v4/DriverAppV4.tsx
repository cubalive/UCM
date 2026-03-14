import { useState, useCallback, useEffect, useRef, Component, type ReactNode, type ErrorInfo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Home, DollarSign, User, Navigation2, MapPin, Power, AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "./design/accessibility";
import { SkipToContent } from "@/components/SkipToContent";
import { colors } from "./design/tokens";
import { useDriverStore } from "./store/driverStore";
import { useAuth } from "@/lib/auth";
import { ConfirmDialog } from "./components/ui/ConfirmDialog";

import { Onboarding } from "./screens/Onboarding";
import { Dashboard } from "./screens/Dashboard";
import { ActiveTrip } from "./screens/ActiveTrip";
import { Earnings } from "./screens/Earnings";
import { Profile } from "./screens/Profile";
import { ToastContainer } from "./components/ui/Toast";
import { OfflineQueueStatus } from "@/components/OfflineQueueStatus";

type Screen = "onboarding" | "dashboard" | "activeTrip" | "earnings" | "profile";

/* ─── Bottom Tab Bar ─── */
function BottomTabBar({
  activeScreen,
  onNavigate,
  tripPhase,
}: {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
  tripPhase: string;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const driverStatus = useDriverStore((s) => s.driverStatus);
  const shiftStatus = useDriverStore((s) => s.shiftStatus);
  const hasActiveTrip = tripPhase !== "none" && tripPhase !== "complete" && tripPhase !== "offer";
  const endShift = useDriverStore((s) => s.endShift);
  const setOffline = useDriverStore((s) => s.setOffline);
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  const tabs: { key: Screen; icon: typeof Home; label: string }[] = [
    { key: "dashboard", icon: Home, label: t('driver.tabs.home') },
    { key: "earnings", icon: DollarSign, label: t('driver.tabs.earnings') },
    // Center orb is inserted manually
    { key: "activeTrip", icon: Navigation2, label: t('driver.tabs.trip') },
    { key: "profile", icon: User, label: t('driver.tabs.profile') },
  ];

  const isOnline = driverStatus === "online" && shiftStatus === "onShift";

  const handleOrbPress = useCallback(() => {
    if (hasActiveTrip) {
      onNavigate("activeTrip");
    } else if (isOnline) {
      setShowEndConfirm(true);
    } else {
      onNavigate("dashboard");
    }
  }, [hasActiveTrip, isOnline, onNavigate]);

  const confirmEndShift = useCallback(() => {
    setShowEndConfirm(false);
    endShift().then(() => setOffline());
  }, [endShift, setOffline]);

  return (
    <>
      <nav
        className="absolute bottom-0 left-0 right-0 z-50"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)", pointerEvents: "auto" }}
        aria-label="Main navigation"
        role="navigation"
      >
        <div
          className="flex items-end justify-around px-2 pt-2 pb-3"
          role="tablist"
          aria-label="App sections"
          style={{
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderTop: "1px solid rgba(0,0,0,0.06)",
            boxShadow: "0 -4px 24px rgba(0,0,0,0.04)",
          }}
        >
          {/* Home tab */}
          <TabItem
            tab={tabs[0]}
            isActive={activeScreen === "dashboard"}
            onPress={() => onNavigate("dashboard")}
            reduced={reduced}
          />

          {/* Earnings tab */}
          <TabItem
            tab={tabs[1]}
            isActive={activeScreen === "earnings"}
            onPress={() => onNavigate("earnings")}
            reduced={reduced}
          />

          {/* Center Status Orb — when online, this becomes the disconnect button */}
          <div className="flex flex-col items-center -mt-6">
            <motion.button
              onClick={handleOrbPress}
              className="relative flex items-center justify-center"
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                background: hasActiveTrip
                  ? `linear-gradient(135deg, ${colors.sky}, ${colors.ocean})`
                  : isOnline
                  ? `linear-gradient(135deg, ${colors.danger}, #E53935)`
                  : `linear-gradient(135deg, ${colors.sunrise}, ${colors.golden})`,
                boxShadow: hasActiveTrip
                  ? `0 4px 20px rgba(74,144,217,0.4)`
                  : isOnline
                  ? `0 4px 20px rgba(255,59,48,0.4)`
                  : `0 4px 20px rgba(255,107,53,0.35)`,
                border: "3px solid rgba(255,255,255,0.95)",
              }}
              whileHover={!reduced ? { scale: 1.08 } : undefined}
              whileTap={!reduced ? { scale: 0.92 } : undefined}
              data-testid="orb-status"
              aria-label={hasActiveTrip ? t('dashboard.activeTrip') : isOnline ? t('driver.status.goOffline') : t('driver.status.goOnline')}
            >
              {/* Pulse ring */}
              {(isOnline || hasActiveTrip) && !reduced && (
                <motion.div
                  className="absolute inset-[-4px] rounded-full"
                  animate={{ scale: [1, 1.25, 1], opacity: [0.4, 0, 0.4] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                  style={{
                    border: `2px solid ${hasActiveTrip ? colors.sky : colors.danger}`,
                    pointerEvents: "none",
                  }}
                />
              )}
              {hasActiveTrip ? (
                <Navigation2 className="w-6 h-6 text-white" />
              ) : isOnline ? (
                <Power className="w-6 h-6 text-white" />
              ) : (
                <MapPin className="w-6 h-6 text-white" />
              )}
            </motion.button>
            <span
              className="text-[9px] font-semibold mt-1 uppercase tracking-wider"
              style={{
                color: hasActiveTrip ? colors.sky : isOnline ? colors.danger : colors.sunrise,
              }}
            >
              {hasActiveTrip ? t('driver.status.inTrip') : isOnline ? t('driver.status.stop') : t('driver.status.offline')}
            </span>
          </div>

          {/* Trip tab */}
          <TabItem
            tab={tabs[2]}
            isActive={activeScreen === "activeTrip"}
            onPress={() => onNavigate("activeTrip")}
            reduced={reduced}
            badge={hasActiveTrip}
          />

          {/* Profile tab */}
          <TabItem
            tab={tabs[3]}
            isActive={activeScreen === "profile"}
            onPress={() => onNavigate("profile")}
            reduced={reduced}
          />
        </div>
      </nav>
      <ConfirmDialog
        open={showEndConfirm}
        title={t('driver.shift.endShift')}
        message={t('driver.shift.endShiftMessage')}
        confirmLabel={t('driver.shift.endShiftConfirm')}
        cancelLabel={t('driver.shift.keepWorking')}
        variant="danger"
        onConfirm={confirmEndShift}
        onCancel={() => setShowEndConfirm(false)}
      />
    </>
  );
}

function TabItem({
  tab,
  isActive,
  onPress,
  reduced,
  badge,
}: {
  tab: { key: string; icon: typeof Home; label: string };
  isActive: boolean;
  onPress: () => void;
  reduced: boolean;
  badge?: boolean;
}) {
  const Icon = tab.icon;
  return (
    <motion.button
      onClick={onPress}
      className="relative flex flex-col items-center gap-0.5 px-3 py-1 min-h-[44px] min-w-[44px]"
      whileTap={!reduced ? { scale: 0.9 } : undefined}
      data-testid={`tab-${tab.key}`}
      role="tab"
      aria-selected={isActive}
      aria-label={tab.label}
    >
      <div className="relative">
        <Icon
          className="w-5 h-5"
          aria-hidden="true"
          style={{
            color: isActive ? colors.sunrise : colors.textTertiary,
            strokeWidth: isActive ? 2.5 : 1.8,
          }}
        />
        {badge && (
          <div
            className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full"
            style={{ background: colors.sky, border: "2px solid white" }}
          />
        )}
      </div>
      <span
        className="text-[10px] font-medium"
        style={{ color: isActive ? colors.sunrise : colors.textTertiary }}
      >
        {tab.label}
      </span>
      {/* Active indicator dot */}
      {isActive && (
        <motion.div
          layoutId="tab-indicator"
          className="w-1 h-1 rounded-full"
          style={{ background: colors.sunrise }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      )}
    </motion.button>
  );
}

/* ─── Error Boundary ─── */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class DriverErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[DriverApp] Uncaught error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center gap-4 p-8 text-center"
          style={{ height: "100vh", maxWidth: 430, margin: "0 auto", background: colors.bg0 }}
        >
          <AlertTriangle className="w-12 h-12" style={{ color: colors.warning }} />
          <h2 className="text-lg font-bold" style={{ color: colors.textPrimary }}>
            Something went wrong
          </h2>
          <p className="text-sm" style={{ color: colors.textSecondary }}>
            The app encountered an unexpected error. Please try refreshing.
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white"
            style={{ background: `linear-gradient(135deg, ${colors.sunrise}, ${colors.golden})` }}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ─── Main App Container ─── */
export function DriverAppV4() {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<Screen>("onboarding");
  const reduced = useReducedMotion();
  const tripPhase = useDriverStore((s) => s.tripPhase);
  const { user, token } = useAuth();
  const initialize = useDriverStore((s) => s.initialize);
  const pollOffers = useDriverStore((s) => s.pollOffers);
  const pollActiveTrip = useDriverStore((s) => s.pollActiveTrip);
  const pollPharmacyDeliveries = useDriverStore((s) => s.pollPharmacyDeliveries);
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
        pollPharmacyDeliveries();
      } else if (tripPhase !== "offer" && tripPhase !== "complete") {
        pollActiveTrip();
      }
    }, 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isAuthenticated, tripPhase, pollOffers, pollActiveTrip, pollPharmacyDeliveries]);

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

  const navigate = useCallback((target: string) => {
    setScreen(target as Screen);
  }, []);

  const handleContinue = useCallback(() => {
    setScreen("dashboard");
  }, []);

  if (!isAuthenticated) {
    return (
      <DriverErrorBoundary>
        <ToastContainer />
        <Onboarding onContinue={handleContinue} />
      </DriverErrorBoundary>
    );
  }

  // Hide tab bar during active trip full view
  const showTabBar = screen !== "onboarding";

  return (
    <DriverErrorBoundary>
      <div
        className="relative"
        style={{
          maxWidth: 430,
          margin: "0 auto",
          height: "100vh",
          maxHeight: "100dvh",
          overflow: "hidden",
          background: colors.bg0,
        }}
        role="application"
        aria-label={t('driver.app.title')}
      >
        <SkipToContent />
        {/* Screen content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={screen}
            id="main-content"
            tabIndex={-1}
            role="main"
            aria-label={t('driver.app.content')}
            initial={reduced ? {} : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? {} : { opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ height: "100%", paddingBottom: showTabBar ? 88 : 0, overflowY: "auto", WebkitOverflowScrolling: "touch" }}
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

        {/* Bottom Tab Bar */}
        {showTabBar && (
          <BottomTabBar
            activeScreen={screen}
            onNavigate={(s) => setScreen(s)}
            tripPhase={tripPhase}
          />
        )}

        {/* Offline queue status indicator */}
        <OfflineQueueStatus />

        {/* Global Toast Notifications */}
        <ToastContainer />
      </div>
    </DriverErrorBoundary>
  );
}
