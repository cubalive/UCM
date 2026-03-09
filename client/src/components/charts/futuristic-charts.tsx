import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";

// ─── Color palettes ──────────────────────────────────────────────────────
const NEON_COLORS = {
  cyan: { main: "#06b6d4", glow: "rgba(6,182,212,0.3)", gradient: ["#06b6d4", "#0891b2"] },
  blue: { main: "#3b82f6", glow: "rgba(59,130,246,0.3)", gradient: ["#3b82f6", "#2563eb"] },
  purple: { main: "#8b5cf6", glow: "rgba(139,92,246,0.3)", gradient: ["#8b5cf6", "#7c3aed"] },
  emerald: { main: "#10b981", glow: "rgba(16,185,129,0.3)", gradient: ["#10b981", "#059669"] },
  amber: { main: "#f59e0b", glow: "rgba(245,158,11,0.3)", gradient: ["#f59e0b", "#d97706"] },
  rose: { main: "#f43f5e", glow: "rgba(244,63,94,0.3)", gradient: ["#f43f5e", "#e11d48"] },
} as const;

type NeonColorKey = keyof typeof NEON_COLORS;
const COLOR_KEYS = Object.keys(NEON_COLORS) as NeonColorKey[];

// ─── Animated counter ────────────────────────────────────────────────────
export function AnimatedNumber({
  value,
  duration = 800,
  prefix = "",
  suffix = "",
  decimals = 0,
  className,
}: {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);
      if (progress < 1) requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
    prevRef.current = value;
  }, [value, duration]);

  return (
    <span className={cn("tabular-nums", className)}>
      {prefix}
      {decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString()}
      {suffix}
    </span>
  );
}

// ─── Glow Area Chart ─────────────────────────────────────────────────────
interface GlowAreaChartProps {
  data: Record<string, any>[];
  dataKeys: { key: string; color?: NeonColorKey; label?: string }[];
  xAxisKey: string;
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  className?: string;
  formatTooltip?: (value: number, name: string) => string;
}

export function GlowAreaChart({
  data,
  dataKeys,
  xAxisKey,
  height = 300,
  showGrid = true,
  showLegend = true,
  className,
  formatTooltip,
}: GlowAreaChartProps) {
  const gradientId = useMemo(() => `glow-area-${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <defs>
            {dataKeys.map((dk, i) => {
              const colorKey = dk.color || COLOR_KEYS[i % COLOR_KEYS.length];
              const colors = NEON_COLORS[colorKey];
              return (
                <linearGradient key={dk.key} id={`${gradientId}-${dk.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.main} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={colors.main} stopOpacity={0.02} />
                </linearGradient>
              );
            })}
          </defs>
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              strokeOpacity={0.4}
              vertical={false}
            />
          )}
          <XAxis
            dataKey={xAxisKey}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={45}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              borderColor: "hsl(var(--border))",
              borderRadius: "0.75rem",
              boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
              fontSize: "12px",
            }}
            formatter={(value: number, name: string) =>
              formatTooltip ? formatTooltip(value, name) : value.toLocaleString()
            }
          />
          {showLegend && (
            <Legend
              wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }}
              iconType="circle"
              iconSize={8}
            />
          )}
          {dataKeys.map((dk, i) => {
            const colorKey = dk.color || COLOR_KEYS[i % COLOR_KEYS.length];
            const colors = NEON_COLORS[colorKey];
            return (
              <Area
                key={dk.key}
                type="monotone"
                dataKey={dk.key}
                name={dk.label || dk.key}
                stroke={colors.main}
                strokeWidth={2.5}
                fill={`url(#${gradientId}-${dk.key})`}
                dot={false}
                activeDot={{
                  r: 5,
                  fill: colors.main,
                  stroke: "hsl(var(--background))",
                  strokeWidth: 2,
                  style: { filter: `drop-shadow(0 0 6px ${colors.glow})` },
                }}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Glow Bar Chart ──────────────────────────────────────────────────────
interface GlowBarChartProps {
  data: Record<string, any>[];
  dataKeys: { key: string; color?: NeonColorKey; label?: string }[];
  xAxisKey: string;
  height?: number;
  stacked?: boolean;
  showGrid?: boolean;
  showLegend?: boolean;
  className?: string;
  formatTooltip?: (value: number, name: string) => string;
}

export function GlowBarChart({
  data,
  dataKeys,
  xAxisKey,
  height = 300,
  stacked = false,
  showGrid = true,
  showLegend = true,
  className,
  formatTooltip,
}: GlowBarChartProps) {
  const gradientId = useMemo(() => `glow-bar-${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <defs>
            {dataKeys.map((dk, i) => {
              const colorKey = dk.color || COLOR_KEYS[i % COLOR_KEYS.length];
              const colors = NEON_COLORS[colorKey];
              return (
                <linearGradient key={dk.key} id={`${gradientId}-${dk.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.gradient[0]} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={colors.gradient[1]} stopOpacity={0.7} />
                </linearGradient>
              );
            })}
          </defs>
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              strokeOpacity={0.4}
              vertical={false}
            />
          )}
          <XAxis
            dataKey={xAxisKey}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={45}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              borderColor: "hsl(var(--border))",
              borderRadius: "0.75rem",
              boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
              fontSize: "12px",
            }}
            formatter={(value: number, name: string) =>
              formatTooltip ? formatTooltip(value, name) : value.toLocaleString()
            }
            cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
          />
          {showLegend && (
            <Legend
              wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }}
              iconType="circle"
              iconSize={8}
            />
          )}
          {dataKeys.map((dk, i) => {
            const colorKey = dk.color || COLOR_KEYS[i % COLOR_KEYS.length];
            return (
              <Bar
                key={dk.key}
                dataKey={dk.key}
                name={dk.label || dk.key}
                fill={`url(#${gradientId}-${dk.key})`}
                radius={[6, 6, 0, 0]}
                stackId={stacked ? "stack" : undefined}
                maxBarSize={48}
              />
            );
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Radial Gauge ────────────────────────────────────────────────────────
interface RadialGaugeProps {
  value: number;
  max?: number;
  label: string;
  color?: NeonColorKey;
  size?: number;
  strokeWidth?: number;
  className?: string;
  formatValue?: (val: number) => string;
}

export function RadialGauge({
  value,
  max = 100,
  label,
  color = "cyan",
  size = 120,
  strokeWidth = 8,
  className,
  formatValue,
}: RadialGaugeProps) {
  const [animatedValue, setAnimatedValue] = useState(0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(Math.max(animatedValue / max, 0), 1);
  const offset = circumference * (1 - pct);
  const colors = NEON_COLORS[color];

  useEffect(() => {
    const duration = 800;
    const startTime = performance.now();
    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedValue(value * eased);
      if (progress < 1) requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }, [value]);

  const displayVal = formatValue ? formatValue(animatedValue) : `${Math.round(pct * 100)}%`;

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.main}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 0.1s linear",
            filter: `drop-shadow(0 0 6px ${colors.glow})`,
          }}
        />
      </svg>
      <div
        className="absolute flex flex-col items-center justify-center"
        style={{ width: size, height: size }}
      >
        <span className="text-lg font-bold tabular-nums" style={{ color: colors.main }}>
          {displayVal}
        </span>
      </div>
      <span className="text-xs text-muted-foreground font-medium mt-1">{label}</span>
    </div>
  );
}

