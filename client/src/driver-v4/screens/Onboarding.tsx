import { motion } from "framer-motion";
import { ChevronRight, Shield, Truck, MapPin, Clock } from "lucide-react";
import { useReducedMotion } from "../design/accessibility";
import { colors } from "../design/tokens";
import { glowColor } from "../design/theme";
import { NeonButton } from "../components/ui/NeonButton";
import { GlassCard } from "../components/ui/GlassCard";

function FloatingOrbs() {
  const reduced = useReducedMotion();
  if (reduced) return null;

  const orbs = [
    { x: 15, y: 20, size: 120, color: colors.sunrise, opacity: 0.08, delay: 0 },
    { x: 75, y: 30, size: 80, color: colors.golden, opacity: 0.06, delay: 1 },
    { x: 50, y: 70, size: 100, color: colors.sky, opacity: 0.05, delay: 2 },
    { x: 85, y: 80, size: 60, color: colors.coral, opacity: 0.07, delay: 0.5 },
    { x: 20, y: 85, size: 90, color: colors.golden, opacity: 0.04, delay: 1.5 },
  ];

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {orbs.map((orb, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${orb.x}%`,
            top: `${orb.y}%`,
            width: orb.size,
            height: orb.size,
            background: `radial-gradient(circle, ${glowColor(orb.color, orb.opacity)} 0%, transparent 70%)`,
            transform: "translate(-50%, -50%)",
          }}
          animate={{
            y: [0, -20, 0],
            scale: [1, 1.1, 1],
          }}
          transition={{
            duration: 6 + i,
            repeat: Infinity,
            delay: orb.delay,
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
    <div
      className="relative flex flex-col min-h-screen overflow-hidden"
      style={{
        background: `linear-gradient(160deg, #FFFAF5 0%, #FFF5EB 30%, #FFE8D6 60%, #F5F0EB 100%)`,
      }}
    >
      <FloatingOrbs />

      <div className="flex-1 flex flex-col items-center justify-center px-6 max-w-md mx-auto w-full relative z-10">
        <motion.div
          initial={reduced ? {} : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-8 text-center"
        >
          {/* Logo */}
          <motion.div
            className="w-24 h-24 mx-auto mb-6 rounded-3xl flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${colors.sunrise}, ${colors.golden})`,
              boxShadow: `0 12px 40px rgba(255,107,53,0.3), 0 4px 12px rgba(255,107,53,0.2)`,
            }}
            animate={reduced ? {} : {
              boxShadow: [
                `0 12px 40px rgba(255,107,53,0.25), 0 4px 12px rgba(255,107,53,0.15)`,
                `0 16px 52px rgba(255,107,53,0.35), 0 6px 16px rgba(255,107,53,0.25)`,
                `0 12px 40px rgba(255,107,53,0.25), 0 4px 12px rgba(255,107,53,0.15)`,
              ],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            data-testid="logo-glow"
          >
            <span className="text-4xl font-bold text-white" style={{ textShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
              U
            </span>
          </motion.div>

          <motion.h1
            initial={reduced ? {} : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-3xl font-bold mb-2"
            style={{ color: colors.textPrimary }}
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
          <GlassCard variant="elevated" className="!p-4">
            <div className="space-y-3">
              {[
                { icon: <Truck className="w-4 h-4" style={{ color: colors.sunrise }} />, title: "Real-time trips", desc: "Accept and manage trips on the go" },
                { icon: <MapPin className="w-4 h-4" style={{ color: colors.success }} />, title: "Live navigation", desc: "Turn-by-turn directions to pickup and dropoff" },
                { icon: <Clock className="w-4 h-4" style={{ color: colors.sky }} />, title: "Track your shift", desc: "Clock in/out, view earnings, and shift history" },
              ].map((f, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,0,0,0.03)" }}>
                    {f.icon}
                  </div>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: colors.textPrimary }}>{f.title}</p>
                    <p className="text-[10px]" style={{ color: colors.textTertiary }}>{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
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

          <div className="flex items-center justify-center gap-1.5 pt-2">
            <Shield className="w-3 h-3" style={{ color: colors.textTertiary }} />
            <span className="text-[10px]" style={{ color: colors.textTertiary }}>
              Secured by UCM • HIPAA Compliant
            </span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
