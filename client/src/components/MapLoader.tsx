import { useEffect, useState, createContext, useContext } from "react";

interface MapLoaderContextType {
  isAvailable: boolean;
  error: string | null;
}

const MapLoaderContext = createContext<MapLoaderContextType>({
  isAvailable: false,
  error: null,
});

export function useGoogleMaps() {
  return useContext(MapLoaderContext);
}

export function MapLoader({ children }: { children: React.ReactNode }) {
  const [isAvailable, setIsAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/maps/health")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.mapsKeyLoaded) {
          setIsAvailable(true);
        } else {
          setError("Maps service not configured");
        }
      })
      .catch(() => setError("Maps service unavailable"));
  }, []);

  return (
    <MapLoaderContext.Provider value={{ isAvailable, error }}>
      {children}
    </MapLoaderContext.Provider>
  );
}
