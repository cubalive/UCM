import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MapPin, Loader2, X, AlertTriangle, Pencil } from "lucide-react";
import { resolveUrl } from "@/lib/api";

export interface StructuredAddress {
  formattedAddress: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  placeId?: string;
  manualOverride?: boolean;
}

interface Prediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

let mapsScriptPromise: Promise<void> | null = null;

function ensureMapsLoaded(apiKey: string): Promise<void> {
  if (typeof google !== "undefined" && google.maps?.places) {
    return Promise.resolve();
  }
  if (mapsScriptPromise) return mapsScriptPromise;

  const existing = document.querySelector(
    'script[src*="maps.googleapis.com/maps/api/js"]'
  ) as HTMLScriptElement | null;

  if (existing) {
    mapsScriptPromise = new Promise<void>((resolve, reject) => {
      if (typeof google !== "undefined" && google.maps?.places) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Google Maps"))
      );
      setTimeout(resolve, 3000);
    });
    return mapsScriptPromise;
  }

  mapsScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
  return mapsScriptPromise;
}

function parseAddressComponents(
  components: google.maps.GeocoderAddressComponent[]
): { street: string; city: string; state: string; zip: string } {
  function getComponent(type: string): string {
    const c = components.find((c) => c.types.includes(type));
    return c?.long_name || "";
  }
  function getShort(type: string): string {
    const c = components.find((c) => c.types.includes(type));
    return c?.short_name || "";
  }

  const streetNumber = getComponent("street_number");
  const route = getShort("route");
  const street = streetNumber ? `${streetNumber} ${route}` : route;

  return {
    street,
    city:
      getComponent("locality") ||
      getComponent("sublocality_level_1") ||
      getComponent("administrative_area_level_2") ||
      "",
    state: getShort("administrative_area_level_1"),
    zip: getComponent("postal_code"),
  };
}

