import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import {
  MapPin,
  Navigation,
  Clock,
  AlertTriangle,
  CheckCircle,
  Truck,
  X,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

export default function BrokerLiveTracking() {
  const [selectedTrip, setSelectedTrip] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/broker/live-trips"],
    queryFn: async () => {
      const res = await fetch(resolveUrl("/api/broker/live-trips"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-[#1e293b] rounded animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-[#111827] border border-[#1e293b] rounded-xl h-[500px] animate-pulse" />
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl h-[500px] animate-pulse" />
        </div>
      </div>
    );
  }

  const trips = data?.trips || [];
  const filteredTrips = statusFilter === "ALL" ? trips : trips.filter((t: any) => t.status === statusFilter);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Navigation className="w-5 h-5" /> Live Trip Tracking
          </h1>
          <p className="text-sm text-gray-400 mt-1">Real-time visibility into active trips</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="px-4 py-2 bg-[#0f172a] border border-[#1e293b] hover:border-blue-500/50 text-gray-300 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-3 text-center">
          <p className="text-xs text-gray-500 uppercase">Total Active</p>
          <p className="text-2xl font-bold text-white mt-1">{data?.total ?? 0}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-3 text-center">
          <p className="text-xs text-gray-500 uppercase">In Progress</p>
          <p className="text-2xl font-bold text-blue-400 mt-1">{data?.inProgress ?? 0}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-3 text-center">
          <p className="text-xs text-gray-500 uppercase">Awarded/Assigned</p>
          <p className="text-2xl font-bold text-purple-400 mt-1">{(data?.awarded ?? 0) + (data?.assigned ?? 0)}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-3 text-center">
          <p className="text-xs text-gray-500 uppercase">Delayed</p>
          <p className="text-2xl font-bold text-red-400 mt-1">{data?.delayed ?? 0}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {["ALL", "IN_PROGRESS", "AWARDED", "ASSIGNED"].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === s
                ? "bg-blue-600 text-white"
                : "bg-[#0f172a] text-gray-400 hover:text-white border border-[#1e293b]"
            }`}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Map Placeholder */}
        <div className="lg:col-span-2 bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
          <div className="p-3 border-b border-[#1e293b] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Trip Map</h2>
            <span className="text-[10px] text-gray-500">Auto-refreshes every 30s</span>
          </div>
          <div className="relative h-[450px] bg-[#0a1628]">
            {/* Simulated map view with trip markers */}
            <div className="absolute inset-0 flex items-center justify-center">
              {filteredTrips.length === 0 ? (
                <div className="text-center text-gray-500">
                  <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No active trips to display</p>
                </div>
              ) : (
                <div className="w-full h-full p-4">
                  {/* Map grid background */}
                  <div className="w-full h-full border border-[#1e293b] rounded-lg relative overflow-hidden bg-gradient-to-br from-[#0f1a2e] to-[#0a1628]">
                    {/* Grid lines */}
                    <div className="absolute inset-0 opacity-10">
                      {[...Array(10)].map((_, i) => (
                        <div key={`h-${i}`} className="absolute w-full border-t border-gray-600" style={{ top: `${(i + 1) * 10}%` }} />
                      ))}
                      {[...Array(10)].map((_, i) => (
                        <div key={`v-${i}`} className="absolute h-full border-l border-gray-600" style={{ left: `${(i + 1) * 10}%` }} />
                      ))}
                    </div>
                    {/* Trip markers */}
                    {filteredTrips.map((trip: any, idx: number) => {
                      const x = 10 + ((idx * 17) % 80);
                      const y = 10 + ((idx * 23) % 75);
                      return (
                        <button
                          key={trip.id}
                          onClick={() => setSelectedTrip(trip)}
                          className={`absolute flex items-center justify-center w-8 h-8 rounded-full transition-all hover:scale-125 ${
                            trip.isDelayed
                              ? "bg-red-500/80 animate-pulse"
                              : trip.status === "IN_PROGRESS"
                              ? "bg-blue-500/80"
                              : "bg-purple-500/60"
                          } ${selectedTrip?.id === trip.id ? "ring-2 ring-white scale-125" : ""}`}
                          style={{ left: `${x}%`, top: `${y}%` }}
                          title={`${trip.memberName} - ${trip.status}`}
                        >
                          <Truck className="w-4 h-4 text-white" />
                        </button>
                      );
                    })}
                    {/* Legend */}
                    <div className="absolute bottom-3 left-3 flex gap-3 text-[10px] text-gray-400">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> In Progress</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" /> Awarded</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Delayed</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Trip List / Detail Panel */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
          {selectedTrip ? (
            <div>
              <div className="p-3 border-b border-[#1e293b] flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Trip Details</h2>
                <button onClick={() => setSelectedTrip(null)} className="text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <span className="font-mono text-xs text-blue-400">{selectedTrip.publicId}</span>
                  <p className="text-sm font-medium text-white mt-1">{selectedTrip.memberName}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      selectedTrip.status === "IN_PROGRESS"
                        ? "bg-blue-500/20 text-blue-400"
                        : "bg-purple-500/20 text-purple-400"
                    }`}>
                      {selectedTrip.status.replace(/_/g, " ")}
                    </span>
                    {selectedTrip.isDelayed && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/20 text-red-400">
                        <AlertTriangle className="w-3 h-3" /> DELAYED
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-3 h-3 text-green-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-gray-500 text-[10px] uppercase">Pickup</p>
                      <p className="text-gray-300">{selectedTrip.pickupAddress}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <MapPin className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-gray-500 text-[10px] uppercase">Dropoff</p>
                      <p className="text-gray-300">{selectedTrip.dropoffAddress}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[#0f172a] rounded-lg p-3 text-center">
                    <Clock className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                    <p className="text-lg font-bold text-white">{selectedTrip.etaMinutes}m</p>
                    <p className="text-[10px] text-gray-500">ETA</p>
                  </div>
                  <div className="bg-[#0f172a] rounded-lg p-3 text-center">
                    <Truck className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                    <p className="text-xs font-medium text-white">{selectedTrip.serviceType}</p>
                    <p className="text-[10px] text-gray-500">Service</p>
                  </div>
                </div>

                {selectedTrip.companyName && (
                  <div className="bg-[#0f172a] rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase">Provider</p>
                    <p className="text-sm text-white">{selectedTrip.companyName}</p>
                  </div>
                )}

                {selectedTrip.isDelayed && selectedTrip.delayReason && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                    <p className="text-xs text-red-400 font-medium flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Delay Reason
                    </p>
                    <p className="text-xs text-gray-300 mt-1">{selectedTrip.delayReason}</p>
                  </div>
                )}

                <div className="text-xs text-gray-500">
                  <p>Date: {selectedTrip.requestedDate}</p>
                  <p>Pickup Time: {selectedTrip.requestedPickupTime || "N/A"}</p>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="p-3 border-b border-[#1e293b]">
                <h2 className="text-sm font-semibold text-white">Active Trips ({filteredTrips.length})</h2>
              </div>
              <div className="divide-y divide-[#1e293b] max-h-[450px] overflow-y-auto">
                {filteredTrips.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-sm">
                    No active trips found.
                  </div>
                ) : (
                  filteredTrips.map((trip: any) => (
                    <button
                      key={trip.id}
                      onClick={() => setSelectedTrip(trip)}
                      className="w-full text-left p-3 hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-blue-400">{trip.publicId}</span>
                            {trip.isDelayed && <AlertTriangle className="w-3 h-3 text-red-400" />}
                          </div>
                          <p className="text-sm text-white truncate">{trip.memberName}</p>
                          <p className="text-[10px] text-gray-500 truncate">{trip.pickupAddress}</p>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <p className="text-sm font-bold text-white">{trip.etaMinutes}m</p>
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium ${
                            trip.isDelayed
                              ? "bg-red-500/20 text-red-400"
                              : trip.status === "IN_PROGRESS"
                              ? "bg-blue-500/20 text-blue-400"
                              : "bg-purple-500/20 text-purple-400"
                          }`}>
                            {trip.isDelayed ? "DELAYED" : trip.status === "IN_PROGRESS" ? "ACTIVE" : "PENDING"}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
