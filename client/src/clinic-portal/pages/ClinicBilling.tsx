import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { useState } from "react";
import { resolveUrl } from "@/lib/api";
import {
  CreditCard,
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Calendar,
  Download,
  XCircle,
  ArrowRight,
  X,
  Car,
  User,
  MapPin,
  Truck,
  Timer,
  Shield,
} from "lucide-react";

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}

function paymentStatusStyle(status: string) {
  switch (status) {
    case "paid": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "unpaid": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "overdue": return "bg-red-500/10 text-red-400 border-red-500/20";
    case "partial": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    default: return "bg-gray-500/10 text-gray-400 border-gray-500/20";
  }
}

function PaymentStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "paid": return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    case "overdue": return <AlertTriangle className="w-4 h-4 text-red-400" />;
    case "unpaid": return <Clock className="w-4 h-4 text-amber-400" />;
    default: return <CreditCard className="w-4 h-4 text-gray-400" />;
  }
}

function InvoiceLineDrawer({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  const { data: detail, isLoading } = useQuery({
    queryKey: ["/api/clinic/billing/invoices", invoice.id],
    queryFn: async () => {
      const res = await fetch(resolveUrl(`/api/clinic/billing/invoices/${invoice.id}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoice details");
      return res.json();
    },
  });

  const invoiceData = detail as any;
  const lines = invoiceData?.items || invoiceData?.lines || [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="invoice-drawer">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[#0f172a] border-l border-[#1e293b] overflow-y-auto">
        <div className="sticky top-0 bg-[#0f172a]/95 backdrop-blur-sm border-b border-[#1e293b] px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-semibold text-white" data-testid="invoice-drawer-title">
              Invoice #{invoice.invoiceNumber || invoice.id}
            </h2>
            <p className="text-xs text-gray-500">
              {invoice.periodStart} — {invoice.periodEnd}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg" data-testid="button-close-invoice-drawer">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <span className={`px-3 py-1.5 rounded-full text-xs font-medium border ${paymentStatusStyle(invoice.paymentStatus)}`}>
              {(invoice.paymentStatus || "unpaid").toUpperCase()}
            </span>
            <p className="text-2xl font-bold text-white" data-testid="invoice-total">
              {formatCents(invoice.totalCents)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-3">
              <p className="text-[10px] text-gray-600 uppercase">Subtotal</p>
              <p className="text-sm text-white font-medium">{formatCents(invoice.subtotalCents)}</p>
            </div>
            <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-3">
              <p className="text-[10px] text-gray-600 uppercase">Fees</p>
              <p className="text-sm text-white font-medium">{formatCents(invoice.feesCents)}</p>
            </div>
            {invoice.balanceDueCents > 0 && (
              <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-3 col-span-2">
                <p className="text-[10px] text-gray-600 uppercase">Balance Due</p>
                <p className="text-sm text-amber-400 font-medium">{formatCents(invoice.balanceDueCents)}</p>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">
              Trip Line Items ({lines.length})
            </h3>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 animate-pulse">
                    <div className="h-4 w-48 bg-gray-800 rounded mb-2" />
                    <div className="h-3 w-32 bg-gray-800 rounded" />
                  </div>
                ))}
              </div>
            ) : lines.length === 0 ? (
              <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 text-center">
                <p className="text-sm text-gray-500">No line items</p>
              </div>
            ) : (
              <div className="space-y-2">
                {lines.map((line: any, idx: number) => {
                  const meta = line.metadata || line.snapshot_json || {};
                  return (
                    <div
                      key={line.id || idx}
                      className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 space-y-2"
                      data-testid={`invoice-line-${line.id || idx}`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-white font-medium">
                          {line.description || "Trip"}
                        </p>
                        <span className="text-sm font-semibold text-white">
                          {formatCents(line.amountCents)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center gap-1 text-gray-500">
                          <User className="w-3 h-3" />
                          <span>{meta.patient_name || meta.patientName || "Patient"}</span>
                        </div>
                        <div className="flex items-center gap-1 text-gray-500">
                          <Car className="w-3 h-3" />
                          <span>
                            {meta.driver_name || meta.driverName ||
                              <span className="text-amber-400">Driver not assigned</span>
                            }
                          </span>
                        </div>
                        {(meta.pickup || meta.pickupAddress) && (
                          <div className="flex items-center gap-1 text-gray-500 col-span-2">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span className="truncate">{meta.pickup || meta.pickupAddress} → {meta.dropoff || meta.dropoffAddress}</span>
                          </div>
                        )}
                        {meta.vehicle && (
                          <div className="flex items-center gap-1 text-gray-500">
                            <Truck className="w-3 h-3" />
                            <span>{meta.vehicle}</span>
                          </div>
                        )}
                        {(meta.wait_time_minutes || line.waitTimeMinutes) && (
                          <div className="flex items-center gap-1 text-gray-500">
                            <Timer className="w-3 h-3" />
                            <span>{meta.wait_time_minutes || line.waitTimeMinutes}m wait</span>
                          </div>
                        )}
                        {(meta.geofence_confirmed || line.geofenceConfirmed) && (
                          <div className="flex items-center gap-1 text-green-400">
                            <Shield className="w-3 h-3" />
                            <span>Geofence verified</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <AdjustmentsSection invoiceId={invoice.id} />
        </div>
      </div>
    </div>
  );
}

function AdjustmentsSection({ invoiceId }: { invoiceId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/finance/invoices", invoiceId, "adjustments"],
    queryFn: async () => {
      const res = await fetch(resolveUrl(`/api/finance/invoices/${invoiceId}/adjustments`), { credentials: "include" });
      if (!res.ok) return { adjustments: [] };
      return res.json();
    },
  });

  const adjustments = (data as any)?.adjustments || [];
  if (isLoading) return null;
  if (adjustments.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">
        Adjustments ({adjustments.length})
      </h3>
      <div className="space-y-2">
        {adjustments.map((adj: any) => (
          <div
            key={adj.id}
            className="bg-[#111827] border border-[#1e293b] rounded-xl p-3 flex items-center justify-between"
            data-testid={`adjustment-row-${adj.id}`}
          >
            <div>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${
                adj.kind === "credit" || adj.kind === "refund"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/20"
              }`}>
                {adj.kind.toUpperCase()}
              </span>
              <p className="text-xs text-gray-400 mt-1">{adj.reason}</p>
            </div>
            <span className={`text-sm font-semibold ${
              adj.kind === "credit" || adj.kind === "refund" ? "text-emerald-400" : "text-amber-400"
            }`}>
              {adj.kind === "credit" || adj.kind === "refund" ? "-" : "+"}
              {formatCents(adj.amountCents)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ClinicBilling() {
  const { user } = useAuth();
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [payingInvoiceId, setPayingInvoiceId] = useState<number | null>(null);

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["/api/clinic/billing/invoices"],
    queryFn: async () => {
      const res = await fetch(resolveUrl("/api/clinic/billing/invoices"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return res.json();
    },
    enabled: !!user?.clinicId || user?.role === "SUPER_ADMIN",
  });

  const payMutation = useMutation({
    mutationFn: async (invoiceId: number) => {
      const res = await fetch(resolveUrl(`/api/clinic/billing/invoices/${invoiceId}/pay`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Payment failed");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/billing/invoices"] });
      setPayingInvoiceId(null);
    },
    onError: () => {
      setPayingInvoiceId(null);
    },
  });

  const invoiceList = Array.isArray(invoices) ? invoices : [];

  const weeklyGroups = invoiceList.reduce((groups: Record<string, any[]>, inv: any) => {
    const week = `${inv.periodStart} — ${inv.periodEnd}`;
    if (!groups[week]) groups[week] = [];
    groups[week].push(inv);
    return groups;
  }, {});

  const unpaidTotal = invoiceList
    .filter((inv: any) => inv.paymentStatus !== "paid")
    .reduce((sum: number, inv: any) => sum + (inv.totalCents || 0), 0);

  const paidTotal = invoiceList
    .filter((inv: any) => inv.paymentStatus === "paid")
    .reduce((sum: number, inv: any) => sum + (inv.totalCents || 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="clinic-billing-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Billing & Invoices</h1>
          <p className="text-sm text-gray-500">Weekly billing summaries and payment management</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4" data-testid="stat-total-invoices">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-gray-500 uppercase">Total Invoices</span>
          </div>
          <p className="text-2xl font-bold text-white">{invoiceList.length}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4" data-testid="stat-unpaid">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-gray-500 uppercase">Unpaid Balance</span>
          </div>
          <p className="text-2xl font-bold text-amber-400">{formatCents(unpaidTotal)}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4" data-testid="stat-paid">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-gray-500 uppercase">Total Paid</span>
          </div>
          <p className="text-2xl font-bold text-emerald-400">{formatCents(paidTotal)}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 animate-pulse">
              <div className="h-5 w-48 bg-gray-800 rounded mb-3" />
              <div className="h-4 w-32 bg-gray-800 rounded" />
            </div>
          ))}
        </div>
      ) : invoiceList.length === 0 ? (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-12 text-center" data-testid="text-no-invoices">
          <CreditCard className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No invoices yet</p>
          <p className="text-gray-600 text-xs mt-1">Invoices will appear here as trips are billed</p>
        </div>
      ) : (
        <div className="space-y-4" data-testid="invoice-list">
          {Object.entries(weeklyGroups).map(([week, invs]) => (
            <div key={week} className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#1e293b] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">{week}</h3>
                </div>
                <span className="text-xs text-gray-500">
                  {invs.length} invoice{invs.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="divide-y divide-[#1e293b]">
                {invs.map((inv: any) => (
                  <div
                    key={inv.id}
                    className="px-5 py-4 flex items-center gap-4 hover:bg-white/[0.02] transition-colors cursor-pointer"
                    onClick={() => setSelectedInvoice(inv)}
                    data-testid={`invoice-row-${inv.id}`}
                  >
                    <PaymentStatusIcon status={inv.paymentStatus} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-white font-medium">
                          Invoice #{inv.invoiceNumber || inv.id}
                        </p>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${paymentStatusStyle(inv.paymentStatus)}`}>
                          {(inv.paymentStatus || "unpaid").toUpperCase()}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {inv.status === "finalized" ? "Finalized" : inv.status === "draft" ? "Draft" : inv.status}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-white">{formatCents(inv.totalCents)}</p>
                      {inv.paymentStatus !== "paid" && inv.totalCents > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPayingInvoiceId(inv.id);
                            payMutation.mutate(inv.id);
                          }}
                          disabled={payMutation.isPending && payingInvoiceId === inv.id}
                          className="mt-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-800 disabled:opacity-50 text-white text-xs rounded-lg transition-colors"
                          data-testid={`button-pay-${inv.id}`}
                        >
                          {payMutation.isPending && payingInvoiceId === inv.id ? "Processing..." : "Pay Now"}
                        </button>
                      )}
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-600 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedInvoice && (
        <InvoiceLineDrawer
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  );
}
