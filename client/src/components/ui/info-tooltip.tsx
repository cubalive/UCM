import * as React from "react";
import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  iconClassName?: string;
  maxWidth?: number;
}

/**
 * InfoTooltip — a small "?" icon that shows a helpful explanation on hover.
 * Use on important buttons, KPI cards, or any UI element that needs context.
 */
export function InfoTooltip({
  content,
  side = "top",
  className,
  iconClassName,
  maxWidth = 280,
}: InfoTooltipProps) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center rounded-full p-0.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
          aria-label="More information"
        >
          <HelpCircle className={cn("h-3.5 w-3.5", iconClassName)} />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className="text-xs leading-relaxed font-normal"
        style={{ maxWidth }}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

interface ButtonWithTooltipProps {
  tooltip: React.ReactNode;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps any button/element with a hover tooltip for explanation.
 */
export function ButtonWithTooltip({
  tooltip,
  tooltipSide = "top",
  children,
  className,
}: ButtonWithTooltipProps) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <div className={cn("inline-flex", className)}>{children}</div>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="text-xs max-w-[280px]">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
