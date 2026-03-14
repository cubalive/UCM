import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/timezone";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  MessageSquare,
  Send,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
    case "PENDING": return <Clock className="w-5 h-5 text-amber-400" />;
    case "NEEDS_INFO": return <HelpCircle className="w-5 h-5 text-orange-400" />;
    case "APPROVED": return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
    case "REJECTED": return <XCircle className="w-5 h-5 text-red-400" />;
    case "CANCELLED": return <AlertTriangle className="w-5 h-5 text-gray-400" />;
    default: return <Clock className="w-5 h-5 text-gray-400" />;
  }
}

export default function ClinicTripRequestDetail() {
  const [, params] = useRoute("/requests/:id");
  const requestId = params?.id;
  const { user } = useAuth();
  const { toast } = useToast();
  const [messageInput, setMessageInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data: request, isLoading } = useQuery<any>({
    queryKey: ["/api/clinic/trip-requests", requestId],
    queryFn: async () => {
      const res = await fetch(`/api/clinic/trip-requests/${requestId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!requestId,
  });

  const { data: chatData, refetch: refetchChat } = useQuery<any>({
    queryKey: ["/api/clinic/trip-requests", requestId, "chat"],
    queryFn: async () => {
      const res = await fetch(`/api/clinic/trip-requests/${requestId}/chat`, { credentials: "include" });
      if (!res.ok) return { thread: null, messages: [] };
      return res.json();
    },
    enabled: !!requestId,
    refetchInterval: 5000,
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
    onError: () => {
      toast({ title: "Failed to send message", variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/clinic/trip-requests/${requestId}/cancel`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/trip-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/trip-requests", requestId] });
      toast({ title: "Trip request cancelled" });
    },
    onError: () => {
      toast({ title: "Failed to cancel request", variant: "destructive" });
    },
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatData?.messages?.length]);

  function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!messageInput.trim()) return;
    sendMessageMutation.mutate(messageInput.trim());
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!request) {
    return (
      <div className="p-6 text-center text-gray-500">
        <p>Trip request not found</p>
        <Link href="/requests">
          <button className="mt-4 text-emerald-400 hover:text-emerald-300 text-sm">Back to requests</button>
        </Link>
      </div>
    );
  }

  const canCancel = request.status === "PENDING" || request.status === "NEEDS_INFO";
  const messages = chatData?.messages || [];

  return (
    <div className="p-6 space-y-6" data-testid="trip-request-detail-page">
      <div className="flex items-center gap-3">
        <Link href="/requests">
          <button className="p-2 hover:bg-white/5 rounded-lg transition-colors" data-testid="button-back">
            <ArrowLeft className="w-5 h-5 text-gray-400" />
          </button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white" data-testid="text-request-title">
            Trip Request #{request.publicId}
          </h1>
          <p className="text-xs text-gray-500">Created {formatDate(request.createdAt)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${statusColor(request.status)}`} data-testid="text-request-status">
          <StatusIcon status={request.status} />
          {request.status.replace("_", " ")}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4" data-testid="request-details-card">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Request Details</h3>

            {request.patientName && (
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="text-sm text-gray-400">Patient</p>
                  <p className="text-white text-sm font-medium" data-testid="text-patient-name">{request.patientName}</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Calendar className="w-4 h-4 text-gray-500" />
              <div>
                <p className="text-sm text-gray-400">Scheduled</p>
                <p className="text-white text-sm font-medium" data-testid="text-schedule">{request.scheduledDate} at {request.scheduledTime}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-green-500 mt-0.5" />
              <div>
                <p className="text-sm text-gray-400">Pickup</p>
                <p className="text-white text-sm" data-testid="text-pickup">{request.pickupAddress}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <p className="text-sm text-gray-400">Dropoff</p>
                <p className="text-white text-sm" data-testid="text-dropoff">{request.dropoffAddress}</p>
              </div>
            </div>

            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-gray-400">Service Level</p>
                <p className="text-white capitalize" data-testid="text-service-level">{request.serviceLevel}</p>
              </div>
              <div>
                <p className="text-gray-400">Passengers</p>
                <p className="text-white" data-testid="text-passengers">{request.passengerCount}</p>
              </div>
              {request.isRoundTrip && (
                <div>
                  <p className="text-gray-400">Type</p>
                  <p className="text-white">Round Trip</p>
                </div>
              )}
            </div>

            {request.notes && (
              <div>
                <p className="text-sm text-gray-400">Notes</p>
                <p className="text-white text-sm" data-testid="text-notes">{request.notes}</p>
              </div>
            )}

            {request.dispatchNotes && (
              <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
                <p className="text-xs text-orange-400 font-medium mb-1">Dispatch Notes</p>
                <p className="text-sm text-orange-200" data-testid="text-dispatch-notes">{request.dispatchNotes}</p>
              </div>
            )}

            {request.rejectedReason && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <p className="text-xs text-red-400 font-medium mb-1">Rejection Reason</p>
                <p className="text-sm text-red-200" data-testid="text-rejection-reason">{request.rejectedReason}</p>
              </div>
            )}

            {request.approvedTripId && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                <p className="text-xs text-emerald-400 font-medium mb-1">Trip Created</p>
                <p className="text-sm text-emerald-200 flex items-center gap-2" data-testid="text-approved-trip">
                  Trip #{request.approvedTripId}
                  <ExternalLink className="w-3.5 h-3.5" />
                </p>
              </div>
            )}
          </div>

          {canCancel && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="w-full py-2.5 bg-red-600/10 border border-red-500/20 text-red-400 hover:bg-red-600/20 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              data-testid="button-cancel-request"
            >
              {cancelMutation.isPending ? "Cancelling..." : "Cancel Request"}
            </button>
          )}
        </div>

        <div className="bg-[#111827] border border-[#1e293b] rounded-xl flex flex-col h-[500px]" data-testid="chat-panel">
          <div className="p-4 border-b border-[#1e293b] flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-gray-300">Messages</h3>
            <span className="text-xs text-gray-500 ml-auto">{messages.length} messages</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="chat-messages">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <MessageSquare className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">No messages yet</p>
                <p className="text-xs mt-1">Send a message to dispatch</p>
              </div>
            ) : (
              messages.map((msg: any) => {
                const isOwnMessage = msg.senderUserId === user?.id;
                const isClinicSide = ["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"].includes(msg.senderRole);
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
                    data-testid={`chat-message-${msg.id}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-xl px-4 py-2.5 ${
                        isClinicSide
                          ? "bg-emerald-600/20 border border-emerald-500/20 text-emerald-100"
                          : "bg-[#0a0f1e] border border-[#1e293b] text-gray-200"
                      }`}
                    >
                      <p className="text-xs font-medium mb-1 opacity-70">
                        {isClinicSide ? "Clinic" : "Dispatch"}
                      </p>
                      <p className="text-sm">{msg.message}</p>
                      <p className="text-[10px] opacity-50 mt-1">
                        {new Date(msg.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleSendMessage} className="p-3 border-t border-[#1e293b] flex gap-2">
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 px-3 py-2 bg-[#0a0f1e] border border-[#1e293b] rounded-lg text-white text-sm placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
              data-testid="input-chat-message"
            />
            <button
              type="submit"
              disabled={sendMessageMutation.isPending || !messageInput.trim()}
              className="p-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              data-testid="button-send-message"
            >
              {sendMessageMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
