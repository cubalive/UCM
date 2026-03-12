import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import {
  Scale,
  Plus,
  AlertTriangle,
  CheckCircle,
  Clock,
  ArrowUpCircle,
  MessageSquare,
  X,
} from "lucide-react";
import { useState } from "react";

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  IN_REVIEW: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  RESOLVED: "bg-green-500/20 text-green-400 border-green-500/30",
  ESCALATED: "bg-red-500/20 text-red-400 border-red-500/30",
};

const STATUS_ICONS: Record<string, any> = {
  OPEN: Clock,
  IN_REVIEW: AlertTriangle,
  RESOLVED: CheckCircle,
  ESCALATED: ArrowUpCircle,
};

export default function BrokerDisputes() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedDispute, setSelectedDispute] = useState<any>(null);
  const [noteText, setNoteText] = useState("");

  // Create form
  const [formSubject, setFormSubject] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState("GENERAL");
  const [formPriority, setFormPriority] = useState("MEDIUM");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/disputes", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const res = await fetch(resolveUrl(`/api/broker/disputes?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(resolveUrl("/api/broker/disputes"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to create dispute");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker/disputes"] });
      setShowCreateForm(false);
      setFormSubject("");
      setFormDescription("");
      setFormCategory("GENERAL");
      setFormPriority("MEDIUM");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...payload }: any) => {
      const res = await fetch(resolveUrl(`/api/broker/disputes/${id}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to update dispute");
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker/disputes"] });
      setSelectedDispute(result.dispute);
      setNoteText("");
    },
  });

  const handleCreate = () => {
    if (!formSubject.trim() || !formDescription.trim()) return;
    createMutation.mutate({
      subject: formSubject,
      description: formDescription,
      category: formCategory,
      priority: formPriority,
    });
  };

  const handleStatusChange = (disputeId: number, newStatus: string) => {
    updateMutation.mutate({ id: disputeId, status: newStatus });
  };

  const handleAddNote = (disputeId: number) => {
    if (!noteText.trim()) return;
    updateMutation.mutate({ id: disputeId, note: noteText });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-[#1e293b] rounded animate-pulse" />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 h-24 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Scale className="w-5 h-5" /> Dispute Management
          </h1>
          <p className="text-sm text-gray-400 mt-1">Create and manage dispute tickets</p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New Dispute
        </button>
      </div>

      {/* Status filter */}
      <div className="flex gap-2">
        {["ALL", "OPEN", "IN_REVIEW", "RESOLVED", "ESCALATED"].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === s
                ? "bg-blue-600 text-white"
                : "bg-[#0f172a] text-gray-400 hover:text-white border border-[#1e293b]"
            }`}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {/* Create dispute form modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Create New Dispute</h2>
              <button onClick={() => setShowCreateForm(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 uppercase mb-1">Category</label>
                <select
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value)}
                  className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="GENERAL">General</option>
                  <option value="BILLING">Billing</option>
                  <option value="SERVICE_QUALITY">Service Quality</option>
                  <option value="NO_SHOW">No Show</option>
                  <option value="LATE_PICKUP">Late Pickup</option>
                  <option value="SAFETY">Safety</option>
                  <option value="CONTRACT">Contract</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase mb-1">Priority</label>
                <select
                  value={formPriority}
                  onChange={e => setFormPriority(e.target.value)}
                  className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase mb-1">Subject</label>
                <input
                  type="text"
                  value={formSubject}
                  onChange={e => setFormSubject(e.target.value)}
                  placeholder="Brief dispute description..."
                  className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase mb-1">Description</label>
                <textarea
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="Detailed description of the dispute..."
                  rows={4}
                  className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none resize-none"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={createMutation.isPending || !formSubject.trim() || !formDescription.trim()}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {createMutation.isPending ? "Creating..." : "Create Dispute"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dispute detail modal */}
      {selectedDispute && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">{selectedDispute.subject}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_STYLES[selectedDispute.status] || STATUS_STYLES.OPEN}`}>
                    {selectedDispute.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-gray-500">#{selectedDispute.id}</span>
                  <span className="text-xs text-gray-500">{selectedDispute.category}</span>
                  <span className={`text-xs ${selectedDispute.priority === "URGENT" ? "text-red-400" : selectedDispute.priority === "HIGH" ? "text-amber-400" : "text-gray-400"}`}>
                    {selectedDispute.priority}
                  </span>
                </div>
              </div>
              <button onClick={() => setSelectedDispute(null)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-300 mb-4">{selectedDispute.description}</p>

            {/* Status actions */}
            <div className="flex gap-2 mb-6">
              {selectedDispute.status !== "IN_REVIEW" && selectedDispute.status !== "RESOLVED" && (
                <button
                  onClick={() => handleStatusChange(selectedDispute.id, "IN_REVIEW")}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium"
                >
                  Mark In Review
                </button>
              )}
              {selectedDispute.status !== "RESOLVED" && (
                <button
                  onClick={() => handleStatusChange(selectedDispute.id, "RESOLVED")}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium"
                >
                  Resolve
                </button>
              )}
              {selectedDispute.status !== "ESCALATED" && selectedDispute.status !== "RESOLVED" && (
                <button
                  onClick={() => handleStatusChange(selectedDispute.id, "ESCALATED")}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium"
                >
                  Escalate
                </button>
              )}
            </div>

            {/* Timeline */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-white mb-3">Timeline</h3>
              <div className="space-y-2">
                {(selectedDispute.timeline || []).map((entry: any, idx: number) => (
                  <div key={idx} className="flex items-start gap-3 p-2 bg-[#0f172a] rounded-lg">
                    <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-400 shrink-0" />
                    <div>
                      <p className="text-xs text-blue-400 font-medium">{entry.action.replace(/_/g, " ")}</p>
                      <p className="text-xs text-gray-400">{entry.description}</p>
                      <p className="text-[10px] text-gray-600 mt-0.5">{new Date(entry.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <h3 className="text-sm font-semibold text-white mb-3">Notes</h3>
              {(selectedDispute.notes || []).length > 0 && (
                <div className="space-y-2 mb-3">
                  {selectedDispute.notes.map((n: any, idx: number) => (
                    <div key={idx} className="p-2 bg-[#0f172a] rounded-lg">
                      <p className="text-sm text-gray-300">{n.text}</p>
                      <p className="text-[10px] text-gray-600 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder="Add a note..."
                  className="flex-1 bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                  onKeyDown={e => e.key === "Enter" && handleAddNote(selectedDispute.id)}
                />
                <button
                  onClick={() => handleAddNote(selectedDispute.id)}
                  disabled={!noteText.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm flex items-center gap-1"
                >
                  <MessageSquare className="w-3 h-3" /> Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dispute list */}
      {(data?.disputes || []).length === 0 ? (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-12 text-center">
          <Scale className="w-12 h-12 mx-auto mb-3 text-gray-600" />
          <p className="text-gray-500">No disputes found.</p>
          <p className="text-sm text-gray-600 mt-1">Create a dispute to track service issues.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(data?.disputes || []).map((dispute: any) => {
            const Icon = STATUS_ICONS[dispute.status] || Clock;
            return (
              <div
                key={dispute.id}
                onClick={() => setSelectedDispute(dispute)}
                className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 hover:border-blue-500/50 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon className="w-5 h-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-white">{dispute.subject}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500">#{dispute.id}</span>
                        <span className="text-xs text-gray-500">{dispute.category}</span>
                        <span className={`text-xs ${dispute.priority === "URGENT" ? "text-red-400" : dispute.priority === "HIGH" ? "text-amber-400" : "text-gray-400"}`}>
                          {dispute.priority}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_STYLES[dispute.status] || STATUS_STYLES.OPEN}`}>
                      {dispute.status.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] text-gray-600">
                      {new Date(dispute.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
