import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
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
} from "lucide-react";

export default function ClinicProfile() {
  const { user, logout } = useAuth();

  const { data: profile, isLoading } = useQuery({
    queryKey: ["/api/clinic/profile"],
    enabled: !!user?.clinicId || user?.role === "SUPER_ADMIN",
  });

  const clinicData = profile as any;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6" data-testid="clinic-profile-page">
      <div>
        <h1 className="text-xl font-bold text-white">Clinic Profile</h1>
        <p className="text-sm text-gray-500">Your clinic information and settings</p>
      </div>

      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden" data-testid="profile-card">
        <div className="h-24 bg-gradient-to-r from-blue-600/20 to-cyan-600/20" />
        <div className="px-6 pb-6 -mt-8">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-xl flex items-center justify-center text-white text-2xl font-bold border-4 border-[#111827]">
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

      <div className="bg-[#111827] border border-[#1e293b] rounded-xl divide-y divide-[#1e293b]" data-testid="profile-details">
        <div className="px-5 py-4 flex items-center gap-3">
          <Mail className="w-4 h-4 text-blue-400 shrink-0" />
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

      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5" data-testid="account-section">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-blue-400" />
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
