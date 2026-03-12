import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  Building2,
  Search,
  Star,
  Truck,
  Users,
  Phone,
  Filter,
  Accessibility,
  Car,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Provider {
  id: number;
  name: string;
  phone?: string;
  fleetSize: number;
  vehicleCount: number;
  vehicleTypes: string[];
  hasWheelchair: boolean;
  completedTrips: number;
  serviceTypes: string[];
  rating: number | null;
}

function StarRating({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-xs text-gray-600">No rating</span>;
  const stars = Math.round(rating * 2) / 2;
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${i <= stars ? "text-amber-400 fill-amber-400" : i - 0.5 <= stars ? "text-amber-400 fill-amber-400/50" : "text-gray-700"}`}
        />
      ))}
      <span className="text-xs text-gray-400 ml-1">{rating.toFixed(1)}</span>
    </div>
  );
}

export default function ClinicProviderDirectory() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filterWheelchair, setFilterWheelchair] = useState(false);
  const [filterMinRating, setFilterMinRating] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ ok: boolean; providers: Provider[] }>({
    queryKey: ["/api/clinic/providers"],
    queryFn: async () => {
      const res = await fetch("/api/clinic/providers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load providers");
      return res.json();
    },
    enabled: !!user?.clinicId,
  });

  const providers = data?.providers || [];

  const filtered = useMemo(() => {
    let result = providers;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        p => p.name.toLowerCase().includes(q) || p.serviceTypes.some(s => s.toLowerCase().includes(q))
      );
    }

    if (filterWheelchair) {
      result = result.filter(p => p.hasWheelchair);
    }

    if (filterMinRating > 0) {
      result = result.filter(p => p.rating != null && p.rating >= filterMinRating);
    }

    return result;
  }, [providers, search, filterWheelchair, filterMinRating]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="provider-directory-page">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Building2 className="w-5 h-5 text-emerald-400" />
          Provider Directory
        </h1>
        <p className="text-sm text-gray-500 mt-1">Browse available transport providers</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-gray-500">Total Providers</span>
          </div>
          <p className="text-2xl font-bold text-white">{providers.length}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Accessibility className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-gray-500">Wheelchair Accessible</span>
          </div>
          <p className="text-2xl font-bold text-white">{providers.filter(p => p.hasWheelchair).length}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Car className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-gray-500">Total Fleet Size</span>
          </div>
          <p className="text-2xl font-bold text-white">{providers.reduce((s, p) => s + p.fleetSize, 0)}</p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by provider name or service type..."
              className="w-full bg-[#0a0f1e] border border-[#1e293b] text-white text-sm rounded-lg pl-10 pr-3 py-2.5 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 placeholder-gray-600 transition-colors"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-400">
              <input
                type="checkbox"
                checked={filterWheelchair}
                onChange={(e) => setFilterWheelchair(e.target.checked)}
                className="w-4 h-4 rounded border-[#1e293b] bg-[#0a0f1e] text-emerald-500"
              />
              <Accessibility className="w-4 h-4 text-blue-400" />
              Wheelchair
            </label>
            <select
              value={filterMinRating}
              onChange={(e) => setFilterMinRating(Number(e.target.value))}
              className="bg-[#0a0f1e] border border-[#1e293b] text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500"
            >
              <option value={0}>Any Rating</option>
              <option value={3}>3+ Stars</option>
              <option value={4}>4+ Stars</option>
              <option value={4.5}>4.5+ Stars</option>
            </select>
          </div>
        </div>
      </div>

      {/* Provider List */}
      <div className="space-y-3" data-testid="provider-list">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-12 text-center">
            <Building2 className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No providers found</p>
            <p className="text-gray-600 text-xs mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          filtered.map(provider => {
            const isExpanded = expandedId === provider.id;
            return (
              <div
                key={provider.id}
                className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden hover:border-emerald-500/30 transition-colors"
                data-testid={`provider-${provider.id}`}
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : provider.id)}
                  className="w-full px-5 py-4 flex items-center gap-4 text-left"
                >
                  <div className="w-12 h-12 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/20 rounded-xl flex items-center justify-center shrink-0">
                    <Building2 className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white truncate">{provider.name}</h3>
                      {provider.hasWheelchair && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full flex items-center gap-0.5">
                          <Accessibility className="w-2.5 h-2.5" /> WC
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1">
                      <StarRating rating={provider.rating} />
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Users className="w-3 h-3" /> {provider.fleetSize} drivers
                      </span>
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Car className="w-3 h-3" /> {provider.vehicleCount} vehicles
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-gray-500">
                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-4 border-t border-[#1e293b] pt-4 space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-[#0a0f1e] rounded-lg p-3 text-center">
                        <p className="text-lg font-bold text-white">{provider.fleetSize}</p>
                        <p className="text-[10px] text-gray-500 uppercase">Active Drivers</p>
                      </div>
                      <div className="bg-[#0a0f1e] rounded-lg p-3 text-center">
                        <p className="text-lg font-bold text-white">{provider.vehicleCount}</p>
                        <p className="text-[10px] text-gray-500 uppercase">Vehicles</p>
                      </div>
                      <div className="bg-[#0a0f1e] rounded-lg p-3 text-center">
                        <p className="text-lg font-bold text-white">{provider.completedTrips}</p>
                        <p className="text-[10px] text-gray-500 uppercase">Completed Trips</p>
                      </div>
                      <div className="bg-[#0a0f1e] rounded-lg p-3 text-center">
                        <p className="text-lg font-bold text-white">{provider.rating?.toFixed(1) || "N/A"}</p>
                        <p className="text-[10px] text-gray-500 uppercase">Rating</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Service Types</p>
                      <div className="flex flex-wrap gap-2">
                        {provider.serviceTypes.map(type => (
                          <span key={type} className="text-xs px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full">
                            {type}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Vehicle Types</p>
                      <div className="flex flex-wrap gap-2">
                        {provider.vehicleTypes.map(type => (
                          <span key={type} className="text-xs px-2.5 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-full capitalize">
                            {type}
                          </span>
                        ))}
                      </div>
                    </div>

                    {provider.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-gray-500" />
                        <a href={`tel:${provider.phone}`} className="text-sm text-emerald-400 hover:underline">
                          {provider.phone}
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
