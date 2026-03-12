import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  User,
  Phone,
  Calendar,
  MapPin,
  Search,
  Plus,
  Heart,
  Shield,
  Mail,
  X,
  Loader2,
  ChevronRight,
  FileText,
  Clock,
  AlertTriangle,
  Trash2,
  ExternalLink,
  Filter,
  UserPlus,
  Activity,
  Accessibility,
  Hash,
  Upload,
  Download,
  CheckCircle2,
} from "lucide-react";

interface Patient {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  dateOfBirth?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  wheelchairRequired?: boolean;
  insuranceId?: string;
  medicaidId?: string;
  notes?: string;
  active?: boolean;
  createdAt?: string;
  totalTrips?: number;
  lastTripDate?: string;
  noShowCount?: number;
}

function formatDOB(dob?: string): string {
  if (!dob) return "N/A";
  try {
    const d = new Date(dob);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dob;
  }
}

function formatDateShort(dateStr?: string): string {
  if (!dateStr) return "N/A";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function buildFullAddress(patient: Patient): string {
  const parts = [patient.address, patient.city, patient.state, patient.zip].filter(Boolean);
  return parts.join(", ") || "No address on file";
}

// ─── Patient Detail Drawer ───────────────────────────────────────────────────

function PatientDrawer({
  patient,
  onClose,
  onDelete,
  isDeleting,
}: {
  patient: Patient;
  onClose: () => void;
  onDelete: (id: number) => void;
  isDeleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-lg bg-[#0a0f1e] border-l border-[#1e293b] shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="sticky top-0 bg-[#0a0f1e]/95 backdrop-blur-md border-b border-[#1e293b] px-6 py-4 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 rounded-full flex items-center justify-center text-sm font-bold text-emerald-400">
                {(patient.firstName?.[0] || "?").toUpperCase()}
                {(patient.lastName?.[0] || "").toUpperCase()}
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">
                  {patient.firstName} {patient.lastName}
                </h2>
                <p className="text-xs text-gray-500">Patient ID: #{patient.id}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-[#1e293b] rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Status Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {patient.wheelchairRequired && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border bg-blue-500/10 border-blue-500/20 text-blue-400">
                <Accessibility className="w-3 h-3" />
                Wheelchair Required
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border ${
                patient.active !== false
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : "bg-red-500/10 border-red-500/20 text-red-400"
              }`}
            >
              <Activity className="w-3 h-3" />
              {patient.active !== false ? "Active" : "Inactive"}
            </span>
          </div>

          {/* Contact Info */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Contact Information</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center shrink-0">
                  <Phone className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">Phone</p>
                  <p className="text-sm text-white truncate">{patient.phone || "N/A"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">Email</p>
                  <p className="text-sm text-white truncate">{patient.email || "N/A"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-purple-500/10 rounded-lg flex items-center justify-center shrink-0">
                  <Calendar className="w-4 h-4 text-purple-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">Date of Birth</p>
                  <p className="text-sm text-white">{formatDOB(patient.dateOfBirth)}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-amber-500/10 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                  <MapPin className="w-4 h-4 text-amber-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">Address</p>
                  <p className="text-sm text-white">{buildFullAddress(patient)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Insurance Info */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Insurance & Coverage</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-cyan-500/10 rounded-lg flex items-center justify-center shrink-0">
                  <Shield className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">Insurance ID</p>
                  <p className="text-sm text-white font-mono">{patient.insuranceId || "N/A"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-pink-500/10 rounded-lg flex items-center justify-center shrink-0">
                  <Heart className="w-4 h-4 text-pink-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">Medicaid ID</p>
                  <p className="text-sm text-white font-mono">{patient.medicaidId || "N/A"}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Trip History Summary */}
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Trip History</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-white">{patient.totalTrips ?? 0}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Total Trips</p>
              </div>
              <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-white">{patient.noShowCount ?? 0}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">No-Shows</p>
              </div>
              <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg p-3 text-center">
                <p className="text-xs font-medium text-white mt-1">
                  {patient.lastTripDate ? formatDateShort(patient.lastTripDate) : "None"}
                </p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Last Trip</p>
              </div>
            </div>
          </div>

          {/* Notes */}
          {patient.notes && (
            <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 space-y-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Notes</h3>
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{patient.notes}</p>
            </div>
          )}

          {/* Quick Actions */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Quick Actions</h3>
            <a
              href={`/clinic/trip-requests/new?patientId=${patient.id}`}
              className="flex items-center gap-3 w-full px-4 py-3 bg-emerald-600/10 border border-emerald-500/20 rounded-xl text-emerald-400 hover:bg-emerald-600/20 transition-colors group"
            >
              <Plus className="w-5 h-5" />
              <span className="text-sm font-medium">Create Trip Request</span>
              <ChevronRight className="w-4 h-4 ml-auto opacity-50 group-hover:opacity-100 transition-opacity" />
            </a>
            {patient.phone && (
              <a
                href={`tel:${patient.phone}`}
                className="flex items-center gap-3 w-full px-4 py-3 bg-blue-600/10 border border-blue-500/20 rounded-xl text-blue-400 hover:bg-blue-600/20 transition-colors group"
              >
                <Phone className="w-5 h-5" />
                <span className="text-sm font-medium">Call Patient</span>
                <ExternalLink className="w-4 h-4 ml-auto opacity-50 group-hover:opacity-100 transition-opacity" />
              </a>
            )}
          </div>

          {/* Delete */}
          <div className="pt-4 border-t border-[#1e293b]">
            {confirmDelete ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onDelete(patient.id)}
                  disabled={isDeleting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {isDeleting ? "Deleting..." : "Confirm Delete"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-4 py-2.5 text-sm text-gray-400 border border-[#1e293b] rounded-lg hover:bg-[#1e293b] transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete Patient
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Add Patient Modal ───────────────────────────────────────────────────────

function AddPatientModal({
  onClose,
  onSubmit,
  isPending,
}: {
  onClose: () => void;
  onSubmit: (data: Record<string, any>) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    dateOfBirth: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    wheelchairRequired: false,
    insuranceId: "",
    medicaidId: "",
    notes: "",
  });

  const update = (field: string, value: any) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim() || !form.phone.trim()) return;
    onSubmit({
      ...form,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || undefined,
      dateOfBirth: form.dateOfBirth || undefined,
      address: form.address.trim() || undefined,
      city: form.city.trim() || undefined,
      state: form.state.trim() || undefined,
      zip: form.zip.trim() || undefined,
      insuranceId: form.insuranceId.trim() || undefined,
      medicaidId: form.medicaidId.trim() || undefined,
      notes: form.notes.trim() || undefined,
    });
  };

  const inputCls =
    "w-full bg-[#0a0f1e] border border-[#1e293b] text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 placeholder-gray-600 transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-[#111827] border border-[#1e293b] rounded-xl w-full max-w-2xl mx-4 shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e293b] shrink-0">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-emerald-400" />
            Add New Patient
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-5">
          {/* Name */}
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Personal Information</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  First Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => update("firstName", e.target.value)}
                  required
                  placeholder="John"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Last Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => update("lastName", e.target.value)}
                  required
                  placeholder="Doe"
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Phone <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  required
                  placeholder="(555) 123-4567"
                  className={`${inputCls} pl-10`}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="patient@email.com"
                  className={`${inputCls} pl-10`}
                />
              </div>
            </div>
          </div>

          {/* DOB */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Date of Birth</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => update("dateOfBirth", e.target.value)}
                  className={`${inputCls} pl-10`}
                />
              </div>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-3 cursor-pointer px-4 py-2.5 bg-[#0a0f1e] border border-[#1e293b] rounded-lg hover:border-[#2d3a4d] transition-colors w-full">
                <input
                  type="checkbox"
                  checked={form.wheelchairRequired}
                  onChange={(e) => update("wheelchairRequired", e.target.checked)}
                  className="w-4 h-4 rounded border-[#1e293b] bg-[#0a0f1e] text-emerald-500 focus:ring-emerald-500/30 focus:ring-offset-0"
                />
                <div className="flex items-center gap-2">
                  <Accessibility className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-white">Wheelchair Required</span>
                </div>
              </label>
            </div>
          </div>

          {/* Address */}
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Address</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Street Address</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => update("address", e.target.value)}
                    placeholder="123 Main Street, Apt 4B"
                    className={`${inputCls} pl-10`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">City</label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => update("city", e.target.value)}
                    placeholder="New York"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">State</label>
                  <input
                    type="text"
                    value={form.state}
                    onChange={(e) => update("state", e.target.value)}
                    placeholder="NY"
                    maxLength={2}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">ZIP Code</label>
                  <input
                    type="text"
                    value={form.zip}
                    onChange={(e) => update("zip", e.target.value)}
                    placeholder="10001"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Insurance */}
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Insurance & Coverage</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Insurance ID</label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    value={form.insuranceId}
                    onChange={(e) => update("insuranceId", e.target.value)}
                    placeholder="INS-12345"
                    className={`${inputCls} pl-10`}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Medicaid ID</label>
                <div className="relative">
                  <Heart className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    value={form.medicaidId}
                    onChange={(e) => update("medicaidId", e.target.value)}
                    placeholder="MCD-67890"
                    className={`${inputCls} pl-10`}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              rows={3}
              placeholder="Any special instructions, medical conditions, or mobility notes..."
              className={`${inputCls} resize-none`}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm text-gray-400 border border-[#1e293b] rounded-lg hover:bg-[#1e293b] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {isPending ? "Creating..." : "Add Patient"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Bulk Import Modal ────────────────────────────────────────────────────────

function BulkImportModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [csvData, setCsvData] = useState<Record<string, any>[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsing(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length < 2) {
          toast({ title: "Invalid CSV", description: "CSV must have a header row and at least one data row.", variant: "destructive" });
          setParsing(false);
          return;
        }

        const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "").replace(/["']/g, ""));
        const headerMap: Record<string, string> = {
          "firstname": "firstName",
          "first_name": "firstName",
          "lastname": "lastName",
          "last_name": "lastName",
          "phone": "phone",
          "email": "email",
          "dateofbirth": "dateOfBirth",
          "date_of_birth": "dateOfBirth",
          "dob": "dateOfBirth",
          "address": "address",
          "city": "city",
          "state": "state",
          "zip": "zip",
          "zipcode": "zip",
          "insuranceid": "insuranceId",
          "insurance_id": "insuranceId",
          "medicaidid": "medicaidId",
          "medicaid_id": "medicaidId",
          "wheelchair": "wheelchairRequired",
          "wheelchairrequired": "wheelchairRequired",
          "notes": "notes",
        };

        const mappedHeaders = headers.map(h => headerMap[h] || h);
        const rows: Record<string, any>[] = [];

        for (let i = 1; i < lines.length; i++) {
          // Basic CSV parsing (handles simple cases)
          const values = lines[i].split(",").map(v => v.trim().replace(/^["']|["']$/g, ""));
          const row: Record<string, any> = {};
          mappedHeaders.forEach((header, idx) => {
            if (values[idx] !== undefined && values[idx] !== "") {
              row[header] = values[idx];
            }
          });
          if (row.firstName || row.lastName) {
            rows.push(row);
          }
        }

        setCsvData(rows);
      } catch (err) {
        toast({ title: "Failed to parse CSV", description: "Please check the file format.", variant: "destructive" });
      }
      setParsing(false);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (csvData.length === 0) return;
    setImporting(true);
    try {
      const res = await apiRequest("POST", "/api/clinic/patients/bulk-import", { patients: csvData });
      const data = await res.json();
      setResult({ success: data.success, failed: data.failed, errors: data.errors || [] });
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/patients"] });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    }
    setImporting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#111827] border border-[#1e293b] rounded-xl w-full max-w-2xl mx-4 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e293b] shrink-0">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Upload className="w-5 h-5 text-emerald-400" />
            Bulk Import Patients
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {result ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-white">Import Complete</p>
                  <p className="text-xs text-gray-400">{result.success} patients imported, {result.failed} failed</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                  <p className="text-xs text-red-400 font-medium mb-2">Errors:</p>
                  <ul className="space-y-1 max-h-40 overflow-y-auto">
                    {result.errors.map((err, i) => (
                      <li key={i} className="text-xs text-gray-400">{err}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              <div className="bg-[#0a0f1e] border border-[#1e293b] border-dashed rounded-xl p-8 text-center">
                <Upload className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className="text-sm text-gray-400 mb-2">Upload a CSV file with patient data</p>
                <p className="text-xs text-gray-600 mb-4">
                  Required columns: firstName, lastName. Optional: phone, email, dateOfBirth, address, city, state, zip, insuranceId, medicaidId, wheelchair, notes
                </p>
                <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer">
                  <Upload className="w-4 h-4" />
                  Choose File
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {parsing && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                  <span className="text-sm text-gray-400 ml-2">Parsing CSV...</span>
                </div>
              )}

              {csvData.length > 0 && (
                <>
                  <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-xl p-4">
                    <p className="text-sm text-white font-medium">{csvData.length} patients ready to import</p>
                    <div className="mt-3 max-h-40 overflow-y-auto space-y-1">
                      {csvData.slice(0, 10).map((row, i) => (
                        <div key={i} className="text-xs text-gray-400 flex items-center gap-2">
                          <span className="text-gray-600 w-5">{i + 1}.</span>
                          <span className="text-white">{row.firstName} {row.lastName}</span>
                          {row.phone && <span className="text-gray-500">{row.phone}</span>}
                        </div>
                      ))}
                      {csvData.length > 10 && (
                        <p className="text-xs text-gray-600">... and {csvData.length - 10} more</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={onClose}
                      className="flex-1 px-4 py-2.5 text-sm text-gray-400 border border-[#1e293b] rounded-lg hover:bg-[#1e293b] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleImport}
                      disabled={importing}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {importing ? "Importing..." : `Import ${csvData.length} Patients`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ClinicPatients() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterWheelchair, setFilterWheelchair] = useState<"all" | "yes" | "no">("all");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);

  const { data, isLoading } = useQuery<{ patients: Patient[] }>({
    queryKey: ["/api/clinic/patients"],
    queryFn: async () => {
      const res = await fetch("/api/clinic/patients", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load patients");
      return res.json();
    },
  });

  const patients: Patient[] = data?.patients || [];

  const filteredPatients = useMemo(() => {
    let result = patients;

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) ||
          p.phone?.toLowerCase().includes(q) ||
          p.email?.toLowerCase().includes(q) ||
          p.insuranceId?.toLowerCase().includes(q) ||
          p.medicaidId?.toLowerCase().includes(q)
      );
    }

    // Wheelchair filter
    if (filterWheelchair === "yes") result = result.filter((p) => p.wheelchairRequired);
    if (filterWheelchair === "no") result = result.filter((p) => !p.wheelchairRequired);

    // Active filter
    if (filterActive === "active") result = result.filter((p) => p.active !== false);
    if (filterActive === "inactive") result = result.filter((p) => p.active === false);

    return result;
  }, [patients, search, filterWheelchair, filterActive]);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, any>) => {
      const res = await apiRequest("POST", "/api/clinic/patients/create", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/patients"] });
      setShowAddModal(false);
      toast({ title: "Patient created", description: "The patient has been added successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create patient", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/clinic/patients/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/patients"] });
      setSelectedPatient(null);
      toast({ title: "Patient removed", description: "The patient record has been deleted." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete patient", description: err.message, variant: "destructive" });
    },
  });

  // Stats
  const totalPatients = patients.length;
  const wheelchairPatients = patients.filter((p) => p.wheelchairRequired).length;
  const activePatients = patients.filter((p) => p.active !== false).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <User className="w-5 h-5 text-emerald-400" />
            Patient Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage patients, view history, and create trip requests</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBulkImport(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#111827] border border-[#1e293b] hover:border-emerald-500/30 text-white text-sm font-medium rounded-lg transition-colors"
            data-testid="button-bulk-import"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-emerald-900/20"
          >
            <Plus className="w-4 h-4" />
            Add Patient
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-gray-500">Total Patients</span>
          </div>
          <p className="text-2xl font-bold text-white">{totalPatients}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-4 h-4 text-green-400" />
            <span className="text-xs text-gray-500">Active</span>
          </div>
          <p className="text-2xl font-bold text-white">{activePatients}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Accessibility className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-gray-500">Wheelchair Required</span>
          </div>
          <p className="text-2xl font-bold text-white">{wheelchairPatients}</p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, email, or insurance ID..."
              className="w-full bg-[#0a0f1e] border border-[#1e293b] text-white text-sm rounded-lg pl-10 pr-3 py-2.5 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 placeholder-gray-600 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Wheelchair Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500 shrink-0" />
            <select
              value={filterWheelchair}
              onChange={(e) => setFilterWheelchair(e.target.value as any)}
              className="bg-[#0a0f1e] border border-[#1e293b] text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500 transition-colors"
            >
              <option value="all">All Mobility</option>
              <option value="yes">Wheelchair Only</option>
              <option value="no">Non-Wheelchair</option>
            </select>

            {/* Active Filter */}
            <select
              value={filterActive}
              onChange={(e) => setFilterActive(e.target.value as any)}
              className="bg-[#0a0f1e] border border-[#1e293b] text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500 transition-colors"
            >
              <option value="all">All Status</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>
          </div>
        </div>
        {search && (
          <p className="text-xs text-gray-500 mt-2">
            {filteredPatients.length} result{filteredPatients.length !== 1 ? "s" : ""} found
          </p>
        )}
      </div>

      {/* Patient List */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
        {/* Table Header */}
        <div className="hidden md:grid grid-cols-[1fr_140px_100px_1fr_120px_100px_60px] gap-4 px-5 py-3 border-b border-[#1e293b] bg-[#0d1424]">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Patient</span>
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Phone</span>
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">DOB</span>
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Address</span>
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Insurance</span>
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Mobility</span>
          <span></span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
          </div>
        ) : filteredPatients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <User className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm font-medium">
              {patients.length === 0 ? "No patients yet" : "No patients match your filters"}
            </p>
            <p className="text-xs mt-1 text-gray-600">
              {patients.length === 0
                ? "Add your first patient to get started"
                : "Try adjusting your search or filter criteria"}
            </p>
            {patients.length === 0 && (
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Patient
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[#1e293b]">
            {filteredPatients.map((patient) => (
              <div
                key={patient.id}
                onClick={() => setSelectedPatient(patient)}
                className="px-5 py-4 hover:bg-[#0f172a] transition-colors cursor-pointer group"
              >
                {/* Desktop Row */}
                <div className="hidden md:grid grid-cols-[1fr_140px_100px_1fr_120px_100px_60px] gap-4 items-center">
                  {/* Name + Avatar */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-[#1e293b] rounded-full flex items-center justify-center text-xs font-semibold text-emerald-400 shrink-0">
                      {(patient.firstName?.[0] || "?").toUpperCase()}
                      {(patient.lastName?.[0] || "").toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {patient.firstName} {patient.lastName}
                      </p>
                      {patient.email && (
                        <p className="text-xs text-gray-500 truncate">{patient.email}</p>
                      )}
                    </div>
                  </div>

                  {/* Phone */}
                  <p className="text-sm text-gray-300 truncate">{patient.phone || "N/A"}</p>

                  {/* DOB */}
                  <p className="text-sm text-gray-400">{formatDOB(patient.dateOfBirth)}</p>

                  {/* Address */}
                  <p className="text-sm text-gray-400 truncate">{buildFullAddress(patient)}</p>

                  {/* Insurance */}
                  <div className="min-w-0">
                    {patient.insuranceId ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded truncate max-w-full">
                        <Shield className="w-3 h-3 shrink-0" />
                        <span className="truncate">{patient.insuranceId}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">None</span>
                    )}
                  </div>

                  {/* Wheelchair Badge */}
                  <div>
                    {patient.wheelchairRequired ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-full">
                        <Accessibility className="w-3 h-3" />
                        WC
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">Standard</span>
                    )}
                  </div>

                  {/* Arrow */}
                  <div className="flex justify-end">
                    <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-emerald-400 transition-colors" />
                  </div>
                </div>

                {/* Mobile Card */}
                <div className="md:hidden space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-[#1e293b] rounded-full flex items-center justify-center text-xs font-semibold text-emerald-400 shrink-0">
                        {(patient.firstName?.[0] || "?").toUpperCase()}
                        {(patient.lastName?.[0] || "").toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">
                          {patient.firstName} {patient.lastName}
                        </p>
                        <p className="text-xs text-gray-500">{patient.phone || "No phone"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {patient.wheelchairRequired && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-full">
                          <Accessibility className="w-3 h-3" />
                        </span>
                      )}
                      <ChevronRight className="w-4 h-4 text-gray-600" />
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500 pl-12">
                    {patient.dateOfBirth && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDOB(patient.dateOfBirth)}
                      </span>
                    )}
                    {patient.insuranceId && (
                      <span className="flex items-center gap-1">
                        <Shield className="w-3 h-3" />
                        {patient.insuranceId}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer count */}
        {!isLoading && filteredPatients.length > 0 && (
          <div className="px-5 py-3 border-t border-[#1e293b] bg-[#0d1424]">
            <p className="text-xs text-gray-500">
              Showing {filteredPatients.length} of {patients.length} patient{patients.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>

      {/* Patient Detail Drawer */}
      {selectedPatient && (
        <PatientDrawer
          patient={selectedPatient}
          onClose={() => setSelectedPatient(null)}
          onDelete={(id) => deleteMutation.mutate(id)}
          isDeleting={deleteMutation.isPending}
        />
      )}

      {/* Add Patient Modal */}
      {showAddModal && (
        <AddPatientModal
          onClose={() => setShowAddModal(false)}
          onSubmit={(data) => createMutation.mutate(data)}
          isPending={createMutation.isPending}
        />
      )}

      {/* Bulk Import Modal */}
      {showBulkImport && (
        <BulkImportModal onClose={() => setShowBulkImport(false)} />
      )}
    </div>
  );
}