// ─── Sparkline (inline mini chart) ───────────────────────────────────────
interface SparklineProps {
  data: number[];
  color?: NeonColorKey;
  width?: number;
  height?: number;
  filled?: boolean;
  className?: string;
}

export function Sparkline({
  data,
  color = "cyan",
  width = 80,
  height = 28,
  filled = true,
  className,
}: SparklineProps) {
  if (!data.length) return null;
  const colors = NEON_COLORS[color];
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const padY = 2;

  const points = data.map((v, i) => ({
    x: (i / Math.max(data.length - 1, 1)) * width,
    y: padY + ((max - v) / range) * (height - padY * 2),
  }));

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg width={width} height={height} className={cn("flex-shrink-0", className)}>
      {filled && (
        <defs>
          <linearGradient id={`spark-fill-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.main} stopOpacity={0.3} />
            <stop offset="100%" stopColor={colors.main} stopOpacity={0.02} />
          </linearGradient>
        </defs>
      )}
      {filled && <path d={areaD} fill={`url(#spark-fill-${color})`} />}
      <path
        d={pathD}
        fill="none"
        stroke={colors.main}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 3px ${colors.glow})` }}
      />
    </svg>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────
interface KpiCardProps {
  title: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  change?: number;
  changeLabel?: string;
  sparkData?: number[];
  color?: NeonColorKey;
  icon?: React.ReactNode;
  tooltip?: string;
  className?: string;
}

export function KpiCard({
  title,
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  change,
  changeLabel,
  sparkData,
  color = "cyan",
  icon,
  tooltip,
  className,
}: KpiCardProps) {
  const colors = NEON_COLORS[color];
  const isPositive = change !== undefined && change >= 0;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card p-4 transition-all duration-300",
        "hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20",
        "group",
        className
      )}
    >
      {/* Subtle glow accent */}
      <div
        className="absolute -top-12 -right-12 w-24 h-24 rounded-full opacity-[0.07] group-hover:opacity-[0.12] transition-opacity"
        style={{ background: `radial-gradient(circle, ${colors.main}, transparent)` }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {icon && <span className="flex-shrink-0">{icon}</span>}
          <span>{title}</span>
          {tooltip && (
            <span
              className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/30 text-[9px] text-muted-foreground/60 cursor-help"
              title={tooltip}
            >
              ?
            </span>
          )}
        </div>
        {sparkData && sparkData.length > 1 && (
          <Sparkline data={sparkData} color={color} width={64} height={24} />
        )}
      </div>

      <div className="mt-2 flex items-end gap-2">
        <AnimatedNumber
          value={value}
          prefix={prefix}
          suffix={suffix}
          decimals={decimals}
          className="text-2xl font-bold"
        />
        {change !== undefined && (
          <span
            className={cn(
              "text-xs font-medium flex items-center gap-0.5 pb-0.5",
              isPositive ? "text-emerald-500" : "text-rose-500"
            )}
          >
            <svg
              className={cn("w-3 h-3", !isPositive && "rotate-180")}
              fill="none"
              viewBox="0 0 12 12"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M6 9V3M3 5l3-3 3 3" />
            </svg>
            {Math.abs(change).toFixed(1)}%
            {changeLabel && <span className="text-muted-foreground ml-0.5">{changeLabel}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Donut Chart ─────────────────────────────────────────────────────────
interface DonutChartProps {
  data: { name: string; value: number; color?: NeonColorKey }[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  showLegend?: boolean;
  centerLabel?: string;
  centerValue?: string;
  className?: string;
}

export function DonutChart({
  data,
  height = 220,
  innerRadius = 60,
  outerRadius = 85,
  showLegend = true,
  centerLabel,
  centerValue,
  className,
}: DonutChartProps) {
  const COLORS_LIST = COLOR_KEYS.map((k) => NEON_COLORS[k].main);

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={3}
            dataKey="value"
            stroke="none"
          >
            {data.map((entry, index) => {
              const c = entry.color ? NEON_COLORS[entry.color].main : COLORS_LIST[index % COLORS_LIST.length];
              return <Cell key={entry.name} fill={c} />;
            })}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              borderColor: "hsl(var(--border))",
              borderRadius: "0.75rem",
              boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
              fontSize: "12px",
            }}
          />
          {showLegend && (
            <Legend
              wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
              iconType="circle"
              iconSize={8}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
      {centerLabel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-bold">{centerValue}</span>
          <span className="text-[10px] text-muted-foreground">{centerLabel}</span>
        </div>
      )}
    </div>
  );
}

// ─── Status Pulse ────────────────────────────────────────────────────────
interface StatusPulseProps {
  status: "healthy" | "warning" | "critical" | "offline";
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}

export function StatusPulse({ status, size = "md", label, className }: StatusPulseProps) {
  const sizeMap = { sm: "w-2 h-2", md: "w-3 h-3", lg: "w-4 h-4" };
  const pulseMap = { sm: "w-2 h-2", md: "w-3 h-3", lg: "w-4 h-4" };
  const colorMap = {
    healthy: "bg-emerald-500",
    warning: "bg-amber-500",
    critical: "bg-rose-500",
    offline: "bg-gray-400",
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="relative flex">
        {status !== "offline" && (
          <span
            className={cn(
              "absolute inline-flex rounded-full opacity-75 animate-ping",
              pulseMap[size],
              colorMap[status]
            )}
          />
        )}
        <span className={cn("relative inline-flex rounded-full", sizeMap[size], colorMap[status])} />
      </span>
      {label && <span className="text-xs font-medium">{label}</span>}
    </div>
  );
}

// ─── Metric Trend Line ───────────────────────────────────────────────────
interface MetricTrendProps {
  data: Record<string, any>[];
  dataKeys: { key: string; color?: NeonColorKey; label?: string; dashed?: boolean }[];
  xAxisKey: string;
  height?: number;
  showDots?: boolean;
  className?: string;
}

export function MetricTrendLine({
  data,
  dataKeys,
  xAxisKey,
  height = 250,
  showDots = false,
  className,
}: MetricTrendProps) {
  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            strokeOpacity={0.4}
            vertical={false}
          />
          <XAxis
            dataKey={xAxisKey}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={45}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              borderColor: "hsl(var(--border))",
              borderRadius: "0.75rem",
              boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
              fontSize: "12px",
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }}
            iconType="circle"
            iconSize={8}
          />
          {dataKeys.map((dk, i) => {
            const colorKey = dk.color || COLOR_KEYS[i % COLOR_KEYS.length];
            const colors = NEON_COLORS[colorKey];
            return (
              <Line
                key={dk.key}
                type="monotone"
                dataKey={dk.key}
                name={dk.label || dk.key}
                stroke={colors.main}
                strokeWidth={2}
                strokeDasharray={dk.dashed ? "5 5" : undefined}
                dot={showDots ? { r: 3, fill: colors.main } : false}
                activeDot={{
                  r: 5,
                  fill: colors.main,
                  stroke: "hsl(var(--background))",
                  strokeWidth: 2,
                  style: { filter: `drop-shadow(0 0 6px ${colors.glow})` },
                }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
