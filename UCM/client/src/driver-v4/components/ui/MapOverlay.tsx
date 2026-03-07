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
        background: `linear-gradient(${gradientDirection}, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      {children}
    </div>
  );
}

export function NebulaBackground({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`relative min-h-screen overflow-hidden ${className}`}
      style={{ background: `linear-gradient(135deg, ${colors.bg0} 0%, ${colors.bg1} 50%, #0d001a 100%)` }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 600px 400px at 20% 20%, rgba(168,85,247,0.08) 0%, transparent 70%),
            radial-gradient(ellipse 500px 300px at 80% 60%, rgba(0,240,255,0.06) 0%, transparent 70%),
            radial-gradient(ellipse 400px 400px at 50% 90%, rgba(255,0,170,0.05) 0%, transparent 70%)
          `,
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
