import { useEffect, useState, createContext, useContext } from "react";

declare global {
  interface Window {
    google?: { maps: unknown };
  }
}

interface MapLoaderContextType {
  isLoaded: boolean;
  error: string | null;
}

const MapLoaderContext = createContext<MapLoaderContextType>({
  isLoaded: false,
  error: null,
});

export function useGoogleMaps() {
  return useContext(MapLoaderContext);
}

let loadPromise: Promise<void> | null = null;

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Failed to load Google Maps script"));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function MapLoader({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/maps/test")
      .then((res) => res.json())
      .then((data) => {
        if (!data.ok || !data.mapsKeyLoaded) {
          setError("Google Maps API key not configured");
          return;
        }
        return loadGoogleMapsScript(data.apiKey);
      })
      .then(() => setIsLoaded(true))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <MapLoaderContext.Provider value={{ isLoaded, error }}>
      {children}
    </MapLoaderContext.Provider>
  );
}
