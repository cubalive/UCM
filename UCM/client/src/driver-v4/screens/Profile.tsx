import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft, User, Car, FileText, Volume2, Vibrate,
  Eye, Navigation, Shield, Info, ChevronRight, Settings, ExternalLink
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
  accent = colors.neonCyan,
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
      style={{ borderColor: "rgba(255,255,255,0.06)", cursor: onPress ? "pointer" : "default" }}
      data-testid={testID}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: glowColor(accent, 0.12) }}
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
  accent = colors.neonCyan,
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
      style={{ borderColor: "rgba(255,255,255,0.06)" }}
      data-testid={testID}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: glowColor(accent, 0.12) }}
        >
          <span style={{ color: accent }}>{icon}</span>
        </div>
        <span className="text-sm" style={{ color: colors.textPrimary }}>{label}</span>
      </div>
      <button
        onClick={() => onChange(!value)}
        className="relative w-11 h-6 rounded-full transition-colors"
        style={{
          background: value ? glowColor(colors.neonCyan, 0.3) : "rgba(255,255,255,0.1)",
          border: `1px solid ${value ? glowColor(colors.neonCyan, 0.4) : "rgba(255,255,255,0.1)"}`,
        }}
        role="switch"
        aria-checked={value}
      >
        <motion.div
          className="absolute top-0.5 w-5 h-5 rounded-full"
          animate={{ left: value ? 21 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          style={{
            background: value ? colors.neonCyan : "rgba(255,255,255,0.3)",
            boxShadow: value ? `0 0 8px ${glowColor(colors.neonCyan, 0.5)}` : "none",
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

  const [sounds, setSounds] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  const navLabels = { ask: "Ask Each Time", google: "Google Maps", apple: "Apple Maps", waze: "Waze" };
  const navOptions: ("ask" | "google" | "apple" | "waze")[] = ["ask", "google", "apple", "waze"];

  return (
    <NebulaBackground className="min-h-screen">
      <div className="max-w-md mx-auto w-full px-4 py-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-8 h-8 rounded-full"
            style={{ background: "rgba(255,255,255,0.08)", color: colors.textPrimary }}
            data-testid="btn-back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold" style={{ color: colors.textPrimary, fontFamily: "'Space Grotesk', system-ui" }}>
            Profile
          </h1>
        </div>

        <GlassCard variant="elevated" testID="card-profile-header" className="!p-5">
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold"
              style={{
                background: `linear-gradient(135deg, ${colors.neonCyan}, ${colors.neonPurple})`,
                color: "#000",
                boxShadow: `0 0 24px ${glowColor(colors.neonCyan, 0.3)}, 0 0 48px ${glowColor(colors.neonPurple, 0.15)}`,
                fontFamily: "'Space Grotesk', system-ui",
              }}
              data-testid="avatar-large"
            >
              JD
            </div>
            <div>
              <p className="text-lg font-bold" style={{ color: colors.textPrimary, fontFamily: "'Space Grotesk', system-ui" }}>
                John Driver
              </p>
              <p className="text-xs" style={{ color: colors.textTertiary }}>ID: DRV-2024-0042</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs flex items-center gap-1" style={{ color: colors.warningNeon }}>
                  ★ {rating}
                </span>
                <span className="text-xs" style={{ color: colors.textTertiary }}>
                  {completedRides} rides
                </span>
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard variant="default" testID="card-settings-nav" className="!p-3">
          <p className="text-[10px] uppercase tracking-wider mb-2 px-1" style={{ color: colors.textTertiary }}>
            Navigation
          </p>
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
            {navOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setNavPreference(opt)}
                className="flex-1 py-2 rounded-lg text-[10px] font-semibold uppercase tracking-wider transition-all"
                style={{
                  background: navPreference === opt ? glowColor(colors.neonCyan, 0.2) : "transparent",
                  color: navPreference === opt ? colors.neonCyan : colors.textTertiary,
                  border: navPreference === opt ? `1px solid ${glowColor(colors.neonCyan, 0.3)}` : "1px solid transparent",
                }}
                data-testid={`nav-pref-${opt}`}
              >
                {navLabels[opt]}
              </button>
            ))}
          </div>
        </GlassCard>

        <GlassCard variant="default" testID="card-settings-prefs" className="!p-3">
          <p className="text-[10px] uppercase tracking-wider mb-1 px-1" style={{ color: colors.textTertiary }}>
            Preferences
          </p>
          <ToggleRow icon={<Volume2 className="w-4 h-4" />} label="Sounds" value={sounds} onChange={setSounds} testID="toggle-sounds" />
          <ToggleRow icon={<Vibrate className="w-4 h-4" />} label="Haptics" value={haptics} onChange={setHaptics} accent={colors.neonPurple} testID="toggle-haptics" />
          <ToggleRow icon={<Eye className="w-4 h-4" />} label="Reduced Motion" value={reducedMotion} onChange={setReducedMotion} accent={colors.neonMagenta} testID="toggle-reduced-motion" />
        </GlassCard>

        <GlassCard variant="default" testID="card-settings-info" className="!p-3">
          <p className="text-[10px] uppercase tracking-wider mb-1 px-1" style={{ color: colors.textTertiary }}>
            Information
          </p>
          <SettingsRow icon={<Car className="w-4 h-4" />} label="Vehicle Info" value="Toyota Camry 2023" onPress={() => {}} testID="row-vehicle" />
          <SettingsRow icon={<FileText className="w-4 h-4" />} label="Documents" value="3 uploaded" onPress={() => {}} accent={colors.neonPurple} testID="row-documents" />
          <SettingsRow icon={<Shield className="w-4 h-4" />} label="Safety" onPress={() => {}} accent={colors.dangerNeon} testID="row-safety" />
        </GlassCard>

        <GlassCard variant="default" testID="card-settings-legal" className="!p-3">
          <p className="text-[10px] uppercase tracking-wider mb-1 px-1" style={{ color: colors.textTertiary }}>
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
            accent={colors.neonPurple}
            testID="row-terms-of-service"
          />
          <ProfileVersionDisplay />
        </GlassCard>
      </div>
    </NebulaBackground>
  );
}
