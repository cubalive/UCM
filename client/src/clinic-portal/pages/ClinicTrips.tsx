import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useState, useMemo } from "react";
import {
  Car,
  Search,
  Filter,
  X,
  Clock,
  MapPin,
  User,
  Phone,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Truck,
  Calendar,
} from "lucide-react";

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "scheduled", label: "Scheduled" },
  { value: "live", label: "Live / In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No Show" },
  { value: "today", label: "Today" },
];

function statusColor(status: string) {
  switch (status) {
    case "COMPLETED": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "CANCELLED": return "bg-red-500/10 text-red-400 border-red-500/20";
    case "NO_SHOW": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "EN_ROUTE_PICKUP":
    case "EN_ROUTE_DROPOFF": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "ARRIVED_PICKUP":
    case "ARRIVED_DROPOFF": return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
    case "PICKED_UP": return "bg-purple-500/10 text-purple-400 border-purple-500/20";
    case "SCHEDULED": return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    case "ASSIGNED":
    case "APPROVED": return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
    default: return "bg-gray-500/10 text-gray-400 border-gray-500/20";
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "COMPLETED": return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    case "CANCELLED": return <XCircle className="w-4 h-4 text-red-400" />;
    case "NO_SHOW": return <AlertTriangle className="w-4 h-4 text-amber-400" />;
    case "EN_ROUTE_PICKUP":
    case "EN_ROUTE_DROPOFF": return <Truck className="w-4 h-4 text-emerald-400" />;
    default: return <Car className="w-4 h-4 text-gray-400" />;
  }
}

interface TripDrawerProps {
  trip: any;
  onClose: () => void;
}

