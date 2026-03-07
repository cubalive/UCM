import { useState, useEffect, useMemo } from "react";

const GRID_SIZE = 8;
const ANIMATION_DURATION = 1500;

function getTileDelay(row: number, col: number, gridSize: number): number {
  const center = (gridSize - 1) / 2;
  const dist = Math.max(Math.abs(row - center), Math.abs(col - center));
  const maxDist = center;
  const normalizedDist = 1 - dist / maxDist;
  return normalizedDist * (ANIMATION_DURATION * 0.6);
}

export function LogoTileAnimation({ className = "" }: { className?: string }) {
  const [animationDone, setAnimationDone] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) {
      setAnimationDone(true);
      return;
    }
    const timer = setTimeout(() => setAnimationDone(true), ANIMATION_DURATION + 200);
    return () => clearTimeout(timer);
  }, [prefersReducedMotion]);

  const tiles = useMemo(() => {
    const result: { row: number; col: number; delay: number }[] = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        result.push({ row: r, col: c, delay: getTileDelay(r, c, GRID_SIZE) });
      }
    }
    return result;
  }, []);

  if (animationDone || prefersReducedMotion) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <img
          src="/branding/logo-horizontal.png"
          alt="United Care Mobility"
          className="h-20 w-auto max-w-full"
          data-testid="img-login-logo"
        />
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="relative" style={{ width: 240, height: 80 }}>
        <img
          src="/branding/logo-horizontal.png"
          alt="United Care Mobility"
          className="absolute inset-0 w-full h-full object-contain"
          data-testid="img-login-logo"
        />
        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
            gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`,
          }}
        >
          {tiles.map(({ row, col, delay }) => (
            <div
              key={`${row}-${col}`}
              className="logo-tile"
              style={{
                animationDelay: `${delay}ms`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
