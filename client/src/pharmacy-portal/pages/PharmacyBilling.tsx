import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  DollarSign,
  Download,
  TrendingUp,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const INVOICE_STATUS_COLORS: Record<string, string> = {
  PAID: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  PENDING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  OVERDUE: "bg-red-500/10 text-red-400 border-red-500/20",
  CANCELLED: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

export default function PharmacyBilling() {
  const { token } = useAuth();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["/api/pharmacy/billing/summary"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/billing/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load billing summary");
      return res.json();
    },
  });

  const { data: invoiceData, isLoading: invoicesLoading } = useQuery({
    queryKey: ["/api/pharmacy/billing/invoices", statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/billing/invoices?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load invoices");
      return res.json();
    },
  });

  const invoices = invoiceData?.invoices || [];
  const totalInvoices = invoiceData?.total || 0;
  const totalPages = Math.ceil(totalInvoices / 25);

  // CSV export
  const handleExportCSV = () => {
    const headers = ["Invoice #", "Order ID", "Recipient", "Date", "Delivery Fee", "Rush Fee", "Total", "Status"];
    const rows = invoices.map((inv: any) => [
      inv.invoiceNumber,
      inv.orderPublicId,
      inv.recipientName,
      inv.deliveryDate ? new Date(inv.deliveryDate).toLocaleDateString() : "",
      formatCents(inv.deliveryFeeCents),
      formatCents(inv.rushFeeCents),
      formatCents(inv.totalCents),
      inv.status,
    ]);

    const csv = [headers.join(","), ...rows.map((r: string[]) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pharmacy-billing-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <DollarSign className="w-6 h-6 text-violet-400" />
            Billing Dashboard
          </h1>
          <p className="text-sm text-gray-400 mt-1">Revenue, invoices, and settlement history</p>
        </div>
        <button
          onClick={handleExportCSV}
          disabled={invoices.length === 0}
          className="px-4 py-2 bg-[#111827] border border-[#1e293b] text-gray-300 hover:text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-30"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Revenue Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-violet-500/10 to-purple-500/10 border border-violet-500/20 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider text-gray-400">Total Revenue</span>
            <DollarSign className="w-5 h-5 text-violet-400 opacity-60" />
          </div>
          {summaryLoading ? (
            <div className="h-8 bg-gray-700 rounded w-24 animate-pulse" />
          ) : (
            <>
              <p className="text-3xl font-bold text-white">{formatCents(summary?.totalRevenueCents || 0)}</p>
              <p className="text-xs text-gray-500 mt-1">{summary?.totalDeliveries || 0} deliveries all time</p>
            </>
          )}
        </div>
        <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider text-gray-400">This Month</span>
            <TrendingUp className="w-5 h-5 text-emerald-400 opacity-60" />
          </div>
          {summaryLoading ? (
            <div className="h-8 bg-gray-700 rounded w-24 animate-pulse" />
          ) : (
            <>
              <p className="text-3xl font-bold text-emerald-400">{formatCents(summary?.monthRevenueCents || 0)}</p>
              <p className="text-xs text-gray-500 mt-1">{summary?.monthDeliveries || 0} deliveries this month</p>
            </>
          )}
        </div>
        <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider text-gray-400">Outstanding</span>
            <Clock className="w-5 h-5 text-amber-400 opacity-60" />
          </div>
          {summaryLoading ? (
            <div className="h-8 bg-gray-700 rounded w-24 animate-pulse" />
          ) : (
            <>
              <p className="text-3xl font-bold text-amber-400">{formatCents(summary?.outstandingCents || 0)}</p>
              <p className="text-xs text-gray-500 mt-1">{summary?.outstandingCount || 0} pending orders</p>
            </>
          )}
        </div>
      </div>

      {/* Invoice filters */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-gray-500" />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          <option value="ALL">All Statuses</option>
          <option value="PAID">Paid</option>
          <option value="PENDING">Pending</option>
          <option value="OVERDUE">Overdue</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <span className="text-xs text-gray-500 ml-auto">{invoices.length} invoices</span>
      </div>

      {/* Invoice Table */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1e293b]">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Invoice #</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipient</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase">Delivery Fee</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase">Rush Fee</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoicesLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-[#1e293b]/50">
                  <td colSpan={7} className="px-5 py-4"><div className="h-4 bg-gray-700 rounded animate-pulse" /></td>
                </tr>
              ))
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-16 text-center text-gray-500">
                  <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No invoices found</p>
                </td>
              </tr>
            ) : (
              invoices.map((inv: any) => (
                <tr key={inv.id} className="border-b border-[#1e293b]/50 hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-3">
                    <span className="text-sm font-mono text-violet-400">{inv.invoiceNumber}</span>
                  </td>
                  <td className="px-5 py-3 text-sm text-white">{inv.recipientName}</td>
                  <td className="px-5 py-3 text-xs text-gray-400">
                    {inv.deliveryDate ? new Date(inv.deliveryDate).toLocaleDateString() : "---"}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-400 text-right">{formatCents(inv.deliveryFeeCents)}</td>
                  <td className="px-5 py-3 text-sm text-gray-400 text-right">
                    {inv.rushFeeCents > 0 ? formatCents(inv.rushFeeCents) : "---"}
                  </td>
                  <td className="px-5 py-3 text-sm font-medium text-white text-right">{formatCents(inv.totalCents)}</td>
                  <td className="px-5 py-3 text-center">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium border ${INVOICE_STATUS_COLORS[inv.status] || INVOICE_STATUS_COLORS.PENDING}`}>
                      {inv.status === "PAID" && <CheckCircle2 className="w-3 h-3" />}
                      {inv.status === "OVERDUE" && <AlertTriangle className="w-3 h-3" />}
                      {inv.status === "PENDING" && <Clock className="w-3 h-3" />}
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">Page {page} of {totalPages}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="p-2 rounded-lg bg-[#111827] border border-[#1e293b] text-gray-400 disabled:opacity-30 hover:bg-white/5">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="p-2 rounded-lg bg-[#111827] border border-[#1e293b] text-gray-400 disabled:opacity-30 hover:bg-white/5">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Settlement History */}
      {summary?.settlements && summary.settlements.length > 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl">
          <div className="px-5 py-4 border-b border-[#1e293b]">
            <h3 className="text-sm font-semibold text-white">Settlement History</h3>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e293b]">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Month</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Deliveries</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500">Total Settled</th>
              </tr>
            </thead>
            <tbody>
              {summary.settlements.map((s: any) => (
                <tr key={s.month} className="border-b border-[#1e293b]/50 hover:bg-white/[0.02]">
                  <td className="px-5 py-3 text-sm text-white">{s.month}</td>
                  <td className="px-5 py-3 text-sm text-gray-400 text-right">{s.orderCount}</td>
                  <td className="px-5 py-3 text-sm font-medium text-emerald-400 text-right">{formatCents(s.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
