import { colors } from "../../design/tokens";

interface MapOverlayProps {
  children: React.ReactNode;
  position: "top" | "bottom";
  className?: string;
  testID?: string;
}

export function MapOverlay({ children, position, className = "", testID }: MapOverlayProps) {
  const gradientDirection = position === "top" ? "to bottom" : "to top";

  return (
    <div
      data-testid={testID}
      className={`absolute left-0 right-0 z-20 ${position === "top" ? "top-0" : "bottom-0"} ${className}`}
      style={{
        background: `linear-gradient(${gradientDirection}, rgba(250,250,248,0.95) 0%, rgba(250,250,248,0.6) 60%, transparent 100%)`,
      }}
    >
      {children}
    </div>
  );
}

export function NebulaBackground({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`relative min-h-full ${className}`}
      style={{ background: `linear-gradient(160deg, ${colors.bg0} 0%, ${colors.bg1} 50%, ${colors.bg2} 100%)` }}
    >
      {/* Subtle warm ambient glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 600px 400px at 20% 10%, rgba(255,107,53,0.04) 0%, transparent 70%),
            radial-gradient(ellipse 500px 300px at 80% 50%, rgba(74,144,217,0.03) 0%, transparent 70%),
            radial-gradient(ellipse 400px 400px at 50% 90%, rgba(255,179,71,0.03) 0%, transparent 70%)
          `,
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
