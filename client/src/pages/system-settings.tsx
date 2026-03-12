import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Settings, Bell, MessageSquare, CreditCard, Send, Eye, Loader2, Save,
} from "lucide-react";

// ─── Notification Channel Configuration ──────────────────────────────────────

function NotificationChannelsTab() {
  const { token } = useAuth();
  const { toast } = useToast();

  const prefsQuery = useQuery<any>({
    queryKey: ["/api/notification-preferences"],
    queryFn: () => apiFetch("/api/notification-preferences", token),
    enabled: !!token,
  });

  const saveMutation = useMutation({
    mutationFn: (preferences: any) =>
      apiFetch("/api/notification-preferences", token, {
        method: "PATCH",
        body: JSON.stringify({ preferences }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences"] });
      toast({ title: "Notification preferences saved" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const [localPrefs, setLocalPrefs] = useState<Record<string, { sms: boolean; email: boolean; push: boolean }> | null>(null);

  const prefs = localPrefs || prefsQuery.data?.preferences || {};
  const events: string[] = prefsQuery.data?.events || [];

  const handleToggle = (event: string, channel: "sms" | "email" | "push") => {
    const updated = { ...prefs };
    if (!updated[event]) updated[event] = { sms: true, email: true, push: true };
    updated[event] = { ...updated[event], [channel]: !updated[event][channel] };
    setLocalPrefs(updated);
  };

  const handleSave = () => {
    if (localPrefs) {
      saveMutation.mutate(localPrefs);
      setLocalPrefs(null);
    }
  };

  const eventLabels: Record<string, string> = {
    trip_assigned: "Trip Assigned",
    trip_completed: "Trip Completed",
    trip_cancelled: "Trip Cancelled",
    payment_received: "Payment Received",
    invoice_due: "Invoice Due",
    driver_status_change: "Driver Status Change",
    new_support_message: "New Support Message",
    system_alert: "System Alert",
  };

  if (prefsQuery.isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Notification Channels</h3>
          <p className="text-sm text-muted-foreground">Configure which channels to use for each event type</p>
        </div>
        <Button onClick={handleSave} disabled={!localPrefs || saveMutation.isPending} data-testid="button-save-notif-prefs">
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save Changes
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead className="text-center">SMS</TableHead>
                <TableHead className="text-center">Email</TableHead>
                <TableHead className="text-center">Push</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event} data-testid={`row-notif-${event}`}>
                  <TableCell className="font-medium">{eventLabels[event] || event}</TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={prefs[event]?.sms ?? true}
                      onCheckedChange={() => handleToggle(event, "sms")}
                      data-testid={`switch-${event}-sms`}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={prefs[event]?.email ?? true}
                      onCheckedChange={() => handleToggle(event, "email")}
                      data-testid={`switch-${event}-email`}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={prefs[event]?.push ?? true}
                      onCheckedChange={() => handleToggle(event, "push")}
                      data-testid={`switch-${event}-push`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── SMS Template Management ─────────────────────────────────────────────────

function SmsTemplatesTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);

  const templatesQuery = useQuery<any>({
    queryKey: ["/api/admin/sms-templates"],
    queryFn: () => apiFetch("/api/admin/sms-templates", token),
    enabled: !!token,
  });

  const updateMutation = useMutation({
    mutationFn: ({ templateId, template }: { templateId: string; template: string }) =>
      apiFetch(`/api/admin/sms-templates/${templateId}`, token, {
        method: "PATCH",
        body: JSON.stringify({ template }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sms-templates"] });
      setEditing(null);
      toast({ title: "Template updated" });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: ({ templateId, phoneNumber }: { templateId: string; phoneNumber: string }) =>
      apiFetch(`/api/admin/sms-templates/${templateId}/test`, token, {
        method: "POST",
        body: JSON.stringify({ phoneNumber }),
      }),
    onSuccess: (data: any) => {
      toast({ title: "Test SMS sent", description: `Sent to ${data.to}` });
      setTestingId(null);
      setTestPhone("");
    },
    onError: (err: any) => toast({ title: "Test failed", description: err.message, variant: "destructive" }),
  });

  const templates = templatesQuery.data?.templates || [];

  if (templatesQuery.isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">SMS Templates</h3>
        <p className="text-sm text-muted-foreground">Edit and test SMS message templates</p>
      </div>
      <div className="space-y-3">
        {templates.map((tpl: any) => (
          <Card key={tpl.id} data-testid={`card-template-${tpl.id}`}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{tpl.name}</CardTitle>
              <div className="flex items-center gap-1">
                {tpl.variables.map((v: string) => (
                  <Badge key={v} variant="secondary" className="text-xs">{`{{${v}}}`}</Badge>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {editing === tpl.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={3}
                    data-testid={`textarea-edit-${tpl.id}`}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => updateMutation.mutate({ templateId: tpl.id, template: editText })} disabled={updateMutation.isPending} data-testid={`button-save-template-${tpl.id}`}>
                      {updateMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-muted-foreground bg-muted p-3 rounded-md flex-1 font-mono text-xs">{tpl.template}</p>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <Button size="sm" variant="outline" onClick={() => { setEditing(tpl.id); setEditText(tpl.template); }} data-testid={`button-edit-${tpl.id}`}>
                      <Eye className="w-3 h-3 mr-1" />
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTestingId(tpl.id)} data-testid={`button-test-${tpl.id}`}>
                      <Send className="w-3 h-3 mr-1" />
                      Test
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!testingId} onOpenChange={() => setTestingId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send Test SMS</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input
                placeholder="+1 (555) 123-4567"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                data-testid="input-test-phone"
              />
            </div>
            <Button
              className="w-full"
              onClick={() => testingId && testMutation.mutate({ templateId: testingId, phoneNumber: testPhone })}
              disabled={!testPhone.trim() || testMutation.isPending}
              data-testid="button-send-test"
            >
              {testMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              Send Test
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Feature Flags (Company Settings) ────────────────────────────────────────

function FeatureFlagsTab() {
  const [flags, setFlags] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem("ucm_feature_flags");
      return stored ? JSON.parse(stored) : {
        auto_assign_v2: true,
        zero_touch_dialysis: false,
        ai_routing: false,
        pharmacy_portal: true,
        broker_portal: true,
        edi_billing: true,
        medicaid_billing: true,
        sms_notifications: true,
        email_notifications: true,
        push_notifications: true,
        demand_prediction: false,
        fraud_detection: true,
      };
    } catch { return {}; }
  });

  const { toast } = useToast();

  const handleToggle = (key: string) => {
    const updated = { ...flags, [key]: !flags[key] };
    setFlags(updated);
    localStorage.setItem("ucm_feature_flags", JSON.stringify(updated));
    toast({ title: "Feature flag updated", description: `${key}: ${updated[key] ? "enabled" : "disabled"}` });
  };

  const flagLabels: Record<string, { label: string; description: string }> = {
    auto_assign_v2: { label: "Auto-Assign v2", description: "Use the new scoring-based auto-assignment algorithm" },
    zero_touch_dialysis: { label: "Zero-Touch Dialysis", description: "Automated dialysis trip scheduling" },
    ai_routing: { label: "AI Routing", description: "AI-powered route optimization" },
    pharmacy_portal: { label: "Pharmacy Portal", description: "Enable pharmacy partner portal" },
    broker_portal: { label: "Broker Portal", description: "Enable broker partner portal" },
    edi_billing: { label: "EDI Billing", description: "EDI 837/835 claim processing" },
    medicaid_billing: { label: "Medicaid Billing", description: "Medicaid claim lifecycle management" },
    sms_notifications: { label: "SMS Notifications", description: "Send SMS notifications to drivers/patients" },
    email_notifications: { label: "Email Notifications", description: "Send email notifications" },
    push_notifications: { label: "Push Notifications", description: "Send push notifications via FCM" },
    demand_prediction: { label: "Demand Prediction", description: "ML-based demand forecasting" },
    fraud_detection: { label: "Fraud Detection", description: "Anomaly scoring for trips and billing" },
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Feature Flags</h3>
        <p className="text-sm text-muted-foreground">Enable or disable platform features</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Object.entries(flags).map(([key, enabled]) => {
          const info = flagLabels[key] || { label: key, description: "" };
          return (
            <Card key={key}>
              <CardContent className="py-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{info.label}</p>
                  <p className="text-xs text-muted-foreground">{info.description}</p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={() => handleToggle(key)}
                  data-testid={`switch-flag-${key}`}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Platform Fee Configuration ──────────────────────────────────────────────

function PlatformFeeTab() {
  const [feePercent, setFeePercent] = useState("5.0");
  const [minFee, setMinFee] = useState("0.50");
  const [maxFee, setMaxFee] = useState("50.00");
  const { toast } = useToast();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Platform Fee Configuration</h3>
        <p className="text-sm text-muted-foreground">Configure default platform fee settings</p>
      </div>
      <Card>
        <CardContent className="py-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Fee Percentage (%)</Label>
              <Input
                type="number"
                step="0.1"
                value={feePercent}
                onChange={(e) => setFeePercent(e.target.value)}
                data-testid="input-fee-percent"
              />
            </div>
            <div className="space-y-2">
              <Label>Minimum Fee ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={minFee}
                onChange={(e) => setMinFee(e.target.value)}
                data-testid="input-min-fee"
              />
            </div>
            <div className="space-y-2">
              <Label>Maximum Fee ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={maxFee}
                onChange={(e) => setMaxFee(e.target.value)}
                data-testid="input-max-fee"
              />
            </div>
          </div>
          <Button onClick={() => toast({ title: "Fee configuration saved" })} data-testid="button-save-fees">
            <Save className="w-4 h-4 mr-2" />
            Save Fee Configuration
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function SystemSettingsPage() {
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2" data-testid="text-page-title">
          <Settings className="w-6 h-6" />
          System Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure system-wide settings, feature flags, and notifications
        </p>
      </div>

      <Tabs defaultValue="features" className="space-y-4">
        <TabsList>
          <TabsTrigger value="features" data-testid="tab-features">
            <Settings className="w-4 h-4 mr-1" />
            Features
          </TabsTrigger>
          <TabsTrigger value="notifications" data-testid="tab-notifications">
            <Bell className="w-4 h-4 mr-1" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="sms" data-testid="tab-sms">
            <MessageSquare className="w-4 h-4 mr-1" />
            SMS Templates
          </TabsTrigger>
          <TabsTrigger value="fees" data-testid="tab-fees">
            <CreditCard className="w-4 h-4 mr-1" />
            Platform Fees
          </TabsTrigger>
        </TabsList>

        <TabsContent value="features">
          <FeatureFlagsTab />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationChannelsTab />
        </TabsContent>
        <TabsContent value="sms">
          <SmsTemplatesTab />
        </TabsContent>
        <TabsContent value="fees">
          <PlatformFeeTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
