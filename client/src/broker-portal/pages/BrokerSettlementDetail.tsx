import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { useRoute, Link } from "wouter";
import { ArrowLeft, DollarSign } from "lucide-react";

export default function BrokerSettlementDetail() {
  const [, params] = useRoute("/settlements/:id");
  const settlementId = params?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/settlements", settlementId],
    queryFn: async () => {
      const res = await fetch(resolveUrl(`/api/broker/settlements/${settlementId}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!settlementId,
  });

  if (isLoading) return <div className="p-6"><div className="h-64 bg-[#111827] rounded-xl animate-pulse" /></div>;

  const settlement = data?.settlement;
  if (!settlement) return <div className="p-6 text-gray-400">Settlement not found.</div>;

  const items = data?.items || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settlements">
          <button className="p-2 hover:bg-white/5 rounded-lg"><ArrowLeft className="w-4 h-4 text-gray-400" /></button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white">{settlement.publicId}</h1>
          <p className="text-sm text-gray-400">{data.companyName} - {settlement.periodStart} to {settlement.periodEnd}</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Trips", value: settlement.totalTrips },
          { label: "Gross Amount", value: `$${Number(settlement.grossAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
          { label: "Platform Fee", value: `$${Number(settlement.platformFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
          { label: "Net Amount", value: `$${Number(settlement.netAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">{label}</p>
            <p className="text-lg font-bold text-white mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Line Items */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#1e293b]">
          <h2 className="text-sm font-semibold text-white">Line Items ({items.length})</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs uppercase border-b border-[#1e293b]">
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Member</th>
              <th className="text-left p-3">Pickup</th>
              <th className="text-left p-3">Dropoff</th>
              <th className="text-right p-3">Miles</th>
              <th className="text-right p-3">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e293b]">
            {items.map((item: any) => (
              <tr key={item.id} className="hover:bg-white/5">
                <td className="p-3 text-gray-400">{item.serviceDate}</td>
                <td className="p-3 text-white">{item.memberName || "-"}</td>
                <td className="p-3 text-gray-400 max-w-[180px] truncate">{item.pickupAddress}</td>
                <td className="p-3 text-gray-400 max-w-[180px] truncate">{item.dropoffAddress}</td>
                <td className="p-3 text-right text-gray-400">{item.miles ? `${Number(item.miles).toFixed(1)}` : "-"}</td>
                <td className="p-3 text-right text-white">${Number(item.amount).toFixed(2)}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-gray-500">No line items.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
