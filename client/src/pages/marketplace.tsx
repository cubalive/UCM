import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { ShoppingCart, MapPin, Clock, DollarSign, Gavel } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export default function MarketplacePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [serviceType, setServiceType] = useState("");
  const [date, setDate] = useState("");
  const [bidDialog, setBidDialog] = useState<any>(null);
  const [bidAmount, setBidAmount] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/marketplace/requests", serviceType, date],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (serviceType) params.set("serviceType", serviceType);
      if (date) params.set("date", date);
      const res = await fetch(resolveUrl(`/api/marketplace/requests?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const bidMutation = useMutation({
    mutationFn: async ({ requestId, amount }: { requestId: number; amount: string }) => {
      const res = await fetch(resolveUrl(`/api/marketplace/requests/${requestId}/bid`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bidAmount: amount, slaGuarantee: true }),
      });
      if (!res.ok) throw new Error("Failed to submit bid");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bid submitted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/requests"] });
      setBidDialog(null);
      setBidAmount("");
    },
    onError: () => {
      toast({ title: "Failed to submit bid", variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ShoppingCart className="w-6 h-6" /> Marketplace</h1>
        <p className="text-muted-foreground text-sm">Browse and bid on open transportation requests from brokers</p>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={serviceType}
          onChange={e => setServiceType(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm bg-background"
        >
          <option value="">All Services</option>
          <option value="ambulatory">Ambulatory</option>
          <option value="wheelchair">Wheelchair</option>
          <option value="stretcher">Stretcher</option>
          <option value="bariatric">Bariatric</option>
        </select>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i}><CardContent className="h-48 animate-pulse" /></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data?.requests || []).map(({ request, brokerName }: any) => (
            <Card key={request.id} className="hover:border-primary/50 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-xs text-primary">{request.publicId}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    request.status === "OPEN" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                  }`}>
                    {request.status}
                  </span>
                </div>

                <p className="font-medium mb-2">{request.memberName}</p>

                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3 text-green-500" /><span className="truncate">{request.pickupAddress}</span></div>
                  <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3 text-red-500" /><span className="truncate">{request.dropoffAddress}</span></div>
                  <div className="flex items-center gap-1.5"><Clock className="w-3 h-3" />{request.requestedDate} at {request.requestedPickupTime}</div>
                </div>

                <div className="flex items-center justify-between mt-4 pt-3 border-t">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="capitalize">{request.serviceType}</span>
                    {request.maxBudget && <span className="flex items-center gap-0.5 text-green-600"><DollarSign className="w-3 h-3" />{Number(request.maxBudget).toFixed(0)} max</span>}
                  </div>
                  {user?.companyId && (
                    <Dialog open={bidDialog?.id === request.id} onOpenChange={open => { if (!open) setBidDialog(null); }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" onClick={() => setBidDialog(request)}>
                          <Gavel className="w-3 h-3 mr-1" /> Bid
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Place Bid on {request.publicId}</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={e => { e.preventDefault(); bidMutation.mutate({ requestId: request.id, amount: bidAmount }); }}>
                          <div className="space-y-4">
                            <div className="text-sm text-muted-foreground">
                              <p>{request.memberName} - {request.requestedDate}</p>
                              <p>{request.pickupAddress} to {request.dropoffAddress}</p>
                              {request.maxBudget && <p className="text-green-600">Budget: ${Number(request.maxBudget).toFixed(2)}</p>}
                            </div>
                            <div>
                              <label className="text-sm font-medium">Bid Amount ($) *</label>
                              <Input
                                required
                                type="number"
                                step="0.01"
                                min="1"
                                value={bidAmount}
                                onChange={e => setBidAmount(e.target.value)}
                                placeholder="Enter your bid"
                              />
                            </div>
                            <Button type="submit" disabled={bidMutation.isPending} className="w-full">
                              {bidMutation.isPending ? "Submitting..." : "Submit Bid"}
                            </Button>
                          </div>
                        </form>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
                {brokerName && <p className="text-[10px] text-muted-foreground mt-2">{brokerName}</p>}
              </CardContent>
            </Card>
          ))}
          {(data?.requests || []).length === 0 && (
            <div className="col-span-full text-center py-16 text-muted-foreground">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No open requests in the marketplace.</p>
              <p className="text-sm mt-1">Brokers will post trip requests here for companies to bid on.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
