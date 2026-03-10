import { useQuery } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  Settings,
  Building2,
  MapPin,
  Phone,
  Mail,
  Clock,
  Shield,
  Thermometer,
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
        </div>
      ) : (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-8 text-center text-gray-500">
          Pharmacy profile not found
        </div>
      )}
    </div>
  );
}
