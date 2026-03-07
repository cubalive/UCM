import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type TripType = "one_time" | "recurring";
export type SeriesPattern = "mwf" | "tths" | "daily" | "custom";

const PATTERN_OPTIONS: { value: SeriesPattern; label: string; days: string[] }[] = [
  { value: "mwf", label: "Mon / Wed / Fri", days: ["Mon", "Wed", "Fri"] },
  { value: "tths", label: "Tue / Thu / Sat", days: ["Tue", "Thu", "Sat"] },
  { value: "daily", label: "Daily (Mon-Sun)", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
  { value: "custom", label: "Custom", days: [] },
];

export type SeriesEndType = "end_date" | "occurrences";

interface RecurringScheduleProps {
  tripType: TripType;
  onTripTypeChange: (type: TripType) => void;
  recurringDays: string[];
  onRecurringDaysChange: (days: string[]) => void;
  seriesPattern?: SeriesPattern;
  onSeriesPatternChange?: (pattern: SeriesPattern) => void;
  seriesEndType?: SeriesEndType;
  onSeriesEndTypeChange?: (type: SeriesEndType) => void;
  endDate?: string;
  onEndDateChange?: (date: string) => void;
  occurrences?: string;
  onOccurrencesChange?: (count: string) => void;
  minDate?: string;
  testIdPrefix?: string;
}

export function RecurringSchedule({
  tripType,
  onTripTypeChange,
  recurringDays,
  onRecurringDaysChange,
  seriesPattern = "custom",
  onSeriesPatternChange,
  seriesEndType = "end_date",
  onSeriesEndTypeChange,
  endDate = "",
  onEndDateChange,
  occurrences = "",
  onOccurrencesChange,
  minDate,
  testIdPrefix = "trip",
}: RecurringScheduleProps) {
  const toggleDay = (day: string) => {
    onRecurringDaysChange(
      recurringDays.includes(day)
        ? recurringDays.filter((d) => d !== day)
        : [...recurringDays, day]
    );
  };

  const handlePatternChange = (pattern: SeriesPattern) => {
    onSeriesPatternChange?.(pattern);
    const preset = PATTERN_OPTIONS.find((p) => p.value === pattern);
    if (preset && preset.days.length > 0) {
      onRecurringDaysChange(preset.days);
    }
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

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Pattern</Label>
            <div className="flex flex-wrap gap-2">
              {PATTERN_OPTIONS.map((opt) => {
                const isActive = seriesPattern === opt.value;
                return (
                  <Button
                    key={opt.value}
                    type="button"
                    variant="outline"
                    size="sm"
                    className={isActive ? "toggle-elevate toggle-elevated" : ""}
                    onClick={() => handlePatternChange(opt.value)}
                    data-testid={`button-${testIdPrefix}-pattern-${opt.value}`}
                  >
                    {opt.label}
                  </Button>
                );
              })}
            </div>
          </div>

          {seriesPattern === "custom" && (
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
          )}

          {recurringDays.length > 0 && (
            <p className="text-xs text-muted-foreground" data-testid={`text-${testIdPrefix}-selected-days`}>
              Selected: {recurringDays.join(", ")}
            </p>
          )}

          <div className="space-y-2 pt-2 border-t">
            <Label className="text-xs text-muted-foreground">Series End</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={seriesEndType === "end_date" ? "toggle-elevate toggle-elevated" : ""}
                onClick={() => onSeriesEndTypeChange?.("end_date")}
                data-testid={`button-${testIdPrefix}-end-type-date`}
              >
                End Date
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={seriesEndType === "occurrences" ? "toggle-elevate toggle-elevated" : ""}
                onClick={() => onSeriesEndTypeChange?.("occurrences")}
                data-testid={`button-${testIdPrefix}-end-type-occurrences`}
              >
                Number of Trips
              </Button>
            </div>

            {seriesEndType === "end_date" && (
              <div className="space-y-1">
                <Label className="text-xs">End Date *</Label>
                <Input
                  type="date"
                  value={endDate}
                  min={minDate}
                  onChange={(e) => onEndDateChange?.(e.target.value)}
                  data-testid={`input-${testIdPrefix}-end-date`}
                />
              </div>
            )}

            {seriesEndType === "occurrences" && (
              <div className="space-y-1">
                <Label className="text-xs">Number of Trips *</Label>
                <Input
                  type="number"
                  min="1"
                  max="365"
                  value={occurrences}
                  onChange={(e) => onOccurrencesChange?.(e.target.value)}
                  placeholder="e.g. 10"
                  data-testid={`input-${testIdPrefix}-occurrences`}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
