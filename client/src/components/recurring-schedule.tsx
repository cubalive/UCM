import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const RECURRING_PRESETS = [
  { label: "Mon / Wed / Fri", days: ["Mon", "Wed", "Fri"] },
  { label: "Tue / Thu / Sat", days: ["Tue", "Thu", "Sat"] },
  { label: "Daily (Mon-Sun)", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
];

export type TripType = "one_time" | "recurring";

interface RecurringScheduleProps {
  tripType: TripType;
  onTripTypeChange: (type: TripType) => void;
  recurringDays: string[];
  onRecurringDaysChange: (days: string[]) => void;
  testIdPrefix?: string;
}

export function RecurringSchedule({
  tripType,
  onTripTypeChange,
  recurringDays,
  onRecurringDaysChange,
  testIdPrefix = "trip",
}: RecurringScheduleProps) {
  const toggleDay = (day: string) => {
    onRecurringDaysChange(
      recurringDays.includes(day)
        ? recurringDays.filter((d) => d !== day)
        : [...recurringDays, day]
    );
  };

  const applyPreset = (days: string[]) => {
    onRecurringDaysChange(days);
  };

  return (
    <>
      <div className="space-y-2">
        <Label>Trip Type *</Label>
        <Select value={tripType} onValueChange={(v) => onTripTypeChange(v as TripType)}>
          <SelectTrigger data-testid={`select-${testIdPrefix}-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one_time">One-time</SelectItem>
            <SelectItem value="recurring">Recurring</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {tripType === "recurring" && (
        <div className="space-y-3 rounded-md border p-3" data-testid={`section-${testIdPrefix}-recurring`}>
          <Label>Recurring Schedule</Label>
          <div className="flex flex-wrap gap-2">
            {RECURRING_PRESETS.map((preset) => {
              const isActive =
                preset.days.length === recurringDays.length &&
                preset.days.every((d) => recurringDays.includes(d));
              return (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  className={isActive ? "toggle-elevate toggle-elevated" : ""}
                  onClick={() => applyPreset(preset.days)}
                  data-testid={`button-${testIdPrefix}-preset-${preset.label.replace(/[\s\/]/g, "-").toLowerCase()}`}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3">
            {ALL_DAYS.map((day) => (
              <label key={day} className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={recurringDays.includes(day)}
                  onCheckedChange={() => toggleDay(day)}
                  data-testid={`checkbox-${testIdPrefix}-day-${day.toLowerCase()}`}
                />
                <span className="text-sm">{day}</span>
              </label>
            ))}
          </div>
          {recurringDays.length > 0 && (
            <p className="text-xs text-muted-foreground" data-testid={`text-${testIdPrefix}-selected-days`}>
              Selected: {recurringDays.join(", ")}
            </p>
          )}
        </div>
      )}
    </>
  );
}
