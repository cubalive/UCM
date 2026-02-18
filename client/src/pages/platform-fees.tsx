import { useState } from "react";
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

function formatFee(type: string, percent: string | number, cents: number): string {
  if (type === "PERCENT") return `${percent}%`;
  return `$${(cents / 100).toFixed(2)} flat`;
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

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

  const settingsQuery = useQuery<GlobalSettings>({
    queryKey: ["/api/admin/platform-fee/settings"],
    queryFn: () => apiFetch("/api/admin/platform-fee/settings", { headers }),
    enabled: !!token,
  });

  const companiesQuery = useQuery<CompanyOverride[]>({
    queryKey: ["/api/admin/platform-fee/companies"],
    queryFn: () => apiFetch("/api/admin/platform-fee/companies", { headers }),
    enabled: !!token,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (data: Partial<GlobalSettings>) =>
      apiFetch("/api/admin/platform-fee/settings", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
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
      apiFetch(`/api/admin/platform-fee/companies/${companyId}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-fee/companies"] });
      setEditCompanyId(null);
      toast({ title: "Company override saved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

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

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto" data-testid="platform-fees-page">
      <div className="flex items-center gap-3 flex-wrap">
        <DollarSign className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Platform Billing Fees</h1>
      </div>

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
              <Skeleton className="h-10 w-full" />
            </div>
          ) : companiesQuery.data && companiesQuery.data.length > 0 ? (
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
                {companiesQuery.data.map((c) => (
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
                        <Button
                          size="icon"
                          variant="ghost"
                          data-testid={`button-edit-${c.companyId}`}
                          onClick={() => openEditOverride(c)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {c.hasOverride && (
                          <Button
                            size="icon"
                            variant="ghost"
                            data-testid={`button-clear-${c.companyId}`}
                            onClick={() =>
                              updateCompanyMutation.mutate({
                                companyId: c.companyId,
                                data: { clearOverride: true },
                              })
                            }
                          >
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

      <Dialog open={editCompanyId !== null} onOpenChange={(v) => !v && setEditCompanyId(null)}>
        <DialogContent data-testid="dialog-edit-override">
          <DialogHeader>
            <DialogTitle>
              Edit Fee Override -{" "}
              {companiesQuery.data?.find((c) => c.companyId === editCompanyId)?.companyName || "Company"}
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
