import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Search, Filter, X, SlidersHorizontal } from "lucide-react";

export interface FilterOption {
  key: string;
  label: string;
  type: "select" | "multi-select" | "date" | "boolean";
  options?: { value: string; label: string }[];
}

export interface ActiveFilter {
  key: string;
  value: string;
  label: string;
  displayValue: string;
}

interface FilterBarProps {
  filters: FilterOption[];
  activeFilters: ActiveFilter[];
  onFilterChange: (filters: ActiveFilter[]) => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  totalCount?: number;
  filteredCount?: number;
  storageKey?: string;
}

export function FilterBar({
  filters,
  activeFilters,
  onFilterChange,
  searchValue = "",
  onSearchChange,
  searchPlaceholder = "Search...",
  totalCount,
  filteredCount,
  storageKey,
}: FilterBarProps) {
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    if (storageKey && activeFilters.length > 0) {
      try {
        localStorage.setItem(`ucm-filters-${storageKey}`, JSON.stringify(activeFilters));
      } catch {}
    }
  }, [activeFilters, storageKey]);

  const addFilter = useCallback((key: string, value: string) => {
    const filterDef = filters.find(f => f.key === key);
    if (!filterDef) return;

    const displayValue = filterDef.options?.find(o => o.value === value)?.label || value;
    const existing = activeFilters.filter(f => f.key !== key);
    onFilterChange([...existing, { key, value, label: filterDef.label, displayValue }]);
  }, [filters, activeFilters, onFilterChange]);

  const removeFilter = useCallback((key: string) => {
    onFilterChange(activeFilters.filter(f => f.key !== key));
    if (storageKey) {
      try {
        const updated = activeFilters.filter(f => f.key !== key);
        if (updated.length === 0) {
          localStorage.removeItem(`ucm-filters-${storageKey}`);
        } else {
          localStorage.setItem(`ucm-filters-${storageKey}`, JSON.stringify(updated));
        }
      } catch {}
    }
  }, [activeFilters, onFilterChange, storageKey]);

  const clearAll = useCallback(() => {
    onFilterChange([]);
    if (storageKey) {
      try { localStorage.removeItem(`ucm-filters-${storageKey}`); } catch {}
    }
  }, [onFilterChange, storageKey]);

  return (
    <div className="space-y-2" data-testid="filter-bar">
      <div className="flex items-center gap-2 flex-wrap">
        {onSearchChange && (
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-filter-search"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-9 pr-8 h-9"
            />
            {searchValue && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
                data-testid="button-clear-search"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        )}

        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-open-filters" className="gap-1.5">
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {activeFilters.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs ml-1">{activeFilters.length}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start" data-testid="popover-filters">
            <div className="space-y-3">
              <p className="text-sm font-semibold">Filter by</p>
              {filters.map((filter) => {
                const currentValue = activeFilters.find(f => f.key === filter.key)?.value || "";
                return (
                  <div key={filter.key} className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">{filter.label}</label>
                    {filter.type === "select" && filter.options && (
                      <Select
                        value={currentValue || "all"}
                        onValueChange={(v) => {
                          if (v === "all") {
                            removeFilter(filter.key);
                          } else {
                            addFilter(filter.key, v);
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 text-sm" data-testid={`select-filter-${filter.key}`}>
                          <SelectValue placeholder={`Select ${filter.label}...`} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {filter.options.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {filter.type === "date" && (
                      <Input
                        type="date"
                        value={currentValue}
                        onChange={(e) => {
                          if (e.target.value) {
                            addFilter(filter.key, e.target.value);
                          } else {
                            removeFilter(filter.key);
                          }
                        }}
                        className="h-8 text-sm"
                        data-testid={`input-filter-${filter.key}`}
                      />
                    )}
                    {filter.type === "boolean" && (
                      <Select
                        value={currentValue || "all"}
                        onValueChange={(v) => {
                          if (v === "all") {
                            removeFilter(filter.key);
                          } else {
                            addFilter(filter.key, v);
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 text-sm" data-testid={`select-filter-${filter.key}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="true">Yes</SelectItem>
                          <SelectItem value="false">No</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        {totalCount != null && (
          <span className="text-sm text-muted-foreground" data-testid="text-result-count">
            Showing {filteredCount != null ? filteredCount : totalCount} of {totalCount} results
          </span>
        )}
      </div>

      {activeFilters.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap" data-testid="active-filter-chips">
          {activeFilters.map((f) => (
            <Badge
              key={f.key}
              variant="secondary"
              className="gap-1 pl-2 pr-1 py-0.5 text-xs"
              data-testid={`chip-filter-${f.key}`}
            >
              {f.label}: {f.displayValue}
              <button
                onClick={() => removeFilter(f.key)}
                className="ml-0.5 hover:bg-muted rounded p-0.5"
                data-testid={`button-remove-filter-${f.key}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="text-xs h-6"
            data-testid="button-clear-all-filters"
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}

export function usePersistedFilters(storageKey: string): [ActiveFilter[], (filters: ActiveFilter[]) => void] {
  const [filters, setFilters] = useState<ActiveFilter[]>(() => {
    try {
      const saved = localStorage.getItem(`ucm-filters-${storageKey}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  return [filters, setFilters];
}
