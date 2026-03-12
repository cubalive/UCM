import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import {
  MessageSquare,
  Send,
  Megaphone,
  FileText,
  Mail,
  Users,
} from "lucide-react";
import { useState } from "react";

export default function BrokerCommunications() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"threads" | "compose" | "templates">("threads");
  const [selectedThread, setSelectedThread] = useState<any>(null);

  // Compose form state
  const [recipientCompanyId, setRecipientCompanyId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isBroadcast, setIsBroadcast] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/messages"],
    queryFn: async () => {
      const res = await fetch(resolveUrl("/api/broker/messages"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: templatesData } = useQuery({
    queryKey: ["/api/broker/message-templates"],
    queryFn: async () => {
      const res = await fetch(resolveUrl("/api/broker/message-templates"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: tab === "templates" || tab === "compose",
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(resolveUrl("/api/broker/messages"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker/messages"] });
      setSubject("");
      setBody("");
      setRecipientCompanyId("");
      setIsBroadcast(false);
      setTab("threads");
    },
  });

  const handleSend = () => {
    if (!subject.trim() || !body.trim()) return;
    sendMutation.mutate({
      recipientCompanyId: isBroadcast ? null : Number(recipientCompanyId),
      subject,
      body,
      isBroadcast,
    });
  };

  const applyTemplate = (template: any) => {
    setSubject(template.subject);
    setBody(template.body);
    setTab("compose");
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-[#1e293b] rounded animate-pulse" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 h-20 animate-pulse" />
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
            <MessageSquare className="w-5 h-5" /> Communications
          </h1>
          <p className="text-sm text-gray-400 mt-1">Messaging with transport providers</p>
        </div>
        <button
          onClick={() => setTab("compose")}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Send className="w-4 h-4" /> New Message
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0f172a] rounded-lg p-1 w-fit">
        {(["threads", "compose", "templates"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors capitalize ${
              tab === t ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Threads */}
      {tab === "threads" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Thread list */}
          <div className="lg:col-span-1 bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
            <div className="p-3 border-b border-[#1e293b]">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Users className="w-4 h-4" /> Provider Threads
              </h2>
            </div>
            <div className="divide-y divide-[#1e293b] max-h-[500px] overflow-y-auto">
              {(data?.threads || []).length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-sm">
                  No provider threads yet. Start by sending a message.
                </div>
              ) : (
                (data?.threads || []).map((thread: any) => (
                  <button
                    key={thread.companyId}
                    onClick={() => setSelectedThread(thread)}
                    className={`w-full text-left p-3 hover:bg-white/5 transition-colors ${
                      selectedThread?.companyId === thread.companyId ? "bg-blue-600/10 border-l-2 border-blue-500" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-white">{thread.companyName}</p>
                      {thread.unreadCount > 0 && (
                        <span className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-[10px] text-white font-bold">
                          {thread.unreadCount}
                        </span>
                      )}
                    </div>
                    {thread.lastMessage && (
                      <p className="text-xs text-gray-500 mt-1 truncate">{thread.lastMessage.subject}</p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Message detail / content */}
          <div className="lg:col-span-2 bg-[#111827] border border-[#1e293b] rounded-xl p-4">
            {selectedThread ? (
              <div>
                <h3 className="text-sm font-semibold text-white mb-4">{selectedThread.companyName}</h3>
                {(() => {
                  const threadMessages = (data?.messages || []).filter(
                    (m: any) => m.recipientCompanyId === selectedThread.companyId || m.senderCompanyId === selectedThread.companyId
                  );
                  if (threadMessages.length === 0) {
                    return (
                      <div className="text-center py-12 text-gray-500">
                        <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p>No messages in this thread yet.</p>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-3 max-h-[400px] overflow-y-auto">
                      {threadMessages.map((msg: any) => (
                        <div key={msg.id} className="p-3 bg-[#0f172a] rounded-lg">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-medium text-blue-400">{msg.subject}</p>
                            <span className="text-[10px] text-gray-600">
                              {new Date(msg.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm text-gray-300">{msg.body}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="text-center py-16 text-gray-500">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Select a thread to view messages</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Compose */}
      {tab === "compose" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4">Compose Message</h2>
          <div className="space-y-4">
            {/* Broadcast toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isBroadcast}
                onChange={e => setIsBroadcast(e.target.checked)}
                className="rounded border-gray-600 bg-[#0f172a] text-blue-600"
              />
              <span className="text-sm text-gray-300 flex items-center gap-1">
                <Megaphone className="w-4 h-4 text-amber-400" />
                Broadcast to all providers
              </span>
            </label>

            {/* Recipient */}
            {!isBroadcast && (
              <div>
                <label className="block text-xs text-gray-500 uppercase mb-1">Recipient</label>
                <select
                  value={recipientCompanyId}
                  onChange={e => setRecipientCompanyId(e.target.value)}
                  className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select provider...</option>
                  {(data?.threads || []).map((t: any) => (
                    <option key={t.companyId} value={t.companyId}>{t.companyName}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Subject */}
            <div>
              <label className="block text-xs text-gray-500 uppercase mb-1">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Message subject..."
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Body */}
            <div>
              <label className="block text-xs text-gray-500 uppercase mb-1">Message</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Type your message..."
                rows={6}
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none resize-none"
              />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                {isBroadcast ? "This will be sent to all contracted providers" : ""}
              </p>
              <button
                onClick={handleSend}
                disabled={sendMutation.isPending || !subject.trim() || !body.trim()}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                {sendMutation.isPending ? "Sending..." : "Send Message"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Templates */}
      {tab === "templates" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <FileText className="w-4 h-4" /> Message Templates
          </h2>
          <div className="space-y-3">
            {(templatesData?.templates || []).map((template: any) => (
              <div key={template.id} className="p-4 bg-[#0f172a] rounded-lg border border-[#1e293b]">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-white">{template.name}</p>
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/20 text-blue-400 mt-1">
                      {template.category}
                    </span>
                  </div>
                  <button
                    onClick={() => applyTemplate(template)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    Use Template
                  </button>
                </div>
                <div className="mt-2 p-2 bg-[#111827] rounded text-xs text-gray-400">
                  <p className="font-medium text-gray-300 mb-1">Subject: {template.subject}</p>
                  <p className="whitespace-pre-wrap">{template.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
