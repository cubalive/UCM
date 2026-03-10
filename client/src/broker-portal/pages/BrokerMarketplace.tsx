import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { ShoppingCart, MapPin, Clock, DollarSign, Users } from "lucide-react";
import { Link } from "wouter";

export default function BrokerMarketplace() {
  const [serviceType, setServiceType] = useState("");
  const [date, setDate] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/marketplace/requests", serviceType, date],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (serviceType) params.set("serviceType", serviceType);
      if (date) params.set("date", date);
      const res = await fetch(resolveUrl(`/api/marketplace/requests?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" /> Marketplace
          </h1>
          <p className="text-sm text-gray-400 mt-1">Open trip requests available for bidding</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={serviceType}
          onChange={e => setServiceType(e.target.value)}
          className="bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Services</option>
          <option value="ambulatory">Ambulatory</option>
          <option value="wheelchair">Wheelchair</option>
          <option value="stretcher">Stretcher</option>
          <option value="bariatric">Bariatric</option>
        </select>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 h-48 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data?.requests || []).map(({ request, brokerName }: any) => (
            <div key={request.id} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 hover:border-blue-500/50 transition-colors">
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-xs text-blue-400">{request.publicId}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  request.status === "OPEN"
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-amber-500/20 text-amber-400"
                }`}>
                  {request.status}
                </span>
              </div>

              <p className="text-sm font-medium text-white mb-2">{request.memberName}</p>

              <div className="space-y-1.5 text-xs text-gray-400">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-green-400 shrink-0" />
                  <span className="truncate">{request.pickupAddress}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-red-400 shrink-0" />
                  <span className="truncate">{request.dropoffAddress}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  <span>{request.requestedDate} at {request.requestedPickupTime}</span>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#1e293b]">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 capitalize">{request.serviceType}</span>
                  {request.wheelchairRequired && <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded text-[10px]">WC</span>}
                </div>
                <div className="flex items-center gap-2">
                  {request.maxBudget && (
                    <span className="text-xs text-green-400 flex items-center gap-0.5">
                      <DollarSign className="w-3 h-3" />{Number(request.maxBudget).toFixed(0)}
                    </span>
                  )}
                  {brokerName && <span className="text-[10px] text-gray-500">{brokerName}</span>}
                </div>
              </div>
            </div>
          ))}
          {(data?.requests || []).length === 0 && (
            <div className="col-span-full text-center py-16 text-gray-500">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No open requests in the marketplace</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
