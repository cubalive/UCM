import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft, User, Car, FileText, Volume2, Vibrate,
  Eye, Navigation, Shield, Info, ChevronRight, Settings, ExternalLink, Star
} from "lucide-react";
import { useDriverStore } from "../store/driverStore";
import { colors } from "../design/tokens";
import { glowColor } from "../design/theme";
import { GlassCard } from "../components/ui/GlassCard";
import { NebulaBackground } from "../components/ui/MapOverlay";
import { resolveUrl } from "@/lib/api";

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

  useEffect(() => {
    const token = localStorage.getItem("ucm_driver_token") || "";
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(resolveUrl("/api/driver/me"), { headers })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.driver) {
          const d = data.driver;
          const vehicle = d.vehicleMake && d.vehicleModel
            ? `${d.vehicleMake} ${d.vehicleModel}${d.vehicleYear ? ` ${d.vehicleYear}` : ""}`
            : d.vehicleName || d.assignedVehicle || "No vehicle assigned";
          setVehicleInfo(vehicle);
        } else {
          setVehicleInfo("No vehicle assigned");
        }
        if (data?.documentCount !== undefined) {
          setDocumentCount(data.documentCount);
        }
      })
      .catch(() => setVehicleInfo("No vehicle assigned"));
  }, []);

  const navLabels = { ask: "Ask", google: "Google", apple: "Apple", waze: "Waze" };
  const navOptions: ("ask" | "google" | "apple" | "waze")[] = ["ask", "google", "apple", "waze"];

  return (
    <NebulaBackground className="min-h-screen">
      <div className="max-w-md mx-auto w-full px-4 py-6 space-y-4 overflow-y-auto" style={{ maxHeight: "100%" }}>
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
