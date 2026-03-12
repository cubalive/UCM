import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useState } from "react";
import {
  Settings,
  Building2,
  MapPin,
  Phone,
  Mail,
  Clock,
  Shield,
  Thermometer,
  Zap,
  Bell,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

export default function PharmacySettings() {
  const { token, user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/pharmacy/profile"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const pharmacy = data?.pharmacy;

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-700 rounded w-48" />
          <div className="h-64 bg-gray-800 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Settings className="w-6 h-6 text-violet-400" />
          Pharmacy Settings
        </h1>
        <p className="text-sm text-gray-400 mt-1">View and manage your pharmacy profile</p>
      </div>

      {pharmacy ? (
        <div className="space-y-6">
          {/* Basic Info */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-violet-400" />
              Pharmacy Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] uppercase text-gray-500">Name</label>
                <p className="text-sm text-white">{pharmacy.name}</p>
              </div>
              <div>
                <label className="text-[10px] uppercase text-gray-500">Public ID</label>
                <p className="text-sm text-white font-mono">{pharmacy.publicId}</p>
              </div>
              {pharmacy.licenseNumber && (
                <div>
                  <label className="text-[10px] uppercase text-gray-500">License #</label>
                  <p className="text-sm text-white">{pharmacy.licenseNumber}</p>
                </div>
              )}
              {pharmacy.npiNumber && (
                <div>
                  <label className="text-[10px] uppercase text-gray-500">NPI</label>
                  <p className="text-sm text-white">{pharmacy.npiNumber}</p>
                </div>
              )}
            </div>
          </div>

          {/* Contact */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">Contact & Location</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <MapPin className="w-4 h-4 text-gray-500" />
                {pharmacy.address}
              </div>
              {pharmacy.phone && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Phone className="w-4 h-4 text-gray-500" />
                  {pharmacy.phone}
                </div>
              )}
              {pharmacy.email && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Mail className="w-4 h-4 text-gray-500" />
                  {pharmacy.email}
                </div>
              )}
            </div>
          </div>

          {/* Operations */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-violet-400" />
              Operations
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] uppercase text-gray-500">Operating Hours</label>
                <p className="text-sm text-white">{pharmacy.operatingHoursStart} — {pharmacy.operatingHoursEnd}</p>
              </div>
              <div>
                <label className="text-[10px] uppercase text-gray-500">Avg Prep Time</label>
                <p className="text-sm text-white">{pharmacy.averagePrepTimeMinutes} minutes</p>
              </div>
              <div>
                <label className="text-[10px] uppercase text-gray-500">Max Delivery Radius</label>
                <p className="text-sm text-white">{pharmacy.maxDeliveryRadiusMiles} miles</p>
              </div>
              <div>
                <label className="text-[10px] uppercase text-gray-500">Auto-confirm Orders</label>
                <p className="text-sm text-white">{pharmacy.autoConfirmOrders ? "Yes" : "No"}</p>
              </div>
            </div>
          </div>

          {/* Capabilities */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-violet-400" />
              Capabilities
            </h3>
            <div className="flex flex-wrap gap-3">
              <div className={`px-4 py-2 rounded-lg text-xs border ${pharmacy.acceptsControlledSubstances ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-gray-800 text-gray-500 border-gray-700"}`}>
                <Shield className="w-3 h-3 inline mr-1" />
                Controlled Substances: {pharmacy.acceptsControlledSubstances ? "Yes" : "No"}
              </div>
              <div className={`px-4 py-2 rounded-lg text-xs border ${pharmacy.hasRefrigeratedStorage ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-gray-800 text-gray-500 border-gray-700"}`}>
                <Thermometer className="w-3 h-3 inline mr-1" />
                Refrigerated Storage: {pharmacy.hasRefrigeratedStorage ? "Yes" : "No"}
              </div>
            </div>
          </div>

          {/* Account */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">Account</h3>
            <div className="text-xs text-gray-500">
              <p>Logged in as: <span className="text-gray-300">{user?.email}</span></p>
              <p>Role: <span className="text-gray-300 uppercase">{user?.role}</span></p>
              <p className="mt-2 text-gray-600">To update pharmacy settings, contact your UCM administrator.</p>
            </div>
          </div>

          {/* Workflow Automation */}
          <WorkflowAutomationSettings token={token!} />
        </div>
      ) : (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-8 text-center text-gray-500">
          Pharmacy profile not found
        </div>
      )}
    </div>
  );
}

function ToggleSwitch({ enabled, onChange, label, description }: { enabled: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm text-white">{label}</p>
        {description && <p className="text-[10px] text-gray-500 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-10 h-5 rounded-full transition-colors ${enabled ? "bg-violet-600" : "bg-gray-700"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${enabled ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

function WorkflowAutomationSettings({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/pharmacy/automation-settings"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/automation-settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/automation-settings`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/automation-settings"] });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onMutate: () => setSaveStatus("saving"),
  });

  const settings = data?.settings || {};

  const update = (key: string, value: any) => {
    updateMutation.mutate({ [key]: value });
  };

  if (isLoading) {
    return (
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-gray-700 rounded w-48 mb-4" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-gray-800 rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Automation Rules */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-violet-400" />
            Workflow Automation
          </h3>
          {saveStatus === "saved" && (
            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Saved
            </span>
          )}
        </div>

        <div className="divide-y divide-[#1e293b]">
          <ToggleSwitch
            enabled={settings.autoConfirmOrders || false}
            onChange={(v) => update("autoConfirmOrders", v)}
            label="Auto-confirm new orders"
            description="Automatically move new orders from PENDING to CONFIRMED"
          />
          <ToggleSwitch
            enabled={settings.autoDispatch || false}
            onChange={(v) => update("autoDispatch", v)}
            label="Auto-dispatch to drivers"
            description="Automatically assign available drivers when orders are ready"
          />
          <ToggleSwitch
            enabled={settings.escalateToManager || false}
            onChange={(v) => update("escalateToManager", v)}
            label="SLA escalation to manager"
            description="Alert pharmacy manager when SLA thresholds are breached"
          />
        </div>
      </div>

      {/* SLA Thresholds */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          SLA Escalation Thresholds
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] uppercase text-gray-500 block mb-1">Warning Threshold (minutes)</label>
            <input
              type="number"
              value={settings.slaWarningMinutes || 45}
              onChange={(e) => update("slaWarningMinutes", Number(e.target.value))}
              className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <p className="text-[10px] text-gray-600 mt-1">Warn when delivery is approaching SLA limit</p>
          </div>
          <div>
            <label className="text-[10px] uppercase text-gray-500 block mb-1">Escalation Threshold (minutes)</label>
            <input
              type="number"
              value={settings.slaEscalationMinutes || 60}
              onChange={(e) => update("slaEscalationMinutes", Number(e.target.value))}
              className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <p className="text-[10px] text-gray-600 mt-1">Escalate when delivery exceeds this time</p>
          </div>
        </div>
      </div>

      {/* Notification Preferences */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Bell className="w-4 h-4 text-violet-400" />
          Notification Preferences
        </h3>
        <div className="divide-y divide-[#1e293b]">
          <ToggleSwitch
            enabled={settings.notifyOnNewOrder ?? true}
            onChange={(v) => update("notifyOnNewOrder", v)}
            label="New order notifications"
          />
          <ToggleSwitch
            enabled={settings.notifyOnStatusChange ?? true}
            onChange={(v) => update("notifyOnStatusChange", v)}
            label="Status change notifications"
          />
          <ToggleSwitch
            enabled={settings.notifyOnDriverAssigned ?? true}
            onChange={(v) => update("notifyOnDriverAssigned", v)}
            label="Driver assignment notifications"
          />
          <ToggleSwitch
            enabled={settings.notifyOnDeliveryComplete ?? true}
            onChange={(v) => update("notifyOnDeliveryComplete", v)}
            label="Delivery completion notifications"
          />
          <ToggleSwitch
            enabled={settings.notifyOnFailure ?? true}
            onChange={(v) => update("notifyOnFailure", v)}
            label="Delivery failure alerts"
          />
        </div>
        <div className="pt-2 border-t border-[#1e293b]">
          <p className="text-[10px] text-gray-500 uppercase mb-2">Notification Channels</p>
          <div className="flex gap-4">
            <ToggleSwitch
              enabled={settings.emailNotifications ?? true}
              onChange={(v) => update("emailNotifications", v)}
              label="Email"
            />
            <ToggleSwitch
              enabled={settings.smsNotifications ?? false}
              onChange={(v) => update("smsNotifications", v)}
              label="SMS"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
