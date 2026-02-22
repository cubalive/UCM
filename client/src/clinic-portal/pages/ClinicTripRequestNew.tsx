import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  User,
  Plus,
  Search,
  Check,
  Loader2,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

export default function ClinicTripRequestNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showNewPatient, setShowNewPatient] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<any>(null);

  const [form, setForm] = useState({
    pickupAddress: "",
    dropoffAddress: "",
    scheduledDate: "",
    scheduledTime: "",
    serviceLevel: "ambulatory",
    isRoundTrip: false,
    passengerCount: 1,
    notes: "",
  });

  const [newPatientForm, setNewPatientForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    dateOfBirth: "",
    email: "",
    address: "",
    wheelchairRequired: false,
  });

  const { data: patients = [] } = useQuery<any[]>({
    queryKey: ["/api/clinic/patients"],
  });

  const filteredPatients = patients.filter((p: any) => {
    if (!patientSearch) return true;
    const search = patientSearch.toLowerCase();
    return (
      p.firstName?.toLowerCase().includes(search) ||
      p.lastName?.toLowerCase().includes(search) ||
      p.phone?.includes(search)
    );
  });

  const createPatientMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/clinic/patients/create", data);
      return res.json();
    },
    onSuccess: (patient: any) => {
      setSelectedPatient(patient);
      setShowNewPatient(false);
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/patients"] });
      toast({ title: "Patient created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create patient", variant: "destructive" });
    },
  });

  const createRequestMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/clinic/trip-requests", data);
      return res.json();
    },
    onSuccess: (request: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/trip-requests"] });
      toast({ title: "Trip request submitted!" });
      setLocation(`/requests/${request.id}`);
    },
    onError: () => {
      toast({ title: "Failed to submit trip request", variant: "destructive" });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.pickupAddress || !form.dropoffAddress || !form.scheduledDate || !form.scheduledTime) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }

    createRequestMutation.mutate({
      ...form,
      patientId: selectedPatient?.id || null,
    });
  }

  function handleCreatePatient() {
    if (!newPatientForm.firstName || !newPatientForm.lastName) {
      toast({ title: "First and last name are required", variant: "destructive" });
      return;
    }
    createPatientMutation.mutate(newPatientForm);
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6" data-testid="new-trip-request-page">
      <div className="flex items-center gap-3">
        <Link href="/requests">
          <button className="p-2 hover:bg-white/5 rounded-lg transition-colors" data-testid="button-back">
            <ArrowLeft className="w-5 h-5 text-gray-400" />
          </button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white" data-testid="text-page-title">New Trip Request</h1>
          <p className="text-sm text-gray-400 mt-0.5">Request transportation for a patient</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <User className="w-4 h-4" /> Patient
          </h2>

          {selectedPatient ? (
            <div className="flex items-center justify-between bg-[#0a0f1e] rounded-lg p-3 border border-[#1e293b]" data-testid="selected-patient">
              <div>
                <p className="text-white font-medium">{selectedPatient.firstName} {selectedPatient.lastName}</p>
                <p className="text-xs text-gray-500">{selectedPatient.phone || "No phone"}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPatient(null)}
                className="text-xs text-red-400 hover:text-red-300"
                data-testid="button-remove-patient"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search patients..."
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-[#0a0f1e] border border-[#1e293b] rounded-lg text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  data-testid="input-patient-search"
                />
              </div>

              {patientSearch && filteredPatients.length > 0 && (
                <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg max-h-40 overflow-y-auto" data-testid="patient-search-results">
                  {filteredPatients.slice(0, 10).map((p: any) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setSelectedPatient(p); setPatientSearch(""); }}
                      className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center justify-between text-sm"
                      data-testid={`patient-option-${p.id}`}
                    >
                      <span className="text-white">{p.firstName} {p.lastName}</span>
                      <span className="text-xs text-gray-500">{p.phone}</span>
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowNewPatient(!showNewPatient)}
                className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
                data-testid="button-toggle-new-patient"
              >
                <Plus className="w-4 h-4" />
                {showNewPatient ? "Cancel new patient" : "Create new patient"}
              </button>

              {showNewPatient && (
                <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg p-4 space-y-3" data-testid="new-patient-form">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">First Name *</label>
                      <input
                        type="text"
                        value={newPatientForm.firstName}
                        onChange={(e) => setNewPatientForm({ ...newPatientForm, firstName: e.target.value })}
                        className="w-full px-3 py-2 bg-[#111827] border border-[#1e293b] rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                        data-testid="input-patient-first-name"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Last Name *</label>
                      <input
                        type="text"
                        value={newPatientForm.lastName}
                        onChange={(e) => setNewPatientForm({ ...newPatientForm, lastName: e.target.value })}
                        className="w-full px-3 py-2 bg-[#111827] border border-[#1e293b] rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                        data-testid="input-patient-last-name"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Phone</label>
                      <input
                        type="text"
                        value={newPatientForm.phone}
                        onChange={(e) => setNewPatientForm({ ...newPatientForm, phone: e.target.value })}
                        className="w-full px-3 py-2 bg-[#111827] border border-[#1e293b] rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                        data-testid="input-patient-phone"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Date of Birth</label>
                      <input
                        type="date"
                        value={newPatientForm.dateOfBirth}
                        onChange={(e) => setNewPatientForm({ ...newPatientForm, dateOfBirth: e.target.value })}
                        className="w-full px-3 py-2 bg-[#111827] border border-[#1e293b] rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                        data-testid="input-patient-dob"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Address</label>
                    <input
                      type="text"
                      value={newPatientForm.address}
                      onChange={(e) => setNewPatientForm({ ...newPatientForm, address: e.target.value })}
                      className="w-full px-3 py-2 bg-[#111827] border border-[#1e293b] rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                      data-testid="input-patient-address"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={newPatientForm.wheelchairRequired}
                      onChange={(e) => setNewPatientForm({ ...newPatientForm, wheelchairRequired: e.target.checked })}
                      className="rounded"
                      data-testid="input-patient-wheelchair"
                    />
                    <label className="text-xs text-gray-400">Wheelchair required</label>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreatePatient}
                    disabled={createPatientMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                    data-testid="button-create-patient"
                  >
                    {createPatientMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Create Patient
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Trip Details
          </h2>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Pickup Address *</label>
            <input
              type="text"
              value={form.pickupAddress}
              onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })}
              placeholder="Enter pickup address"
              className="w-full px-3 py-2.5 bg-[#0a0f1e] border border-[#1e293b] rounded-lg text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              data-testid="input-pickup-address"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Dropoff Address *</label>
            <input
              type="text"
              value={form.dropoffAddress}
              onChange={(e) => setForm({ ...form, dropoffAddress: e.target.value })}
              placeholder="Enter dropoff address"
              className="w-full px-3 py-2.5 bg-[#0a0f1e] border border-[#1e293b] rounded-lg text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              data-testid="input-dropoff-address"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Date *</label>
              <input
                type="date"
                value={form.scheduledDate}
                onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
                className="w-full px-3 py-2.5 bg-[#0a0f1e] border border-[#1e293b] rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                data-testid="input-date"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Time *</label>
              <input
                type="time"
                value={form.scheduledTime}
                onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })}
                className="w-full px-3 py-2.5 bg-[#0a0f1e] border border-[#1e293b] rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                data-testid="input-time"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Service Level</label>
              <select
                value={form.serviceLevel}
                onChange={(e) => setForm({ ...form, serviceLevel: e.target.value })}
                className="w-full px-3 py-2.5 bg-[#0a0f1e] border border-[#1e293b] rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                data-testid="select-service-level"
              >
                <option value="ambulatory">Ambulatory</option>
                <option value="wheelchair">Wheelchair</option>
                <option value="stretcher">Stretcher</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Passengers</label>
              <input
                type="number"
                min={1}
                max={10}
                value={form.passengerCount}
                onChange={(e) => setForm({ ...form, passengerCount: parseInt(e.target.value) || 1 })}
                className="w-full px-3 py-2.5 bg-[#0a0f1e] border border-[#1e293b] rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                data-testid="input-passengers"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.isRoundTrip}
              onChange={(e) => setForm({ ...form, isRoundTrip: e.target.checked })}
              className="rounded"
              data-testid="input-round-trip"
            />
            <label className="text-sm text-gray-400">Round trip</label>
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Any additional instructions or notes..."
              rows={3}
              className="w-full px-3 py-2.5 bg-[#0a0f1e] border border-[#1e293b] rounded-lg text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
              data-testid="input-notes"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={createRequestMutation.isPending}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
          data-testid="button-submit-request"
        >
          {createRequestMutation.isPending ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Check className="w-5 h-5" />
          )}
          Submit Trip Request
        </button>
      </form>
    </div>
  );
}
