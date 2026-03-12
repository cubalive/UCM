import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import {
  ClipboardCheck,
  CheckCircle,
  XCircle,
  Clock,
  Download,
  Shield,
  Users,
  FileText,
} from "lucide-react";
import { useState } from "react";

export default function BrokerCompliance() {
  const [tab, setTab] = useState<"checklist" | "credentialing" | "hipaa" | "audit">("checklist");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/compliance/summary"],
    queryFn: async () => {
      const res = await fetch(resolveUrl("/api/broker/compliance/summary"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ["/api/broker/compliance/audit-trail"],
    queryFn: async () => {
      const res = await fetch(resolveUrl("/api/broker/compliance/audit-trail"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: tab === "audit",
  });

  const handleExportAudit = () => {
    if (!auditData?.events) return;
    const csv = [
      "ID,Event Type,Description,Performed By,Date",
      ...auditData.events.map((e: any) =>
        `${e.id},"${e.eventType}","${e.description || ""}",${e.performedBy || ""},${e.createdAt}`
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-trail-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-[#1e293b] rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 h-28 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const statusIcon = (status: string) => {
    if (status === "PASS" || status === "VALID") return <CheckCircle className="w-4 h-4 text-green-400" />;
    if (status === "FAIL" || status === "EXPIRED") return <XCircle className="w-4 h-4 text-red-400" />;
    return <Clock className="w-4 h-4 text-amber-400" />;
  };

  const statusColor = (status: string) => {
    if (status === "PASS" || status === "VALID") return "bg-green-500/20 text-green-400";
    if (status === "FAIL" || status === "EXPIRED") return "bg-red-500/20 text-red-400";
    return "bg-amber-500/20 text-amber-400";
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5" /> Compliance Reporting
        </h1>
        <p className="text-sm text-gray-400 mt-1">Regulatory compliance, credentialing & audit trails</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-blue-400" />
            <p className="text-xs text-gray-500 uppercase">Overall Score</p>
          </div>
          <p className={`text-3xl font-bold ${(data?.overallScore ?? 0) >= 90 ? "text-green-400" : "text-amber-400"}`}>
            {data?.overallScore ?? 0}%
          </p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <p className="text-xs text-gray-500 uppercase">Passed</p>
          </div>
          <p className="text-3xl font-bold text-green-400">{data?.passCount ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">of {data?.totalItems ?? 0}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-4 h-4 text-red-400" />
            <p className="text-xs text-gray-500 uppercase">Failed</p>
          </div>
          <p className="text-3xl font-bold text-red-400">{data?.failCount ?? 0}</p>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <p className="text-xs text-gray-500 uppercase">Pending</p>
          </div>
          <p className="text-3xl font-bold text-amber-400">{data?.pendingCount ?? 0}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0f172a] rounded-lg p-1 w-fit">
        {(["checklist", "credentialing", "hipaa", "audit"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors capitalize ${
              tab === t ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            {t === "hipaa" ? "HIPAA" : t === "audit" ? "Audit Trail" : t}
          </button>
        ))}
      </div>

      {/* Checklist */}
      {tab === "checklist" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4">Regulatory Compliance Checklist</h2>
          <div className="space-y-2">
            {(data?.checklist || []).map((item: any) => (
              <div key={item.id} className="flex items-center justify-between p-3 bg-[#0f172a] rounded-lg">
                <div className="flex items-center gap-3">
                  {statusIcon(item.status)}
                  <div>
                    <p className="text-sm text-white">{item.name}</p>
                    <p className="text-xs text-gray-500">{item.category}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColor(item.status)}`}>
                    {item.status}
                  </span>
                  <span className="text-[10px] text-gray-600">
                    {new Date(item.lastChecked).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Credentialing */}
      {tab === "credentialing" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Users className="w-4 h-4" /> Provider Credentialing Status
          </h2>
          {(data?.providerCredentialing || []).length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No providers to credential yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {(data?.providerCredentialing || []).map((p: any) => (
                <div key={p.companyId} className="p-4 bg-[#0f172a] rounded-lg border border-[#1e293b]">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-medium text-white">{p.companyName}</p>
                      <p className="text-xs text-gray-500">Last verified: {p.lastVerified}</p>
                    </div>
                    <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${
                      p.status === "CREDENTIALED" ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400"
                    }`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {(p.items || []).map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2">
                        {statusIcon(item.status)}
                        <span className="text-xs text-gray-400">{item.name}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-4 mt-3 text-xs text-gray-500">
                    <span>Insurance expires: {p.insuranceExpiry}</span>
                    <span>License expires: {p.licenseExpiry}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* HIPAA */}
      {tab === "hipaa" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" /> HIPAA Compliance Indicators
          </h2>
          {data?.hipaaIndicators ? (
            <div className="space-y-3">
              {Object.entries(data.hipaaIndicators).map(([key, value]) => {
                const labels: Record<string, string> = {
                  phiEncryption: "PHI Data Encryption",
                  auditLogging: "PHI Access Audit Logging",
                  accessControls: "Role-Based Access Controls",
                  breachPlan: "Breach Notification Plan",
                  baaInPlace: "Business Associate Agreements",
                  lastSecurityReview: "Last Security Review Date",
                };
                const isDate = key === "lastSecurityReview";
                return (
                  <div key={key} className="flex items-center justify-between p-3 bg-[#0f172a] rounded-lg">
                    <div className="flex items-center gap-3">
                      {isDate ? (
                        <Clock className="w-4 h-4 text-blue-400" />
                      ) : value ? (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400" />
                      )}
                      <span className="text-sm text-white">{labels[key] || key}</span>
                    </div>
                    {isDate ? (
                      <span className="text-xs text-gray-400">{String(value)}</span>
                    ) : (
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        value ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                      }`}>
                        {value ? "ACTIVE" : "INACTIVE"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">No HIPAA indicators available.</p>
          )}
        </div>
      )}

      {/* Audit Trail */}
      {tab === "audit" && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <FileText className="w-4 h-4" /> Audit Trail
            </h2>
            <button
              onClick={handleExportAudit}
              disabled={!auditData?.events?.length}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-xs font-medium transition-colors"
            >
              <Download className="w-3 h-3" /> Export CSV
            </button>
          </div>
          {auditLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-[#0f172a] rounded animate-pulse" />
              ))}
            </div>
          ) : (auditData?.events || []).length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No audit events recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {(auditData?.events || []).map((event: any) => (
                <div key={event.id} className="flex items-start gap-3 p-3 bg-[#0f172a] rounded-lg">
                  <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-blue-400">{event.eventType}</span>
                      <span className="text-[10px] text-gray-600">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 mt-0.5 truncate">{event.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
