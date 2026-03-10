import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { Handshake, Plus, CheckCircle, XCircle, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const BROKER_TYPES = ["INSURANCE", "MEDICAID", "MEDICARE", "MANAGED_CARE", "PRIVATE_PAYER", "GOVERNMENT", "TPA"];

export default function AdminBrokersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ALL");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/brokers", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const res = await fetch(resolveUrl(`/api/admin/brokers?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (brokerData: any) => {
      const res = await fetch(resolveUrl("/api/admin/brokers"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(brokerData),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Broker created" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/brokers"] });
      setShowCreate(false);
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(resolveUrl(`/api/admin/brokers/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Broker updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/brokers"] });
    },
  });

  const [newBroker, setNewBroker] = useState({
    name: "",
    legalName: "",
    type: "PRIVATE_PAYER",
    email: "",
    phone: "",
    contactName: "",
    contactEmail: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    npi: "",
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Handshake className="w-6 h-6" /> Broker Management</h1>
          <p className="text-muted-foreground text-sm">Manage transportation broker organizations</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> Add Broker</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create New Broker</DialogTitle>
            </DialogHeader>
            <form onSubmit={e => { e.preventDefault(); createMutation.mutate(newBroker); }} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Name *</Label><Input required value={newBroker.name} onChange={e => setNewBroker(p => ({...p, name: e.target.value}))} /></div>
                <div><Label>Legal Name</Label><Input value={newBroker.legalName} onChange={e => setNewBroker(p => ({...p, legalName: e.target.value}))} /></div>
                <div>
                  <Label>Type</Label>
                  <select value={newBroker.type} onChange={e => setNewBroker(p => ({...p, type: e.target.value}))} className="w-full rounded-md border px-3 py-2 text-sm bg-background">
                    {BROKER_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div><Label>NPI</Label><Input value={newBroker.npi} onChange={e => setNewBroker(p => ({...p, npi: e.target.value}))} /></div>
                <div><Label>Email</Label><Input type="email" value={newBroker.email} onChange={e => setNewBroker(p => ({...p, email: e.target.value}))} /></div>
                <div><Label>Phone</Label><Input value={newBroker.phone} onChange={e => setNewBroker(p => ({...p, phone: e.target.value}))} /></div>
                <div><Label>Contact Name</Label><Input value={newBroker.contactName} onChange={e => setNewBroker(p => ({...p, contactName: e.target.value}))} /></div>
                <div><Label>Contact Email</Label><Input type="email" value={newBroker.contactEmail} onChange={e => setNewBroker(p => ({...p, contactEmail: e.target.value}))} /></div>
              </div>
              <Button type="submit" disabled={createMutation.isPending} className="w-full">
                {createMutation.isPending ? "Creating..." : "Create Broker"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-2">
        {["ALL", "PENDING_APPROVAL", "ACTIVE", "SUSPENDED", "INACTIVE"].map(s => (
          <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(s)}>
            {s.replace(/_/g, " ")}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-3">ID</th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Contact</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i}><td colSpan={6} className="p-3"><div className="h-4 bg-muted rounded animate-pulse" /></td></tr>
                ))
              ) : (data?.brokers || []).map((broker: any) => (
                <tr key={broker.id} className="hover:bg-muted/50">
                  <td className="p-3 font-mono text-xs">{broker.publicId}</td>
                  <td className="p-3 font-medium">{broker.name}</td>
                  <td className="p-3 text-muted-foreground">{broker.type?.replace(/_/g, " ")}</td>
                  <td className="p-3 text-muted-foreground">{broker.contactName || broker.email || "-"}</td>
                  <td className="p-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      broker.status === "ACTIVE" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" :
                      broker.status === "PENDING_APPROVAL" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" :
                      "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
                    }`}>
                      {broker.status?.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      {broker.status === "PENDING_APPROVAL" && (
                        <Button size="sm" variant="outline" onClick={() => approveMutation.mutate({ id: broker.id, status: "ACTIVE" })}>
                          <CheckCircle className="w-3 h-3 mr-1" /> Approve
                        </Button>
                      )}
                      {broker.status === "ACTIVE" && (
                        <Button size="sm" variant="outline" onClick={() => approveMutation.mutate({ id: broker.id, status: "SUSPENDED" })}>
                          <XCircle className="w-3 h-3 mr-1" /> Suspend
                        </Button>
                      )}
                      {broker.status === "SUSPENDED" && (
                        <Button size="sm" variant="outline" onClick={() => approveMutation.mutate({ id: broker.id, status: "ACTIVE" })}>
                          Reactivate
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && (data?.brokers || []).length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No brokers found. Click "Add Broker" to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
