import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
        throw new Error(err.message || t('pharmacy.newOrder.error'));
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
        <button onClick={() => navigate("/orders")} aria-label={t('pharmacy.newOrder.backToOrders')} className="p-2 hover:bg-white/5 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-400" aria-hidden="true" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-white">{t('pharmacy.newOrder.title')}</h1>
          <p className="text-sm text-gray-400">{t('pharmacy.newOrder.subtitle')}</p>
        </div>
      </div>

      {/* Warnings */}
      {hasControlled && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3" role="alert">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm text-red-400 font-medium">{t('pharmacy.newOrder.controlledDetected')}</p>
            <p className="text-xs text-red-400/70">{t('pharmacy.newOrder.controlledWarning')}</p>
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); createOrder.mutate(); }}
        className="space-y-6"
      >
        {/* Recipient Info */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">{t('pharmacy.newOrder.recipientInfo')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('pharmacy.newOrder.recipientName')}</label>
              <input
                type="text"
                required
                value={form.recipientName}
                onChange={(e) => setForm(f => ({ ...f, recipientName: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                placeholder={t('pharmacy.newOrder.recipientNamePlaceholder')}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('pharmacy.newOrder.phone')}</label>
              <input
                type="tel"
                value={form.recipientPhone}
                onChange={(e) => setForm(f => ({ ...f, recipientPhone: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                placeholder={t('pharmacy.newOrder.phonePlaceholder')}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{t('pharmacy.newOrder.deliveryAddress')}</label>
            <input
              type="text"
              required
              value={form.deliveryAddress}
              onChange={(e) => setForm(f => ({ ...f, deliveryAddress: e.target.value }))}
              className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              placeholder={t('pharmacy.newOrder.deliveryAddressPlaceholder')}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{t('pharmacy.newOrder.deliveryInstructions')}</label>
            <input
              type="text"
              value={form.deliveryInstructions}
              onChange={(e) => setForm(f => ({ ...f, deliveryInstructions: e.target.value }))}
              className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              placeholder={t('pharmacy.newOrder.deliveryInstructionsPlaceholder')}
            />
          </div>
        </div>

        {/* Scheduling & Priority */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">{t('pharmacy.newOrder.scheduling')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('pharmacy.newOrder.deliveryDate')}</label>
              <input
                type="date"
                required
                value={form.requestedDeliveryDate}
                onChange={(e) => setForm(f => ({ ...f, requestedDeliveryDate: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('pharmacy.newOrder.deliveryWindow')}</label>
              <select
                value={form.requestedDeliveryWindow}
                onChange={(e) => setForm(f => ({ ...f, requestedDeliveryWindow: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="">{t('pharmacy.newOrder.anyTime')}</option>
                <option value="8AM-12PM">{t('pharmacy.newOrder.morning')}</option>
                <option value="12PM-4PM">{t('pharmacy.newOrder.afternoon')}</option>
                <option value="4PM-8PM">{t('pharmacy.newOrder.evening')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('pharmacy.newOrder.priority')}</label>
              <select
                value={form.priority}
                onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="STANDARD">{t('pharmacy.newOrder.standard')}</option>
                <option value="EXPRESS">{t('pharmacy.newOrder.express')}</option>
                <option value="URGENT">{t('pharmacy.newOrder.urgent')}</option>
                <option value="STAT">{t('pharmacy.newOrder.stat')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Medication Items */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Pill className="w-4 h-4 text-violet-400" />
              {t('pharmacy.newOrder.medications', { count: items.length })}
            </h3>
            <button type="button" onClick={addItem} className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1">
              <Plus className="w-3 h-3" /> {t('pharmacy.newOrder.addItem')}
            </button>
          </div>
          {items.map((item, i) => (
            <div key={i} className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{t('pharmacy.newOrder.itemNumber', { number: i + 1 })}</span>
                {items.length > 1 && (
                  <button type="button" onClick={() => removeItem(i)} aria-label={t('pharmacy.newOrder.removeItem', { number: i + 1 })} className="text-red-400 hover:text-red-300">
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <input
                    type="text"
                    placeholder={t('pharmacy.newOrder.medicationNamePlaceholder')}
                    value={item.medicationName}
                    onChange={(e) => updateItem(i, "medicationName", e.target.value)}
                    className="w-full bg-[#111827] border border-[#1e293b] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    placeholder={t('pharmacy.newOrder.qtyPlaceholder')}
                    value={item.quantity}
                    onChange={(e) => updateItem(i, "quantity", parseInt(e.target.value) || 1)}
                    className="w-20 bg-[#111827] border border-[#1e293b] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                  <input
                    type="text"
                    placeholder={t('pharmacy.newOrder.rxPlaceholder')}
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
                  {t('pharmacy.newOrder.controlledSubstance')}
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.requiresRefrigeration}
                    onChange={(e) => updateItem(i, "requiresRefrigeration", e.target.checked)}
                    className="rounded border-gray-600"
                  />
                  <Thermometer className="w-3 h-3 text-blue-400" />
                  {t('pharmacy.newOrder.requiresRefrigeration')}
                </label>
              </div>
            </div>
          ))}
        </div>

        {/* Delivery Requirements */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">{t('pharmacy.newOrder.deliveryRequirements')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('pharmacy.newOrder.temperature')}</label>
              <select
                value={form.temperatureRequirement}
                onChange={(e) => setForm(f => ({ ...f, temperatureRequirement: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="AMBIENT">{t('pharmacy.newOrder.ambient')}</option>
                <option value="REFRIGERATED">{t('pharmacy.newOrder.refrigerated')}</option>
                <option value="FROZEN">{t('pharmacy.newOrder.frozen')}</option>
                <option value="CONTROLLED">{t('pharmacy.newOrder.controlledTemp')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('pharmacy.newOrder.deliveryType')}</label>
              <select
                value={form.deliveryType}
                onChange={(e) => setForm(f => ({ ...f, deliveryType: e.target.value }))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="PHARMACY_TO_PATIENT">{t('pharmacy.newOrder.pharmacyToPatient')}</option>
                <option value="PHARMACY_TO_CLINIC">{t('pharmacy.newOrder.pharmacyToClinic')}</option>
                <option value="PHARMACY_TO_PHARMACY">{t('pharmacy.newOrder.pharmacyToPharmacy')}</option>
                <option value="LAB_SPECIMEN">{t('pharmacy.newOrder.labSpecimen')}</option>
                <option value="MEDICAL_SUPPLY">{t('pharmacy.newOrder.medicalSupply')}</option>
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
              {t('pharmacy.newOrder.requireSignature')}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={form.requiresIdVerification}
                onChange={(e) => setForm(f => ({ ...f, requiresIdVerification: e.target.checked }))}
                className="rounded border-gray-600"
              />
              {t('pharmacy.newOrder.requireIdVerification')}
            </label>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">{t('pharmacy.newOrder.additionalNotes')}</h3>
          <textarea
            value={form.notes}
            onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={3}
            className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
            placeholder={t('pharmacy.newOrder.notesPlaceholder')}
          />
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate("/orders")}
            className="px-6 py-2.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={createOrder.isPending || !form.recipientName || !form.deliveryAddress}
            className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
          >
            <Package className="w-4 h-4" />
            {createOrder.isPending ? t('pharmacy.newOrder.creating') : t('pharmacy.newOrder.createOrder')}
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
