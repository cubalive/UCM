import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function BrokerTripRequestNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [form, setForm] = useState({
    memberName: "",
    memberId: "",
    memberPhone: "",
    pickupAddress: "",
    dropoffAddress: "",
    requestedDate: "",
    requestedPickupTime: "",
    requestedReturnTime: "",
    isRoundTrip: false,
    serviceType: "ambulatory",
    wheelchairRequired: false,
    stretcherRequired: false,
    attendantRequired: false,
    oxygenRequired: false,
    specialNeeds: "",
    maxBudget: "",
    preauthorizationNumber: "",
    diagnosisCode: "",
    priority: "STANDARD",
    notes: "",
  });

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(resolveUrl("/api/broker/trip-requests"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create request");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Trip request created" });
      setLocation(`/trip-requests/${data.request.id}`);
    },
    onError: () => {
      toast({ title: "Failed to create request", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      ...form,
      maxBudget: form.maxBudget ? form.maxBudget : null,
    });
  };

  const updateField = (field: string, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/trip-requests">
          <button className="p-2 hover:bg-white/5 rounded-lg" aria-label="Go back to trip requests"><ArrowLeft className="w-4 h-4 text-gray-400" aria-hidden="true" /></button>
        </Link>
        <h1 className="text-xl font-bold text-white">New Trip Request</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Member Info */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold text-white">Member Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="broker-member-name" className="block text-xs text-gray-400 mb-1">Member Name *</label>
              <input
                id="broker-member-name"
                required
                value={form.memberName}
                onChange={e => updateField("memberName", e.target.value)}
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="broker-member-id" className="block text-xs text-gray-400 mb-1">Member ID</label>
              <input
                id="broker-member-id"
                value={form.memberId}
                onChange={e => updateField("memberId", e.target.value)}
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="broker-member-phone" className="block text-xs text-gray-400 mb-1">Phone</label>
              <input
                id="broker-member-phone"
                value={form.memberPhone}
                onChange={e => updateField("memberPhone", e.target.value)}
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="broker-preauth" className="block text-xs text-gray-400 mb-1">Preauthorization #</label>
              <input
                id="broker-preauth"
                value={form.preauthorizationNumber}
                onChange={e => updateField("preauthorizationNumber", e.target.value)}
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Trip Details */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold text-white">Trip Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="broker-pickup" className="block text-xs text-gray-400 mb-1">Pickup Address *</label>
              <input
                id="broker-pickup"
                required
                value={form.pickupAddress}
                onChange={e => updateField("pickupAddress", e.target.value)}
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="broker-dropoff" className="block text-xs text-gray-400 mb-1">Dropoff Address *</label>
              <input
                id="broker-dropoff"
                required
                value={form.dropoffAddress}
                onChange={e => updateField("dropoffAddress", e.target.value)}
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="broker-date" className="block text-xs text-gray-400 mb-1">Date *</label>
              <input
                id="broker-date"
                required
                type="date"
                value={form.requestedDate}
                onChange={e => updateField("requestedDate", e.target.value)}
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="broker-pickup-time" className="block text-xs text-gray-400 mb-1">Pickup Time *</label>
              <input
                id="broker-pickup-time"
                required
                type="time"
                value={form.requestedPickupTime}
                onChange={e => updateField("requestedPickupTime", e.target.value)}
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Return Time (if round trip)</label>
              <input
                type="time"
                value={form.requestedReturnTime}
                onChange={e => updateField("requestedReturnTime", e.target.value)}
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isRoundTrip}
                  onChange={e => updateField("isRoundTrip", e.target.checked)}
                  className="rounded border-gray-600"
                />
                Round Trip
              </label>
            </div>
          </div>
        </div>

        {/* Service Requirements */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold text-white">Service Requirements</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Service Type</label>
              <select
                value={form.serviceType}
                onChange={e => updateField("serviceType", e.target.value)}
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="ambulatory">Ambulatory</option>
                <option value="wheelchair">Wheelchair</option>
                <option value="stretcher">Stretcher</option>
                <option value="bariatric">Bariatric</option>
                <option value="gurney">Gurney</option>
                <option value="long_distance">Long Distance</option>
                <option value="multi_load">Multi-Load</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={e => updateField("priority", e.target.value)}
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="STANDARD">Standard</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
                <option value="STAT">STAT</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max Budget ($)</label>
              <input
                type="number"
                step="0.01"
                value={form.maxBudget}
                onChange={e => updateField("maxBudget", e.target.value)}
                placeholder="No limit"
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Diagnosis Code</label>
              <input
                value={form.diagnosisCode}
                onChange={e => updateField("diagnosisCode", e.target.value)}
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            {[
              { key: "wheelchairRequired", label: "Wheelchair" },
              { key: "stretcherRequired", label: "Stretcher" },
              { key: "attendantRequired", label: "Attendant" },
              { key: "oxygenRequired", label: "Oxygen" },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(form as any)[key]}
                  onChange={e => updateField(key, e.target.checked)}
                  className="rounded border-gray-600"
                />
                {label}
              </label>
            ))}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Special Needs / Notes</label>
            <textarea
              value={form.notes}
              onChange={e => updateField("notes", e.target.value)}
              rows={3}
              className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Link href="/trip-requests">
            <button type="button" className="px-4 py-2 bg-[#1e293b] text-gray-400 rounded-lg text-sm hover:text-white">
              Cancel
            </button>
          </Link>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {mutation.isPending ? "Creating..." : "Create Trip Request"}
          </button>
        </div>
      </form>
    </div>
  );
}
