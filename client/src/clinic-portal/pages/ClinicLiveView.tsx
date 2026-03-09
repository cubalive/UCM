import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useState, useEffect } from "react";
import {
  MapPin,
  Car,
  Clock,
  RefreshCw,
  User,
  Navigation,
  Phone,
  Truck,
} from "lucide-react";

function formatTimeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown";
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function DriverLocationCard({ trip }: { trip: any }) {
  const hasLocation = trip.driverLastLat && trip.driverLastLng;
  const lastSeen = trip.driverLastSeenAt;

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 hover:border-emerald-500/20 transition-colors" data-testid={`live-trip-${trip.id}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
            trip.status === "EN_ROUTE_PICKUP" ? "bg-emerald-500/10 text-emerald-400" :
            trip.status === "EN_ROUTE_DROPOFF" ? "bg-cyan-500/10 text-cyan-400" :
            trip.status === "ARRIVED_PICKUP" ? "bg-amber-500/10 text-amber-400" :
            trip.status === "PICKED_UP" ? "bg-purple-500/10 text-purple-400" :
            "bg-gray-500/10 text-gray-400"
          }`}>
            {(trip.status || "").replace(/_/g, " ")}
          </span>
        </div>
        {lastSeen && (
          <span className="text-[10px] text-gray-600 flex items-center gap-1" data-testid={`last-updated-${trip.id}`}>
            <Clock className="w-3 h-3" />
            Last updated {formatTimeAgo(lastSeen)}
          </span>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-500/10 rounded-full flex items-center justify-center shrink-0">
            <User className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{trip.patientName || "Patient"}</p>
            <p className="text-xs text-gray-500 truncate">{trip.pickupAddress || "Pickup"}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-cyan-500/10 rounded-full flex items-center justify-center shrink-0">
            <Car className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {trip.driverName || <span className="text-amber-400">Driver not assigned</span>}
            </p>
            {trip.driverPhone && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Phone className="w-3 h-3" /> {trip.driverPhone}
              </p>
            )}
          </div>
        </div>

        {trip.vehicleLabel && (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-purple-500/10 rounded-full flex items-center justify-center shrink-0">
              <Truck className="w-4 h-4 text-purple-400" />
            </div>
            <p className="text-sm text-gray-400 truncate">{trip.vehicleLabel}</p>
          </div>
        )}

        {hasLocation && (
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[#1e293b]">
            <Navigation className="w-3.5 h-3.5 text-green-400" />
            <span className="text-xs text-gray-500">
              {Number(trip.driverLastLat).toFixed(4)}, {Number(trip.driverLastLng).toFixed(4)}
            </span>
          </div>
        )}

        <div className="pt-2 border-t border-[#1e293b]">
          <div className="flex gap-2">
            <div className="flex-1">
              <p className="text-[10px] text-gray-600 uppercase">Pickup</p>
              <p className="text-xs text-gray-400 truncate">{trip.pickupAddress || "Not set"}</p>
            </div>
            <div className="text-gray-700">→</div>
            <div className="flex-1">
              <p className="text-[10px] text-gray-600 uppercase">Dropoff</p>
              <p className="text-xs text-gray-400 truncate">{trip.dropoffAddress || "Not set"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ClinicLiveView() {
  const { user } = useAuth();
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const { data: activeTrips, isLoading, refetch } = useQuery({
    queryKey: ["/api/clinic/active-trips"],
    enabled: !!user?.clinicId || user?.role === "SUPER_ADMIN",
    refetchInterval: 15000,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setLastRefresh(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const trips = Array.isArray(activeTrips) ? activeTrips : [];

  const handleRefresh = () => {
    refetch();
    setLastRefresh(Date.now());
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4" data-testid="clinic-live-view">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            Live View
          </h1>
          <p className="text-sm text-gray-500">
            Real-time tracking of active trips
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">
            Auto-refresh every 15s
          </span>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-2 bg-[#111827] border border-[#1e293b] rounded-lg text-sm text-gray-400 hover:text-white hover:border-emerald-500/30 transition-all"
            data-testid="button-refresh"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-600">
        <span className="flex items-center gap-1">
          <Car className="w-3.5 h-3.5" />
          {trips.length} active trip{trips.length !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          Polling: 15s interval
        </span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 animate-pulse">
              <div className="h-4 w-24 bg-gray-800 rounded mb-3" />
              <div className="h-3 w-48 bg-gray-800 rounded mb-2" />
              <div className="h-3 w-36 bg-gray-800 rounded" />
            </div>
          ))}
        </div>
      ) : trips.length === 0 ? (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-12 text-center" data-testid="text-no-active-trips">
          <MapPin className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No active trips right now</p>
          <p className="text-gray-600 text-xs mt-1">Active trips will appear here in real-time</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="live-trips-grid">
          {trips.map((trip: any) => (
            <DriverLocationCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}
    </div>
  );
}
