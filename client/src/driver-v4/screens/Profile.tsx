import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft, User, Car, FileText, Volume2, Vibrate,
  Eye, Navigation, Shield, Info, ChevronRight, Settings, ExternalLink, Star,
  Bell, BellOff, Zap, Clock, MapPin, Route, Sliders
} from "lucide-react";
import { useDriverStore } from "../store/driverStore";
import { colors } from "../design/tokens";
import { glowColor } from "../design/theme";
import { GlassCard } from "../components/ui/GlassCard";
import { NebulaBackground } from "../components/ui/MapOverlay";
import { resolveUrl, getStoredToken } from "@/lib/api";
import { DRIVER_TOKEN_KEY } from "@/lib/hostDetection";
import { useNotifications } from "../hooks/useNotifications";

function ProfileVersionDisplay() {
  const [buildVersion, setBuildVersion] = useState("...");

  useEffect(() => {
    fetch(resolveUrl("/version.json"), { cache: "no-store", credentials: "omit" })
      .then((r) => r.json())
      .then((d) => setBuildVersion(d.version || "dev"))
      .catch(() => setBuildVersion("unknown"));
  }, []);

  return (
    <div className="pt-3 text-center" data-testid="text-build-version">
      <p className="text-[10px]" style={{ color: colors.textTertiary }}>
        UCM Driver • Build {buildVersion}
      </p>
    </div>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  onPress,
  accent = colors.sunrise,
  testID,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onPress?: () => void;
  accent?: string;
  testID: string;
}) {
  return (
    <button
      onClick={onPress}
      className="w-full flex items-center justify-between py-3 px-1 border-b"
      style={{ borderColor: "rgba(0,0,0,0.04)", cursor: onPress ? "pointer" : "default" }}
      data-testid={testID}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: glowColor(accent, 0.08) }}
        >
          <span style={{ color: accent }}>{icon}</span>
        </div>
        <span className="text-sm" style={{ color: colors.textPrimary }}>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {value && (
          <span className="text-xs" style={{ color: colors.textTertiary }}>{value}</span>
        )}
        {onPress && <ChevronRight className="w-4 h-4" style={{ color: colors.textTertiary }} />}
      </div>
    </button>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onChange,
  accent = colors.sunrise,
  testID,
}: {
  icon: React.ReactNode;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  accent?: string;
  testID: string;
}) {
  return (
    <div
      className="flex items-center justify-between py-3 px-1 border-b"
      style={{ borderColor: "rgba(0,0,0,0.04)" }}
      data-testid={testID}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: glowColor(accent, 0.08) }}
        >
          <span style={{ color: accent }}>{icon}</span>
        </div>
        <span className="text-sm" style={{ color: colors.textPrimary }}>{label}</span>
      </div>
      <button
        onClick={() => onChange(!value)}
        className="relative w-11 h-6 rounded-full transition-colors"
        style={{
          background: value ? glowColor(colors.sunrise, 0.2) : "rgba(0,0,0,0.08)",
          border: `1px solid ${value ? glowColor(colors.sunrise, 0.3) : "rgba(0,0,0,0.06)"}`,
        }}
        role="switch"
        aria-checked={value}
      >
        <motion.div
          className="absolute top-0.5 w-5 h-5 rounded-full"
          animate={{ left: value ? 21 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          style={{
            background: value ? colors.sunrise : "rgba(0,0,0,0.15)",
            boxShadow: value ? `0 2px 8px ${glowColor(colors.sunrise, 0.3)}` : colors.shadowSm,
          }}
        />
      </button>
    </div>
  );
}

