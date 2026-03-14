import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import {
  FileText,
  Search,
  Plus,
  Pill,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  X,
} from "lucide-react";

interface Prescription {
  id: number;
  rxNumber: string;
  medicationName: string;
  ndc: string | null;
  patientName: string;
  patientId: number | null;
  prescriber: string | null;
  quantity: number;
  unit: string;
  refillsRemaining: number;
  refillsTotal: number;
  isControlled: boolean;
  scheduleClass: string | null;
  validationStatus: string;
  linkedOrderId: number | null;
  linkedOrderPublicId: string | null;
  orderStatus: string | null;
  createdAt: string;
  source: string;
}

const VALIDATION_COLORS: Record<string, string> = {
  VALID: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  PENDING_VERIFICATION: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  EXPIRED: "bg-red-500/10 text-red-400 border-red-500/20",
  INVALID: "bg-red-500/10 text-red-400 border-red-500/20",
};

const VALIDATION_ICONS: Record<string, any> = {
  VALID: CheckCircle2,
  PENDING_VERIFICATION: Clock,
  EXPIRED: AlertTriangle,
  INVALID: X,
};

export default function PharmacyPrescriptions() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Create form state
  const [form, setForm] = useState({
    rxNumber: "",
    medicationName: "",
    ndc: "",
    patientName: "",
    prescriber: "",
    quantity: 1,
    unit: "each",
    refillsRemaining: 0,
    refillsTotal: 0,
    isControlled: false,
    scheduleClass: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["/api/pharmacy/prescriptions", search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/prescriptions?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load prescriptions");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (rxData: typeof form) => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/prescriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(rxData),
      });
      if (!res.ok) throw new Error("Failed to create prescription");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/prescriptions"] });
      setShowCreateModal(false);
      setForm({
        rxNumber: "", medicationName: "", ndc: "", patientName: "", prescriber: "",
        quantity: 1, unit: "each", refillsRemaining: 0, refillsTotal: 0,
        isControlled: false, scheduleClass: "",
      });
    },
  });

  const prescriptions: Prescription[] = data?.prescriptions || [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <FileText className="w-6 h-6 text-violet-400" />
            Prescriptions
          </h1>
          <p className="text-sm text-gray-400 mt-1">Manage prescriptions and link to delivery orders</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Import Rx
        </button>
      </div>

      {/* Filters */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search by Rx#, medication, or patient..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          <option value="ALL">All Statuses</option>
          <option value="VALID">Valid</option>
          <option value="PENDING_VERIFICATION">Pending Verification</option>
          <option value="EXPIRED">Expired</option>
        </select>
        <span className="text-xs text-gray-500">{prescriptions.length} prescriptions</span>
      </div>

      {/* Table */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1e293b]">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rx #</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Medication</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prescriber</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Qty</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Refills</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Flags</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Validation</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Source</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Linked Order</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-[#1e293b]/50">
                  <td colSpan={10} className="px-5 py-4"><div className="h-4 bg-gray-700 rounded animate-pulse" /></td>
                </tr>
              ))
            ) : prescriptions.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-5 py-16 text-center text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No prescriptions found</p>
                  <p className="text-xs text-gray-600 mt-1">Import a prescription or create a delivery order with Rx info</p>
                </td>
              </tr>
            ) : (
              prescriptions.map((rx) => {
                const StatusIcon = VALIDATION_ICONS[rx.validationStatus] || Clock;
                return (
                  <tr key={`${rx.source}-${rx.id}`} className="border-b border-[#1e293b]/50 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3">
                      <span className="text-sm font-mono text-violet-400">{rx.rxNumber || "---"}</span>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-sm text-white">{rx.medicationName}</p>
                      {rx.ndc && <p className="text-[10px] text-gray-500 font-mono">{rx.ndc}</p>}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-300">{rx.patientName}</td>
                    <td className="px-5 py-3 text-sm text-gray-400">{rx.prescriber || "---"}</td>
                    <td className="px-5 py-3 text-center text-sm text-gray-400">{rx.quantity} {rx.unit}</td>
                    <td className="px-5 py-3 text-center text-sm text-gray-400">
                      {rx.refillsRemaining}/{rx.refillsTotal}
                    </td>
                    <td className="px-5 py-3 text-center space-x-1">
                      {rx.isControlled && (
                        <span className="inline-flex items-center gap-1 text-[9px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">
                          <ShieldCheck className="w-2.5 h-2.5" />
                          {rx.scheduleClass || "CTRL"}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${VALIDATION_COLORS[rx.validationStatus] || VALIDATION_COLORS.VALID}`}>
                        <StatusIcon className="w-3 h-3" />
                        {rx.validationStatus.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium ${
                        rx.source === "erx" ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                        : rx.source === "order" ? "bg-gray-500/10 text-gray-400 border border-gray-500/20"
                        : "bg-violet-500/10 text-violet-400 border border-violet-500/20"
                      }`}>
                        {rx.source === "erx" ? "e-Rx" : rx.source === "order" ? "Order" : "Manual"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      {rx.linkedOrderPublicId ? (
                        <Link href={`/orders/${rx.linkedOrderId}`}>
                          <span className="text-xs font-mono text-violet-400 hover:text-violet-300 cursor-pointer">
                            {rx.linkedOrderPublicId}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-600">---</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Create Prescription Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowCreateModal(false)} role="presentation" aria-hidden="true">
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="import-prescription-title">
            <h3 id="import-prescription-title" className="text-lg font-semibold text-white flex items-center gap-2">
              <Pill className="w-5 h-5 text-violet-400" />
              Import Prescription
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Rx Number *</label>
                <input type="text" value={form.rxNumber} onChange={(e) => setForm({ ...form, rxNumber: e.target.value })} placeholder="RX-123456"
                  className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">NDC</label>
                <input type="text" value={form.ndc} onChange={(e) => setForm({ ...form, ndc: e.target.value })} placeholder="12345-678-90"
                  className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Medication Name *</label>
              <input type="text" value={form.medicationName} onChange={(e) => setForm({ ...form, medicationName: e.target.value })} placeholder="Lisinopril 10mg"
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Patient Name *</label>
                <input type="text" value={form.patientName} onChange={(e) => setForm({ ...form, patientName: e.target.value })}
                  className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Prescriber</label>
                <input type="text" value={form.prescriber} onChange={(e) => setForm({ ...form, prescriber: e.target.value })} placeholder="Dr. Smith"
                  className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Quantity</label>
                <input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                  className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Unit</label>
                <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500">
                  <option value="each">Each</option>
                  <option value="tablet">Tablet</option>
                  <option value="capsule">Capsule</option>
                  <option value="ml">mL</option>
                  <option value="bottle">Bottle</option>
                  <option value="box">Box</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Refills</label>
                <input type="number" value={form.refillsTotal} onChange={(e) => setForm({ ...form, refillsTotal: Number(e.target.value), refillsRemaining: Number(e.target.value) })}
                  className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
            </div>

            {/* Controlled substance toggle */}
            <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg p-3 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isControlled}
                  onChange={(e) => setForm({ ...form, isControlled: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-600 text-violet-500 focus:ring-violet-500"
                />
                <span className="text-sm text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-red-400" />
                  Controlled Substance
                </span>
              </label>
              {form.isControlled && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">DEA Schedule</label>
                  <select value={form.scheduleClass} onChange={(e) => setForm({ ...form, scheduleClass: e.target.value })}
                    className="w-full bg-[#111827] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500">
                    <option value="">Select Schedule</option>
                    <option value="CII">Schedule II</option>
                    <option value="CIII">Schedule III</option>
                    <option value="CIV">Schedule IV</option>
                    <option value="CV">Schedule V</option>
                  </select>
                </div>
              )}
              {form.isControlled && (
                <div className="flex items-start gap-2 bg-red-500/5 border border-red-500/10 rounded-lg p-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-red-400">
                    Controlled substances require signature, ID verification, and chain of custody tracking per DEA regulations.
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700">Cancel</button>
              <button
                onClick={() => createMutation.mutate(form)}
                disabled={createMutation.isPending || !form.rxNumber || !form.medicationName || !form.patientName}
                className="flex-1 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 disabled:opacity-50"
              >
                {createMutation.isPending ? "Saving..." : "Import Rx"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
