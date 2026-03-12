import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import {
  ShoppingCart,
  MapPin,
  Clock,
  DollarSign,
  Star,
  Users,
  Send,
  X,
} from "lucide-react";

export default function BrokerMarketplace() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"marketplace" | "ratings">("marketplace");
  const [serviceType, setServiceType] = useState("");
  const [date, setDate] = useState("");

  // Rating form
  const [showRatingForm, setShowRatingForm] = useState(false);
  const [ratingCompanyId, setRatingCompanyId] = useState<number | null>(null);
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingReview, setRatingReview] = useState("");

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

  const { data: ratingsData, isLoading: ratingsLoading } = useQuery({
    queryKey: ["/api/broker/provider-ratings"],
    queryFn: async () => {
      const res = await fetch(resolveUrl("/api/broker/provider-ratings"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: tab === "ratings",
  });

  const submitRatingMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(resolveUrl("/api/broker/provider-ratings"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker/provider-ratings"] });
      setShowRatingForm(false);
      setRatingCompanyId(null);
      setRatingValue(5);
      setRatingReview("");
    },
  });

  const handleSubmitRating = () => {
    if (!ratingCompanyId) return;
    submitRatingMutation.mutate({
      companyId: ratingCompanyId,
      rating: ratingValue,
      review: ratingReview,
    });
  };

  const renderStars = (rating: number | null, interactive = false, onChange?: (v: number) => void) => {
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(star => (
          <button
            key={star}
            onClick={() => interactive && onChange?.(star)}
            disabled={!interactive}
            className={`${interactive ? "cursor-pointer hover:scale-110" : "cursor-default"} transition-transform`}
          >
            <Star
              className={`w-4 h-4 ${
                rating !== null && star <= (rating || 0)
                  ? "text-amber-400 fill-amber-400"
                  : "text-gray-600"
              }`}
            />
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" /> Marketplace
          </h1>
          <p className="text-sm text-gray-400 mt-1">Open trip requests & provider ratings</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0f172a] rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab("marketplace")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === "marketplace" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          Open Requests
        </button>
        <button
          onClick={() => setTab("ratings")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
            tab === "ratings" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Star className="w-3.5 h-3.5" /> Provider Ratings
        </button>
      </div>

      {tab === "marketplace" && (
        <>
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
              <option value="gurney">Gurney</option>
              <option value="long_distance">Long Distance</option>
              <option value="multi_load">Multi-Load</option>
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
        </>
      )}

      {tab === "ratings" && (
        <>
          {/* Rating form modal */}
          {showRatingForm && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
              <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 w-full max-w-md">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-white">Submit Review</h2>
                  <button onClick={() => setShowRatingForm(false)} className="text-gray-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-gray-500 uppercase mb-2">Rating</label>
                    <div className="flex items-center gap-1">
                      {renderStars(ratingValue, true, setRatingValue)}
                      <span className="text-sm text-gray-400 ml-2">{ratingValue}/5</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 uppercase mb-1">Review (optional)</label>
                    <textarea
                      value={ratingReview}
                      onChange={e => setRatingReview(e.target.value)}
                      placeholder="Share your experience..."
                      rows={3}
                      className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none resize-none"
                    />
                  </div>
                  <div className="flex justify-end gap-3">
                    <button onClick={() => setShowRatingForm(false)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmitRating}
                      disabled={submitRatingMutation.isPending}
                      className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2"
                    >
                      <Send className="w-3 h-3" />
                      {submitRatingMutation.isPending ? "Submitting..." : "Submit"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {ratingsLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 h-32 animate-pulse" />
              ))}
            </div>
          ) : (ratingsData?.providers || []).length === 0 ? (
            <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-12 text-center">
              <Users className="w-12 h-12 mx-auto mb-3 text-gray-600" />
              <p className="text-gray-500">No providers to rate yet.</p>
              <p className="text-sm text-gray-600 mt-1">Providers appear here after contracts are established.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {(ratingsData?.providers || []).map((provider: any) => (
                <div key={provider.companyId} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                        {provider.companyName?.[0]?.toUpperCase() || "P"}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{provider.companyName}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {provider.averageRating !== null ? (
                            <>
                              {renderStars(Math.round(provider.averageRating))}
                              <span className="text-xs text-gray-400">
                                {provider.averageRating} ({provider.reviewCount} reviews)
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-gray-500">No ratings yet</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setRatingCompanyId(provider.companyId);
                          setShowRatingForm(true);
                        }}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                      >
                        <Star className="w-3 h-3" /> Rate
                      </button>
                    </div>
                  </div>

                  {/* Performance scorecard */}
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <div className="bg-[#0f172a] rounded-lg p-2 text-center">
                      <p className="text-xs text-gray-500">Trips</p>
                      <p className="text-lg font-bold text-white">{provider.tripCount}</p>
                    </div>
                    <div className="bg-[#0f172a] rounded-lg p-2 text-center">
                      <p className="text-xs text-gray-500">Rating</p>
                      <p className="text-lg font-bold text-amber-400">
                        {provider.averageRating !== null ? provider.averageRating : "-"}
                      </p>
                    </div>
                    <div className="bg-[#0f172a] rounded-lg p-2 text-center">
                      <p className="text-xs text-gray-500">Status</p>
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${
                        provider.isBlacklisted
                          ? "bg-red-500/20 text-red-400"
                          : "bg-green-500/20 text-green-400"
                      }`}>
                        {provider.isBlacklisted ? "BLACKLISTED" : "ACTIVE"}
                      </span>
                    </div>
                  </div>

                  {/* Recent reviews */}
                  {(provider.reviews || []).length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-gray-500 uppercase">Recent Reviews</p>
                      {provider.reviews.map((review: any) => (
                        <div key={review.id} className="p-2 bg-[#0f172a] rounded-lg">
                          <div className="flex items-center gap-2">
                            {renderStars(review.rating)}
                            <span className="text-[10px] text-gray-600">
                              {new Date(review.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          {review.review && <p className="text-xs text-gray-400 mt-1">{review.review}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
