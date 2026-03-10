import { useState } from "react";
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
  Sliders,
  Plus,
  Pencil,
  Ban,
  Calculator,
  History,
  Loader2,
  CheckCircle,
  XCircle,
} from "lucide-react";

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
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

interface FeeRuleAudit {
  id: number;
  ruleId: number;
  action: string;
  actorId: number | null;
  before: any;
  after: any;
  createdAt: string;
}

interface PreviewResult {
  rule: FeeRule | null;
  feeCents: number;
  source: string;
  details: any;
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

function scopeBadge(scope: ScopeType) {
  const variants: Record<ScopeType, string> = {
    global: "bg-emerald-600",
    company: "bg-emerald-600",
    clinic: "bg-purple-600",
    company_clinic: "bg-orange-600",
  };
  return (
    <Badge className={variants[scope]} data-testid={`badge-scope-${scope}`}>
      {SCOPE_LABELS[scope]}
    </Badge>
  );
}

function formatRate(rule: FeeRule): string {
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

function formatCents(cents: number | null): string {
  if (cents == null) return "-";
  return `$${(cents / 100).toFixed(2)}`;
}


const emptyForm = {
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

export default function FeeRulesPage() {
  const { token, user } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("rules");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const [filterScope, setFilterScope] = useState("all");
  const [filterEnabled, setFilterEnabled] = useState("all");

  const [calcCompanyId, setCalcCompanyId] = useState("");
  const [calcClinicId, setCalcClinicId] = useState("");
  const [calcAmount, setCalcAmount] = useState("");
  const [calcServiceLevel, setCalcServiceLevel] = useState("");

  const [auditRuleId, setAuditRuleId] = useState("");

  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  if (!isSuperAdmin) {
    return (
      <div className="p-6" data-testid="fee-rules-no-access">
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Fee Rules management requires Super Admin access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (filterScope !== "all") params.set("scopeType", filterScope);
    if (filterEnabled !== "all") params.set("isEnabled", filterEnabled);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  const rulesQuery = useQuery<{ rules: FeeRule[] }>({
    queryKey: ["/api/admin/fee-rules", filterScope, filterEnabled],
    queryFn: () => apiFetch(`/api/admin/fee-rules${buildQuery()}`, token),
    enabled: !!token,
  });

  const auditQuery = useQuery<{ events: FeeRuleAudit[] }>({
    queryKey: ["/api/admin/fee-rules/audit", auditRuleId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (auditRuleId) params.set("ruleId", auditRuleId);
      params.set("limit", "50");
      const qs = params.toString();
      return apiFetch(`/api/admin/fee-rules/audit?${qs}`, token);
    },
    enabled: !!token && activeTab === "audit",
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/admin/fee-rules", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fee-rules"] });
      setDialogOpen(false);
      setEditingId(null);
      toast({ title: "Fee rule created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiFetch(`/api/admin/fee-rules/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fee-rules"] });
      setDialogOpen(false);
      setEditingId(null);
      toast({ title: "Fee rule updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const disableMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/admin/fee-rules/${id}/disable`, token, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fee-rules"] });
      toast({ title: "Fee rule disabled" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const previewMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/admin/fee-rules/preview", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  };

  const openEdit = (rule: FeeRule) => {
    setEditingId(rule.id);
    setForm({
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
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload: any = {
      scopeType: form.scopeType,
      feeType: form.feeType,
      percentBps: Math.round(parseFloat(form.percentInput || "0") * 100),
      fixedFeeCents: Math.round(parseFloat(form.fixedInput || "0") * 100),
      minFeeCents: form.minFeeInput ? Math.round(parseFloat(form.minFeeInput) * 100) : null,
      maxFeeCents: form.maxFeeInput ? Math.round(parseFloat(form.maxFeeInput) * 100) : null,
      isEnabled: form.isEnabled,
      priority: parseInt(form.priority || "0", 10),
      effectiveFrom: form.effectiveFrom || null,
      effectiveTo: form.effectiveTo || null,
      notes: form.notes || null,
      companyId: form.companyId ? parseInt(form.companyId, 10) : null,
      clinicId: form.clinicId ? parseInt(form.clinicId, 10) : null,
      serviceLevel: form.serviceLevel || null,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handlePreview = () => {
    const amountCents = Math.round(parseFloat(calcAmount || "0") * 100);
    previewMutation.mutate({
      companyId: calcCompanyId ? parseInt(calcCompanyId, 10) : null,
      clinicId: calcClinicId ? parseInt(calcClinicId, 10) : null,
      amountCents,
      serviceLevel: calcServiceLevel || null,
    });
  };

  const rules = rulesQuery.data?.rules || [];
  const audits = auditQuery.data?.events || [];
  const preview = previewMutation.data as PreviewResult | undefined;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const showCompanyField = form.scopeType === "company" || form.scopeType === "company_clinic";
  const showClinicField = form.scopeType === "clinic" || form.scopeType === "company_clinic";
  const showPercentField = form.feeType === "percent" || form.feeType === "percent_plus_fixed";
  const showFixedField = form.feeType === "fixed" || form.feeType === "percent_plus_fixed";

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto" data-testid="fee-rules-page">
      <div className="flex items-center gap-3 flex-wrap">
        <Sliders className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Fee Rules Engine</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-fee-rules">
          <TabsTrigger value="rules" data-testid="tab-rules">
            <Sliders className="h-4 w-4 mr-1" />
            Rules
          </TabsTrigger>
          <TabsTrigger value="calculator" data-testid="tab-calculator">
            <Calculator className="h-4 w-4 mr-1" />
            Calculator
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">
            <History className="h-4 w-4 mr-1" />
            Audit Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules">
          <div className="space-y-4">
            <Card data-testid="card-rules-filters">
              <CardContent className="pt-4">
                <div className="flex items-end gap-4 flex-wrap">
                  <div className="space-y-1">
                    <Label>Scope Type</Label>
                    <Select value={filterScope} onValueChange={setFilterScope}>
                      <SelectTrigger data-testid="select-filter-scope" className="w-40">
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
                    <Select value={filterEnabled} onValueChange={setFilterEnabled}>
                      <SelectTrigger data-testid="select-filter-enabled" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="true">Enabled</SelectItem>
                        <SelectItem value="false">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={openCreate} data-testid="button-create-rule">
                    <Plus className="h-4 w-4 mr-1" />
                    New Rule
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-rules-list">
              <CardContent className="pt-4">
                {rulesQuery.isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : rules.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Scope</TableHead>
                          <TableHead>Company/Clinic</TableHead>
                          <TableHead>Fee Type</TableHead>
                          <TableHead>Rate</TableHead>
                          <TableHead>Min/Max</TableHead>
                          <TableHead>Priority</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Dates</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rules.map((rule) => (
                          <TableRow key={rule.id} data-testid={`row-rule-${rule.id}`}>
                            <TableCell>{scopeBadge(rule.scopeType)}</TableCell>
                            <TableCell data-testid={`text-scope-target-${rule.id}`}>
                              {rule.companyId && <span className="text-sm">Co: {rule.companyId}</span>}
                              {rule.companyId && rule.clinicId && <span className="text-muted-foreground mx-1">/</span>}
                              {rule.clinicId && <span className="text-sm">Cl: {rule.clinicId}</span>}
                              {!rule.companyId && !rule.clinicId && <span className="text-muted-foreground">-</span>}
                              {rule.serviceLevel && (
                                <Badge variant="outline" className="ml-1">{rule.serviceLevel}</Badge>
                              )}
                            </TableCell>
                            <TableCell data-testid={`text-fee-type-${rule.id}`}>
                              {FEE_TYPE_LABELS[rule.feeType]}
                            </TableCell>
                            <TableCell data-testid={`text-rate-${rule.id}`}>
                              {formatRate(rule)}
                            </TableCell>
                            <TableCell data-testid={`text-minmax-${rule.id}`}>
                              {formatCents(rule.minFeeCents)} / {formatCents(rule.maxFeeCents)}
                            </TableCell>
                            <TableCell data-testid={`text-priority-${rule.id}`}>
                              {rule.priority}
                            </TableCell>
                            <TableCell>
                              {rule.isEnabled ? (
                                <Badge className="bg-green-600" data-testid={`badge-enabled-${rule.id}`}>
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Enabled
                                </Badge>
                              ) : (
                                <Badge variant="secondary" data-testid={`badge-disabled-${rule.id}`}>
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Disabled
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell data-testid={`text-dates-${rule.id}`}>
                              <span className="text-xs text-muted-foreground">
                                {formatDate(rule.effectiveFrom)} — {formatDate(rule.effectiveTo)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  data-testid={`button-edit-rule-${rule.id}`}
                                  onClick={() => openEdit(rule)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                {rule.isEnabled && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    data-testid={`button-disable-rule-${rule.id}`}
                                    onClick={() => disableMutation.mutate(rule.id)}
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
                  <p className="text-muted-foreground text-center py-8">No fee rules found. Create one to get started.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="calculator">
          <Card data-testid="card-calculator">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-4 w-4" />
                Fee Calculator
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Company ID</Label>
                  <Input
                    type="number"
                    placeholder="Optional"
                    data-testid="input-calc-company"
                    value={calcCompanyId}
                    onChange={(e) => setCalcCompanyId(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Clinic ID</Label>
                  <Input
                    type="number"
                    placeholder="Optional"
                    data-testid="input-calc-clinic"
                    value={calcClinicId}
                    onChange={(e) => setCalcClinicId(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Amount ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 150.00"
                    data-testid="input-calc-amount"
                    value={calcAmount}
                    onChange={(e) => setCalcAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Service Level</Label>
                  <Input
                    placeholder="Optional (e.g. ambulatory)"
                    data-testid="input-calc-service-level"
                    value={calcServiceLevel}
                    onChange={(e) => setCalcServiceLevel(e.target.value)}
                  />
                </div>
              </div>
              <Button
                onClick={handlePreview}
                disabled={previewMutation.isPending || !calcAmount}
                data-testid="button-calculate"
              >
                {previewMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Calculate Fee
              </Button>

              {preview && (
                <Card data-testid="card-preview-result">
                  <CardContent className="pt-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label className="text-muted-foreground">Source</Label>
                        <p className="text-lg font-semibold" data-testid="text-preview-source">
                          <Badge variant={preview.source === "fee_rule" ? "default" : "secondary"}>
                            {preview.source}
                          </Badge>
                        </p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Computed Fee</Label>
                        <p className="text-lg font-semibold" data-testid="text-preview-fee">
                          ${(preview.feeCents / 100).toFixed(2)}
                        </p>
                      </div>
                      {preview.rule && (
                        <div>
                          <Label className="text-muted-foreground">Matched Rule</Label>
                          <p className="text-sm" data-testid="text-preview-rule">
                            #{preview.rule.id} — {scopeBadge(preview.rule.scopeType)} {formatRate(preview.rule)}
                          </p>
                        </div>
                      )}
                    </div>
                    {preview.details && (
                      <div>
                        <Label className="text-muted-foreground">Details</Label>
                        <pre className="text-xs bg-muted p-3 rounded-md mt-1 overflow-x-auto" data-testid="text-preview-details">
                          {JSON.stringify(preview.details, null, 2)}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card data-testid="card-audit">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4" />
                Audit Log
              </CardTitle>
              <div className="flex items-center gap-2">
                <Label>Rule ID Filter</Label>
                <Input
                  type="number"
                  placeholder="All"
                  className="w-24"
                  data-testid="input-audit-rule-id"
                  value={auditRuleId}
                  onChange={(e) => setAuditRuleId(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent>
              {auditQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : audits.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rule ID</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Actor</TableHead>
                        <TableHead>Before</TableHead>
                        <TableHead>After</TableHead>
                        <TableHead>Timestamp</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {audits.map((evt) => (
                        <TableRow key={evt.id} data-testid={`row-audit-${evt.id}`}>
                          <TableCell data-testid={`text-audit-rule-${evt.id}`}>
                            #{evt.ruleId}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" data-testid={`badge-audit-action-${evt.id}`}>
                              {evt.action}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`text-audit-actor-${evt.id}`}>
                            {evt.actorId ?? "-"}
                          </TableCell>
                          <TableCell>
                            <pre className="text-xs max-w-48 overflow-hidden text-ellipsis whitespace-nowrap" data-testid={`text-audit-before-${evt.id}`}>
                              {evt.before ? JSON.stringify(evt.before) : "-"}
                            </pre>
                          </TableCell>
                          <TableCell>
                            <pre className="text-xs max-w-48 overflow-hidden text-ellipsis whitespace-nowrap" data-testid={`text-audit-after-${evt.id}`}>
                              {evt.after ? JSON.stringify(evt.after) : "-"}
                            </pre>
                          </TableCell>
                          <TableCell data-testid={`text-audit-time-${evt.id}`}>
                            {formatDateTime(evt.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">No audit events found.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-rule-form">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Fee Rule" : "Create Fee Rule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Scope Type</Label>
              <Select
                value={form.scopeType}
                onValueChange={(val: ScopeType) => setForm((f) => ({ ...f, scopeType: val }))}
              >
                <SelectTrigger data-testid="select-scope-type">
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

            {showCompanyField && (
              <div className="space-y-1">
                <Label>Company ID</Label>
                <Input
                  type="number"
                  data-testid="input-company-id"
                  value={form.companyId}
                  onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                />
              </div>
            )}

            {showClinicField && (
              <div className="space-y-1">
                <Label>Clinic ID</Label>
                <Input
                  type="number"
                  data-testid="input-clinic-id"
                  value={form.clinicId}
                  onChange={(e) => setForm((f) => ({ ...f, clinicId: e.target.value }))}
                />
              </div>
            )}

            <div className="space-y-1">
              <Label>Service Level (optional)</Label>
              <Input
                placeholder="e.g. ambulatory, wheelchair"
                data-testid="input-service-level"
                value={form.serviceLevel}
                onChange={(e) => setForm((f) => ({ ...f, serviceLevel: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label>Fee Type</Label>
              <Select
                value={form.feeType}
                onValueChange={(val: FeeType) => setForm((f) => ({ ...f, feeType: val }))}
              >
                <SelectTrigger data-testid="select-fee-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                  <SelectItem value="percent_plus_fixed">Percent + Fixed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showPercentField && (
              <div className="space-y-1">
                <Label>Percentage (%)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    data-testid="input-percent"
                    value={form.percentInput}
                    onChange={(e) => setForm((f) => ({ ...f, percentInput: e.target.value }))}
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
              </div>
            )}

            {showFixedField && (
              <div className="space-y-1">
                <Label>Fixed Fee ($)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    data-testid="input-fixed-fee"
                    value={form.fixedInput}
                    onChange={(e) => setForm((f) => ({ ...f, fixedInput: e.target.value }))}
                  />
                  <span className="text-muted-foreground">USD</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Min Fee ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Optional"
                  data-testid="input-min-fee"
                  value={form.minFeeInput}
                  onChange={(e) => setForm((f) => ({ ...f, minFeeInput: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Max Fee ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Optional"
                  data-testid="input-max-fee"
                  value={form.maxFeeInput}
                  onChange={(e) => setForm((f) => ({ ...f, maxFeeInput: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Priority</Label>
              <Input
                type="number"
                min="0"
                data-testid="input-priority"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Higher priority rules take precedence</p>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="form-enabled"
                data-testid="switch-enabled"
                checked={form.isEnabled}
                onCheckedChange={(val) => setForm((f) => ({ ...f, isEnabled: val }))}
              />
              <Label htmlFor="form-enabled">Enabled</Label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Effective From</Label>
                <Input
                  type="date"
                  data-testid="input-effective-from"
                  value={form.effectiveFrom}
                  onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Effective To</Label>
                <Input
                  type="date"
                  data-testid="input-effective-to"
                  value={form.effectiveTo}
                  onChange={(e) => setForm((f) => ({ ...f, effectiveTo: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                data-testid="input-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes about this rule"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel">
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={isSaving} data-testid="button-save-rule">
                {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {editingId ? "Update Rule" : "Create Rule"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
