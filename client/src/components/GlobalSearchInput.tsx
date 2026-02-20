import { useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Search, X, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

interface SearchResult {
  id: number;
  publicId: string;
  [key: string]: any;
}

interface GlobalSearchInputProps {
  entity: "patients" | "drivers" | "vehicles" | "trips" | "clinics";
  placeholder?: string;
  onSelect?: (result: SearchResult) => void;
  onResults?: (results: SearchResult[]) => void;
  onQueryChange?: (query: string) => void;
  className?: string;
}

export function GlobalSearchInput({
  entity,
  placeholder,
  onSelect,
  onResults,
  onQueryChange,
  className = "",
}: GlobalSearchInputProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const { token } = useAuth();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([]);
        onResults?.([]);
        setShowDropdown(false);
        return;
      }
      setLoading(true);
      try {
        const data = await apiFetch(`/api/search/${entity}?q=${encodeURIComponent(q)}`, token);
        setResults(data);
        onResults?.(data);
        setShowDropdown(data.length > 0);
      } catch {
        setResults([]);
        onResults?.([]);
      } finally {
        setLoading(false);
      }
    },
    [entity, token, onResults]
  );

  const handleChange = (value: string) => {
    setQuery(value);
    onQueryChange?.(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleClear = () => {
    setQuery("");
    onQueryChange?.("");
    setResults([]);
    onResults?.([]);
    setShowDropdown(false);
  };

  const handleSelect = (result: SearchResult) => {
    onSelect?.(result);
    setShowDropdown(false);
  };

  const renderLabel = (r: SearchResult): string => {
    if (entity === "patients") return `${r.firstName} ${r.lastName}`;
    if (entity === "drivers") return `${r.firstName} ${r.lastName}`;
    if (entity === "vehicles") return r.name || `${r.make} ${r.model}`;
    if (entity === "trips") return `${r.publicId} — ${r.pickupAddress || ""}`;
    if (entity === "clinics") return r.name;
    return r.publicId;
  };

  const renderSub = (r: SearchResult): string => {
    if (entity === "patients") return r.phone || r.email || r.publicId;
    if (entity === "drivers") return r.phone || r.publicId;
    if (entity === "vehicles") return r.licensePlate || r.publicId;
    if (entity === "trips") return r.status || "";
    if (entity === "clinics") return r.address || r.publicId;
    return "";
  };

  return (
    <div ref={containerRef} className={`relative ${className}`} data-testid={`search-${entity}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          data-testid={`search-input-${entity}`}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder || `Search ${entity}...`}
          className="pl-9 pr-8"
        />
        {loading && (
          <Loader2 className="absolute right-8 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {query && (
          <button
            data-testid={`search-clear-${entity}`}
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
      {showDropdown && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-lg max-h-64 overflow-y-auto" data-testid={`search-results-${entity}`}>
          {results.map((r) => (
            <button
              key={r.id}
              data-testid={`search-result-${entity}-${r.id}`}
              onClick={() => handleSelect(r)}
              className="w-full text-left px-3 py-2 hover:bg-accent transition-colors border-b last:border-b-0"
            >
              <div className="font-medium text-sm">{renderLabel(r)}</div>
              <div className="text-xs text-muted-foreground">{renderSub(r)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