function TripDrawer({ trip, onClose }: TripDrawerProps) {
  const progressSteps = [
    { key: "created", label: "Created", time: trip.createdAt },
    { key: "approved", label: "Approved", time: trip.approvedAt },
    { key: "assigned", label: "Assigned", time: trip.assignedAt },
    { key: "en_route", label: "En Route to Pickup", time: trip.startedAt },
    { key: "arrived_pickup", label: "Arrived at Pickup", time: trip.arrivedPickupAt },
    { key: "picked_up", label: "Picked Up", time: trip.pickedUpAt },
    { key: "dropoff", label: "En Route to Dropoff", time: trip.enRouteDropoffAt },
    { key: "arrived_dropoff", label: "Arrived at Dropoff", time: trip.arrivedDropoffAt },
    { key: "completed", label: "Completed", time: trip.completedAt },
  ];

  if (trip.status === "CANCELLED" || trip.status === "NO_SHOW") {
    progressSteps.push({ key: trip.status.toLowerCase(), label: trip.status === "CANCELLED" ? "Cancelled" : "No Show", time: trip.cancelledAt });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="trip-drawer">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[#0f172a] border-l border-[#1e293b] overflow-y-auto animate-in slide-in-from-right">
        <div className="sticky top-0 bg-[#0f172a]/95 backdrop-blur-sm border-b border-[#1e293b] px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-semibold text-white" data-testid="drawer-title">Trip Details</h2>
            <p className="text-xs text-gray-500">ID: {trip.publicId || trip.id}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
            data-testid="button-close-drawer"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1.5 rounded-full text-xs font-medium border ${statusColor(trip.status)}`} data-testid="drawer-status">
              {(trip.status || "").replace(/_/g, " ")}
            </span>
            {trip.scheduledDate && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {trip.scheduledDate} {trip.pickupTime || ""}
              </span>
            )}
          </div>

          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 space-y-4" data-testid="drawer-locations">
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-green-400 border-2 border-green-400/30" />
                <div className="w-0.5 flex-1 bg-[#1e293b] my-1" />
                <div className="w-3 h-3 rounded-full bg-red-400 border-2 border-red-400/30" />
              </div>
              <div className="flex-1 space-y-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Pickup</p>
                  <p className="text-sm text-white mt-0.5" data-testid="drawer-pickup">{trip.pickupAddress || "Not specified"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Dropoff</p>
                  <p className="text-sm text-white mt-0.5" data-testid="drawer-dropoff">{trip.dropoffAddress || "Not specified"}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4" data-testid="drawer-patient">
              <div className="flex items-center gap-2 mb-2">
                <User className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-gray-500 uppercase">Patient</span>
              </div>
              <p className="text-sm text-white font-medium">{trip.patientName || "Not assigned"}</p>
            </div>
            <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4" data-testid="drawer-driver">
              <div className="flex items-center gap-2 mb-2">
                <Car className="w-4 h-4 text-cyan-400" />
                <span className="text-xs text-gray-500 uppercase">Driver</span>
              </div>
              <p className="text-sm text-white font-medium">
                {trip.driverName || <span className="text-amber-400">Driver not assigned</span>}
              </p>
              {trip.driverPhone && (
                <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                  <Phone className="w-3 h-3" /> {trip.driverPhone}
                </p>
              )}
            </div>
          </div>

          {(trip.vehicleLabel || trip.vehicleMake) && (
            <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4" data-testid="drawer-vehicle">
              <div className="flex items-center gap-2 mb-2">
                <Truck className="w-4 h-4 text-purple-400" />
                <span className="text-xs text-gray-500 uppercase">Vehicle</span>
              </div>
              <p className="text-sm text-white font-medium">{trip.vehicleLabel || `${trip.vehicleMake || ""} ${trip.vehicleModel || ""}`.trim() || "Not assigned"}</p>
            </div>
          )}

          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4" data-testid="drawer-timeline">
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-4">Timeline</h3>
            <div className="space-y-0">
              {progressSteps.map((step, i) => {
                const isCompleted = !!step.time;
                const isLast = i === progressSteps.length - 1;
                return (
                  <div key={step.key} className="flex gap-3" data-testid={`timeline-${step.key}`}>
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full ${isCompleted ? "bg-emerald-400" : "bg-gray-700"}`} />
                      {!isLast && <div className={`w-0.5 h-8 ${isCompleted ? "bg-emerald-400/30" : "bg-gray-800"}`} />}
                    </div>
                    <div className="pb-4">
                      <p className={`text-xs font-medium ${isCompleted ? "text-white" : "text-gray-600"}`}>
                        {step.label}
                      </p>
                      {step.time && (
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          {new Date(step.time).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {trip.cancelledReason && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4" data-testid="drawer-cancel-reason">
              <p className="text-xs text-red-400 font-medium mb-1">Cancellation Reason</p>
              <p className="text-sm text-gray-300">{trip.cancelledReason}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ClinicTrips() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedTrip, setSelectedTrip] = useState<any>(null);
  const [showFilters, setShowFilters] = useState(false);

  const queryParams = new URLSearchParams();
  if (search) queryParams.set("search", search);
  if (statusFilter) queryParams.set("status", statusFilter);

  const { data: trips, isLoading } = useQuery({
    queryKey: ["/api/clinic/trips", search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/clinic/trips?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch trips");
      return res.json();
    },
    enabled: !!user?.clinicId || user?.role === "SUPER_ADMIN" || user?.role === "COMPANY_ADMIN" || user?.role === "ADMIN",
  });

  const tripsList = Array.isArray(trips) ? trips : [];

  const handleTripClick = async (trip: any) => {
    try {
      const res = await fetch(`/api/clinic/trips/${trip.id}`, { credentials: "include" });
      if (res.ok) {
        const detailed = await res.json();
        setSelectedTrip(detailed);
      } else {
        setSelectedTrip(trip);
      }
    } catch {
      setSelectedTrip(trip);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4" data-testid="clinic-trips-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Trips</h1>
          <p className="text-sm text-gray-500">Manage and track your transportation trips</p>
        </div>
        <span className="text-sm text-gray-500">{tripsList.length} trip{tripsList.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search trips by patient, address..."
            className="w-full pl-10 pr-4 py-2.5 bg-[#111827] border border-[#1e293b] rounded-lg text-sm text-white placeholder-gray-600 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 outline-none transition"
            data-testid="input-search-trips"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2.5 bg-[#111827] border border-[#1e293b] rounded-lg text-sm text-white outline-none focus:border-emerald-500/50 transition"
            data-testid="select-status-filter"
          >
            {STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {statusFilter && (
        <div className="flex flex-wrap gap-2" data-testid="active-filters">
          <button
            onClick={() => setStatusFilter("")}
            className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-xs text-emerald-400 hover:bg-emerald-500/20 transition"
            data-testid="chip-clear-filter"
          >
            {STATUS_OPTIONS.find(o => o.value === statusFilter)?.label}
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden" data-testid="trips-table">
        {isLoading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-gray-500 text-sm mt-3">Loading trips...</p>
          </div>
        ) : tripsList.length === 0 ? (
          <div className="p-12 text-center" data-testid="text-no-trips">
            <Car className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No trips found</p>
            <p className="text-gray-600 text-xs mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="divide-y divide-[#1e293b]">
            {tripsList.map((trip: any) => (
              <button
                key={trip.id}
                onClick={() => handleTripClick(trip)}
                className="w-full px-5 py-3.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors text-left"
                data-testid={`trip-row-${trip.id}`}
              >
                <StatusIcon status={trip.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-white font-medium truncate">
                      {trip.patientName || "Unknown Patient"}
                    </p>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${statusColor(trip.status)}`}>
                      {(trip.status || "").replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {trip.pickupAddress || "No pickup"} → {trip.dropoffAddress || "No dropoff"}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-400">
                    {trip.scheduledDate || ""}
                  </p>
                  <p className="text-[10px] text-gray-600">
                    {trip.pickupTime || ""}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedTrip && (
        <TripDrawer
          trip={selectedTrip}
          onClose={() => setSelectedTrip(null)}
        />
      )}
    </div>
  );
}
