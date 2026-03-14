import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Package,
  Pill,
  Thermometer,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";

interface OrderItem {
  medicationName: string;
  ndc: string;
  quantity: number;
  unit: string;
  rxNumber: string;
  isControlled: boolean;
  scheduleClass: string;
  requiresRefrigeration: boolean;
}

const EMPTY_ITEM: OrderItem = {
  medicationName: "",
  ndc: "",
  quantity: 1,
  unit: "each",
  rxNumber: "",
  isControlled: false,
  scheduleClass: "",
  requiresRefrigeration: false,
};

export default function PharmacyNewOrder() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    recipientName: "",
    recipientPhone: "",
    deliveryAddress: "",
    deliveryInstructions: "",
    requestedDeliveryDate: new Date().toISOString().split("T")[0],
    requestedDeliveryWindow: "",
    priority: "STANDARD",
    deliveryType: "PHARMACY_TO_PATIENT",
    temperatureRequirement: "AMBIENT",
    requiresSignature: true,
    requiresIdVerification: false,
    isControlledSubstance: false,
    specialHandling: "",
    notes: "",
  });

  const [items, setItems] = useState<OrderItem[]>([{ ...EMPTY_ITEM }]);

  const createOrder = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/orders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, items: items.filter(i => i.medicationName.trim()) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to create order");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/dashboard"] });
      navigate(`/orders/${data.order.id}`);
    },
  });

  const addItem = () => setItems([...items, { ...EMPTY_ITEM }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, value: any) => {
    const newItems = [...items];
    (newItems[i] as any)[field] = value;
    if (field === "isControlled" && value) {
      setForm(f => ({ ...f, isControlledSubstance: true }));
    }
    setItems(newItems);
  };

  const hasControlled = items.some(i => i.isControlled);
  const hasRefrigerated = items.some(i => i.requiresRefrigeration);

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate("/orders")} aria-label="Go back to orders" className="p-2 hover:bg-white/5 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-400" aria-hidden="true" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-white">New Delivery Order</h1>
          <p className="text-sm text-gray-400">Create a pharmacy delivery request</p>
        </div>
      </div>

      {/* Warnings */}
      {hasControlled && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3" role="alert">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm text-red-400 font-medium">Controlled Substance Detected</p>
            <p className="text-xs text-red-400/70">This order will require ID verification and chain of custody tracking.</p>
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); createOrder.mutate(); }}
        className="space-y-6"
      >
        {/* Recipient Info */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Recipient Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Recipient Name *</label>
              <input
                type="text"
                required
                value={form.recipientName}
                onChange={(e) => setForm(f => ({ ...f, recipientName: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                placeholder="Patient or facility name"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Phone</label>
              <input
                type="tel"
                value={form.recipientPhone}
                onChange={(e) => setForm(f => ({ ...f, recipientPhone: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                placeholder="(555) 123-4567"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Delivery Address *</label>
            <input
              type="text"
              required
              value={form.deliveryAddress}
              onChange={(e) => setForm(f => ({ ...f, deliveryAddress: e.target.value }))}
              className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              placeholder="123 Main St, City, State ZIP"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Delivery Instructions</label>
            <input
              type="text"
              value={form.deliveryInstructions}
              onChange={(e) => setForm(f => ({ ...f, deliveryInstructions: e.target.value }))}
              className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              placeholder="e.g. Leave at front desk, ring doorbell, etc."
            />
          </div>
        </div>

        {/* Scheduling & Priority */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Scheduling</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Delivery Date *</label>
              <input
                type="date"
                required
                value={form.requestedDeliveryDate}
                onChange={(e) => setForm(f => ({ ...f, requestedDeliveryDate: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Delivery Window</label>
              <select
                value={form.requestedDeliveryWindow}
                onChange={(e) => setForm(f => ({ ...f, requestedDeliveryWindow: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="">Any time</option>
                <option value="8AM-12PM">Morning (8AM-12PM)</option>
                <option value="12PM-4PM">Afternoon (12PM-4PM)</option>
                <option value="4PM-8PM">Evening (4PM-8PM)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="STANDARD">Standard (same day)</option>
                <option value="EXPRESS">Express (2-4 hours)</option>
                <option value="URGENT">Urgent (1-2 hours)</option>
                <option value="STAT">STAT (ASAP)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Medication Items */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Pill className="w-4 h-4 text-violet-400" />
              Medications ({items.length})
            </h3>
            <button type="button" onClick={addItem} className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add Item
            </button>
          </div>
          {items.map((item, i) => (
            <div key={i} className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Item {i + 1}</span>
                {items.length > 1 && (
                  <button type="button" onClick={() => removeItem(i)} aria-label={`Remove item ${i + 1}`} className="text-red-400 hover:text-red-300">
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <input
                    type="text"
                    placeholder="Medication name *"
                    value={item.medicationName}
                    onChange={(e) => updateItem(i, "medicationName", e.target.value)}
                    className="w-full bg-[#111827] border border-[#1e293b] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={(e) => updateItem(i, "quantity", parseInt(e.target.value) || 1)}
                    className="w-20 bg-[#111827] border border-[#1e293b] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                  <input
                    type="text"
                    placeholder="Rx #"
                    value={item.rxNumber}
                    onChange={(e) => updateItem(i, "rxNumber", e.target.value)}
                    className="flex-1 bg-[#111827] border border-[#1e293b] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.isControlled}
                    onChange={(e) => updateItem(i, "isControlled", e.target.checked)}
                    className="rounded border-gray-600"
                  />
                  <ShieldCheck className="w-3 h-3 text-red-400" />
                  Controlled substance
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.requiresRefrigeration}
                    onChange={(e) => updateItem(i, "requiresRefrigeration", e.target.checked)}
                    className="rounded border-gray-600"
                  />
                  <Thermometer className="w-3 h-3 text-blue-400" />
                  Requires refrigeration
                </label>
              </div>
            </div>
          ))}
        </div>

        {/* Delivery Requirements */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Delivery Requirements</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Temperature</label>
              <select
                value={form.temperatureRequirement}
                onChange={(e) => setForm(f => ({ ...f, temperatureRequirement: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="AMBIENT">Ambient (Room Temp)</option>
                <option value="REFRIGERATED">Refrigerated (2-8C)</option>
                <option value="FROZEN">Frozen (-20C)</option>
                <option value="CONTROLLED">Controlled Temp</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Delivery Type</label>
              <select
                value={form.deliveryType}
                onChange={(e) => setForm(f => ({ ...f, deliveryType: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="PHARMACY_TO_PATIENT">Pharmacy to Patient</option>
                <option value="PHARMACY_TO_CLINIC">Pharmacy to Clinic</option>
                <option value="PHARMACY_TO_PHARMACY">Pharmacy to Pharmacy</option>
                <option value="LAB_SPECIMEN">Lab Specimen</option>
                <option value="MEDICAL_SUPPLY">Medical Supply</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={form.requiresSignature}
                onChange={(e) => setForm(f => ({ ...f, requiresSignature: e.target.checked }))}
                className="rounded border-gray-600"
              />
              Require signature on delivery
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={form.requiresIdVerification}
                onChange={(e) => setForm(f => ({ ...f, requiresIdVerification: e.target.checked }))}
                className="rounded border-gray-600"
              />
              Require ID verification
            </label>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Additional Notes</h3>
          <textarea
            value={form.notes}
            onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={3}
            className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
            placeholder="Any additional notes for the delivery..."
          />
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate("/orders")}
            className="px-6 py-2.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createOrder.isPending || !form.recipientName || !form.deliveryAddress}
            className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
          >
            <Package className="w-4 h-4" />
            {createOrder.isPending ? "Creating..." : "Create Delivery Order"}
          </button>
        </div>

        {createOrder.isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400" role="alert">
            {(createOrder.error as Error).message}
          </div>
        )}
      </form>
    </div>
  );
}
