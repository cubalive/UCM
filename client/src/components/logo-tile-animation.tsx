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
        <div className="flex flex-col items-center gap-3" data-testid="img-login-logo">
          <div className="h-16 w-16 rounded-2xl flex items-center justify-center bg-gradient-to-br from-emerald-500 via-emerald-600 to-emerald-800 shadow-xl shadow-emerald-500/20">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z" fill="white" fillOpacity="0.95"/>
              <path d="M10 15l-3-3 1.41-1.41L10 12.17l5.59-5.59L17 8l-7 7z" fill="#059669"/>
            </svg>
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              UCM <span className="text-amber-500 text-sm font-semibold tracking-widest">ELITE</span>
            </h1>
            <p className="text-xs text-muted-foreground tracking-wider mt-0.5">Mobility Management System</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="relative" style={{ width: 240, height: 80 }}>
        <div className="absolute inset-0 flex items-center justify-center" data-testid="img-login-logo">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 rounded-2xl flex items-center justify-center bg-gradient-to-br from-emerald-500 via-emerald-600 to-emerald-800 shadow-lg shadow-emerald-500/20">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z" fill="white" fillOpacity="0.95"/>
                <path d="M10 15l-3-3 1.41-1.41L10 12.17l5.59-5.59L17 8l-7 7z" fill="#059669"/>
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                UCM <span className="text-amber-500 text-xs font-semibold tracking-widest">ELITE</span>
              </h1>
              <p className="text-[10px] text-muted-foreground tracking-wider">Mobility System</p>
            </div>
          </div>
        </div>
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
