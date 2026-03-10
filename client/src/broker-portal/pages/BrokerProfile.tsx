import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { User, Building2, Phone, Mail, Globe, MapPin } from "lucide-react";

export default function BrokerProfile() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/profile"],
    queryFn: async () => {
      const res = await fetch(resolveUrl("/api/broker/profile"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 h-64 animate-pulse" />
      </div>
    );
  }

  const broker = data?.broker;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-xl font-bold text-white flex items-center gap-2">
        <User className="w-5 h-5" /> Broker Profile
      </h1>

      {/* User Info */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white">Account</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-gray-500 text-xs">Email</p><p className="text-white">{user?.email}</p></div>
          <div><p className="text-gray-500 text-xs">Role</p><p className="text-white uppercase">{user?.role}</p></div>
        </div>
      </div>

      {/* Broker Organization */}
      {broker && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Building2 className="w-4 h-4" /> Organization
          </h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-gray-500 text-xs">Name</p><p className="text-white">{broker.name}</p></div>
            <div><p className="text-gray-500 text-xs">Type</p><p className="text-white">{broker.type}</p></div>
            <div><p className="text-gray-500 text-xs">Status</p><p className="text-white">{broker.status}</p></div>
            <div><p className="text-gray-500 text-xs">NPI</p><p className="text-white">{broker.npi || "-"}</p></div>
            {broker.address && (
              <div className="col-span-2">
                <p className="text-gray-500 text-xs">Address</p>
                <p className="text-white flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {broker.address}, {broker.city}, {broker.state} {broker.zip}
                </p>
              </div>
            )}
            {broker.phone && (
              <div><p className="text-gray-500 text-xs">Phone</p><p className="text-white flex items-center gap-1"><Phone className="w-3 h-3" /> {broker.phone}</p></div>
            )}
            {broker.email && (
              <div><p className="text-gray-500 text-xs">Email</p><p className="text-white flex items-center gap-1"><Mail className="w-3 h-3" /> {broker.email}</p></div>
            )}
            {broker.website && (
              <div><p className="text-gray-500 text-xs">Website</p><p className="text-white flex items-center gap-1"><Globe className="w-3 h-3" /> {broker.website}</p></div>
            )}
            <div><p className="text-gray-500 text-xs">Contact</p><p className="text-white">{broker.contactName || "-"}</p></div>
            <div><p className="text-gray-500 text-xs">Payment Terms</p><p className="text-white">{broker.defaultPaymentTermsDays} days</p></div>
          </div>
        </div>
      )}

      {!broker && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-8 text-center text-gray-500">
          <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>No broker organization linked to this account.</p>
        </div>
      )}
    </div>
  );
}
