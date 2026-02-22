import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  ClipboardList,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  MessageSquare,
  Send,
  Loader2,
  MapPin,
  Calendar,
  User,
  X,
  ChevronRight,
  Filter,
} from "lucide-react";

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "NEEDS_INFO", label: "Needs Info" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
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
    default: return <Clock className="w-4 h-4 text-gray-400" />;
  }
}

function RequestDetailDrawer({ request, onClose }: { request: any; onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messageInput, setMessageInput] = useState("");
  const [needsInfoNote, setNeedsInfoNote] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showNeedsInfoForm, setShowNeedsInfoForm] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data: chatData, refetch: refetchChat } = useQuery<any>({
    queryKey: ["/api/dispatch/trip-requests", request.id, "chat"],
    queryFn: async () => {
      const res = await fetch(`/api/dispatch/trip-requests/${request.id}/chat`, { credentials: "include" });
      if (!res.ok) return { thread: null, messages: [] };
      return res.json();
    },
    refetchInterval: 5000,
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/dispatch/trip-requests/${request.id}/approve`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trip-requests"] });
      toast({ title: `Trip request approved! Trip #${data.tripId} created.` });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: err?.message || "Failed to approve", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (reason: string) => {
      const res = await apiRequest("POST", `/api/dispatch/trip-requests/${request.id}/reject`, { reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trip-requests"] });
      toast({ title: "Trip request rejected" });
      onClose();
    },
    onError: () => {
      toast({ title: "Failed to reject", variant: "destructive" });
    },
  });

  const needsInfoMutation = useMutation({
    mutationFn: async (data: { notes: string; message?: string }) => {
      const res = await apiRequest("POST", `/api/dispatch/trip-requests/${request.id}/needs-info`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trip-requests"] });
      setShowNeedsInfoForm(false);
      setNeedsInfoNote("");
      toast({ title: "Marked as needs info" });
      refetchChat();
    },
    onError: () => {
      toast({ title: "Failed to update", variant: "destructive" });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!chatData?.thread?.id) return;
      const res = await apiRequest("POST", `/api/chat/threads/${chatData.thread.id}/messages`, { message });
      return res.json();
    },
    onSuccess: () => {
      setMessageInput("");
      refetchChat();
    },
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatData?.messages?.length]);

  const messages = chatData?.messages || [];
  const canAction = request.status === "PENDING" || request.status === "NEEDS_INFO";

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="request-detail-drawer">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="ml-auto relative w-full max-w-2xl bg-[#0f172a] border-l border-[#1e293b] flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-[#1e293b]">
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusColor(request.status)}`}>
              <StatusIcon status={request.status} />
              {request.status.replace("_", " ")}
            </span>
            <span className="text-sm text-gray-400">#{request.publicId}</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/5 rounded-lg" data-testid="button-close-drawer">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-4 border-b border-[#1e293b]">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500 text-xs mb-1">Patient</p>
                <p className="text-white font-medium flex items-center gap-1.5" data-testid="text-patient">
                  <User className="w-3.5 h-3.5 text-gray-500" />
                  {request.patientName || "Not assigned"}
                </p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-1">Schedule</p>
                <p className="text-white font-medium flex items-center gap-1.5" data-testid="text-schedule">
                  <Calendar className="w-3.5 h-3.5 text-gray-500" />
                  {request.scheduledDate} {request.scheduledTime}
                </p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-1">Clinic</p>
                <p className="text-white text-sm" data-testid="text-clinic">{request.clinicName}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-1">City</p>
                <p className="text-white text-sm" data-testid="text-city">{request.cityName}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-gray-500 text-xs">Pickup</p>
                  <p className="text-white" data-testid="text-pickup">{request.pickupAddress}</p>
                </div>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-gray-500 text-xs">Dropoff</p>
                  <p className="text-white" data-testid="text-dropoff">{request.dropoffAddress}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-4 text-sm">
              <div>
                <p className="text-gray-500 text-xs">Service</p>
                <p className="text-white capitalize">{request.serviceLevel}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Passengers</p>
                <p className="text-white">{request.passengerCount}</p>
              </div>
              {request.isRoundTrip && <div><p className="text-gray-500 text-xs">Type</p><p className="text-white">Round Trip</p></div>}
            </div>

            {request.notes && (
              <div>
                <p className="text-gray-500 text-xs">Notes</p>
                <p className="text-white text-sm">{request.notes}</p>
              </div>
            )}
          </div>

          {canAction && (
            <div className="p-4 border-b border-[#1e293b] space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending || !request.patientId}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                  data-testid="button-approve"
                >
                  {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Approve
                </button>
                <button
                  onClick={() => { setShowNeedsInfoForm(!showNeedsInfoForm); setShowRejectForm(false); }}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-orange-600/10 border border-orange-500/20 text-orange-400 hover:bg-orange-600/20 rounded-lg text-sm font-medium transition-colors"
                  data-testid="button-needs-info"
                >
                  <HelpCircle className="w-4 h-4" />
                  Needs Info
                </button>
                <button
                  onClick={() => { setShowRejectForm(!showRejectForm); setShowNeedsInfoForm(false); }}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-600/10 border border-red-500/20 text-red-400 hover:bg-red-600/20 rounded-lg text-sm font-medium transition-colors"
                  data-testid="button-reject"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
              </div>

              {!request.patientId && (
                <p className="text-xs text-amber-400 text-center">Patient must be assigned before approval</p>
              )}

              {showNeedsInfoForm && (
                <div className="bg-[#111827] border border-[#1e293b] rounded-lg p-3 space-y-2" data-testid="needs-info-form">
                  <textarea
                    value={needsInfoNote}
                    onChange={(e) => setNeedsInfoNote(e.target.value)}
                    placeholder="What information is needed?"
                    rows={2}
                    className="w-full px-3 py-2 bg-[#0a0f1e] border border-[#1e293b] rounded-lg text-white text-sm placeholder-gray-500 focus:border-orange-500 focus:outline-none resize-none"
                    data-testid="input-needs-info-note"
                  />
                  <button
                    onClick={() => needsInfoMutation.mutate({ notes: needsInfoNote, message: needsInfoNote })}
                    disabled={needsInfoMutation.isPending || !needsInfoNote.trim()}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
                    data-testid="button-submit-needs-info"
                  >
                    {needsInfoMutation.isPending ? "Sending..." : "Send & Mark Needs Info"}
                  </button>
                </div>
              )}

              {showRejectForm && (
                <div className="bg-[#111827] border border-[#1e293b] rounded-lg p-3 space-y-2" data-testid="reject-form">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Reason for rejection (optional)"
                    rows={2}
                    className="w-full px-3 py-2 bg-[#0a0f1e] border border-[#1e293b] rounded-lg text-white text-sm placeholder-gray-500 focus:border-red-500 focus:outline-none resize-none"
                    data-testid="input-reject-reason"
                  />
                  <button
                    onClick={() => rejectMutation.mutate(rejectReason)}
                    disabled={rejectMutation.isPending}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
                    data-testid="button-submit-reject"
                  >
                    {rejectMutation.isPending ? "Rejecting..." : "Confirm Reject"}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col h-72">
            <div className="p-3 border-b border-[#1e293b] flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-semibold text-gray-300">Chat</h3>
              <span className="text-xs text-gray-500 ml-auto">{messages.length}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                  No messages yet
                </div>
              ) : (
                messages.map((msg: any) => {
                  const isClinicSide = ["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"].includes(msg.senderRole);
                  return (
                    <div key={msg.id} className={`flex ${!isClinicSide ? "justify-end" : "justify-start"}`} data-testid={`chat-message-${msg.id}`}>
                      <div className={`max-w-[80%] rounded-xl px-3 py-2 ${
                        isClinicSide
                          ? "bg-[#111827] border border-[#1e293b] text-gray-200"
                          : "bg-blue-600/20 border border-blue-500/20 text-blue-100"
                      }`}>
                        <p className="text-xs font-medium mb-0.5 opacity-70">{isClinicSide ? "Clinic" : "Dispatch"}</p>
                        <p className="text-sm">{msg.message}</p>
                        <p className="text-[10px] opacity-50 mt-0.5">{new Date(msg.createdAt).toLocaleTimeString()}</p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (messageInput.trim()) sendMessageMutation.mutate(messageInput.trim());
              }}
              className="p-2 border-t border-[#1e293b] flex gap-2"
            >
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Message to clinic..."
                className="flex-1 px-3 py-2 bg-[#0a0f1e] border border-[#1e293b] rounded-lg text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                data-testid="input-dispatch-message"
              />
              <button
                type="submit"
                disabled={sendMessageMutation.isPending || !messageInput.trim()}
                className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
                data-testid="button-dispatch-send"
              >
                {sendMessageMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TripRequestsQueue() {
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [selectedRequest, setSelectedRequest] = useState<any>(null);

  const { data: requests = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/dispatch/trip-requests", statusFilter],
    queryFn: async () => {
      const url = statusFilter
        ? `/api/dispatch/trip-requests?status=${statusFilter}`
        : "/api/dispatch/trip-requests";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 10000,
  });

  return (
    <div className="p-6 space-y-6" data-testid="trip-requests-queue-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3" data-testid="text-page-title">
            <ClipboardList className="w-6 h-6 text-blue-400" />
            Trip Requests Queue
          </h1>
          <p className="text-sm text-gray-400 mt-1">Review and process clinic trip requests</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Filter className="w-4 h-4" />
          {requests.length} requests
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" data-testid="dispatch-status-tabs">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              statusFilter === tab.value
                ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                : "bg-[#111827] text-gray-400 border border-[#1e293b] hover:text-white hover:bg-white/5"
            }`}
            data-testid={`dispatch-tab-${tab.value || "all"}`}
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
        <div className="flex flex-col items-center justify-center py-20 text-gray-500" data-testid="dispatch-empty-state">
          <ClipboardList className="w-12 h-12 mb-4 opacity-50" />
          <p className="text-lg font-medium">No requests found</p>
          <p className="text-sm mt-1">There are no trip requests matching this filter</p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="dispatch-requests-list">
          {requests.map((req: any) => (
            <div
              key={req.id}
              onClick={() => setSelectedRequest(req)}
              className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 hover:border-blue-500/30 transition-all cursor-pointer group"
              data-testid={`dispatch-request-${req.id}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${statusColor(req.status)}`}>
                      <StatusIcon status={req.status} />
                      {req.status.replace("_", " ")}
                    </span>
                    <span className="text-xs text-gray-500">#{req.publicId}</span>
                    <span className="text-xs text-gray-600">•</span>
                    <span className="text-xs text-gray-500">{req.clinicName}</span>
                    {req.cityName && <><span className="text-xs text-gray-600">•</span><span className="text-xs text-gray-500">{req.cityName}</span></>}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    {req.patientName && (
                      <span className="text-gray-300 flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-gray-500" />
                        {req.patientName}
                      </span>
                    )}
                    <span className="text-gray-400 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-gray-500" />
                      {req.scheduledDate} {req.scheduledTime}
                    </span>
                    <span className="text-gray-400 capitalize text-xs">{req.serviceLevel}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
                    <span className="flex items-center gap-1 truncate max-w-[200px]">
                      <MapPin className="w-3 h-3 text-green-500 shrink-0" />
                      {req.pickupAddress}
                    </span>
                    <span className="flex items-center gap-1 truncate max-w-[200px]">
                      <MapPin className="w-3 h-3 text-red-500 shrink-0" />
                      {req.dropoffAddress}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-blue-400 transition-colors shrink-0" />
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedRequest && (
        <RequestDetailDrawer
          request={selectedRequest}
          onClose={() => setSelectedRequest(null)}
        />
      )}
    </div>
  );
}
