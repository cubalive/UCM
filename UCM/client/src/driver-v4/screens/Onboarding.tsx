import { motion } from "framer-motion";
import { Fingerprint, QrCode, ChevronRight, Shield } from "lucide-react";
import { useReducedMotion } from "../design/accessibility";
import { colors } from "../design/tokens";
import { glowColor } from "../design/theme";
import { NeonButton } from "../components/ui/NeonButton";
import { GlassCard } from "../components/ui/GlassCard";
import { NebulaBackground } from "../components/ui/MapOverlay";

function ParticleField() {
  const reduced = useReducedMotion();
  if (reduced) return null;

  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: 1 + Math.random() * 2,
    delay: Math.random() * 5,
    duration: 3 + Math.random() * 4,
  }));

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            background: colors.neonCyan,
            opacity: 0,
          }}
          animate={{
            opacity: [0, 0.6, 0],
            scale: [0.5, 1, 0.5],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

export function Onboarding({ onContinue }: { onContinue: () => void }) {
  const reduced = useReducedMotion();

  return (
    <NebulaBackground className="flex flex-col min-h-screen">
      <ParticleField />

      <div className="flex-1 flex flex-col items-center justify-center px-6 max-w-md mx-auto w-full">
        <motion.div
          initial={reduced ? {} : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-8 text-center"
        >
          <motion.div
            className="w-24 h-24 mx-auto mb-6 rounded-3xl flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${colors.neonCyan}, ${colors.neonPurple})`,
              boxShadow: `0 0 40px ${glowColor(colors.neonCyan, 0.4)}, 0 0 80px ${glowColor(colors.neonPurple, 0.2)}`,
            }}
            animate={reduced ? {} : {
              boxShadow: [
                `0 0 40px ${glowColor(colors.neonCyan, 0.3)}, 0 0 80px ${glowColor(colors.neonPurple, 0.15)}`,
                `0 0 60px ${glowColor(colors.neonCyan, 0.5)}, 0 0 100px ${glowColor(colors.neonPurple, 0.25)}`,
                `0 0 40px ${glowColor(colors.neonCyan, 0.3)}, 0 0 80px ${glowColor(colors.neonPurple, 0.15)}`,
              ],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            data-testid="logo-glow"
          >
            <span className="text-4xl font-bold" style={{ color: "#000", fontFamily: "'Space Grotesk', system-ui" }}>
              U
            </span>
          </motion.div>

          <motion.h1
            initial={reduced ? {} : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-3xl font-bold mb-2"
            style={{
              color: colors.textPrimary,
              fontFamily: "'Space Grotesk', system-ui",
              textShadow: `0 0 30px ${glowColor(colors.neonCyan, 0.2)}`,
            }}
          >
            UCM Driver
          </motion.h1>
          <motion.p
            initial={reduced ? {} : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="text-sm"
            style={{ color: colors.textSecondary }}
          >
            United Care Mobility — Driver Platform v4
          </motion.p>
        </motion.div>

        <motion.div
          className="w-full space-y-3"
          initial={reduced ? {} : { opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <GlassCard variant="default" className="!p-0">
            <button
              className="w-full flex items-center gap-4 p-4"
              style={{ color: colors.textPrimary }}
              data-testid="btn-scan-qr"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: glowColor(colors.neonPurple, 0.15) }}
              >
                <QrCode className="w-5 h-5" style={{ color: colors.neonPurple }} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium">Scan QR Code</p>
                <p className="text-[10px]" style={{ color: colors.textTertiary }}>Quick login with company QR</p>
              </div>
              <ChevronRight className="w-4 h-4" style={{ color: colors.textTertiary }} />
            </button>
          </GlassCard>

          <GlassCard variant="default" className="!p-0">
            <button
              className="w-full flex items-center gap-4 p-4"
              style={{ color: colors.textPrimary }}
              data-testid="btn-biometric"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: glowColor(colors.neonCyan, 0.15) }}
              >
                <Fingerprint className="w-5 h-5" style={{ color: colors.neonCyan }} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium">Biometric Login</p>
                <p className="text-[10px]" style={{ color: colors.textTertiary }}>Use Face ID or fingerprint</p>
              </div>
              <ChevronRight className="w-4 h-4" style={{ color: colors.textTertiary }} />
            </button>
          </GlassCard>

          <div className="pt-3">
            <NeonButton
              title="Continue"
              onPress={onContinue}
              variant="primary"
              testID="btn-continue"
              icon={<ChevronRight className="w-5 h-5" />}
            />
          </div>

          <div className="flex items-center justify-center gap-1 pt-2">
            <Shield className="w-3 h-3" style={{ color: colors.textTertiary }} />
            <span className="text-[10px]" style={{ color: colors.textTertiary }}>
              Secured by UCM • HIPAA Compliant
            </span>
          </div>
        </motion.div>
      </div>
    </NebulaBackground>
  );
}
