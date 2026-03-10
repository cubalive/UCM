import { useQuery } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { useRoute, Link } from "wouter";
import { ArrowLeft, Handshake, DollarSign } from "lucide-react";

export default function BrokerContractDetail() {
  const [, params] = useRoute("/contracts/:id");
  const contractId = params?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["/api/broker/contracts", contractId],
    queryFn: async () => {
      const res = await fetch(resolveUrl(`/api/broker/contracts/${contractId}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!contractId,
  });

  if (isLoading) return <div className="p-6"><div className="h-64 bg-[#111827] rounded-xl animate-pulse" /></div>;

  const contract = data?.contract;
  if (!contract) return <div className="p-6 text-gray-400">Contract not found.</div>;

  const rateCards = data?.rateCards || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/contracts">
          <button className="p-2 hover:bg-white/5 rounded-lg"><ArrowLeft className="w-4 h-4 text-gray-400" /></button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Handshake className="w-5 h-5" /> {contract.name}
          </h1>
          <p className="text-sm text-gray-400">{contract.publicId} - {data.companyName || "Company"}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold text-white">Contract Details</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-gray-500 text-xs">Status</p><p className="text-white">{contract.status}</p></div>
            <div><p className="text-gray-500 text-xs">Company</p><p className="text-white">{data.companyName}</p></div>
            <div><p className="text-gray-500 text-xs">Effective Date</p><p className="text-white">{contract.effectiveDate}</p></div>
            <div><p className="text-gray-500 text-xs">Expiration</p><p className="text-white">{contract.expirationDate || "Auto-renew"}</p></div>
            <div><p className="text-gray-500 text-xs">Base Rate/Mile</p><p className="text-white">{contract.baseRatePerMile ? `$${Number(contract.baseRatePerMile).toFixed(4)}` : "-"}</p></div>
            <div><p className="text-gray-500 text-xs">Base Rate/Trip</p><p className="text-white">{contract.baseRatePerTrip ? `$${Number(contract.baseRatePerTrip).toFixed(2)}` : "-"}</p></div>
            <div><p className="text-gray-500 text-xs">Payment Terms</p><p className="text-white">{contract.paymentTermsDays} days</p></div>
            <div><p className="text-gray-500 text-xs">SLA On-Time</p><p className="text-white">{contract.slaOnTimePercent ? `${Number(contract.slaOnTimePercent)}%` : "-"}</p></div>
            <div><p className="text-gray-500 text-xs">Wait Time/15min</p><p className="text-white">{contract.waitTimePer15Min ? `$${Number(contract.waitTimePer15Min).toFixed(2)}` : "-"}</p></div>
            <div><p className="text-gray-500 text-xs">No-Show Fee</p><p className="text-white">{contract.noShowFee ? `$${Number(contract.noShowFee).toFixed(2)}` : "-"}</p></div>
          </div>
          {contract.notes && (
            <div className="pt-3 border-t border-[#1e293b]">
              <p className="text-xs text-gray-500">Notes</p>
              <p className="text-sm text-gray-300">{contract.notes}</p>
            </div>
          )}
        </div>

        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <DollarSign className="w-4 h-4" /> Rate Cards ({rateCards.length})
          </h2>
          {rateCards.length === 0 ? (
            <p className="text-sm text-gray-500">No rate cards configured.</p>
          ) : (
            <div className="space-y-3">
              {rateCards.map((card: any) => (
                <div key={card.id} className="bg-[#0f172a] border border-[#1e293b] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-white">{card.name}</p>
                    <span className={`px-2 py-0.5 rounded text-[10px] ${card.isActive ? "bg-green-500/20 text-green-400" : "bg-gray-500/20 text-gray-400"}`}>
                      {card.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-gray-400">
                    <div><span className="text-gray-500">Type:</span> {card.serviceType}</div>
                    <div><span className="text-gray-500">Base:</span> ${Number(card.baseFare).toFixed(2)}</div>
                    <div><span className="text-gray-500">Per Mile:</span> ${Number(card.perMileRate).toFixed(4)}</div>
                    {card.minimumFare && <div><span className="text-gray-500">Min:</span> ${Number(card.minimumFare).toFixed(2)}</div>}
                    {card.maximumFare && <div><span className="text-gray-500">Max:</span> ${Number(card.maximumFare).toFixed(2)}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
