import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown } from "lucide-react";
import { MAP_LEGEND_ITEMS, DRIVER_LEGEND_ITEMS } from "@/lib/tripStatusMapping";

export function MapLegend() {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute bottom-3 left-3 z-20">
      {open ? (
        <Card className="w-56">
          <CardContent className="p-2">
            <div className="flex items-center justify-between gap-1 mb-1.5">
              <span className="text-xs font-semibold">Legend</span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setOpen(false)}
                data-testid="map-legend-toggle"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div className="col-span-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-0.5">
                Trip Status
              </div>
              {MAP_LEGEND_ITEMS.map((item) => (
                <div key={item.status} className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-[11px] leading-tight">{item.label}</span>
                </div>
              ))}
              <div className="col-span-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-1.5">
                Driver
              </div>
              {DRIVER_LEGEND_ITEMS.map((item) => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-[11px] leading-tight">{item.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setOpen(true)}
          data-testid="map-legend-toggle"
        >
          Legend
        </Button>
      )}
    </div>
  );
}
