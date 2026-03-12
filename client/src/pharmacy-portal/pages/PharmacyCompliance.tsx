import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  ShieldCheck,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Eye,
  X,
  User,
  Fingerprint,
  Truck,
} from "lucide-react";
import { Link } from "wouter";

export default function PharmacyCompliance() {
  const { token } = useAuth();
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/pharmacy/compliance/summary"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/compliance/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load compliance data");
      return res.json();
    },
  });

  const { data: custodyData } = useQuery({
    queryKey: ["/api/pharmacy/compliance/chain-of-custody", selectedOrderId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/compliance/chain-of-custody/${selectedOrderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load chain of custody");
      return res.json();
    },
    enabled: !!selectedOrderId,
  });

  const summary = data?.summary || {};
  const scheduleBreakdown = data?.scheduleBreakdown || [];
  const recentDeliveries = data?.recentDeliveries || [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-violet-400" />
          Controlled Substance Compliance
        </h1>
        <p className="text-sm text-gray-400 mt-1">DEA compliance tracking, chain of custody, and signature verification</p>
      </div>

      {/* DEA Compliance Status */}
      <div className={`rounded-xl p-5 border ${summary.deaCompliant ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
        <div className="flex items-center gap-3">
          {summary.deaCompliant ? (
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-8 h-8 text-red-400" />
          )}
          <div>
            <h2 className={`text-lg font-semibold ${summary.deaCompliant ? "text-emerald-400" : "text-red-400"}`}>
              {summary.deaCompliant ? "DEA Compliant" : "Compliance Issues Detected"}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {summary.deaCompliant
                ? "All controlled substance deliveries have required documentation."
                : "Some deliveries are missing required signatures or ID verification."
              }
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-20 mb-3" />
              <div className="h-8 bg-gray-700 rounded w-12" />
            </div>
          ))
        ) : (
          <>
            <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase">Total Controlled</p>
              <p className="text-3xl font-bold text-white mt-2">{summary.totalControlled || 0}</p>
            </div>
            <div className="bg-[#111827] border border-emerald-500/20 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase">Delivered</p>
              <p className="text-3xl font-bold text-emerald-400 mt-2">{summary.delivered || 0}</p>
            </div>
            <div className="bg-[#111827] border border-violet-500/20 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase">Signature Rate</p>
              <p className="text-3xl font-bold text-violet-400 mt-2">{summary.signatureRate || 100}%</p>
            </div>
            <div className="bg-[#111827] border border-amber-500/20 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase">Pending</p>
              <p className="text-3xl font-bold text-amber-400 mt-2">{summary.pending || 0}</p>
            </div>
          </>
        )}
      </div>

      {/* Schedule Breakdown */}
      {scheduleBreakdown.length > 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">DEA Schedule Breakdown</h3>
          <div className="flex flex-wrap gap-3">
            {scheduleBreakdown.map((s: any) => (
              <div
                key={s.scheduleClass}
                className={`px-4 py-3 rounded-lg border ${
                  s.scheduleClass === "CII"
                    ? "bg-red-500/10 border-red-500/20"
                    : s.scheduleClass === "CIII"
                    ? "bg-amber-500/10 border-amber-500/20"
                    : "bg-blue-500/10 border-blue-500/20"
                }`}
              >
                <p className={`text-lg font-bold ${
                  s.scheduleClass === "CII" ? "text-red-400" : s.scheduleClass === "CIII" ? "text-amber-400" : "text-blue-400"
                }`}>
                  {s.count}
                </p>
                <p className="text-xs text-gray-400">{s.scheduleClass}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Controlled Deliveries */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-x-auto">
        <div className="px-5 py-4 border-b border-[#1e293b]">
          <h3 className="text-sm font-semibold text-white">Controlled Substance Deliveries</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1e293b]">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipient</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Signature</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">ID Check</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Schedule</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Audit</th>
            </tr>
          </thead>
          <tbody>
            {recentDeliveries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-12 text-center text-gray-500 text-sm">
                  No controlled substance orders found
                </td>
              </tr>
            ) : (
              recentDeliveries.map((order: any) => {
                const isDelivered = order.status === "DELIVERED";
                return (
                  <tr key={order.id} className="border-b border-[#1e293b]/50 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3">
                      <Link href={`/orders/${order.id}`}>
                        <span className="text-sm font-mono text-violet-400 hover:text-violet-300 cursor-pointer">{order.publicId}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-sm text-white">{order.recipientName}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        isDelivered ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                      }`}>
                        {order.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      {isDelivered ? (
                        order.hasSignature ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
                            <CheckCircle2 className="w-3 h-3" /> Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-400 text-xs">
                            <AlertTriangle className="w-3 h-3" /> Missing
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-gray-600">
                          {order.requiresSignature ? "Required" : "N/A"}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {order.requiresIdVerification ? (
                        <span className={`inline-flex items-center gap-1 text-xs ${
                          isDelivered ? "text-emerald-400" : "text-amber-400"
                        }`}>
                          <Fingerprint className="w-3 h-3" />
                          {isDelivered ? "Verified" : "Required"}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600">N/A</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className="text-[9px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded font-bold">CII</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-400">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button
                        onClick={() => setSelectedOrderId(order.id)}
                        className="p-1.5 rounded bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
                        title="View chain of custody"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Chain of Custody Modal */}
      {selectedOrderId && custodyData && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelectedOrderId(null)}>
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-violet-400" />
                Chain of Custody — {custodyData.publicId}
              </h3>
              <button onClick={() => setSelectedOrderId(null)} className="p-1 hover:bg-white/5 rounded">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {/* Status indicators */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className={`px-3 py-2 rounded-lg text-xs text-center border ${custodyData.hasSignature ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
                <FileText className="w-4 h-4 mx-auto mb-1" />
                Signature {custodyData.hasSignature ? "Collected" : "Missing"}
              </div>
              <div className={`px-3 py-2 rounded-lg text-xs text-center border ${custodyData.requiresIdVerification ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-gray-800 text-gray-500 border-gray-700"}`}>
                <Fingerprint className="w-4 h-4 mx-auto mb-1" />
                ID {custodyData.requiresIdVerification ? "Required" : "Not Required"}
              </div>
              <div className="px-3 py-2 rounded-lg text-xs text-center border bg-violet-500/10 text-violet-400 border-violet-500/20">
                <Truck className="w-4 h-4 mx-auto mb-1" />
                {custodyData.driverName || "No Driver"}
              </div>
            </div>

            {custodyData.signedByName && (
              <div className="bg-[#0a0f1e] rounded-lg p-3 mb-4 flex items-center gap-2">
                <User className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-white">Signed by: <strong>{custodyData.signedByName}</strong></span>
              </div>
            )}

            {/* Audit Trail */}
            <h4 className="text-sm font-medium text-gray-400 mb-3">Audit Trail</h4>
            {custodyData.auditTrail && custodyData.auditTrail.length > 0 ? (
              <div className="space-y-3">
                {custodyData.auditTrail.map((entry: any, i: number) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full ${i === 0 ? "bg-violet-400" : "bg-gray-600"}`} />
                      {i < custodyData.auditTrail.length - 1 && <div className="w-px h-8 bg-[#1e293b]" />}
                    </div>
                    <div className="flex-1 pb-2">
                      <p className="text-xs text-white font-medium">{entry.type.replace(/_/g, " ")}</p>
                      {entry.description && <p className="text-[10px] text-gray-400 mt-0.5">{entry.description}</p>}
                      <p className="text-[10px] text-gray-600 mt-0.5">{new Date(entry.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No audit trail entries</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
