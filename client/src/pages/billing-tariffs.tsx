import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  Plus,
  Settings,
  FileText,
  Loader2,
  Pencil,
  Trash2,
  AlertTriangle,
  Building2,
} from "lucide-react";
import { getStoredCompanyScopeId, setStoredCompanyScopeId } from "@/lib/api";

function cents(v: number): string {
  return (v / 100).toFixed(2);
}

export default function BillingTariffsPage() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editTariff, setEditTariff] = useState<any>(null);
  const [filterClinic, setFilterClinic] = useState("__all__");
  const [backfillFrom, setBackfillFrom] = useState("");
  const [backfillTo, setBackfillTo] = useState("");
  const [invoiceClinic, setInvoiceClinic] = useState("");
  const [invoiceFrom, setInvoiceFrom] = useState("");
  const [invoiceTo, setInvoiceTo] = useState("");

  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const [companyScopeId, setCompanyScopeId] = useState<string | null>(getStoredCompanyScopeId());
  const hasCompanyScope = isSuperAdmin ? !!companyScopeId : true;

  const companiesQuery = useQuery<any[]>({
    queryKey: ["/api/companies"],
    queryFn: () => apiFetch("/api/companies", token),
    enabled: !!token && isSuperAdmin,
  });

  const handleCompanyChange = (value: string) => {
    setStoredCompanyScopeId(value);
    setCompanyScopeId(value);
    queryClient.invalidateQueries();
  };

  if (isSuperAdmin && !hasCompanyScope) {
    const companies = companiesQuery.data || [];
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-4" data-testid="billing-no-company">
        <Building2 className="w-10 h-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{t("billingConfig.selectCompany")}</h2>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          {t("billingConfig.selectCompanyDesc")}
        </p>
        <div className="w-full max-w-xs">
          {companiesQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : companiesQuery.isError ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-destructive">{t("billingConfig.failedLoadCompanies")}</p>
              <Button variant="outline" size="sm" onClick={() => companiesQuery.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          ) : companies.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("billingConfig.noCompaniesFound")}</p>
          ) : (
            <Select onValueChange={handleCompanyChange}>
              <SelectTrigger data-testid="select-company-scope">
                <SelectValue placeholder={t("billingConfig.chooseCompany")} />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)} data-testid={`option-company-${c.id}`}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    );
  }

  const clinicsQuery = useQuery<any[]>({
    queryKey: ["/api/clinics"],
    queryFn: () => apiFetch("/api/clinics", token),
    enabled: !!token,
  });

  const tariffsQuery = useQuery<any[]>({
    queryKey: ["/api/company/billing/tariffs", filterClinic],
    queryFn: () => {
      const params = filterClinic && filterClinic !== "__all__" ? `?clinic_id=${filterClinic}` : "";
      return apiFetch(`/api/company/billing/tariffs${params}`, token);
    },
    enabled: !!token,
  });

  const invoicesQuery = useQuery<any[]>({
    queryKey: ["/api/company/billing/invoices"],
    queryFn: () => apiFetch("/api/company/billing/invoices", token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/company/billing/tariffs", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/billing/tariffs"] });
      setShowCreate(false);
      toast({ title: t("billingConfig.tariffCreated") });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiFetch(`/api/company/billing/tariffs/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/billing/tariffs"] });
      setEditTariff(null);
      toast({ title: t("billingConfig.tariffUpdated") });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteTariffMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/company/billing/tariffs/${id}`, token, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/billing/tariffs"] });
      toast({ title: t("billingConfig.tariffDeleted") });
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const backfillMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/company/billing/backfill?from=${backfillFrom}&to=${backfillTo}`, token, { method: "POST" }),
    onSuccess: (data: any) => {
      toast({ title: t("billingConfig.backfillComplete"), description: t("billingConfig.processedTrips", { processed: data.processed, errors: data.errors }) });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const invoiceGenMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/company/billing/invoices/generate", token, {
        method: "POST",
        body: JSON.stringify({ clinicId: parseInt(invoiceClinic), periodStart: invoiceFrom, periodEnd: invoiceTo }),
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/billing/invoices"] });
      toast({ title: t("billingConfig.invoiceGenerated"), description: `Invoice #${data.invoiceNumber}` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const clinics = clinicsQuery.data || [];
  const tariffs = tariffsQuery.data || [];
  const invoices = invoicesQuery.data || [];

  const hasError = tariffsQuery.isError || clinicsQuery.isError || invoicesQuery.isError;
  const errorMsg = (tariffsQuery.error as any)?.message || (clinicsQuery.error as any)?.message || (invoicesQuery.error as any)?.message || "Unknown error";

  if (hasError) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-4" data-testid="billing-error">
        <AlertTriangle className="w-10 h-10 text-destructive" />
        <h2 className="text-lg font-semibold">{t("billingConfig.failedLoadBilling")}</h2>
        <p className="text-sm text-muted-foreground text-center max-w-md">{errorMsg}</p>
        <Button
          variant="outline"
          onClick={() => {
            tariffsQuery.refetch();
            clinicsQuery.refetch();
            invoicesQuery.refetch();
          }}
          data-testid="button-retry-billing"
        >
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 max-w-7xl mx-auto" data-testid="billing-tariffs-page">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("billingConfig.title")}</h1>
          {isSuperAdmin && (
            <Select value={companyScopeId || ""} onValueChange={handleCompanyChange}>
              <SelectTrigger className="w-52" data-testid="select-company-switch">
                <Building2 className="w-4 h-4 mr-1 text-muted-foreground shrink-0" />
                <SelectValue placeholder={t("billingConfig.switchCompany")} />
              </SelectTrigger>
              <SelectContent>
                {(companiesQuery.data || []).map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="button-create-tariff">
          <Plus className="w-4 h-4 mr-2" />
          {t("billingConfig.newTariff")}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">{t("billingConfig.billingBackfill")}</CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <div className="space-y-1">
                <Label>{t("billingConfig.from")}</Label>
                <Input type="date" value={backfillFrom} onChange={(e) => setBackfillFrom(e.target.value)} data-testid="input-backfill-from" />
              </div>
              <div className="space-y-1">
                <Label>{t("billingConfig.to")}</Label>
                <Input type="date" value={backfillTo} onChange={(e) => setBackfillTo(e.target.value)} data-testid="input-backfill-to" />
              </div>
            </div>
            <Button
              onClick={() => backfillMutation.mutate()}
              disabled={!backfillFrom || !backfillTo || backfillMutation.isPending}
              data-testid="button-run-backfill"
            >
              {backfillMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("billingConfig.runBackfill")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">{t("billingConfig.generateInvoice")}</CardTitle>
            <DollarSign className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>{t("billingConfig.clinic")}</Label>
              <Select value={invoiceClinic} onValueChange={setInvoiceClinic}>
                <SelectTrigger data-testid="select-invoice-clinic">
                  <SelectValue placeholder={t("billingConfig.selectClinic")} />
                </SelectTrigger>
                <SelectContent>
                  {clinics.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="space-y-1">
                <Label>{t("billingConfig.periodStart")}</Label>
                <Input type="date" value={invoiceFrom} onChange={(e) => setInvoiceFrom(e.target.value)} data-testid="input-invoice-from" />
              </div>
              <div className="space-y-1">
                <Label>{t("billingConfig.periodEnd")}</Label>
                <Input type="date" value={invoiceTo} onChange={(e) => setInvoiceTo(e.target.value)} data-testid="input-invoice-to" />
              </div>
            </div>
            <Button
              onClick={() => invoiceGenMutation.mutate()}
              disabled={!invoiceClinic || !invoiceFrom || !invoiceTo || invoiceGenMutation.isPending}
              data-testid="button-generate-invoice"
            >
              {invoiceGenMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("billingConfig.generateInvoice")}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">{t("billingConfig.tariffs")}</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={filterClinic} onValueChange={setFilterClinic}>
              <SelectTrigger className="w-48" data-testid="select-filter-clinic">
                <SelectValue placeholder="All clinics" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("billingConfig.allClinics")}</SelectItem>
                {clinics.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {tariffsQuery.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : tariffs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("billingConfig.noTariffs")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("billingConfig.name")}</TableHead>
                    <TableHead>{t("billingConfig.clinic")}</TableHead>
                    <TableHead>{t("billingConfig.baseFee")}</TableHead>
                    <TableHead>{t("billingConfig.perMile")}</TableHead>
                    <TableHead>{t("billingConfig.perMin")}</TableHead>
                    <TableHead>{t("billingConfig.wcExtra")}</TableHead>
                    <TableHead>{t("billingConfig.noShowFee")}</TableHead>
                    <TableHead>{t("billingConfig.cancelFee")}</TableHead>
                    <TableHead>{t("billingConfig.minFare")}</TableHead>
                    <TableHead>{t("billingConfig.sharedMode")}</TableHead>
                    <TableHead>{t("billingConfig.active")}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tariffs.map((tariff: any) => (
                    <TableRow key={tariff.id} data-testid={`row-tariff-${tariff.id}`}>
                      <TableCell className="font-medium">{tariff.name}</TableCell>
                      <TableCell>{tariff.clinicId ? clinics.find((c: any) => c.id === tariff.clinicId)?.name || tariff.clinicId : "Default"}</TableCell>
                      <TableCell>${cents(tariff.baseFeeCents)}</TableCell>
                      <TableCell>${cents(tariff.perMileCents)}</TableCell>
                      <TableCell>${cents(tariff.perMinuteCents)}</TableCell>
                      <TableCell>${cents(tariff.wheelchairExtraCents)}</TableCell>
                      <TableCell>${cents(tariff.noShowFeeCents)}</TableCell>
                      <TableCell>${cents(tariff.cancelFeeCents)}</TableCell>
                      <TableCell>${cents(tariff.minimumFareCents)}</TableCell>
                      <TableCell>{tariff.sharedTripMode}</TableCell>
                      <TableCell>
                        <Badge variant={tariff.active ? "default" : "secondary"} data-testid={`badge-tariff-active-${tariff.id}`}>
                          {tariff.active ? t("billingConfig.active") : t("billingConfig.inactive")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => setEditTariff(tariff)} data-testid={`button-edit-tariff-${tariff.id}`}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              if (window.confirm(t("billingConfig.deleteTariffConfirm", { name: tariff.name }))) {
                                deleteTariffMutation.mutate(tariff.id);
                              }
                            }}
                            disabled={deleteTariffMutation.isPending}
                            data-testid={`button-delete-tariff-${tariff.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">{t("billingConfig.generatedInvoices")}</CardTitle>
        </CardHeader>
        <CardContent>
          {invoicesQuery.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("billingConfig.noInvoices")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("billingConfig.invoiceNumber")}</TableHead>
                    <TableHead>{t("billingConfig.clinic")}</TableHead>
                    <TableHead>{t("reconciliation.period")}</TableHead>
                    <TableHead>{t("billingConfig.total")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("billingConfig.payment")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv: any) => (
                    <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                      <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                      <TableCell>{inv.clinicName || inv.clinicId}</TableCell>
                      <TableCell>{inv.periodStart} - {inv.periodEnd}</TableCell>
                      <TableCell>${cents(inv.totalCents)}</TableCell>
                      <TableCell>
                        <Badge variant={inv.status === "approved" ? "default" : "outline"}>
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={inv.paymentStatus === "paid" ? "default" : "secondary"}>
                          {inv.paymentStatus || "unpaid"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <TariffFormDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={(data: any) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
        clinics={clinics}
        title={t("billingConfig.createTariff")}
      />

      {editTariff && (
        <TariffFormDialog
          open={true}
          onClose={() => setEditTariff(null)}
          onSubmit={(data: any) => updateMutation.mutate({ id: editTariff.id, data })}
          isPending={updateMutation.isPending}
          clinics={clinics}
          title={t("billingConfig.editTariff")}
          defaults={editTariff}
        />
      )}
    </div>
  );
}

function TariffFormDialog({ open, onClose, onSubmit, isPending, clinics, title, defaults }: any) {
  const { t } = useTranslation();
  const [name, setName] = useState(defaults?.name || "");
  const [clinicId, setClinicId] = useState(defaults?.clinicId ? String(defaults.clinicId) : "__default__");
  const [baseFeeCents, setBaseFeeCents] = useState(defaults?.baseFeeCents || 0);
  const [perMileCents, setPerMileCents] = useState(defaults?.perMileCents || 0);
  const [perMinuteCents, setPerMinuteCents] = useState(defaults?.perMinuteCents || 0);
  const [waitMinuteCents, setWaitMinuteCents] = useState(defaults?.waitMinuteCents || 0);
  const [wheelchairExtraCents, setWheelchairExtraCents] = useState(defaults?.wheelchairExtraCents || 0);
  const [noShowFeeCents, setNoShowFeeCents] = useState(defaults?.noShowFeeCents || 0);
  const [cancelFeeCents, setCancelFeeCents] = useState(defaults?.cancelFeeCents || 0);
  const [minimumFareCents, setMinimumFareCents] = useState(defaults?.minimumFareCents || 0);
  const [sharedTripMode, setSharedTripMode] = useState(defaults?.sharedTripMode || "PER_PATIENT");
  const [sharedTripDiscountPct, setSharedTripDiscountPct] = useState(defaults?.sharedTripDiscountPct || "0");
  const [active, setActive] = useState(defaults?.active !== false);

  const handleSubmit = () => {
    const data: any = {
      name,
      baseFeeCents: Number(baseFeeCents),
      perMileCents: Number(perMileCents),
      perMinuteCents: Number(perMinuteCents),
      waitMinuteCents: Number(waitMinuteCents),
      wheelchairExtraCents: Number(wheelchairExtraCents),
      noShowFeeCents: Number(noShowFeeCents),
      cancelFeeCents: Number(cancelFeeCents),
      minimumFareCents: Number(minimumFareCents),
      sharedTripMode,
      sharedTripDiscountPct: Number(sharedTripDiscountPct),
      active,
    };
    if (clinicId && clinicId !== "__default__") data.clinicId = parseInt(clinicId);
    onSubmit(data);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("billingConfig.name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-tariff-name" />
          </div>
          <div className="space-y-1">
            <Label>{t("billingConfig.clinicLabel")}</Label>
            <Select value={clinicId} onValueChange={setClinicId}>
              <SelectTrigger data-testid="select-tariff-clinic">
                <SelectValue placeholder={t("billingConfig.clinicDefault")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">{t("billingConfig.clinicDefault")}</SelectItem>
                {clinics.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("billingConfig.baseFeeCents")}</Label>
              <Input type="number" value={baseFeeCents} onChange={(e) => setBaseFeeCents(e.target.value)} data-testid="input-base-fee" />
            </div>
            <div className="space-y-1">
              <Label>{t("billingConfig.perMileCents")}</Label>
              <Input type="number" value={perMileCents} onChange={(e) => setPerMileCents(e.target.value)} data-testid="input-per-mile" />
            </div>
            <div className="space-y-1">
              <Label>{t("billingConfig.perMinuteCents")}</Label>
              <Input type="number" value={perMinuteCents} onChange={(e) => setPerMinuteCents(e.target.value)} data-testid="input-per-minute" />
            </div>
            <div className="space-y-1">
              <Label>{t("billingConfig.waitMinCents")}</Label>
              <Input type="number" value={waitMinuteCents} onChange={(e) => setWaitMinuteCents(e.target.value)} data-testid="input-wait-min" />
            </div>
            <div className="space-y-1">
              <Label>{t("billingConfig.wheelchairExtraCents")}</Label>
              <Input type="number" value={wheelchairExtraCents} onChange={(e) => setWheelchairExtraCents(e.target.value)} data-testid="input-wheelchair" />
            </div>
            <div className="space-y-1">
              <Label>{t("billingConfig.noShowFeeCents")}</Label>
              <Input type="number" value={noShowFeeCents} onChange={(e) => setNoShowFeeCents(e.target.value)} data-testid="input-noshow" />
            </div>
            <div className="space-y-1">
              <Label>{t("billingConfig.cancelFeeCents")}</Label>
              <Input type="number" value={cancelFeeCents} onChange={(e) => setCancelFeeCents(e.target.value)} data-testid="input-cancel" />
            </div>
            <div className="space-y-1">
              <Label>{t("billingConfig.minimumFareCents")}</Label>
              <Input type="number" value={minimumFareCents} onChange={(e) => setMinimumFareCents(e.target.value)} data-testid="input-min-fare" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("billingConfig.sharedTripMode")}</Label>
            <Select value={sharedTripMode} onValueChange={setSharedTripMode}>
              <SelectTrigger data-testid="select-shared-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PER_PATIENT">{t("billingConfig.perPatient")}</SelectItem>
                <SelectItem value="SPLIT">{t("billingConfig.split")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("billingConfig.sharedTripDiscount")}</Label>
            <Input type="number" value={sharedTripDiscountPct} onChange={(e) => setSharedTripDiscountPct(e.target.value)} data-testid="input-shared-discount" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} id="tariff-active" data-testid="checkbox-tariff-active" />
            <Label htmlFor="tariff-active">{t("billingConfig.active")}</Label>
          </div>
          <Button onClick={handleSubmit} disabled={isPending || !name} className="w-full" data-testid="button-submit-tariff">
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {defaults ? t("billingConfig.update") : t("common.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
