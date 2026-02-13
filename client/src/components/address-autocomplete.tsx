import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MapPin, Loader2, X, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api";

export interface StructuredAddress {
  formattedAddress: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
}

export function AddressAutocomplete({
  label,
  value,
  onSelect,
  token,
  testIdPrefix,
  required,
}: {
  label: string;
  value: StructuredAddress | null;
  onSelect: (addr: StructuredAddress | null) => void;
  token: string | null;
  testIdPrefix: string;
  required?: boolean;
}) {
  const [inputValue, setInputValue] = useState(value?.formattedAddress || "");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value?.formattedAddress && inputValue !== value.formattedAddress) {
      setInputValue(value.formattedAddress);
    }
  }, [value?.formattedAddress]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (query.length < 3) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        const data = await apiFetch("/api/maps/places/autocomplete", token, {
          method: "POST",
          body: JSON.stringify({ input: query }),
        });
        setSuggestions(data.results || []);
        setShowDropdown(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  const handleInputChange = (val: string) => {
    setInputValue(val);
    if (value) onSelect(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
  };

  const handleSelectSuggestion = async (suggestion: any) => {
    setShowDropdown(false);
    setInputValue(suggestion.description);
    setDetailsLoading(true);
    try {
      const data = await apiFetch("/api/maps/places/details", token, {
        method: "POST",
        body: JSON.stringify({ placeId: suggestion.placeId }),
      });
      if (data.result) {
        onSelect(data.result);
        setInputValue(data.result.formattedAddress);
      }
    } catch {
      onSelect(null);
    } finally {
      setDetailsLoading(false);
    }
  };

  const hasZipError = value && !value.zip;

  const handleClear = () => {
    setInputValue("");
    onSelect(null);
    setSuggestions([]);
    setShowDropdown(false);
  };

  if (value) {
    return (
      <div className="space-y-2">
        <Label>{label} {required && "*"}</Label>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 rounded-md border px-3 py-2 text-sm bg-muted/50">
            <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="truncate" data-testid={`text-${testIdPrefix}-selected`}>{value.formattedAddress}</span>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={handleClear} data-testid={`button-${testIdPrefix}-clear`}>
            <span className="sr-only">Clear</span>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">Street:</span>{" "}
            <span data-testid={`text-${testIdPrefix}-street`}>{value.street || "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">City:</span>{" "}
            <span data-testid={`text-${testIdPrefix}-city`}>{value.city || "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">State:</span>{" "}
            <span data-testid={`text-${testIdPrefix}-state`}>{value.state || "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">ZIP:</span>{" "}
            <span data-testid={`text-${testIdPrefix}-zip`} className={hasZipError ? "text-destructive font-medium" : ""}>
              {value.zip || "Missing"}
            </span>
          </div>
        </div>
        {hasZipError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            ZIP code is required. Please clear and select a more specific address.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      <Label>{label} {required && "*"}</Label>
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
          placeholder="Start typing an address..."
          className="pl-9"
          data-testid={`input-${testIdPrefix}-address`}
        />
        {(loading || detailsLoading) && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
        )}
        {showDropdown && suggestions.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-60 overflow-y-auto">
            {suggestions.map((s: any) => (
              <button
                key={s.placeId}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover-elevate cursor-pointer"
                onClick={() => handleSelectSuggestion(s)}
                data-testid={`option-${testIdPrefix}-${s.placeId}`}
              >
                <span className="font-medium">{s.mainText}</span>
                <span className="text-muted-foreground ml-1 text-xs">{s.secondaryText}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
