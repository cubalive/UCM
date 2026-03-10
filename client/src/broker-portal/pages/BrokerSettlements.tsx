import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { Link } from "wouter";
import { DollarSign } from "lucide-react";

const STATUSES = ["ALL", "PENDING", "INVOICED", "PAID", "PARTIAL", "DISPUTED", "WRITTEN_OFF"];

export default function BrokerSettlements() {
  const [status, setStatus] = useState("ALL");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/settlements", status],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status !== "ALL") params.set("status", status);
      const res = await fetch(resolveUrl(`/api/broker/settlements?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <DollarSign className="w-5 h-5" /> Settlements
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
              <th className="text-left p-3">Company</th>
              <th className="text-left p-3">Period</th>
              <th className="text-left p-3">Trips</th>
              <th className="text-right p-3">Gross</th>
              <th className="text-right p-3">Platform Fee</th>
              <th className="text-right p-3">Net</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e293b]">
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i}><td colSpan={9} className="p-3"><div className="h-4 bg-[#1e293b] rounded animate-pulse" /></td></tr>
              ))
            ) : (data?.settlements || []).map(({ settlement, companyName }: any) => (
              <tr key={settlement.id} className="hover:bg-white/5 transition-colors">
                <td className="p-3">
                  <Link href={`/settlements/${settlement.id}`}>
                    <span className="text-blue-400 hover:underline cursor-pointer font-mono text-xs">{settlement.publicId}</span>
                  </Link>
                </td>
                <td className="p-3 text-white">{companyName || "-"}</td>
                <td className="p-3 text-gray-400">{settlement.periodStart} — {settlement.periodEnd}</td>
                <td className="p-3 text-gray-400">{settlement.totalTrips}</td>
                <td className="p-3 text-right text-white">${Number(settlement.grossAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="p-3 text-right text-gray-400">${Number(settlement.platformFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="p-3 text-right text-green-400 font-medium">${Number(settlement.netAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="p-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${getSettlementStyle(settlement.status)}`}>
                    {settlement.status}
                  </span>
                </td>
                <td className="p-3 text-gray-400">{settlement.dueDate || "-"}</td>
              </tr>
            ))}
            {!isLoading && (data?.settlements || []).length === 0 && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-gray-500">No settlements found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getSettlementStyle(status: string): string {
  const map: Record<string, string> = {
    PENDING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    INVOICED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    PAID: "bg-green-500/20 text-green-400 border-green-500/30",
    PARTIAL: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    DISPUTED: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    WRITTEN_OFF: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return map[status] || map.PENDING;
}
