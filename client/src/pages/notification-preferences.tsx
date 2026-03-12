import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Bell, Save, Loader2, Mail, MessageSquare, Smartphone } from "lucide-react";

const EVENT_LABELS: Record<string, { label: string; description: string }> = {
  trip_assigned: { label: "Trip Assigned", description: "When a new trip is assigned to a driver" },
  trip_completed: { label: "Trip Completed", description: "When a trip is marked as completed" },
  trip_cancelled: { label: "Trip Cancelled", description: "When a trip is cancelled" },
  payment_received: { label: "Payment Received", description: "When a payment is processed" },
  invoice_due: { label: "Invoice Due", description: "When an invoice is approaching its due date" },
  driver_status_change: { label: "Driver Status Change", description: "When a driver goes online/offline" },
  new_support_message: { label: "New Support Message", description: "When a new support message is received" },
  system_alert: { label: "System Alert", description: "System maintenance and updates" },
};

export default function NotificationPreferencesPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [localPrefs, setLocalPrefs] = useState<Record<string, { sms: boolean; email: boolean; push: boolean }> | null>(null);

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
      setLocalPrefs(null);
      toast({ title: "Preferences saved", description: "Your notification preferences have been updated." });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const prefs = localPrefs || prefsQuery.data?.preferences || {};
  const events: string[] = prefsQuery.data?.events || [];

  const handleToggle = (event: string, channel: "sms" | "email" | "push") => {
    const updated = { ...prefs };
    if (!updated[event]) updated[event] = { sms: true, email: true, push: true };
    updated[event] = { ...updated[event], [channel]: !updated[event][channel] };
    setLocalPrefs(updated);
  };

  const handleSave = () => {
    if (localPrefs) saveMutation.mutate(localPrefs);
  };

  const enableAll = () => {
    const updated: typeof prefs = {};
    for (const event of events) {
      updated[event] = { sms: true, email: true, push: true };
    }
    setLocalPrefs(updated);
  };

  const disableAll = () => {
    const updated: typeof prefs = {};
    for (const event of events) {
      updated[event] = { sms: false, email: false, push: false };
    }
    setLocalPrefs(updated);
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2" data-testid="text-page-title">
            <Bell className="w-6 h-6" />
            Notification Preferences
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose how you want to be notified for each event type
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={enableAll} data-testid="button-enable-all">Enable All</Button>
          <Button size="sm" variant="outline" onClick={disableAll} data-testid="button-disable-all">Disable All</Button>
          <Button onClick={handleSave} disabled={!localPrefs || saveMutation.isPending} data-testid="button-save">
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save
          </Button>
        </div>
      </div>

      {prefsQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <MessageSquare className="w-3.5 h-3.5" />
                      SMS
                    </div>
                  </TableHead>
                  <TableHead className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Mail className="w-3.5 h-3.5" />
                      Email
                    </div>
                  </TableHead>
                  <TableHead className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Smartphone className="w-3.5 h-3.5" />
                      Push
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const info = EVENT_LABELS[event] || { label: event, description: "" };
                  return (
                    <TableRow key={event} data-testid={`row-${event}`}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{info.label}</p>
                          <p className="text-xs text-muted-foreground">{info.description}</p>
                        </div>
                      </TableCell>
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
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
