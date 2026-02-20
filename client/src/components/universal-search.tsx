import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X, Loader2, Route, HeartPulse, UserCheck, Truck, Building2, Globe, FileText } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

interface SearchResult {
  id: number;
  publicId?: string;
  [key: string]: any;
}

interface GroupedResults {
  trips: SearchResult[];
  patients: SearchResult[];
  drivers: SearchResult[];
  vehicles: SearchResult[];
  clinics: SearchResult[];
}

const ENTITY_CONFIG = {
  trips: { icon: Route, label: "Trips", route: (id: number) => `/trips/${id}` },
  patients: { icon: HeartPulse, label: "Patients", route: (id: number) => `/patients?highlight=${id}` },
  drivers: { icon: UserCheck, label: "Drivers", route: (id: number) => `/drivers?highlight=${id}` },
  vehicles: { icon: Truck, label: "Vehicles", route: (id: number) => `/vehicles?highlight=${id}` },
  clinics: { icon: Building2, label: "Clinics", route: (id: number) => `/clinics?highlight=${id}` },
} as const;

type EntityType = keyof typeof ENTITY_CONFIG;

function getResultLabel(entity: EntityType, r: SearchResult): string {
  switch (entity) {
    case "trips": return r.publicId || `Trip #${r.id}`;
    case "patients": return `${r.firstName || ""} ${r.lastName || ""}`.trim() || r.publicId || `#${r.id}`;
    case "drivers": return `${r.firstName || ""} ${r.lastName || ""}`.trim() || r.publicId || `#${r.id}`;
    case "vehicles": return r.name || `${r.make || ""} ${r.model || ""}`.trim() || r.publicId || `#${r.id}`;
    case "clinics": return r.name || r.publicId || `#${r.id}`;
    default: return r.publicId || `#${r.id}`;
  }
}

function getResultSub(entity: EntityType, r: SearchResult): string {
  switch (entity) {
    case "trips": return `${r.status || ""} — ${r.pickupAddress?.split(",")[0] || ""}`;
    case "patients": return r.phone || r.email || "";
    case "drivers": return r.phone || r.status || "";
    case "vehicles": return r.licensePlate || "";
    case "clinics": return r.address?.split(",")[0] || r.phone || "";
    default: return "";
  }
}

export function UniversalSearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GroupedResults>({ trips: [], patients: [], drivers: [], vehicles: [], clinics: [] });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { token, user } = useAuth();
  const [, navigate] = useLocation();

  const isClinicUser = user?.role === "VIEWER" || user?.role === "CLINIC_ADMIN" || user?.role === "CLINIC_USER" || user?.role === "CLINIC_VIEWER";

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const flatResults = (() => {
    const items: { entity: EntityType; result: SearchResult }[] = [];
    for (const entity of Object.keys(ENTITY_CONFIG) as EntityType[]) {
      for (const r of results[entity] || []) {
        items.push({ entity, result: r });
      }
    }
    return items;
  })();

  const totalCount = flatResults.length;

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults({ trips: [], patients: [], drivers: [], vehicles: [], clinics: [] });
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const entities: EntityType[] = isClinicUser
        ? ["trips", "patients"]
        : ["trips", "patients", "drivers", "vehicles", "clinics"];

      const promises = entities.map(async (entity) => {
        try {
          const data = await apiFetch(`/api/search/${entity}?q=${encodeURIComponent(q)}`, token);
          return { entity, data: (data || []).slice(0, 5) };
        } catch {
          return { entity, data: [] };
        }
      });

      const settled = await Promise.all(promises);
      const grouped: GroupedResults = { trips: [], patients: [], drivers: [], vehicles: [], clinics: [] };
      for (const { entity, data } of settled) {
        grouped[entity] = data;
      }
      setResults(grouped);
      setOpen(true);
      setSelectedIndex(-1);
    } finally {
      setLoading(false);
    }
  }, [token, isClinicUser]);

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleClear = () => {
    setQuery("");
    setResults({ trips: [], patients: [], drivers: [], vehicles: [], clinics: [] });
    setOpen(false);
    setSelectedIndex(-1);
  };

  const handleSelect = (entity: EntityType, result: SearchResult) => {
    const route = ENTITY_CONFIG[entity].route(result.id);
    navigate(route);
    setOpen(false);
    setQuery("");
    setResults({ trips: [], patients: [], drivers: [], vehicles: [], clinics: [] });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || totalCount === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % totalCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + totalCount) % totalCount);
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      const item = flatResults[selectedIndex];
      if (item) handleSelect(item.entity, item.result);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md" data-testid="universal-search">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          data-testid="input-universal-search"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (query.length >= 2 && totalCount > 0) setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder="Search trips, patients, drivers... (⌘K)"
          className="pl-9 pr-8 h-9 text-sm"
        />
        {loading && (
          <Loader2 className="absolute right-8 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {query && (
          <button
            data-testid="button-clear-universal-search"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {open && (query.length >= 2) && (
        <div
          className="absolute z-[100] mt-1 w-full bg-popover border rounded-md shadow-lg max-h-[400px] overflow-y-auto"
          data-testid="universal-search-results"
        >
          {totalCount === 0 && !loading ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground" data-testid="text-no-search-results">
              No results found for "{query}"
            </div>
          ) : (
            <>
              {(Object.keys(ENTITY_CONFIG) as EntityType[]).map((entity) => {
                const entityResults = results[entity] || [];
                if (entityResults.length === 0) return null;
                const config = ENTITY_CONFIG[entity];
                const Icon = config.icon;
                let currentStartIdx = 0;
                for (const e of Object.keys(ENTITY_CONFIG) as EntityType[]) {
                  if (e === entity) break;
                  currentStartIdx += (results[e] || []).length;
                }

                return (
                  <div key={entity} data-testid={`search-group-${entity}`}>
                    <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-muted/30 flex items-center gap-1.5 sticky top-0">
                      <Icon className="w-3 h-3" />
                      {config.label}
                      <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-auto">{entityResults.length}</Badge>
                    </div>
                    {entityResults.map((r, idx) => {
                      const globalIdx = currentStartIdx + idx;
                      return (
                        <button
                          key={r.id}
                          data-testid={`search-result-${entity}-${r.id}`}
                          onClick={() => handleSelect(entity, r)}
                          className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors border-b last:border-b-0 ${
                            globalIdx === selectedIndex ? "bg-accent" : ""
                          }`}
                        >
                          <div className="font-medium text-sm">{getResultLabel(entity, r)}</div>
                          <div className="text-xs text-muted-foreground">{getResultSub(entity, r)}</div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
