import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import {
  Settings,
  Key,
  Webhook,
  Users,
  Bell,
  CreditCard,
  RefreshCw,
  Copy,
  Plus,
  Trash2,
  Check,
} from "lucide-react";
import { useState } from "react";

export default function BrokerSettings() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"api" | "webhooks" | "team" | "notifications" | "billing">("api");
  const [copied, setCopied] = useState(false);

  // Webhook form
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/settings"],
    queryFn: async () => {
      const res = await fetch(resolveUrl("/api/broker/settings"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(resolveUrl("/api/broker/settings"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker/settings"] });
    },
  });

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleNotification = (key: string, value: boolean) => {
    const current = data?.settings?.notifications || {};
    updateMutation.mutate({
      notifications: { ...current, [key]: value },
    });
  };

  const handleAddWebhook = () => {
    if (!webhookUrl.trim()) return;
    const current = data?.settings?.webhooks || [];
    updateMutation.mutate({
      webhooks: [
        ...current,
        {
          id: Date.now(),
          url: webhookUrl,
          events: webhookEvents.length > 0 ? webhookEvents : ["ALL"],
          status: "ACTIVE",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    setWebhookUrl("");
    setWebhookEvents([]);
  };

  const handleDeleteWebhook = (webhookId: number) => {
    const current = data?.settings?.webhooks || [];
    updateMutation.mutate({
      webhooks: current.filter((w: any) => w.id !== webhookId),
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-[#1e293b] rounded animate-pulse" />
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl h-96 animate-pulse" />
      </div>
    );
  }

  const settings = data?.settings || {};
  const broker = data?.broker;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5" /> Settings & Configuration
        </h1>
        <p className="text-sm text-gray-400 mt-1">Manage API keys, webhooks, team, and preferences</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0f172a] rounded-lg p-1 w-fit flex-wrap">
        {([
          { key: "api", label: "API Keys", icon: Key },
          { key: "webhooks", label: "Webhooks", icon: Webhook },
          { key: "team", label: "Team", icon: Users },
          { key: "notifications", label: "Notifications", icon: Bell },
          { key: "billing", label: "Billing", icon: CreditCard },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
              tab === t.key ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* API Keys */}
      {tab === "api" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4">API Key Management</h2>
          <div className="space-y-4">
            {(settings.apiKeys || []).map((key: any) => (
              <div key={key.id} className="flex items-center justify-between p-4 bg-[#0f172a] rounded-lg border border-[#1e293b]">
                <div>
                  <p className="text-sm font-medium text-white">{key.name}</p>
                  <p className="font-mono text-xs text-gray-400 mt-1">{key.keyPrefix}</p>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500">
                    <span>Created: {new Date(key.createdAt).toLocaleDateString()}</span>
                    <span>Last used: {key.lastUsed ? new Date(key.lastUsed).toLocaleDateString() : "Never"}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                      key.status === "ACTIVE" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                    }`}>
                      {key.status}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopyKey(key.keyPrefix)}
                    className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-400 hover:text-white"
                    title="Copy key"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-400 hover:text-amber-400"
                    title="Regenerate key"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            <p className="text-xs text-gray-500">
              API keys are used to authenticate requests to the Broker API. Keep your keys secure and never share them publicly.
            </p>
          </div>
        </div>
      )}

      {/* Webhooks */}
      {tab === "webhooks" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4">Webhook Configuration</h2>

          {/* Add webhook form */}
          <div className="p-4 bg-[#0f172a] rounded-lg border border-[#1e293b] mb-4">
            <p className="text-xs text-gray-500 uppercase mb-3">Add New Webhook</p>
            <div className="flex gap-3">
              <input
                type="url"
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
                placeholder="https://your-server.com/webhook"
                className="flex-1 bg-[#111827] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={handleAddWebhook}
                disabled={!webhookUrl.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {["TRIP_CREATED", "TRIP_AWARDED", "TRIP_COMPLETED", "BID_RECEIVED", "SETTLEMENT_GENERATED"].map(event => (
                <label key={event} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={webhookEvents.includes(event)}
                    onChange={e => {
                      if (e.target.checked) {
                        setWebhookEvents(prev => [...prev, event]);
                      } else {
                        setWebhookEvents(prev => prev.filter(ev => ev !== event));
                      }
                    }}
                    className="rounded border-gray-600 bg-[#111827] text-blue-600"
                  />
                  <span className="text-xs text-gray-400">{event.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Existing webhooks */}
          <div className="space-y-3">
            {(settings.webhooks || []).length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Webhook className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No webhooks configured yet.</p>
              </div>
            ) : (
              (settings.webhooks || []).map((wh: any) => (
                <div key={wh.id} className="flex items-center justify-between p-3 bg-[#0f172a] rounded-lg border border-[#1e293b]">
                  <div>
                    <p className="text-sm font-mono text-white">{wh.url}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                        wh.status === "ACTIVE" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                      }`}>
                        {wh.status}
                      </span>
                      <span className="text-[10px] text-gray-500">
                        Events: {(wh.events || []).join(", ")}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteWebhook(wh.id)}
                    className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-gray-400 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Team */}
      {tab === "team" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4">Team Member Management</h2>
          <div className="space-y-4">
            {/* Current broker info */}
            {broker && (
              <div className="p-4 bg-[#0f172a] rounded-lg border border-[#1e293b]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                    {broker.name?.[0]?.toUpperCase() || "B"}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{broker.contactName || broker.name}</p>
                    <p className="text-xs text-gray-400">{broker.email}</p>
                  </div>
                  <span className="ml-auto px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px] font-medium">
                    ADMIN
                  </span>
                </div>
              </div>
            )}

            {(settings.teamMembers || []).length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No additional team members added.</p>
                <p className="text-xs text-gray-600 mt-1">Team member invitations coming soon.</p>
              </div>
            )}

            <div className="border-t border-[#1e293b] pt-4">
              <button
                className="px-4 py-2 border border-dashed border-[#1e293b] hover:border-blue-500/50 text-gray-400 hover:text-white rounded-lg text-sm transition-colors flex items-center gap-2 w-full justify-center"
              >
                <Plus className="w-4 h-4" /> Invite Team Member
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notifications */}
      {tab === "notifications" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4">Notification Preferences</h2>
          <div className="space-y-3">
            {[
              { key: "emailOnNewBid", label: "Email on new bid received", description: "Get notified when a provider submits a bid on your trip request" },
              { key: "emailOnTripComplete", label: "Email on trip completion", description: "Receive email when a trip is marked as completed" },
              { key: "emailOnSLAViolation", label: "Email on SLA violation", description: "Alert when a provider misses an SLA target" },
              { key: "emailOnSettlement", label: "Email on settlement ready", description: "Notification when a settlement is generated and ready for review" },
              { key: "smsOnUrgentTrip", label: "SMS for urgent trips", description: "Receive SMS for urgent or STAT priority trip requests" },
            ].map(pref => (
              <div key={pref.key} className="flex items-center justify-between p-4 bg-[#0f172a] rounded-lg">
                <div>
                  <p className="text-sm text-white">{pref.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{pref.description}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.notifications?.[pref.key] ?? false}
                    onChange={e => handleToggleNotification(pref.key, e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#1e293b] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 peer-checked:after:bg-white" />
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Billing */}
      {tab === "billing" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4">Billing Settings</h2>
          <div className="space-y-4">
            <div className="p-4 bg-[#0f172a] rounded-lg border border-[#1e293b]">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="w-4 h-4 text-gray-400" />
                <p className="text-sm font-medium text-white">Payment Method</p>
              </div>
              {settings.billing?.paymentMethod ? (
                <p className="text-sm text-gray-300">{settings.billing.paymentMethod}</p>
              ) : (
                <p className="text-sm text-gray-500">No payment method on file. Configure via Stripe.</p>
              )}
            </div>

            <div className="p-4 bg-[#0f172a] rounded-lg border border-[#1e293b]">
              <p className="text-xs text-gray-500 uppercase mb-2">Billing Email</p>
              <p className="text-sm text-white">{settings.billing?.billingEmail || broker?.email || "Not set"}</p>
            </div>

            <div className="flex items-center justify-between p-4 bg-[#0f172a] rounded-lg border border-[#1e293b]">
              <div>
                <p className="text-sm text-white">Auto-Pay</p>
                <p className="text-xs text-gray-500">Automatically pay settlements when approved</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.billing?.autoPayEnabled ?? false}
                  onChange={e => {
                    const current = settings.billing || {};
                    updateMutation.mutate({
                      billing: { ...current, autoPayEnabled: e.target.checked },
                    });
                  }}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#1e293b] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 peer-checked:after:bg-white" />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
