import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import {
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  MessageSquare,
  ChevronRight,
  MapPin,
  Calendar,
  User,
} from "lucide-react";

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "NEEDS_INFO", label: "Needs Info" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
];

function statusColor(status: string) {
  switch (status) {
    case "PENDING": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "NEEDS_INFO": return "bg-orange-500/10 text-orange-400 border-orange-500/20";
    case "APPROVED": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "REJECTED": return "bg-red-500/10 text-red-400 border-red-500/20";
    case "CANCELLED": return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    default: return "bg-gray-500/10 text-gray-400 border-gray-500/20";
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "PENDING": return <Clock className="w-4 h-4 text-amber-400" />;
    case "NEEDS_INFO": return <HelpCircle className="w-4 h-4 text-orange-400" />;
    case "APPROVED": return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    case "REJECTED": return <XCircle className="w-4 h-4 text-red-400" />;
    case "CANCELLED": return <AlertTriangle className="w-4 h-4 text-gray-400" />;
    default: return <Clock className="w-4 h-4 text-gray-400" />;
  }
}

export default function ClinicTripRequests() {
  const [statusFilter, setStatusFilter] = useState("");

  const { data: requests = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/clinic/trip-requests", statusFilter],
    queryFn: async () => {
      const url = statusFilter
        ? `/api/clinic/trip-requests?status=${statusFilter}`
        : "/api/clinic/trip-requests";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch trip requests");
      return res.json();
    },
  });

  return (
    <div className="p-6 space-y-6" data-testid="clinic-trip-requests-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white" data-testid="text-page-title">Trip Requests</h1>
          <p className="text-sm text-gray-400 mt-1">Request transportation for your patients</p>
        </div>
        <Link href="/requests/new">
          <button
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            data-testid="button-new-request"
          >
            <Plus className="w-4 h-4" />
            New Request
          </button>
        </Link>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" data-testid="status-tabs">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              statusFilter === tab.value
                ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                : "bg-[#111827] text-gray-400 border border-[#1e293b] hover:text-white hover:bg-white/5"
            }`}
            data-testid={`tab-${tab.value || "all"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500" data-testid="empty-state">
          <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
          <p className="text-lg font-medium">No trip requests found</p>
          <p className="text-sm mt-1">Create your first trip request to get started</p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="requests-list">
          {requests.map((req: any) => (
            <Link key={req.id} href={`/requests/${req.id}`}>
              <div
                className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 hover:border-blue-500/30 transition-all cursor-pointer group"
                data-testid={`request-card-${req.id}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusColor(req.status)}`}>
                        <StatusIcon status={req.status} />
                        {req.status.replace("_", " ")}
                      </span>
                      <span className="text-xs text-gray-500">#{req.publicId}</span>
                    </div>

                    <div className="flex items-center gap-4 text-sm">
                      {req.patientName && (
                        <span className="flex items-center gap-1.5 text-gray-300">
                          <User className="w-3.5 h-3.5 text-gray-500" />
                          {req.patientName}
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 text-gray-400">
                        <Calendar className="w-3.5 h-3.5 text-gray-500" />
                        {req.scheduledDate} at {req.scheduledTime}
                      </span>
                    </div>

                    <div className="flex items-start gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-1 truncate">
                        <MapPin className="w-3 h-3 shrink-0 text-green-500" />
                        {req.pickupAddress}
                      </span>
                      <span className="flex items-center gap-1 truncate">
                        <MapPin className="w-3 h-3 shrink-0 text-red-500" />
                        {req.dropoffAddress}
                      </span>
                    </div>
                  </div>

                  <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-blue-400 transition-colors shrink-0 mt-1" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
