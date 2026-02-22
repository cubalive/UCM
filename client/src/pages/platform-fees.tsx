import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign,
  Settings,
  Loader2,
  Pencil,
  Trash2,
  Building2,
  CreditCard,
  ExternalLink,
  XCircle,
  CheckCircle,
  RotateCcw,
  Play,
  ShieldCheck,
  ShieldOff,
  Sliders,
  Plus,
  Ban,
} from "lucide-react";

interface GlobalSettings {
  id: number;
  enabled: boolean;
  defaultFeeType: "PERCENT" | "FIXED";
  defaultFeePercent: string;
  defaultFeeCents: number;
  updatedAt: string;
}

interface CompanyOverride {
  companyId: number;
  companyName: string;
  hasOverride: boolean;
  override: {
    companyId: number;
    enabled: boolean | null;
    feeType: "PERCENT" | "FIXED" | null;
    feePercent: string | null;
    feeCents: number | null;
    updatedAt: string;
  } | null;
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

interface CompanySubSettings {
  companyId: number;
  subscriptionEnabled: boolean;
  subscriptionRequiredForAccess: boolean;
  monthlyFeeCents: number;
  updatedAt: string;
}

interface CompanyDetail {
  subscription: CompanySubscription | null;
  settings: CompanySubSettings | null;
  access: { allowed: boolean; reason?: string };
}

interface FeeRule {
  id: number;
  scopeType: "global" | "company" | "clinic" | "company_clinic";
  companyId: number | null;
  clinicId: number | null;
  serviceLevel: string | null;
  feeType: "percent" | "fixed" | "percent_plus_fixed";
  percentBps: number;
  fixedFeeCents: number;
  minFeeCents: number | null;
  maxFeeCents: number | null;
  isEnabled: boolean;
  priority: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  notes: string | null;
  calculationBase: string | null;
  feeDirection: string | null;
  beneficiary: string | null;
  settlementStage: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

type ScopeType = "global" | "company" | "clinic" | "company_clinic";
type FeeType = "percent" | "fixed" | "percent_plus_fixed";

const SCOPE_LABELS: Record<ScopeType, string> = {
  global: "Global",
  company: "Company",
  clinic: "Clinic",
  company_clinic: "Company + Clinic",
};

const FEE_TYPE_LABELS: Record<FeeType, string> = {
  percent: "Percentage",
  fixed: "Fixed",
  percent_plus_fixed: "Percent + Fixed",
};

function feeRuleScopeBadge(scope: ScopeType) {
  const variants: Record<ScopeType, string> = {
    global: "bg-blue-600",
    company: "bg-emerald-600",
    clinic: "bg-purple-600",
    company_clinic: "bg-orange-600",
  };
  return (
    <Badge className={variants[scope]} data-testid={`badge-fr-scope-${scope}`}>
      {SCOPE_LABELS[scope]}
    </Badge>
  );
}

function formatRuleRate(rule: FeeRule): string {
  const pct = (rule.percentBps / 100).toFixed(2);
  const fixed = (rule.fixedFeeCents / 100).toFixed(2);
  switch (rule.feeType) {
    case "percent":
      return `${pct}%`;
    case "fixed":
      return `$${fixed}`;
    case "percent_plus_fixed":
      return `${pct}% + $${fixed}`;
    default:
      return "-";
  }
}

function formatCentsVal(cents: number | null): string {
  if (cents == null) return "-";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDateVal(d: string | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString();
}

const emptyFeeRuleForm = {
  scopeType: "global" as ScopeType,
  companyId: "",
  clinicId: "",
  serviceLevel: "",
  feeType: "percent" as FeeType,
  percentInput: "0",
  fixedInput: "0",
  minFeeInput: "",
  maxFeeInput: "",
  isEnabled: true,
  priority: "0",
  effectiveFrom: "",
  effectiveTo: "",
  notes: "",
};

function formatFee(type: string, percent: string | number, cents: number): string {
  if (type === "PERCENT") return `${percent}%`;
  return `$${(cents / 100).toFixed(2)} flat`;
}

function subscriptionStatusBadge(status: string, cancelAtPeriodEnd: boolean) {
  if (cancelAtPeriodEnd && status === "active") {
    return <Badge variant="outline" className="text-orange-600 border-orange-300" data-testid="badge-canceling">Canceling</Badge>;
  }
  switch (status) {
    case "active":
      return <Badge className="bg-green-600" data-testid="badge-active">Active</Badge>;
    case "trialing":
      return <Badge className="bg-blue-600" data-testid="badge-trialing">Trialing</Badge>;
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

export default function PlatformFeesPage() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [editCompanyId, setEditCompanyId] = useState<number | null>(null);
  const [editData, setEditData] = useState<{
    enabled: boolean;
    feeType: "PERCENT" | "FIXED";
    feePercent: string;
    feeCents: string;
  }>({ enabled: true, feeType: "PERCENT", feePercent: "0", feeCents: "0" });

  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [activeTab, setActiveTab] = useState("fees");

  const [frDialogOpen, setFrDialogOpen] = useState(false);
  const [frEditingId, setFrEditingId] = useState<number | null>(null);
  const [frForm, setFrForm] = useState({ ...emptyFeeRuleForm });
  const [frFilterScope, setFrFilterScope] = useState("all");
  const [frFilterEnabled, setFrFilterEnabled] = useState("all");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "subscription") setActiveTab("subscription");
    else if (tab === "fee-rules") setActiveTab("fee-rules");
  }, []);

  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  if (!isSuperAdmin) {
    return (
      <div className="p-6" data-testid="platform-fees-no-access">
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Platform fee management requires Super Admin access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const settingsQuery = useQuery<GlobalSettings>({
    queryKey: ["/api/admin/platform-fee/settings"],
    queryFn: () => apiFetch("/api/admin/platform-fee/settings", token),
    enabled: !!token,
  });

  const companiesQuery = useQuery<CompanyOverride[]>({
    queryKey: ["/api/admin/platform-fee/companies"],
    queryFn: () => apiFetch("/api/admin/platform-fee/companies", token),
    enabled: !!token,
  });

  const subsQuery = useQuery<SubscriptionRow[]>({
    queryKey: ["/api/admin/subscriptions"],
    queryFn: () => apiFetch("/api/admin/subscriptions", token),
    enabled: !!token,
  });

  const companyDetailQuery = useQuery<CompanyDetail>({
    queryKey: ["/api/admin/subscriptions/company", selectedCompanyId],
    queryFn: () => apiFetch(`/api/admin/subscriptions/company/${selectedCompanyId}`, token),
    enabled: !!token && !!selectedCompanyId,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (data: Partial<GlobalSettings>) =>
      apiFetch("/api/admin/platform-fee/settings", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-fee/settings"] });
      toast({ title: "Global settings updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateCompanyMutation = useMutation({
    mutationFn: ({ companyId, data }: { companyId: number; data: any }) =>
      apiFetch(`/api/admin/platform-fee/companies/${companyId}`, token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-fee/companies"] });
      setEditCompanyId(null);
      toast({ title: "Company override saved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const startSubMutation = useMutation({
    mutationFn: (companyId: number) =>
      apiFetch(`/api/admin/subscriptions/company/${companyId}/start`, token, { method: "POST" }),
    onSuccess: (data: { url: string }) => {
      window.open(data.url, "_blank");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const portalMutation = useMutation({
    mutationFn: (companyId: number) =>
      apiFetch(`/api/admin/subscriptions/company/${companyId}/portal`, token, { method: "POST" }),
    onSuccess: (data: { url: string }) => {
      window.open(data.url, "_blank");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const cancelSubMutation = useMutation({
    mutationFn: (companyId: number) =>
      apiFetch(`/api/admin/subscriptions/company/${companyId}/cancel`, token, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscriptions/company", selectedCompanyId] });
      toast({ title: "Subscription set to cancel at period end" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const reactivateSubMutation = useMutation({
    mutationFn: (companyId: number) =>
      apiFetch(`/api/admin/subscriptions/company/${companyId}/reactivate`, token, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscriptions/company", selectedCompanyId] });
      toast({ title: "Subscription reactivated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateSubSettingsMutation = useMutation({
    mutationFn: ({ companyId, data }: { companyId: number; data: any }) =>
      apiFetch(`/api/admin/subscriptions/company/${companyId}/settings`, token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscriptions/company", selectedCompanyId] });
      toast({ title: "Subscription settings updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const frBuildQuery = () => {
    const params = new URLSearchParams();
    if (frFilterScope !== "all") params.set("scopeType", frFilterScope);
    if (frFilterEnabled !== "all") params.set("isEnabled", frFilterEnabled);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  const feeRulesQuery = useQuery<{ rules: FeeRule[] }>({
    queryKey: ["/api/admin/fee-rules", frFilterScope, frFilterEnabled],
    queryFn: () => apiFetch(`/api/admin/fee-rules${frBuildQuery()}`, token),
    enabled: !!token && activeTab === "fee-rules",
  });

  const frCreateMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/admin/fee-rules", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fee-rules"] });
      setFrDialogOpen(false);
      setFrEditingId(null);
      toast({ title: "Fee rule created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const frUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiFetch(`/api/admin/fee-rules/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fee-rules"] });
      setFrDialogOpen(false);
      setFrEditingId(null);
      toast({ title: "Fee rule updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const frDisableMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/admin/fee-rules/${id}/disable`, token, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fee-rules"] });
      toast({ title: "Fee rule disabled" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const frToggleMutation = useMutation({
    mutationFn: ({ id, isEnabled }: { id: number; isEnabled: boolean }) =>
      apiFetch(`/api/admin/fee-rules/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ isEnabled }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fee-rules"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const frOpenCreate = () => {
    setFrEditingId(null);
    setFrForm({ ...emptyFeeRuleForm });
    setFrDialogOpen(true);
  };

  const frOpenEdit = (rule: FeeRule) => {
    setFrEditingId(rule.id);
    setFrForm({
      scopeType: rule.scopeType,
      companyId: rule.companyId != null ? String(rule.companyId) : "",
      clinicId: rule.clinicId != null ? String(rule.clinicId) : "",
      serviceLevel: rule.serviceLevel || "",
      feeType: rule.feeType,
      percentInput: (rule.percentBps / 100).toFixed(2),
      fixedInput: (rule.fixedFeeCents / 100).toFixed(2),
      minFeeInput: rule.minFeeCents != null ? (rule.minFeeCents / 100).toFixed(2) : "",
      maxFeeInput: rule.maxFeeCents != null ? (rule.maxFeeCents / 100).toFixed(2) : "",
      isEnabled: rule.isEnabled,
      priority: String(rule.priority),
      effectiveFrom: rule.effectiveFrom ? rule.effectiveFrom.split("T")[0] : "",
      effectiveTo: rule.effectiveTo ? rule.effectiveTo.split("T")[0] : "",
      notes: rule.notes || "",
    });
    setFrDialogOpen(true);
  };

  const frHandleSubmit = () => {
    const payload: any = {
      scopeType: frForm.scopeType,
      feeType: frForm.feeType,
      percentBps: Math.round(parseFloat(frForm.percentInput || "0") * 100),
      fixedFeeCents: Math.round(parseFloat(frForm.fixedInput || "0") * 100),
      minFeeCents: frForm.minFeeInput ? Math.round(parseFloat(frForm.minFeeInput) * 100) : null,
      maxFeeCents: frForm.maxFeeInput ? Math.round(parseFloat(frForm.maxFeeInput) * 100) : null,
      isEnabled: frForm.isEnabled,
      priority: parseInt(frForm.priority || "0", 10),
      effectiveFrom: frForm.effectiveFrom || null,
      effectiveTo: frForm.effectiveTo || null,
      notes: frForm.notes || null,
      companyId: frForm.companyId ? parseInt(frForm.companyId, 10) : null,
      clinicId: frForm.clinicId ? parseInt(frForm.clinicId, 10) : null,
      serviceLevel: frForm.serviceLevel || null,
    };

    if (frEditingId) {
      frUpdateMutation.mutate({ id: frEditingId, data: payload });
    } else {
      frCreateMutation.mutate(payload);
    }
  };

  const feeRulesList = feeRulesQuery.data?.rules || [];
  const frIsSaving = frCreateMutation.isPending || frUpdateMutation.isPending;
  const frShowCompanyField = frForm.scopeType === "company" || frForm.scopeType === "company_clinic";
  const frShowClinicField = frForm.scopeType === "clinic" || frForm.scopeType === "company_clinic";
  const frShowPercentField = frForm.feeType === "percent" || frForm.feeType === "percent_plus_fixed";
  const frShowFixedField = frForm.feeType === "fixed" || frForm.feeType === "percent_plus_fixed";

  const settings = settingsQuery.data;

  const openEditOverride = (c: CompanyOverride) => {
    setEditCompanyId(c.companyId);
    if (c.hasOverride && c.override) {
      setEditData({
        enabled: c.override.enabled ?? true,
        feeType: c.override.feeType || "PERCENT",
        feePercent: String(c.override.feePercent ?? "0"),
        feeCents: String(c.override.feeCents ?? "0"),
      });
    } else {
      setEditData({
        enabled: true,
        feeType: settings?.defaultFeeType || "PERCENT",
        feePercent: String(settings?.defaultFeePercent ?? "0"),
        feeCents: String(settings?.defaultFeeCents ?? "0"),
      });
    }
  };

  const companyList = companiesQuery.data || [];
  const detail = companyDetailQuery.data;
  const selectedCompanyName = companyList.find(c => String(c.companyId) === selectedCompanyId)?.companyName;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto" data-testid="platform-fees-page">
      <div className="flex items-center gap-3 flex-wrap">
        <DollarSign className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Platform Billing</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-platform-billing">
          <TabsTrigger value="fees" data-testid="tab-fees">
            <DollarSign className="h-4 w-4 mr-1" />
            Fees
          </TabsTrigger>
          <TabsTrigger value="subscription" data-testid="tab-subscription">
            <CreditCard className="h-4 w-4 mr-1" />
            Subscription
          </TabsTrigger>
          <TabsTrigger value="fee-rules" data-testid="tab-fee-rules">
            <Sliders className="h-4 w-4 mr-1" />
            Fee Rules
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fees">
          <div className="space-y-6">
            <Card data-testid="card-global-settings">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Global Settings
                </CardTitle>
                {settings && (
                  <Badge variant={settings.enabled ? "default" : "secondary"} data-testid="badge-global-status">
                    {settings.enabled ? "Active" : "Inactive"}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {settingsQuery.isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : settings ? (
                  <>
                    <div className="flex items-center gap-3">
                      <Label htmlFor="global-enabled">Collect platform fees on Stripe payments</Label>
                      <Switch
                        id="global-enabled"
                        data-testid="switch-global-enabled"
                        checked={settings.enabled}
                        onCheckedChange={(val) =>
                          updateSettingsMutation.mutate({ enabled: val })
                        }
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <Label>Default Fee Type</Label>
                        <Select
                          value={settings.defaultFeeType}
                          onValueChange={(val: "PERCENT" | "FIXED") =>
                            updateSettingsMutation.mutate({ defaultFeeType: val })
                          }
                        >
                          <SelectTrigger data-testid="select-fee-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PERCENT">Percentage</SelectItem>
                            <SelectItem value="FIXED">Fixed Amount</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {settings.defaultFeeType === "PERCENT" ? (
                        <div className="space-y-1">
                          <Label>Default Fee Percent (%)</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              data-testid="input-fee-percent"
                              defaultValue={settings.defaultFeePercent}
                              onBlur={(e) =>
                                updateSettingsMutation.mutate({
                                  defaultFeePercent: e.target.value as any,
                                })
                              }
                            />
                            <span className="text-muted-foreground">%</span>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <Label>Default Fee Amount ($)</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              data-testid="input-fee-cents"
                              defaultValue={(settings.defaultFeeCents / 100).toFixed(2)}
                              onBlur={(e) =>
                                updateSettingsMutation.mutate({
                                  defaultFeeCents: Math.round(parseFloat(e.target.value || "0") * 100),
                                })
                              }
                            />
                            <span className="text-muted-foreground">USD</span>
                          </div>
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label>Current Default</Label>
                        <p className="text-sm text-muted-foreground pt-2" data-testid="text-current-default">
                          {formatFee(settings.defaultFeeType, settings.defaultFeePercent, settings.defaultFeeCents)}
                        </p>
                      </div>
                    </div>
                    {updateSettingsMutation.isPending && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Saving...
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">Unable to load settings.</p>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-company-overrides">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Company Fee Overrides
                </CardTitle>
              </CardHeader>
              <CardContent>
                {companiesQuery.isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : companyList.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Company</TableHead>
                        <TableHead>Override Status</TableHead>
                        <TableHead>Fee</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {companyList.map((c) => (
                        <TableRow key={c.companyId} data-testid={`row-company-${c.companyId}`}>
                          <TableCell className="font-medium" data-testid={`text-company-name-${c.companyId}`}>
                            {c.companyName}
                          </TableCell>
                          <TableCell>
                            {c.hasOverride ? (
                              <Badge variant="default" data-testid={`badge-override-${c.companyId}`}>Custom</Badge>
                            ) : (
                              <Badge variant="secondary" data-testid={`badge-default-${c.companyId}`}>Using Default</Badge>
                            )}
                          </TableCell>
                          <TableCell data-testid={`text-fee-${c.companyId}`}>
                            {c.hasOverride && c.override ? (
                              <>
                                {c.override.enabled === false && <span className="text-muted-foreground mr-1">(disabled)</span>}
                                {formatFee(
                                  c.override.feeType || settings?.defaultFeeType || "PERCENT",
                                  c.override.feePercent || settings?.defaultFeePercent || "0",
                                  c.override.feeCents ?? settings?.defaultFeeCents ?? 0
                                )}
                              </>
                            ) : (
                              <span className="text-muted-foreground">
                                {settings ? formatFee(settings.defaultFeeType, settings.defaultFeePercent, settings.defaultFeeCents) : "-"}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button size="icon" variant="ghost" data-testid={`button-edit-${c.companyId}`} onClick={() => openEditOverride(c)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {c.hasOverride && (
                                <Button size="icon" variant="ghost" data-testid={`button-clear-${c.companyId}`}
                                  onClick={() => updateCompanyMutation.mutate({ companyId: c.companyId, data: { clearOverride: true } })}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No companies found.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="subscription">
          <div className="space-y-6">
            <Card data-testid="card-company-selector">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Company Subscription Management
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Select Company</Label>
                  <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                    <SelectTrigger data-testid="select-company" className="max-w-sm">
                      <SelectValue placeholder="Choose a company..." />
                    </SelectTrigger>
                    <SelectContent>
                      {companyList.map((c) => (
                        <SelectItem key={c.companyId} value={String(c.companyId)}>
                          {c.companyName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedCompanyId && (
                  <>
                    {companyDetailQuery.isLoading ? (
                      <div className="space-y-3">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </div>
                    ) : (
                      <div className="space-y-4 border-t pt-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label htmlFor="sub-enabled">Subscription Enabled</Label>
                            <p className="text-xs text-muted-foreground">Turn on subscription billing for this company</p>
                          </div>
                          <Switch
                            id="sub-enabled"
                            data-testid="switch-sub-enabled"
                            checked={detail?.settings?.subscriptionEnabled ?? false}
                            onCheckedChange={(val) =>
                              updateSubSettingsMutation.mutate({
                                companyId: parseInt(selectedCompanyId),
                                data: { subscriptionEnabled: val },
                              })
                            }
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <Label htmlFor="enforce-access">Require Subscription for Access</Label>
                            <p className="text-xs text-muted-foreground">Block trip/invoice creation if no active subscription</p>
                          </div>
                          <Switch
                            id="enforce-access"
                            data-testid="switch-enforce-access"
                            checked={detail?.settings?.subscriptionRequiredForAccess ?? true}
                            onCheckedChange={(val) =>
                              updateSubSettingsMutation.mutate({
                                companyId: parseInt(selectedCompanyId),
                                data: { subscriptionRequiredForAccess: val },
                              })
                            }
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <Label htmlFor="monthly-fee">Monthly Fee</Label>
                            <p className="text-xs text-muted-foreground">Set the monthly subscription amount for this company</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">$</span>
                            <Input
                              id="monthly-fee"
                              type="number"
                              step="0.01"
                              min="0"
                              className="w-28 text-right"
                              data-testid="input-monthly-fee"
                              defaultValue={((detail?.settings?.monthlyFeeCents ?? 120000) / 100).toFixed(2)}
                              key={`fee-${selectedCompanyId}-${detail?.settings?.monthlyFeeCents}`}
                              onBlur={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val) && val >= 0) {
                                  const cents = Math.round(val * 100);
                                  if (cents !== (detail?.settings?.monthlyFeeCents ?? 120000)) {
                                    updateSubSettingsMutation.mutate({
                                      companyId: parseInt(selectedCompanyId),
                                      data: { monthlyFeeCents: cents },
                                    });
                                  }
                                }
                              }}
                            />
                            <span className="text-sm text-muted-foreground">/mo</span>
                          </div>
                        </div>

                        {detail?.subscription ? (
                          <Card className="bg-muted/50" data-testid="card-subscription-detail">
                            <CardContent className="p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">Status</span>
                                {subscriptionStatusBadge(detail.subscription.status, detail.subscription.cancelAtPeriodEnd)}
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Next Bill Date</span>
                                <span className="text-sm font-medium" data-testid="text-next-bill">
                                  {detail.subscription.currentPeriodEnd
                                    ? new Date(detail.subscription.currentPeriodEnd).toLocaleDateString()
                                    : "—"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Stripe Subscription</span>
                                <span className="text-xs font-mono text-muted-foreground" data-testid="text-stripe-sub-id">
                                  {detail.subscription.stripeSubscriptionId || "—"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Access</span>
                                <span data-testid="text-access-status">
                                  {detail.access.allowed ? (
                                    <span className="flex items-center gap-1 text-green-600 text-sm">
                                      <ShieldCheck className="h-4 w-4" /> Allowed
                                    </span>
                                  ) : (
                                    <span className="flex items-center gap-1 text-red-600 text-sm">
                                      <ShieldOff className="h-4 w-4" /> Restricted ({detail.access.reason})
                                    </span>
                                  )}
                                </span>
                              </div>
                              <div className="flex gap-2 pt-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => portalMutation.mutate(parseInt(selectedCompanyId))}
                                  disabled={portalMutation.isPending}
                                  data-testid="button-manage-billing"
                                >
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  Manage Billing
                                </Button>
                                {["active", "trialing"].includes(detail.subscription.status) && !detail.subscription.cancelAtPeriodEnd && (
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => {
                                      if (confirm("Cancel this subscription at period end?")) {
                                        cancelSubMutation.mutate(parseInt(selectedCompanyId));
                                      }
                                    }}
                                    disabled={cancelSubMutation.isPending}
                                    data-testid="button-cancel-sub"
                                  >
                                    <XCircle className="h-3 w-3 mr-1" />
                                    Cancel at Period End
                                  </Button>
                                )}
                                {detail.subscription.cancelAtPeriodEnd && detail.subscription.status !== "canceled" && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => reactivateSubMutation.mutate(parseInt(selectedCompanyId))}
                                    disabled={reactivateSubMutation.isPending}
                                    data-testid="button-reactivate"
                                  >
                                    <RotateCcw className="h-3 w-3 mr-1" />
                                    Reactivate
                                  </Button>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ) : (
                          <div className="border rounded-lg p-6 text-center space-y-3" data-testid="no-subscription-prompt">
                            <CreditCard className="h-10 w-10 mx-auto text-muted-foreground opacity-40" />
                            <p className="text-sm text-muted-foreground">No subscription yet for {selectedCompanyName}.</p>
                            <Button
                              onClick={() => startSubMutation.mutate(parseInt(selectedCompanyId))}
                              disabled={startSubMutation.isPending}
                              data-testid="button-start-subscription"
                            >
                              {startSubMutation.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Play className="h-4 w-4 mr-2" />
                              )}
                              Start Subscription (${((detail?.settings?.monthlyFeeCents ?? 120000) / 100).toLocaleString()}/mo)
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-all-subscriptions">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  All Company Subscriptions
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
                        <TableHead>Next Bill</TableHead>
                        <TableHead>Stripe ID</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subsQuery.data.map((row) => (
                        <TableRow key={row.subscription.id} data-testid={`row-sub-${row.subscription.companyId}`}>
                          <TableCell className="font-medium" data-testid={`text-sub-company-${row.subscription.companyId}`}>
                            {row.companyName}
                          </TableCell>
                          <TableCell>
                            {subscriptionStatusBadge(row.subscription.status, row.subscription.cancelAtPeriodEnd)}
                          </TableCell>
                          <TableCell data-testid={`text-sub-period-${row.subscription.companyId}`}>
                            {row.subscription.currentPeriodEnd
                              ? new Date(row.subscription.currentPeriodEnd).toLocaleDateString()
                              : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {row.subscription.stripeSubscriptionId
                              ? `${row.subscription.stripeSubscriptionId.substring(0, 20)}...`
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
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
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground" data-testid="text-no-subscriptions">
                    <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>No company subscriptions yet.</p>
                    <p className="text-sm mt-1">Select a company above to start a subscription.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="fee-rules">
          <div className="space-y-4">
            <Card data-testid="card-fr-filters">
              <CardContent className="pt-4">
                <div className="flex items-end gap-4 flex-wrap">
                  <div className="space-y-1">
                    <Label>Scope Type</Label>
                    <Select value={frFilterScope} onValueChange={setFrFilterScope}>
                      <SelectTrigger data-testid="select-fr-filter-scope" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Scopes</SelectItem>
                        <SelectItem value="global">Global</SelectItem>
                        <SelectItem value="company">Company</SelectItem>
                        <SelectItem value="clinic">Clinic</SelectItem>
                        <SelectItem value="company_clinic">Company + Clinic</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Status</Label>
                    <Select value={frFilterEnabled} onValueChange={setFrFilterEnabled}>
                      <SelectTrigger data-testid="select-fr-filter-enabled" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="true">Enabled</SelectItem>
                        <SelectItem value="false">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={frOpenCreate} data-testid="button-fr-create-rule">
                    <Plus className="h-4 w-4 mr-1" />
                    New Fee Rule
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-fr-rules-list">
              <CardContent className="pt-4">
                {feeRulesQuery.isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : feeRulesList.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Scope</TableHead>
                          <TableHead>Company/Clinic</TableHead>
                          <TableHead>Fee Type</TableHead>
                          <TableHead>Rate</TableHead>
                          <TableHead>Min/Max</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Priority</TableHead>
                          <TableHead>Dates</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {feeRulesList.map((rule) => (
                          <TableRow key={rule.id} data-testid={`row-fr-rule-${rule.id}`}>
                            <TableCell>{feeRuleScopeBadge(rule.scopeType)}</TableCell>
                            <TableCell data-testid={`text-fr-scope-target-${rule.id}`}>
                              {rule.companyId && <span className="text-sm">Co: {rule.companyId}</span>}
                              {rule.companyId && rule.clinicId && <span className="text-muted-foreground mx-1">/</span>}
                              {rule.clinicId && <span className="text-sm">Cl: {rule.clinicId}</span>}
                              {!rule.companyId && !rule.clinicId && <span className="text-muted-foreground">-</span>}
                              {rule.serviceLevel && (
                                <Badge variant="outline" className="ml-1">{rule.serviceLevel}</Badge>
                              )}
                            </TableCell>
                            <TableCell data-testid={`text-fr-fee-type-${rule.id}`}>
                              {FEE_TYPE_LABELS[rule.feeType]}
                            </TableCell>
                            <TableCell data-testid={`text-fr-rate-${rule.id}`}>
                              {formatRuleRate(rule)}
                            </TableCell>
                            <TableCell data-testid={`text-fr-minmax-${rule.id}`}>
                              {formatCentsVal(rule.minFeeCents)} / {formatCentsVal(rule.maxFeeCents)}
                            </TableCell>
                            <TableCell>
                              <Switch
                                data-testid={`switch-fr-enabled-${rule.id}`}
                                checked={rule.isEnabled}
                                onCheckedChange={(val) =>
                                  frToggleMutation.mutate({ id: rule.id, isEnabled: val })
                                }
                              />
                            </TableCell>
                            <TableCell data-testid={`text-fr-priority-${rule.id}`}>
                              {rule.priority}
                            </TableCell>
                            <TableCell data-testid={`text-fr-dates-${rule.id}`}>
                              <span className="text-xs text-muted-foreground">
                                {formatDateVal(rule.effectiveFrom)} — {formatDateVal(rule.effectiveTo)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  data-testid={`button-fr-edit-rule-${rule.id}`}
                                  onClick={() => frOpenEdit(rule)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                {rule.isEnabled && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    data-testid={`button-fr-disable-rule-${rule.id}`}
                                    onClick={() => frDisableMutation.mutate(rule.id)}
                                  >
                                    <Ban className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8" data-testid="text-fr-no-rules">
                    No fee rules found. Create one to get started.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={frDialogOpen} onOpenChange={(v) => { if (!v) { setFrDialogOpen(false); setFrEditingId(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-fr-rule">
          <DialogHeader>
            <DialogTitle>{frEditingId ? "Edit Fee Rule" : "New Fee Rule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Scope Type</Label>
              <Select
                value={frForm.scopeType}
                onValueChange={(val: ScopeType) => setFrForm((f) => ({ ...f, scopeType: val }))}
              >
                <SelectTrigger data-testid="select-fr-scope-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="company">Company</SelectItem>
                  <SelectItem value="clinic">Clinic</SelectItem>
                  <SelectItem value="company_clinic">Company + Clinic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {frShowCompanyField && (
              <div className="space-y-1">
                <Label>Company ID</Label>
                <Input
                  type="number"
                  data-testid="input-fr-company-id"
                  value={frForm.companyId}
                  onChange={(e) => setFrForm((f) => ({ ...f, companyId: e.target.value }))}
                />
              </div>
            )}

            {frShowClinicField && (
              <div className="space-y-1">
                <Label>Clinic ID</Label>
                <Input
                  type="number"
                  data-testid="input-fr-clinic-id"
                  value={frForm.clinicId}
                  onChange={(e) => setFrForm((f) => ({ ...f, clinicId: e.target.value }))}
                />
              </div>
            )}

            <div className="space-y-1">
              <Label>Service Level</Label>
              <Input
                placeholder="e.g. wheelchair, ambulatory, stretcher"
                data-testid="input-fr-service-level"
                value={frForm.serviceLevel}
                onChange={(e) => setFrForm((f) => ({ ...f, serviceLevel: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label>Fee Type</Label>
              <Select
                value={frForm.feeType}
                onValueChange={(val: FeeType) => setFrForm((f) => ({ ...f, feeType: val }))}
              >
                <SelectTrigger data-testid="select-fr-fee-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                  <SelectItem value="percent_plus_fixed">Percent + Fixed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {frShowPercentField && (
              <div className="space-y-1">
                <Label>Percent (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  data-testid="input-fr-percent"
                  value={frForm.percentInput}
                  onChange={(e) => setFrForm((f) => ({ ...f, percentInput: e.target.value }))}
                />
              </div>
            )}

            {frShowFixedField && (
              <div className="space-y-1">
                <Label>Fixed Fee ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  data-testid="input-fr-fixed"
                  value={frForm.fixedInput}
                  onChange={(e) => setFrForm((f) => ({ ...f, fixedInput: e.target.value }))}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Min Fee ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Optional floor"
                  data-testid="input-fr-min-fee"
                  value={frForm.minFeeInput}
                  onChange={(e) => setFrForm((f) => ({ ...f, minFeeInput: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Max Fee ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Optional cap"
                  data-testid="input-fr-max-fee"
                  value={frForm.maxFeeInput}
                  onChange={(e) => setFrForm((f) => ({ ...f, maxFeeInput: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Priority</Label>
              <Input
                type="number"
                min="0"
                data-testid="input-fr-priority"
                value={frForm.priority}
                onChange={(e) => setFrForm((f) => ({ ...f, priority: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Lower number = higher priority</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Effective From</Label>
                <Input
                  type="date"
                  data-testid="input-fr-effective-from"
                  value={frForm.effectiveFrom}
                  onChange={(e) => setFrForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Effective To</Label>
                <Input
                  type="date"
                  data-testid="input-fr-effective-to"
                  value={frForm.effectiveTo}
                  onChange={(e) => setFrForm((f) => ({ ...f, effectiveTo: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Label htmlFor="fr-enabled">Enabled</Label>
              <Switch
                id="fr-enabled"
                data-testid="switch-fr-form-enabled"
                checked={frForm.isEnabled}
                onCheckedChange={(val) => setFrForm((f) => ({ ...f, isEnabled: val }))}
              />
            </div>

            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                placeholder="Optional notes about this rule"
                data-testid="input-fr-notes"
                value={frForm.notes}
                onChange={(e) => setFrForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setFrDialogOpen(false); setFrEditingId(null); }}
                data-testid="button-fr-cancel"
              >
                Cancel
              </Button>
              <Button
                data-testid="button-fr-save"
                disabled={frIsSaving}
                onClick={frHandleSubmit}
              >
                {frIsSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {frEditingId ? "Update Rule" : "Create Rule"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editCompanyId !== null} onOpenChange={(v) => !v && setEditCompanyId(null)}>
        <DialogContent data-testid="dialog-edit-override">
          <DialogHeader>
            <DialogTitle>
              Edit Fee Override -{" "}
              {companyList.find((c) => c.companyId === editCompanyId)?.companyName || "Company"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Label htmlFor="override-enabled">Fee Enabled</Label>
              <Switch
                id="override-enabled"
                data-testid="switch-override-enabled"
                checked={editData.enabled}
                onCheckedChange={(val) => setEditData((d) => ({ ...d, enabled: val }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Fee Type</Label>
              <Select
                value={editData.feeType}
                onValueChange={(val: "PERCENT" | "FIXED") =>
                  setEditData((d) => ({ ...d, feeType: val }))
                }
              >
                <SelectTrigger data-testid="select-override-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT">Percentage</SelectItem>
                  <SelectItem value="FIXED">Fixed Amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editData.feeType === "PERCENT" ? (
              <div className="space-y-1">
                <Label>Fee Percent (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  data-testid="input-override-percent"
                  value={editData.feePercent}
                  onChange={(e) => setEditData((d) => ({ ...d, feePercent: e.target.value }))}
                />
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Fee Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  data-testid="input-override-cents"
                  value={editData.feeCents}
                  onChange={(e) => setEditData((d) => ({ ...d, feeCents: e.target.value }))}
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditCompanyId(null)} data-testid="button-cancel-override">
                Cancel
              </Button>
              <Button
                data-testid="button-save-override"
                disabled={updateCompanyMutation.isPending}
                onClick={() => {
                  if (editCompanyId === null) return;
                  updateCompanyMutation.mutate({
                    companyId: editCompanyId,
                    data: {
                      enabled: editData.enabled,
                      feeType: editData.feeType,
                      feePercent: editData.feeType === "PERCENT" ? editData.feePercent : null,
                      feeCents: editData.feeType === "FIXED" ? Math.round(parseFloat(editData.feeCents || "0") * 100) : null,
                    },
                  });
                }}
              >
                {updateCompanyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Override
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
