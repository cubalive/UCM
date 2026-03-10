import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { useRoute, Link } from "wouter";
import { ArrowLeft, MapPin, Clock, User, DollarSign, CheckCircle, XCircle, Gavel } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function BrokerTripRequestDetail() {
  const [, params] = useRoute("/trip-requests/:id");
  const requestId = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/trip-requests", requestId],
    queryFn: async () => {
      const res = await fetch(resolveUrl(`/api/broker/trip-requests/${requestId}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!requestId,
  });

  const awardMutation = useMutation({
    mutationFn: async (bidId: number) => {
      const res = await fetch(resolveUrl(`/api/broker/bids/${bidId}/award`), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to award bid");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bid awarded successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/broker/trip-requests", requestId] });
    },
    onError: () => {
      toast({ title: "Failed to award bid", variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ status, reason }: { status: string; reason?: string }) => {
      const res = await fetch(resolveUrl(`/api/broker/trip-requests/${requestId}/status`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status, reason }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Status updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/broker/trip-requests", requestId] });
    },
  });

  if (isLoading) {
    return <div className="p-6"><div className="h-64 bg-[#111827] rounded-xl animate-pulse" /></div>;
  }

  const request = data?.request;
  if (!request) {
    return <div className="p-6 text-gray-400">Trip request not found.</div>;
  }

  const bids = data?.bids || [];
  const events = data?.events || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/trip-requests">
          <button className="p-2 hover:bg-white/5 rounded-lg"><ArrowLeft className="w-4 h-4 text-gray-400" /></button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            {request.publicId}
            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${getStatusStyle(request.status)}`}>
              {request.status.replace(/_/g, " ")}
            </span>
          </h1>
          <p className="text-sm text-gray-400">{request.memberName} - {request.requestedDate}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Request Details */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 space-y-4">
            <h2 className="text-sm font-semibold text-white">Trip Details</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500 text-xs">Member</p>
                <p className="text-white flex items-center gap-1"><User className="w-3 h-3" /> {request.memberName}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Member ID</p>
                <p className="text-white">{request.memberId || "-"}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Pickup</p>
                <p className="text-white flex items-center gap-1"><MapPin className="w-3 h-3 text-green-400" /> {request.pickupAddress}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Dropoff</p>
                <p className="text-white flex items-center gap-1"><MapPin className="w-3 h-3 text-red-400" /> {request.dropoffAddress}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Date & Time</p>
                <p className="text-white flex items-center gap-1"><Clock className="w-3 h-3" /> {request.requestedDate} at {request.requestedPickupTime}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Service Type</p>
                <p className="text-white capitalize">{request.serviceType}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Est. Miles</p>
                <p className="text-white">{request.estimatedMiles ? `${request.estimatedMiles} mi` : "-"}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Max Budget</p>
                <p className="text-white">{request.maxBudget ? `$${Number(request.maxBudget).toFixed(2)}` : "No limit"}</p>
              </div>
            </div>

            {(request.wheelchairRequired || request.stretcherRequired || request.attendantRequired || request.oxygenRequired) && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-[#1e293b]">
                {request.wheelchairRequired && <span className="px-2 py-1 bg-amber-500/20 text-amber-400 rounded text-xs">Wheelchair</span>}
                {request.stretcherRequired && <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs">Stretcher</span>}
                {request.attendantRequired && <span className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded text-xs">Attendant</span>}
                {request.oxygenRequired && <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">Oxygen</span>}
              </div>
            )}
          </div>

          {/* Bids */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl">
            <div className="p-4 border-b border-[#1e293b] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Gavel className="w-4 h-4" /> Bids ({bids.length})
              </h2>
              {request.status === "BIDDING" && (
                <button
                  onClick={() => statusMutation.mutate({ status: "BIDDING" })}
                  className="text-xs text-blue-400"
                >
                  Refresh
                </button>
              )}
            </div>
            {bids.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                No bids received yet.
              </div>
            ) : (
              <div className="divide-y divide-[#1e293b]">
                {bids.map(({ bid, companyName }: any) => (
                  <div key={bid.id} className="p-4 flex items-center justify-between hover:bg-white/5">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                        {(companyName || "?")[0]}
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{companyName || `Company #${bid.companyId}`}</p>
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          {bid.vehicleType && <span>{bid.vehicleType}</span>}
                          {bid.estimatedDurationMinutes && <span>{bid.estimatedDurationMinutes} min</span>}
                          {bid.slaGuarantee && <span className="text-green-400">SLA Guaranteed</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-lg font-bold text-white">${Number(bid.bidAmount).toFixed(2)}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${getStatusStyle(bid.status)}`}>{bid.status}</span>
                      </div>
                      {bid.status === "PENDING" && (request.status === "BIDDING" || request.status === "OPEN") && (
                        <button
                          onClick={() => awardMutation.mutate(bid.id)}
                          disabled={awardMutation.isPending}
                          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium disabled:opacity-50"
                        >
                          <CheckCircle className="w-3 h-3 inline mr-1" />
                          Award
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Actions */}
          {(request.status === "OPEN" || request.status === "BIDDING") && (
            <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-white">Actions</h3>
              {request.status === "OPEN" && (
                <button
                  onClick={() => statusMutation.mutate({ status: "BIDDING" })}
                  className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
                >
                  Open for Bidding
                </button>
              )}
              <button
                onClick={() => statusMutation.mutate({ status: "CANCELLED", reason: "Cancelled by broker" })}
                className="w-full px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm"
              >
                Cancel Request
              </button>
            </div>
          )}

          {/* Event Log */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Activity</h3>
            <div className="space-y-3">
              {events.slice(0, 10).map((evt: any) => (
                <div key={evt.id} className="flex gap-3">
                  <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-500 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-300">{evt.description}</p>
                    <p className="text-[10px] text-gray-500">{new Date(evt.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
              {events.length === 0 && <p className="text-xs text-gray-500">No activity yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getStatusStyle(status: string): string {
  const map: Record<string, string> = {
    OPEN: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    BIDDING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    AWARDED: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    PENDING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    ACCEPTED: "bg-green-500/20 text-green-400 border-green-500/30",
    REJECTED: "bg-red-500/20 text-red-400 border-red-500/30",
    COMPLETED: "bg-green-500/20 text-green-400 border-green-500/30",
    CANCELLED: "bg-red-500/20 text-red-400 border-red-500/30",
    IN_PROGRESS: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  };
  return map[status] || "bg-gray-500/20 text-gray-400 border-gray-500/30";
}