export function AddressAutocomplete({
  label,
  value,
  onSelect,
  token,
  testIdPrefix,
  required,
  allowManualOverride,
}: {
  label: string;
  value: StructuredAddress | null;
  onSelect: (addr: StructuredAddress | null) => void;
  token: string | null;
  testIdPrefix: string;
  required?: boolean;
  allowManualOverride?: boolean;
}) {
  const [inputValue, setInputValue] = useState(value?.formattedAddress || "");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const dummyDivRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (value?.formattedAddress && inputValue !== value.formattedAddress) {
      setInputValue(value.formattedAddress);
    }
  }, [value?.formattedAddress]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const res = await fetch(resolveUrl("/api/maps/client-key"), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          const pubRes = await fetch(resolveUrl("/api/public/maps/key"));
          if (!pubRes.ok) {
            setMapsError(true);
            return;
          }
          const pubData = await pubRes.json();
          if (!pubData.key) {
            setMapsError(true);
            return;
          }
          await ensureMapsLoaded(pubData.key);
        } else {
          const data = await res.json();
          if (!data.key) {
            setMapsError(true);
            return;
          }
          await ensureMapsLoaded(data.key);
        }

        if (cancelled) return;

        autocompleteServiceRef.current =
          new google.maps.places.AutocompleteService();

        if (!dummyDivRef.current) {
          dummyDivRef.current = document.createElement("div");
        }
        placesServiceRef.current = new google.maps.places.PlacesService(
          dummyDivRef.current
        );

        setMapsReady(true);
      } catch {
        if (!cancelled) setMapsError(true);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const fetchPredictions = useCallback(
    (query: string) => {
      if (query.length < 3 || !autocompleteServiceRef.current) {
        setPredictions([]);
        return;
      }
      setLoading(true);
      autocompleteServiceRef.current.getPlacePredictions(
        {
          input: query,
          types: ["address"],
          componentRestrictions: { country: "us" },
        },
        (results, status) => {
          setLoading(false);
          if (
            status === google.maps.places.PlacesServiceStatus.OK &&
            results
          ) {
            setPredictions(
              results.map((r) => ({
                placeId: r.place_id,
                description: r.description,
                mainText: r.structured_formatting?.main_text || "",
                secondaryText:
                  r.structured_formatting?.secondary_text || "",
              }))
            );
            setShowDropdown(true);
          } else {
            setPredictions([]);
          }
        }
      );
    },
    []
  );

  const handleInputChange = (val: string) => {
    setInputValue(val);
    if (value) onSelect(null);
    if (manualMode) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(val), 300);
  };

  const handleSelectPrediction = (pred: Prediction) => {
    setShowDropdown(false);
    setInputValue(pred.description);
    setDetailsLoading(true);

    if (!placesServiceRef.current) {
      setDetailsLoading(false);
      return;
    }

    placesServiceRef.current.getDetails(
      {
        placeId: pred.placeId,
        fields: [
          "formatted_address",
          "geometry",
          "address_components",
          "place_id",
        ],
      },
      (place, status) => {
        setDetailsLoading(false);
        if (
          status === google.maps.places.PlacesServiceStatus.OK &&
          place
        ) {
          const parsed = parseAddressComponents(
            place.address_components || []
          );
          const addr: StructuredAddress = {
            formattedAddress: place.formatted_address || pred.description,
            street: parsed.street,
            city: parsed.city,
            state: parsed.state,
            zip: parsed.zip,
            lat: place.geometry?.location?.lat() || 0,
            lng: place.geometry?.location?.lng() || 0,
            placeId: place.place_id || pred.placeId,
          };
          onSelect(addr);
          setInputValue(addr.formattedAddress);
        } else {
          onSelect(null);
        }
      }
    );
  };

  const handleManualSubmit = () => {
    if (!inputValue.trim()) return;
    const addr: StructuredAddress = {
      formattedAddress: inputValue.trim(),
      street: "",
      city: "",
      state: "",
      zip: "",
      lat: 0,
      lng: 0,
      manualOverride: true,
    };
    onSelect(addr);
  };

  const hasZipError = value && !value.zip && !value.manualOverride;
  const hasCoordsError = value && (!value.lat || !value.lng) && !value.manualOverride;

  const handleClear = () => {
    setInputValue("");
    onSelect(null);
    setPredictions([]);
    setShowDropdown(false);
    setManualMode(false);
  };

  if (value) {
    return (
      <div className="space-y-2">
        <Label>
          {label} {required && "*"}
        </Label>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 rounded-md border px-3 min-h-[44px] text-sm bg-muted/50">
            <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span
              className="truncate"
              data-testid={`text-${testIdPrefix}-selected`}
            >
              {value.formattedAddress}
            </span>
            {value.manualOverride && (
              <span className="text-xs text-amber-600 dark:text-amber-400 flex-shrink-0">(manual)</span>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleClear}
            data-testid={`button-${testIdPrefix}-clear`}
          >
            <span className="sr-only">Clear</span>
            <X className="w-4 h-4" />
          </Button>
        </div>
        {!value.manualOverride && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Street:</span>{" "}
              <span data-testid={`text-${testIdPrefix}-street`}>
                {value.street || "\u2014"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">City:</span>{" "}
              <span data-testid={`text-${testIdPrefix}-city`}>
                {value.city || "\u2014"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">State:</span>{" "}
              <span data-testid={`text-${testIdPrefix}-state`}>
                {value.state || "\u2014"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">ZIP:</span>{" "}
              <span
                data-testid={`text-${testIdPrefix}-zip`}
                className={hasZipError ? "text-destructive font-medium" : ""}
              >
                {value.zip || "Missing"}
              </span>
            </div>
          </div>
        )}
        {hasZipError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            ZIP code is required. Please clear and select a more specific
            address.
          </p>
        )}
        {hasCoordsError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Coordinates are missing. Please clear and re-select the address.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label>
          {label} {required && "*"}
        </Label>
        {allowManualOverride && !manualMode && (
          <button
            type="button"
            onClick={() => { setManualMode(true); setPredictions([]); setShowDropdown(false); }}
            className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors min-h-[28px]"
            data-testid={`button-${testIdPrefix}-manual-toggle`}
          >
            <Pencil className="w-3 h-3" />
            Enter manually
          </button>
        )}
        {allowManualOverride && manualMode && (
          <button
            type="button"
            onClick={() => { setManualMode(false); setInputValue(""); }}
            className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors min-h-[28px]"
            data-testid={`button-${testIdPrefix}-auto-toggle`}
          >
            <MapPin className="w-3 h-3" />
            Use suggestions
          </button>
        )}
      </div>
      {mapsError && !manualMode && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Address suggestions unavailable. Maps service not configured.
        </p>
      )}
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (!manualMode && predictions.length > 0) setShowDropdown(true);
          }}
          placeholder={
            manualMode
              ? "Type full address manually..."
              : mapsReady
              ? "Start typing an address..."
              : "Loading address search..."
          }
          className="pl-9 min-h-[44px]"
          data-testid={`input-${testIdPrefix}-address`}
          disabled={!manualMode && !mapsReady && !mapsError}
        />
        {(loading || detailsLoading) && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
        )}
        {!manualMode && showDropdown && predictions.length > 0 && (
          <div className="absolute z-[9999] w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
            {predictions.map((p) => (
              <button
                key={p.placeId}
                type="button"
                className="w-full text-left px-3 py-3 min-h-[44px] text-sm hover-elevate cursor-pointer border-b border-border last:border-b-0"
                onClick={() => handleSelectPrediction(p)}
                data-testid={`option-${testIdPrefix}-${p.placeId}`}
              >
                <span className="font-medium">{p.mainText}</span>
                <span className="text-muted-foreground ml-1 text-xs">
                  {p.secondaryText}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {manualMode && inputValue.trim().length > 0 && (
        <Button
          type="button"
          variant="outline"
          className="w-full min-h-[44px]"
          onClick={handleManualSubmit}
          data-testid={`button-${testIdPrefix}-manual-save`}
        >
          Use this address (no coordinates)
        </Button>
      )}
    </div>
  );
}
