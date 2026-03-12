import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  User,
  Building2,
  Mail,
  Phone,
  MapPin,
  Shield,
  Clock,
  LogOut,
  Settings,
  Edit3,
  Save,
  X,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Zap,
} from "lucide-react";

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DEFAULT_HOURS: Record<string, { open: string; close: string; closed: boolean }> = {};
DAYS_OF_WEEK.forEach(day => {
  DEFAULT_HOURS[day] = { open: "08:00", close: "17:00", closed: day === "Saturday" || day === "Sunday" };
});

const SELF_SERVICE_FEATURES = [
  { key: "ai_scheduling", label: "AI Scheduling", description: "Smart trip scheduling with optimization" },
  { key: "demand_forecasting", label: "Demand Forecasting", description: "Predict transport demand patterns" },
  { key: "auto_notifications", label: "Auto Notifications", description: "Automatic SMS/email trip updates" },
  { key: "recurring_auto_generate", label: "Auto-Generate Recurring", description: "Auto-create trips from recurring schedules" },
];

export default function ClinicProfile() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editingHours, setEditingHours] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["/api/clinic/profile"],
    enabled: !!user?.clinicId || user?.role === "SUPER_ADMIN",
  });

  const { data: featureData } = useQuery<any>({
    queryKey: ["/api/clinic/features"],
    enabled: !!user?.clinicId,
  });

  const clinicData = profile as any;

  const [form, setForm] = useState({
    name: "",
    address: "",
    phone: "",
    contactName: "",
    email: "",
    facilityType: "",
  });

  const [hours, setHours] = useState<Record<string, { open: string; close: string; closed: boolean }>>(DEFAULT_HOURS);

  const startEditing = () => {
    setForm({
      name: clinicData?.name || "",
      address: clinicData?.address || "",
      phone: clinicData?.phone || "",
      contactName: clinicData?.contactName || "",
      email: clinicData?.email || "",
      facilityType: clinicData?.facilityType || "clinic",
    });
    setEditing(true);
  };

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PATCH", "/api/clinic/profile", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/profile"] });
      setEditing(false);
      toast({ title: "Profile updated", description: "Your clinic profile has been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const featureToggleMutation = useMutation({
    mutationFn: async (data: { featureKey: string; enabled: boolean }) => {
      const res = await apiRequest("POST", "/api/clinic/features/toggle", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/features"] });
      toast({ title: "Feature updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to toggle feature", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    const updateData: Record<string, any> = {};
    if (form.name.trim()) updateData.name = form.name.trim();
    if (form.address.trim()) updateData.address = form.address.trim();
    updateData.phone = form.phone.trim() || null;
    updateData.contactName = form.contactName.trim() || null;
    updateData.email = form.email.trim() || null;
    updateData.facilityType = form.facilityType;
    updateMutation.mutate(updateData);
  };

  const inputCls =
    "w-full bg-[#0a0f1e] border border-[#1e293b] text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 placeholder-gray-600 transition-colors";

  const features = (featureData as any)?.features || {};
  const isClinicAdmin = user?.role === "CLINIC_ADMIN" || user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "COMPANY_ADMIN";

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6" data-testid="clinic-profile-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Clinic Profile</h1>
          <p className="text-sm text-gray-500">Your clinic information and settings</p>
        </div>
        {isClinicAdmin && !editing && (
          <button
            onClick={startEditing}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
            data-testid="button-edit-profile"
          >
            <Edit3 className="w-4 h-4" />
            Edit Profile
          </button>
        )}
      </div>

      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden" data-testid="profile-card">
        <div className="h-24 bg-gradient-to-r from-emerald-600/20 to-teal-600/20" />
        <div className="px-6 pb-6 -mt-8">
          <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-teal-400 rounded-xl flex items-center justify-center text-white text-2xl font-bold border-4 border-[#111827]">
            {clinicData?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "C"}
          </div>
          <div className="mt-3">
            {isLoading ? (
              <div className="space-y-2">
                <div className="h-6 w-48 bg-gray-800 rounded animate-pulse" />
                <div className="h-4 w-32 bg-gray-800 rounded animate-pulse" />
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-white" data-testid="text-clinic-name">
                  {clinicData?.name || "Clinic"}
                </h2>
                <p className="text-sm text-gray-500" data-testid="text-clinic-type">
                  {clinicData?.facilityType?.replace(/_/g, " ") || "Healthcare Facility"}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {editing ? (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 space-y-5" data-testid="profile-edit-form">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Settings className="w-4 h-4 text-emerald-400" />
            Edit Profile
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Clinic Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                className={inputCls}
                placeholder="Clinic name"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Facility Type</label>
              <select
                value={form.facilityType}
                onChange={(e) => setForm(f => ({ ...f, facilityType: e.target.value }))}
                className={inputCls}
              >
                <option value="clinic">Clinic</option>
                <option value="hospital">Hospital</option>
                <option value="dialysis_center">Dialysis Center</option>
                <option value="rehabilitation">Rehabilitation</option>
                <option value="nursing_home">Nursing Home</option>
                <option value="pharmacy">Pharmacy</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Address</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
              className={inputCls}
              placeholder="123 Main St, City, State"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                className={inputCls}
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                className={inputCls}
                placeholder="clinic@example.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Contact Name</label>
            <input
              type="text"
              value={form.contactName}
              onChange={(e) => setForm(f => ({ ...f, contactName: e.target.value }))}
              className={inputCls}
              placeholder="Primary contact person"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => setEditing(false)}
              className="flex-1 px-4 py-2.5 text-sm text-gray-400 border border-[#1e293b] rounded-lg hover:bg-[#1e293b] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl divide-y divide-[#1e293b]" data-testid="profile-details">
          <div className="px-5 py-4 flex items-center gap-3">
            <Mail className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Email</p>
              <p className="text-sm text-white">{clinicData?.email || user?.email || "Not set"}</p>
            </div>
          </div>
          <div className="px-5 py-4 flex items-center gap-3">
            <Phone className="w-4 h-4 text-green-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Phone</p>
              <p className="text-sm text-white">{clinicData?.phone || "Not set"}</p>
            </div>
          </div>
          <div className="px-5 py-4 flex items-center gap-3">
            <MapPin className="w-4 h-4 text-red-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Address</p>
              <p className="text-sm text-white">{clinicData?.address || "Not set"}</p>
            </div>
          </div>
          <div className="px-5 py-4 flex items-center gap-3">
            <User className="w-4 h-4 text-purple-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Contact Name</p>
              <p className="text-sm text-white">{clinicData?.contactName || "Not set"}</p>
            </div>
          </div>
          <div className="px-5 py-4 flex items-center gap-3">
            <Building2 className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Facility Type</p>
              <p className="text-sm text-white capitalize">{clinicData?.facilityType?.replace(/_/g, " ") || "Clinic"}</p>
            </div>
          </div>
        </div>
      )}

      {/* Operational Hours */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5" data-testid="operational-hours">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            Operational Hours
          </h3>
          {isClinicAdmin && (
            <button
              onClick={() => setEditingHours(!editingHours)}
              className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              {editingHours ? "Done" : "Edit"}
            </button>
          )}
        </div>
        <div className="space-y-2">
          {DAYS_OF_WEEK.map(day => (
            <div key={day} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-gray-300 w-28">{day}</span>
              {editingHours ? (
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={hours[day]?.closed || false}
                      onChange={(e) => setHours(h => ({ ...h, [day]: { ...h[day], closed: e.target.checked } }))}
                      className="w-3 h-3 rounded border-[#1e293b]"
                    />
                    Closed
                  </label>
                  {!hours[day]?.closed && (
                    <>
                      <input
                        type="time"
                        value={hours[day]?.open || "08:00"}
                        onChange={(e) => setHours(h => ({ ...h, [day]: { ...h[day], open: e.target.value } }))}
                        className="bg-[#0a0f1e] border border-[#1e293b] text-white text-xs rounded px-2 py-1"
                      />
                      <span className="text-gray-600">-</span>
                      <input
                        type="time"
                        value={hours[day]?.close || "17:00"}
                        onChange={(e) => setHours(h => ({ ...h, [day]: { ...h[day], close: e.target.value } }))}
                        className="bg-[#0a0f1e] border border-[#1e293b] text-white text-xs rounded px-2 py-1"
                      />
                    </>
                  )}
                </div>
              ) : (
                <span className="text-sm text-gray-400">
                  {hours[day]?.closed ? "Closed" : `${hours[day]?.open || "08:00"} - ${hours[day]?.close || "17:00"}`}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Feature Flags */}
      {isClinicAdmin && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5" data-testid="feature-flags">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-amber-400" />
            Feature Toggles
          </h3>
          <div className="space-y-3">
            {SELF_SERVICE_FEATURES.map(feat => {
              const isEnabled = features[feat.key]?.enabled === true;
              return (
                <div key={feat.key} className="flex items-center justify-between py-2 border-b border-[#1e293b]/50 last:border-0">
                  <div>
                    <p className="text-sm text-white">{feat.label}</p>
                    <p className="text-xs text-gray-500">{feat.description}</p>
                  </div>
                  <button
                    onClick={() => featureToggleMutation.mutate({ featureKey: feat.key, enabled: !isEnabled })}
                    disabled={featureToggleMutation.isPending}
                    className="shrink-0"
                    data-testid={`toggle-${feat.key}`}
                  >
                    {isEnabled ? (
                      <ToggleRight className="w-8 h-8 text-emerald-400" />
                    ) : (
                      <ToggleLeft className="w-8 h-8 text-gray-600" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5" data-testid="account-section">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400" />
          Account
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white">{user?.email}</p>
              <p className="text-xs text-gray-500 uppercase">{user?.role}</p>
            </div>
            <span className="px-2 py-1 bg-green-500/10 text-green-400 text-xs rounded-full">Active</span>
          </div>
        </div>
      </div>

      <button
        onClick={() => logout()}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 hover:bg-red-500/20 transition-colors"
        data-testid="button-signout"
      >
        <LogOut className="w-4 h-4" />
        Sign Out
      </button>
    </div>
  );
}
