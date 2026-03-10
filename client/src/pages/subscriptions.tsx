import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/timezone";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  CreditCard,
  Settings,
  Loader2,
  ExternalLink,
  XCircle,
  CheckCircle,
  AlertTriangle,
  Building2,
} from "lucide-react";

interface SubscriptionSettings {
  monthlySubscriptionEnabled: boolean;
  monthlySubscriptionPriceId: string | null;
  subscriptionRequiredForAccess: boolean;
  gracePeriodDays: number;
}

interface CompanySubscription {
  id: number;
  companyId: number;
  stripeSubscriptionId: string | null;
  stripePriceId: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  lastEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionRow {
  subscription: CompanySubscription;
  companyName: string;
}

function statusBadge(status: string, cancelAtPeriodEnd: boolean) {
  if (cancelAtPeriodEnd && status === "active") {
    return <Badge variant="outline" className="text-orange-600 border-orange-300" data-testid="badge-canceling">Canceling</Badge>;
  }
  switch (status) {
    case "active":
      return <Badge className="bg-green-600" data-testid="badge-active">Active</Badge>;
    case "trialing":
      return <Badge className="bg-emerald-600" data-testid="badge-trialing">Trialing</Badge>;
    case "past_due":
      return <Badge variant="destructive" data-testid="badge-past-due">Past Due</Badge>;
    case "canceled":
      return <Badge variant="secondary" data-testid="badge-canceled">Canceled</Badge>;
    case "incomplete":
      return <Badge variant="outline" data-testid="badge-incomplete">Incomplete</Badge>;
    case "unpaid":
      return <Badge variant="destructive" data-testid="badge-unpaid">Unpaid</Badge>;
    default:
      return <Badge variant="outline" data-testid={`badge-${status}`}>{status}</Badge>;
  }
}

export default function SubscriptionsPage() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localSettings, setLocalSettings] = useState<SubscriptionSettings>({
    monthlySubscriptionEnabled: false,
    monthlySubscriptionPriceId: null,
    subscriptionRequiredForAccess: false,
    gracePeriodDays: 0,
  });

  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  if (!isSuperAdmin) {
    return (
      <div className="p-6" data-testid="subscriptions-no-access">
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Subscription management requires Super Admin access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const settingsQuery = useQuery<SubscriptionSettings>({
    queryKey: ["/api/admin/subscriptions/settings"],
    queryFn: () => apiFetch("/api/admin/subscriptions/settings", token),
  });

  const subsQuery = useQuery<SubscriptionRow[]>({
    queryKey: ["/api/admin/subscriptions"],
    queryFn: () => apiFetch("/api/admin/subscriptions", token),
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setLocalSettings(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  const updateSettingsMutation = useMutation({
    mutationFn: (data: Partial<SubscriptionSettings>) =>
      apiFetch("/api/admin/subscriptions/settings", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscriptions/settings"] });
      toast({ title: "Settings updated" });
      setSettingsOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: (companyId: number) =>
      apiFetch(`/api/admin/subscriptions/company/${companyId}/checkout`, token, {
        method: "POST",
      }),
    onSuccess: (data: { url: string }) => {
      window.open(data.url, "_blank");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: (companyId: number) =>
      apiFetch(`/api/admin/subscriptions/company/${companyId}/portal`, token, {
        method: "POST",
      }),
    onSuccess: (data: { url: string }) => {
      window.open(data.url, "_blank");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (companyId: number) =>
      apiFetch(`/api/admin/subscriptions/company/${companyId}/cancel`, token, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscriptions"] });
      toast({ title: "Subscription set to cancel at period end" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const settings = settingsQuery.data;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" data-testid="subscriptions-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <CreditCard className="h-6 w-6" />
            Company Subscriptions
          </h1>
          <p className="text-muted-foreground mt-1">Manage monthly subscription billing for companies</p>
        </div>
        <Button
          variant="outline"
          onClick={() => setSettingsOpen(true)}
          data-testid="button-open-settings"
        >
          <Settings className="h-4 w-4 mr-2" />
          Settings
        </Button>
      </div>

      {settingsQuery.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : settings ? (
        <Card data-testid="card-settings-summary">
          <CardContent className="p-4 flex flex-wrap gap-6 items-center">
            <div className="flex items-center gap-2">
              {settings.monthlySubscriptionEnabled ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <XCircle className="h-5 w-5 text-gray-400" />
              )}
              <span className="text-sm font-medium" data-testid="text-subscription-status">
                Subscriptions {settings.monthlySubscriptionEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            {settings.monthlySubscriptionPriceId && (
              <div className="text-sm text-muted-foreground" data-testid="text-price-id">
                Price: <code className="bg-muted px-1 rounded">{settings.monthlySubscriptionPriceId}</code>
              </div>
            )}
            <div className="text-sm text-muted-foreground" data-testid="text-access-required">
              {settings.subscriptionRequiredForAccess ? (
                <Badge variant="outline" className="text-orange-600 border-orange-300">Access Required</Badge>
              ) : (
                <span>Access not gated</span>
              )}
            </div>
            {settings.gracePeriodDays > 0 && (
              <div className="text-sm text-muted-foreground" data-testid="text-grace-period">
                Grace: {settings.gracePeriodDays} days
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card data-testid="card-subscriptions-table">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Active Subscriptions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {subsQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : subsQuery.data && subsQuery.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Period End</TableHead>
                  <TableHead>Stripe ID</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subsQuery.data.map((row) => (
                  <TableRow key={row.subscription.id} data-testid={`row-subscription-${row.subscription.companyId}`}>
                    <TableCell className="font-medium" data-testid={`text-company-${row.subscription.companyId}`}>
                      {row.companyName}
                    </TableCell>
                    <TableCell>
                      {statusBadge(row.subscription.status, row.subscription.cancelAtPeriodEnd)}
                    </TableCell>
                    <TableCell data-testid={`text-period-end-${row.subscription.companyId}`}>
                      {row.subscription.currentPeriodEnd
                        ? formatDate(row.subscription.currentPeriodEnd)
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground" data-testid={`text-stripe-id-${row.subscription.companyId}`}>
                      {row.subscription.stripeSubscriptionId
                        ? `${row.subscription.stripeSubscriptionId.substring(0, 20)}...`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => portalMutation.mutate(row.subscription.companyId)}
                        disabled={portalMutation.isPending}
                        data-testid={`button-portal-${row.subscription.companyId}`}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Portal
                      </Button>
                      {["active", "trialing"].includes(row.subscription.status) && !row.subscription.cancelAtPeriodEnd && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            if (confirm("Cancel this subscription at period end?")) {
                              cancelMutation.mutate(row.subscription.companyId);
                            }
                          }}
                          disabled={cancelMutation.isPending}
                          data-testid={`button-cancel-${row.subscription.companyId}`}
                        >
                          <XCircle className="h-3 w-3 mr-1" />
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-subscriptions">
              <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No company subscriptions yet.</p>
              <p className="text-sm mt-1">Use Stripe Checkout to create subscriptions for companies.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-subscription-settings">
          <DialogHeader>
            <DialogTitle>Subscription Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <Label htmlFor="sub-enabled">Enable Monthly Subscriptions</Label>
              <Switch
                id="sub-enabled"
                checked={localSettings.monthlySubscriptionEnabled}
                onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, monthlySubscriptionEnabled: v }))}
                data-testid="switch-subscription-enabled"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price-id">Stripe Price ID</Label>
              <Input
                id="price-id"
                placeholder="price_1Ab2Cd3Ef..."
                value={localSettings.monthlySubscriptionPriceId || ""}
                onChange={(e) => setLocalSettings((s) => ({ ...s, monthlySubscriptionPriceId: e.target.value || null }))}
                data-testid="input-price-id"
              />
              <p className="text-xs text-muted-foreground">The Stripe recurring price ID to bill companies.</p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="access-required">Require Subscription for Access</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Block company users if no active subscription.</p>
              </div>
              <Switch
                id="access-required"
                checked={localSettings.subscriptionRequiredForAccess}
                onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, subscriptionRequiredForAccess: v }))}
                data-testid="switch-access-required"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grace-days">Grace Period (days)</Label>
              <Input
                id="grace-days"
                type="number"
                min={0}
                value={localSettings.gracePeriodDays}
                onChange={(e) => setLocalSettings((s) => ({ ...s, gracePeriodDays: parseInt(e.target.value) || 0 }))}
                data-testid="input-grace-days"
              />
              <p className="text-xs text-muted-foreground">Days to allow access after payment fails.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)} data-testid="button-cancel-settings">
              Cancel
            </Button>
            <Button
              onClick={() => updateSettingsMutation.mutate(localSettings)}
              disabled={updateSettingsMutation.isPending}
              data-testid="button-save-settings"
            >
              {updateSettingsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
