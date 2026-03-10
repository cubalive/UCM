import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { Link } from "wouter";
import { Handshake, Plus } from "lucide-react";

const STATUSES = ["ALL", "DRAFT", "PENDING_APPROVAL", "ACTIVE", "EXPIRED", "TERMINATED"];

export default function BrokerContracts() {
  const [status, setStatus] = useState("ALL");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/contracts", status],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status !== "ALL") params.set("status", status);
      const res = await fetch(resolveUrl(`/api/broker/contracts?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Handshake className="w-5 h-5" /> Contracts
        </h1>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              status === s ? "bg-blue-600 text-white" : "bg-[#1e293b] text-gray-400 hover:text-white"
            }`}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs uppercase border-b border-[#1e293b]">
              <th className="text-left p-3">ID</th>
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Company</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Effective</th>
              <th className="text-left p-3">Expires</th>
              <th className="text-left p-3">Rate/Mile</th>
              <th className="text-left p-3">Rate/Trip</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e293b]">
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i}><td colSpan={8} className="p-3"><div className="h-4 bg-[#1e293b] rounded animate-pulse" /></td></tr>
              ))
            ) : (data?.contracts || []).map(({ contract, companyName }: any) => (
              <tr key={contract.id} className="hover:bg-white/5 transition-colors">
                <td className="p-3">
                  <Link href={`/contracts/${contract.id}`}>
                    <span className="text-blue-400 hover:underline cursor-pointer font-mono text-xs">{contract.publicId}</span>
                  </Link>
                </td>
                <td className="p-3 text-white">{contract.name}</td>
                <td className="p-3 text-gray-400">{companyName || "-"}</td>
                <td className="p-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${getContractStatusStyle(contract.status)}`}>
                    {contract.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="p-3 text-gray-400">{contract.effectiveDate}</td>
                <td className="p-3 text-gray-400">{contract.expirationDate || "Auto-renew"}</td>
                <td className="p-3 text-gray-400">{contract.baseRatePerMile ? `$${Number(contract.baseRatePerMile).toFixed(2)}` : "-"}</td>
                <td className="p-3 text-gray-400">{contract.baseRatePerTrip ? `$${Number(contract.baseRatePerTrip).toFixed(2)}` : "-"}</td>
              </tr>
            ))}
            {!isLoading && (data?.contracts || []).length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-gray-500">No contracts found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getContractStatusStyle(status: string): string {
  const map: Record<string, string> = {
    DRAFT: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    PENDING_APPROVAL: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    ACTIVE: "bg-green-500/20 text-green-400 border-green-500/30",
    EXPIRED: "bg-red-500/20 text-red-400 border-red-500/30",
    TERMINATED: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return map[status] || map.DRAFT;
}
