import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatDateTime } from "@/lib/timezone";
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
  Edit3,
  Save,
  Loader2,
  FileCheck,
  Camera,
  Pen,
  Navigation,
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
  onTripUpdated?: () => void;
}

function TripEditForm({ trip, onClose, onSaved }: { trip: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    scheduledDate: trip.scheduledDate || "",
    pickupTime: trip.pickupTime || "",
    pickupAddress: trip.pickupAddress || "",
    dropoffAddress: trip.dropoffAddress || "",
    notes: trip.notes || "",
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PATCH", `/api/clinic/trips/${trip.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/trips"] });
      toast({ title: "Trip updated", description: "Trip details have been saved." });
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const inputCls = "w-full bg-[#0a0f1e] border border-[#1e293b] text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 placeholder-gray-600 transition-colors";

  return (
    <div className="space-y-4 p-4 bg-[#0a0f1e] border border-[#1e293b] rounded-xl">
      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Edit Trip</h4>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Date</label>
          <input type="date" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Pickup Time</label>
          <input type="time" value={form.pickupTime} onChange={e => setForm(f => ({ ...f, pickupTime: e.target.value }))} className={inputCls} />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Pickup Address</label>
        <input type="text" value={form.pickupAddress} onChange={e => setForm(f => ({ ...f, pickupAddress: e.target.value }))} className={inputCls} />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Dropoff Address</label>
        <input type="text" value={form.dropoffAddress} onChange={e => setForm(f => ({ ...f, dropoffAddress: e.target.value }))} className={inputCls} />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Notes</label>
        <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={`${inputCls} resize-none`} rows={2} />
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 px-3 py-2 text-xs text-gray-400 border border-[#1e293b] rounded-lg hover:bg-[#1e293b]">Cancel</button>
        <button
          onClick={() => updateMutation.mutate(form)}
          disabled={updateMutation.isPending}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
        >
          {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          {updateMutation.isPending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function ProofOfDeliverySection({ tripId }: { tripId: number }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: [`/api/clinic/trips/${tripId}/proof`],
    queryFn: async () => {
      const res = await fetch(`/api/clinic/trips/${tripId}/proof`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  if (isLoading) return <div className="text-xs text-gray-500 py-2" role="status" aria-live="polite">Loading proof...</div>;
  if (!data?.hasProof) return null;

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 space-y-3" data-testid="proof-of-delivery">
      <h3 className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-2">
        <FileCheck className="w-4 h-4 text-emerald-400" />
        Proof of Delivery
      </h3>

      {data.signature && (
        <div className="space-y-2">
          {data.signature.driverSignature && (
            <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase mb-2 flex items-center gap-1">
                <Pen className="w-3 h-3" /> Driver Signature
              </p>
              <img src={data.signature.driverSignature} alt="Driver signature" className="max-h-16 bg-white/5 rounded p-1" />
              {data.signature.driverSignedAt && (
                <p className="text-[10px] text-gray-600 mt-1">Signed: {formatDateTime(data.signature.driverSignedAt)}</p>
              )}
            </div>
          )}
          {data.signature.signatureRefused && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
              <p className="text-xs text-amber-400">Signature was refused{data.signature.refusedReason ? `: ${data.signature.refusedReason}` : ""}</p>
            </div>
          )}
        </div>
      )}

      {data.proofs?.length > 0 && (
        <div className="space-y-2">
          {data.proofs.map((proof: any) => (
            <div key={proof.id} className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                {proof.proofType === "photo" ? <Camera className="w-3.5 h-3.5 text-blue-400" /> : proof.proofType === "signature" ? <Pen className="w-3.5 h-3.5 text-purple-400" /> : <Navigation className="w-3.5 h-3.5 text-cyan-400" />}
                <span className="text-[10px] text-gray-500 uppercase">{proof.proofType}</span>
                {proof.collectedAt && <span className="text-[10px] text-gray-600 ml-auto">{formatDateTime(proof.collectedAt)}</span>}
              </div>
              {proof.photoUrl && (
                <img src={proof.photoUrl} alt="Delivery proof" className="w-full max-h-40 object-cover rounded" />
              )}
              {proof.signatureData && (
                <p className="text-xs text-emerald-400 flex items-center gap-1"><Pen className="w-3 h-3" /> Signature collected</p>
              )}
              {proof.gpsLat && proof.gpsLng && (
                <p className="text-[10px] text-gray-500 flex items-center gap-1 mt-1">
                  <Navigation className="w-3 h-3" /> GPS: {proof.gpsLat.toFixed(5)}, {proof.gpsLng.toFixed(5)}
                  {proof.gpsAccuracy && ` (accuracy: ${proof.gpsAccuracy.toFixed(0)}m)`}
                </p>
              )}
              {proof.recipientName && (
                <p className="text-xs text-gray-400 mt-1">Recipient: {proof.recipientName}</p>
              )}
              {proof.notes && (
                <p className="text-xs text-gray-500 mt-1">{proof.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TripDrawer({ trip, onClose, onTripUpdated }: TripDrawerProps) {
  const patient = trip.patient;
  const [showEdit, setShowEdit] = useState(false);
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
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="trip-drawer" role="dialog" aria-modal="true" aria-label="Trip details">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-lg bg-[#0f172a] border-l border-[#1e293b] overflow-y-auto animate-in slide-in-from-right">
        <div className="sticky top-0 bg-[#0f172a]/95 backdrop-blur-sm border-b border-[#1e293b] px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-semibold text-white" data-testid="drawer-title">Trip Details</h2>
            <p className="text-xs text-gray-500">ID: {trip.publicId || trip.id}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close trip details"
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
            data-testid="button-close-drawer"
          >
            <X className="w-5 h-5 text-gray-400" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Status + Schedule + ETA */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`px-3 py-1.5 rounded-full text-xs font-medium border ${statusColor(trip.status)}`} data-testid="drawer-status">
              {(trip.status || "").replace(/_/g, " ")}
            </span>
            {trip.scheduledDate && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {trip.scheduledDate} {trip.pickupTime || ""}
              </span>
            )}
            {trip.lastEtaMinutes && (
              <span className="text-xs text-emerald-400 flex items-center gap-1 bg-emerald-500/10 px-2 py-1 rounded-full">
                <Clock className="w-3 h-3" />
                ETA: {trip.lastEtaMinutes} min
              </span>
            )}
            {trip.mobilityRequirement && trip.mobilityRequirement !== "STANDARD" && (
              <span className="text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full">
                {trip.mobilityRequirement}
              </span>
            )}
          </div>

          {/* Edit / Reschedule buttons */}
          {(trip.status === "SCHEDULED" || trip.status === "ASSIGNED") && !showEdit && (
            <div className="flex gap-2">
              <button
                onClick={() => setShowEdit(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-600/10 border border-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-600/20 transition-colors"
                data-testid="button-edit-trip"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Edit Trip
              </button>
              <button
                onClick={() => setShowEdit(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-blue-600/10 border border-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-600/20 transition-colors"
                data-testid="button-reschedule-trip"
              >
                <Calendar className="w-3.5 h-3.5" />
                Reschedule
              </button>
            </div>
          )}

          {showEdit && (
            <TripEditForm
              trip={trip}
              onClose={() => setShowEdit(false)}
              onSaved={() => {
                setShowEdit(false);
                onTripUpdated?.();
              }}
            />
          )}

          {/* Patient Card - Enhanced */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4" data-testid="drawer-patient-full">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <User className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{trip.patientName || "Unknown Patient"}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Patient Information</p>
              </div>
              {trip.wheelchairRequired && (
                <span className="ml-auto text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full flex items-center gap-1">
                  ♿ Wheelchair
                </span>
              )}
              {patient?.isFrequent && (
                <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full">
                  ⭐ Frequent
                </span>
              )}
            </div>

            {patient ? (
              <div className="grid grid-cols-2 gap-3">
                {patient.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-gray-500" />
                    <div>
                      <p className="text-[10px] text-gray-500">Phone</p>
                      <a href={`tel:${patient.phone}`} className="text-xs text-emerald-400 hover:underline">{patient.phone}</a>
                    </div>
                  </div>
                )}
                {patient.email && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-gray-500" />
                    <div>
                      <p className="text-[10px] text-gray-500">Email</p>
                      <p className="text-xs text-gray-300 truncate">{patient.email}</p>
                    </div>
                  </div>
                )}
                {patient.dateOfBirth && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-gray-500" />
                    <div>
                      <p className="text-[10px] text-gray-500">Date of Birth</p>
                      <p className="text-xs text-gray-300">{patient.dateOfBirth}</p>
                    </div>
                  </div>
                )}
                {patient.insuranceId && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-gray-500" />
                    <div>
                      <p className="text-[10px] text-gray-500">Insurance ID</p>
                      <p className="text-xs text-gray-300">{patient.insuranceId}</p>
                    </div>
                  </div>
                )}
                {patient.medicaidId && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-gray-500" />
                    <div>
                      <p className="text-[10px] text-gray-500">Medicaid</p>
                      <p className="text-xs text-gray-300">{patient.medicaidId} {patient.medicaidState ? `(${patient.medicaidState})` : ""}</p>
                    </div>
                  </div>
                )}
                {patient.address && (
                  <div className="col-span-2 flex items-start gap-2">
                    <MapPin className="w-3.5 h-3.5 text-gray-500 mt-0.5" />
                    <div>
                      <p className="text-[10px] text-gray-500">Home Address</p>
                      <p className="text-xs text-gray-300">{patient.address}</p>
                    </div>
                  </div>
                )}
                {patient.notes && (
                  <div className="col-span-2 bg-amber-500/5 border border-amber-500/10 rounded-lg p-2 mt-1">
                    <p className="text-[10px] text-amber-400 font-medium">Patient Notes</p>
                    <p className="text-xs text-gray-300 mt-0.5">{patient.notes}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500 italic">No detailed patient information available</p>
            )}
          </div>

          {/* Route Card */}
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
            {(trip.distanceMiles || trip.totalDurationMinutes) && (
              <div className="flex gap-4 text-xs text-gray-500 border-t border-[#1e293b] pt-3">
                {trip.distanceMiles && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {trip.distanceMiles} mi
                  </span>
                )}
                {trip.totalDurationMinutes && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {trip.totalDurationMinutes} min
                  </span>
                )}
                {trip.waitTimeMinutes != null && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Wait: {trip.waitTimeMinutes} min
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Driver & Vehicle */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4" data-testid="drawer-driver">
              <div className="flex items-center gap-2 mb-2">
                <Car className="w-4 h-4 text-cyan-400" />
                <span className="text-xs text-gray-500 uppercase">Driver</span>
              </div>
              <p className="text-sm text-white font-medium">
                {trip.driverName || <span className="text-amber-400">Not assigned</span>}
              </p>
              {trip.driverPhone && (
                <a href={`tel:${trip.driverPhone}`} className="text-xs text-emerald-400 hover:underline flex items-center gap-1 mt-1">
                  <Phone className="w-3 h-3" /> {trip.driverPhone}
                </a>
              )}
            </div>
            <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4" data-testid="drawer-vehicle">
              <div className="flex items-center gap-2 mb-2">
                <Truck className="w-4 h-4 text-purple-400" />
                <span className="text-xs text-gray-500 uppercase">Vehicle</span>
              </div>
              <p className="text-sm text-white font-medium">
                {trip.vehicleLabel || `${trip.vehicleMake || ""} ${trip.vehicleModel || ""}`.trim() || "Not assigned"}
              </p>
              {trip.vehicleColor && (
                <p className="text-xs text-gray-500 mt-0.5">{trip.vehicleColor}</p>
              )}
            </div>
          </div>

          {/* Map Snapshot */}
          {trip.routeImageUrl && (
            <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
              <img src={trip.routeImageUrl} alt="Route map" className="w-full h-40 object-cover" />
            </div>
          )}

          {/* Timeline */}
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
                          {formatDateTime(step.time)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Proof of Delivery */}
          {(trip.status === "COMPLETED" || trip.completedAt) && (
            <ProofOfDeliverySection tripId={trip.id} />
          )}

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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search trips by patient, address..."
            aria-label="Search trips"
            className="w-full pl-10 pr-4 py-2.5 bg-[#111827] border border-[#1e293b] rounded-lg text-sm text-white placeholder-gray-600 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 outline-none transition"
            data-testid="input-search-trips"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
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
          <div className="p-12 text-center" role="status" aria-live="polite">
            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" aria-hidden="true" />
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
                <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" aria-hidden="true" />
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
