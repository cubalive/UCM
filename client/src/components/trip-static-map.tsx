import { useState } from "react";
import { MapPin } from "lucide-react";

interface TripStaticMapProps {
  tripId: number;
  pickupLat?: number | null;
  dropoffLat?: number | null;
  size?: "thumb" | "full";
  className?: string;
  token?: string | null;
  publicToken?: string | null;
}

export function TripStaticMap({
  tripId,
  pickupLat,
  dropoffLat,
  size = "thumb",
  className = "",
  token,
  publicToken,
}: TripStaticMapProps) {
  const [failed, setFailed] = useState(false);

  const hasCoords = pickupLat != null && dropoffLat != null;

  if (!hasCoords || failed || (!token && !publicToken)) {
    return (
      <div
        className={`bg-muted flex items-center justify-center rounded-md ${className}`}
        data-testid={`placeholder-static-map-${tripId}`}
      >
        <MapPin className="w-5 h-5 text-muted-foreground" />
      </div>
    );
  }

  const src = publicToken
    ? `/api/public/trips/static-map/${publicToken}/${size}`
    : `/api/trips/${tripId}/static-map/${size}?t=${encodeURIComponent(token!)}`;

  return (
    <img
      src={src}
      alt="Trip route map"
      className={`object-cover rounded-md ${className}`}
      loading="lazy"
      onError={() => setFailed(true)}
      data-testid={`img-static-map-${tripId}`}
    />
  );
}