/* ─── Slider control for preferences ─── */
function PreferenceSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  accent = colors.sunrise,
  testID,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  accent?: string;
  testID: string;
}) {
  return (
    <div className="py-2 px-1" data-testid={testID}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs" style={{ color: colors.textSecondary }}>{label}</span>
        <span className="text-xs font-bold tabular-nums" style={{ color: accent }}>
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, ${accent} 0%, ${accent} ${((value - min) / (max - min)) * 100}%, rgba(0,0,0,0.08) ${((value - min) / (max - min)) * 100}%, rgba(0,0,0,0.08) 100%)`,
          accentColor: accent,
        }}
      />
      <div className="flex justify-between mt-1">
        <span className="text-[9px]" style={{ color: colors.textTertiary }}>{min}{unit}</span>
        <span className="text-[9px]" style={{ color: colors.textTertiary }}>{max}{unit}</span>
      </div>
    </div>
  );
}

export function Profile({ onBack }: { onBack: () => void }) {
  const navPreference = useDriverStore((s) => s.navPreference);
  const setNavPreference = useDriverStore((s) => s.setNavPreference);
  const rating = useDriverStore((s) => s.rating);
  const completedRides = useDriverStore((s) => s.completedRides);
  const driverName = useDriverStore((s) => s.driverName);
  const driverInitials = useDriverStore((s) => s.driverInitials);

  const [sounds, setSounds] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [vehicleInfo, setVehicleInfo] = useState("Loading...");
  const [documentCount, setDocumentCount] = useState<number | null>(null);

  // Auto-accept state
  const [autoAcceptEnabled, setAutoAcceptEnabled] = useState(false);
  const [autoAcceptLoading, setAutoAcceptLoading] = useState(false);
  const [maxDistance, setMaxDistance] = useState(15);
  const [preferredTimeStart, setPreferredTimeStart] = useState(6);
  const [preferredTimeEnd, setPreferredTimeEnd] = useState(22);
  const [preferredServiceTypes, setPreferredServiceTypes] = useState<string[]>([]);
  const [learnedPreferences, setLearnedPreferences] = useState<{
    topServiceTypes?: string[];
    avgDistance?: number;
    peakHours?: string;
    acceptRate?: number;
  } | null>(null);

  // Notification hook
  const { status: notifStatus, isSupported: notifSupported, requestPermission } = useNotifications();

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem(DRIVER_TOKEN_KEY) || getStoredToken() || "";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }, []);

  useEffect(() => {
    const headers = getHeaders();

    fetch(resolveUrl("/api/driver/me"), { headers })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.driver) {
          const d = data.driver;
          const vehicleObj = d.assignedVehicle;
          const vehicle = d.vehicleMake && d.vehicleModel
            ? `${d.vehicleMake} ${d.vehicleModel}${d.vehicleYear ? ` ${d.vehicleYear}` : ""}`
            : d.vehicleName
              || (vehicleObj && typeof vehicleObj === "object"
                ? `${vehicleObj.make || ""} ${vehicleObj.model || ""} ${vehicleObj.year || ""}`.trim() || vehicleObj.name || vehicleObj.plate || "No vehicle assigned"
                : vehicleObj)
              || "No vehicle assigned";
          setVehicleInfo(vehicle);
        } else {
          setVehicleInfo("No vehicle assigned");
        }
        if (data?.documentCount !== undefined) {
          setDocumentCount(data.documentCount);
        }
      })
      .catch(() => setVehicleInfo("No vehicle assigned"));

    // Fetch auto-accept settings
    fetch(resolveUrl("/api/driver/settings"), { headers })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setAutoAcceptEnabled(data.autoAcceptEnabled ?? false);
          setMaxDistance(data.maxDistance ?? 15);
          setPreferredTimeStart(data.preferredTimeStart ?? 6);
          setPreferredTimeEnd(data.preferredTimeEnd ?? 22);
          setPreferredServiceTypes(data.preferredServiceTypes ?? []);
          if (data.learnedPreferences) {
            setLearnedPreferences(data.learnedPreferences);
          }
        }
      })
      .catch(() => {});
  }, [getHeaders]);

  const saveAutoAcceptSettings = useCallback((updates: Record<string, any>) => {
    setAutoAcceptLoading(true);
    const headers = getHeaders();

    fetch(resolveUrl("/api/driver/settings"), {
      method: "PATCH",
      headers,
      body: JSON.stringify(updates),
    })
      .then((r) => r.ok ? r.json() : null)
      .finally(() => setAutoAcceptLoading(false));
  }, [getHeaders]);

  const handleAutoAcceptToggle = useCallback((enabled: boolean) => {
    setAutoAcceptEnabled(enabled);
    saveAutoAcceptSettings({ autoAcceptEnabled: enabled });
  }, [saveAutoAcceptSettings]);

  const handleMaxDistanceChange = useCallback((value: number) => {
    setMaxDistance(value);
    saveAutoAcceptSettings({ maxDistance: value });
  }, [saveAutoAcceptSettings]);

  const handleTimeStartChange = useCallback((value: number) => {
    setPreferredTimeStart(value);
    saveAutoAcceptSettings({ preferredTimeStart: value });
  }, [saveAutoAcceptSettings]);

  const handleTimeEndChange = useCallback((value: number) => {
    setPreferredTimeEnd(value);
    saveAutoAcceptSettings({ preferredTimeEnd: value });
  }, [saveAutoAcceptSettings]);

  const toggleServiceType = useCallback((serviceType: string) => {
    setPreferredServiceTypes((prev) => {
      const next = prev.includes(serviceType)
        ? prev.filter((s) => s !== serviceType)
        : [...prev, serviceType];
      saveAutoAcceptSettings({ preferredServiceTypes: next });
      return next;
    });
  }, [saveAutoAcceptSettings]);

  const serviceTypeOptions = [
    { key: "ambulatory", label: "Ambulatory" },
    { key: "wheelchair", label: "Wheelchair" },
    { key: "stretcher", label: "Stretcher" },
    { key: "bariatric", label: "Bariatric" },
    { key: "gurney", label: "Gurney" },
    { key: "long_distance", label: "Long Distance" },
    { key: "delivery", label: "Delivery" },
  ];

  const navLabels = { ask: "Ask", google: "Google", apple: "Apple", waze: "Waze" };
  const navOptions: ("ask" | "google" | "apple" | "waze")[] = ["ask", "google", "apple", "waze"];

  return (
    <NebulaBackground>
      <div className="max-w-md mx-auto w-full px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-9 h-9 rounded-full"
            style={{ background: "rgba(255,255,255,0.80)", color: colors.textPrimary, boxShadow: colors.shadowSm, border: "1px solid rgba(0,0,0,0.04)" }}
            data-testid="btn-back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold" style={{ color: colors.textPrimary }}>
            Profile
          </h1>
        </div>

        {/* Profile card */}
        <GlassCard variant="elevated" testID="card-profile-header" className="!p-5">
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold"
              style={{
                background: `linear-gradient(135deg, ${colors.sunrise}, ${colors.golden})`,
                color: "#fff",
                boxShadow: `0 8px 24px rgba(255,107,53,0.3)`,
              }}
              data-testid="avatar-large"
            >
              {driverInitials || "DR"}
            </div>
            <div>
              <p className="text-lg font-bold" style={{ color: colors.textPrimary }}>
                {driverName || "Driver"}
              </p>
              <p className="text-xs" style={{ color: colors.textTertiary }}>UCM Driver</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs flex items-center gap-1" style={{ color: colors.warning }}>
                  <Star className="w-3 h-3" style={{ fill: colors.warning }} /> {rating}
                </span>
                <span className="text-xs" style={{ color: colors.textTertiary }}>
                  {completedRides} rides
                </span>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Navigation preference */}
        <GlassCard variant="default" testID="card-settings-nav" className="!p-4">
          <p className="text-[10px] uppercase tracking-wider mb-2 px-1 font-semibold" style={{ color: colors.textTertiary }}>
            Navigation App
          </p>
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(0,0,0,0.03)" }}>
            {navOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setNavPreference(opt)}
                className="flex-1 py-2.5 rounded-lg text-[10px] font-semibold capitalize transition-all"
                style={{
                  background: navPreference === opt ? "white" : "transparent",
                  color: navPreference === opt ? colors.sunrise : colors.textTertiary,
                  boxShadow: navPreference === opt ? colors.shadowSm : "none",
                }}
                data-testid={`nav-pref-${opt}`}
              >
                {navLabels[opt]}
              </button>
            ))}
          </div>
        </GlassCard>

        {/* Preferences */}
        <GlassCard variant="default" testID="card-settings-prefs" className="!p-4">
          <p className="text-[10px] uppercase tracking-wider mb-1 px-1 font-semibold" style={{ color: colors.textTertiary }}>
            Preferences
          </p>
          <ToggleRow icon={<Volume2 className="w-4 h-4" />} label="Sounds" value={sounds} onChange={setSounds} testID="toggle-sounds" />
          <ToggleRow icon={<Vibrate className="w-4 h-4" />} label="Haptics" value={haptics} onChange={setHaptics} accent={colors.sky} testID="toggle-haptics" />
          <ToggleRow icon={<Eye className="w-4 h-4" />} label="Reduced Motion" value={reducedMotion} onChange={setReducedMotion} accent={colors.warning} testID="toggle-reduced-motion" />
        </GlassCard>

        {/* Information */}
        <GlassCard variant="default" testID="card-settings-info" className="!p-4">
          <p className="text-[10px] uppercase tracking-wider mb-1 px-1 font-semibold" style={{ color: colors.textTertiary }}>
            Information
          </p>
          <SettingsRow icon={<Car className="w-4 h-4" />} label="Vehicle Info" value={vehicleInfo} testID="row-vehicle" />
          <SettingsRow icon={<FileText className="w-4 h-4" />} label="Documents" value={documentCount !== null ? `${documentCount} uploaded` : "-"} accent={colors.sky} testID="row-documents" />
          <SettingsRow icon={<Shield className="w-4 h-4" />} label="Safety" accent={colors.danger} testID="row-safety" />
        </GlassCard>

        {/* Auto-Accept Preferences */}
        <GlassCard variant="default" testID="card-auto-accept" className="!p-4">
          <p className="text-[10px] uppercase tracking-wider mb-1 px-1 font-semibold" style={{ color: colors.textTertiary }}>
            Auto-Accept
          </p>
          <ToggleRow
            icon={<Zap className="w-4 h-4" />}
            label="Auto-Accept Trips"
            value={autoAcceptEnabled}
            onChange={handleAutoAcceptToggle}
            accent={colors.success}
            testID="toggle-auto-accept"
          />

          {autoAcceptEnabled && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 space-y-1"
            >
              <PreferenceSlider
                label="Max Distance"
                value={maxDistance}
                min={1}
                max={50}
                step={1}
                unit=" mi"
                onChange={handleMaxDistanceChange}
                accent={colors.sky}
                testID="slider-max-distance"
              />
              <PreferenceSlider
                label="Available From"
                value={preferredTimeStart}
                min={0}
                max={23}
                step={1}
                unit=":00"
                onChange={handleTimeStartChange}
                accent={colors.sunrise}
                testID="slider-time-start"
              />
              <PreferenceSlider
                label="Available Until"
                value={preferredTimeEnd}
                min={1}
                max={24}
                step={1}
                unit=":00"
                onChange={handleTimeEndChange}
                accent={colors.sunrise}
                testID="slider-time-end"
              />

              {/* Service type preferences */}
              <div className="pt-2 px-1">
                <p className="text-[10px] uppercase tracking-wider mb-2 font-semibold" style={{ color: colors.textTertiary }}>
                  Service Types
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {serviceTypeOptions.map((opt) => {
                    const isActive = preferredServiceTypes.includes(opt.key);
                    return (
                      <button
                        key={opt.key}
                        onClick={() => toggleServiceType(opt.key)}
                        className="px-3 py-1.5 rounded-full text-[10px] font-semibold transition-all"
                        style={{
                          background: isActive ? glowColor(colors.sunrise, 0.12) : "rgba(0,0,0,0.03)",
                          color: isActive ? colors.sunrise : colors.textTertiary,
                          border: `1px solid ${isActive ? glowColor(colors.sunrise, 0.2) : "rgba(0,0,0,0.04)"}`,
                        }}
                        data-testid={`service-pref-${opt.key}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {preferredServiceTypes.length === 0 && (
                  <p className="text-[9px] mt-1.5" style={{ color: colors.textTertiary }}>
                    No filter — all service types accepted
                  </p>
                )}
              </div>

              {/* Learned preferences display */}
              {learnedPreferences && (
                <div className="pt-3 px-1">
                  <p className="text-[10px] uppercase tracking-wider mb-2 font-semibold" style={{ color: colors.textTertiary }}>
                    Learned Preferences
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {learnedPreferences.topServiceTypes && learnedPreferences.topServiceTypes.length > 0 && (
                      <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl" style={{ background: "rgba(0,0,0,0.02)" }}>
                        <Route className="w-3.5 h-3.5" style={{ color: colors.sky }} />
                        <div>
                          <p className="text-[9px] uppercase tracking-wider font-medium" style={{ color: colors.textTertiary }}>Top Types</p>
                          <p className="text-[10px] font-semibold" style={{ color: colors.textPrimary }}>
                            {learnedPreferences.topServiceTypes.slice(0, 2).join(", ")}
                          </p>
                        </div>
                      </div>
                    )}
                    {learnedPreferences.avgDistance != null && (
                      <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl" style={{ background: "rgba(0,0,0,0.02)" }}>
                        <MapPin className="w-3.5 h-3.5" style={{ color: colors.success }} />
                        <div>
                          <p className="text-[9px] uppercase tracking-wider font-medium" style={{ color: colors.textTertiary }}>Avg Dist</p>
                          <p className="text-[10px] font-semibold" style={{ color: colors.textPrimary }}>
                            {learnedPreferences.avgDistance.toFixed(1)} mi
                          </p>
                        </div>
                      </div>
                    )}
                    {learnedPreferences.peakHours && (
                      <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl" style={{ background: "rgba(0,0,0,0.02)" }}>
                        <Clock className="w-3.5 h-3.5" style={{ color: colors.warning }} />
                        <div>
                          <p className="text-[9px] uppercase tracking-wider font-medium" style={{ color: colors.textTertiary }}>Peak Hours</p>
                          <p className="text-[10px] font-semibold" style={{ color: colors.textPrimary }}>
                            {learnedPreferences.peakHours}
                          </p>
                        </div>
                      </div>
                    )}
                    {learnedPreferences.acceptRate != null && (
                      <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl" style={{ background: "rgba(0,0,0,0.02)" }}>
                        <Zap className="w-3.5 h-3.5" style={{ color: colors.sunrise }} />
                        <div>
                          <p className="text-[9px] uppercase tracking-wider font-medium" style={{ color: colors.textTertiary }}>Accept Rate</p>
                          <p className="text-[10px] font-semibold" style={{ color: colors.textPrimary }}>
                            {(learnedPreferences.acceptRate * 100).toFixed(0)}%
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </GlassCard>

        {/* Notifications */}
        <GlassCard variant="default" testID="card-notifications" className="!p-4">
          <p className="text-[10px] uppercase tracking-wider mb-1 px-1 font-semibold" style={{ color: colors.textTertiary }}>
            Notifications
          </p>
          <div className="flex items-center justify-between py-3 px-1 border-b" style={{ borderColor: "rgba(0,0,0,0.04)" }}>
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: glowColor(notifStatus === "granted" ? colors.success : colors.warning, 0.08) }}
              >
                {notifStatus === "granted" ? (
                  <Bell className="w-4 h-4" style={{ color: colors.success }} />
                ) : (
                  <BellOff className="w-4 h-4" style={{ color: colors.warning }} />
                )}
              </div>
              <div>
                <span className="text-sm" style={{ color: colors.textPrimary }}>Push Notifications</span>
                <p className="text-[10px]" style={{ color: colors.textTertiary }}>
                  {notifStatus === "granted"
                    ? "Enabled — you'll receive trip alerts"
                    : notifStatus === "denied"
                    ? "Blocked — enable in browser settings"
                    : !notifSupported
                    ? "Not supported in this browser"
                    : "Tap to enable notifications"}
                </p>
              </div>
            </div>
            {notifStatus !== "granted" && notifStatus !== "denied" && notifSupported && (
              <button
                onClick={requestPermission}
                className="px-3 py-1.5 rounded-full text-[10px] font-semibold"
                style={{
                  background: glowColor(colors.sunrise, 0.1),
                  color: colors.sunrise,
                  border: `1px solid ${glowColor(colors.sunrise, 0.15)}`,
                }}
                data-testid="btn-enable-notifications"
              >
                Enable
              </button>
            )}
            {notifStatus === "granted" && (
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: colors.success, boxShadow: `0 0 8px ${glowColor(colors.success, 0.4)}` }}
              />
            )}
          </div>
        </GlassCard>

        {/* Legal */}
        <GlassCard variant="default" testID="card-settings-legal" className="!p-4">
          <p className="text-[10px] uppercase tracking-wider mb-1 px-1 font-semibold" style={{ color: colors.textTertiary }}>
            Legal
          </p>
          <SettingsRow
            icon={<FileText className="w-4 h-4" />}
            label="Privacy Policy"
            onPress={() => window.open("/privacy", "_blank")}
            testID="row-privacy-policy"
          />
          <SettingsRow
            icon={<FileText className="w-4 h-4" />}
            label="Terms of Service"
            onPress={() => window.open("/terms", "_blank")}
            accent={colors.sky}
            testID="row-terms-of-service"
          />
          <ProfileVersionDisplay />
        </GlassCard>
      </div>
    </NebulaBackground>
  );
}
