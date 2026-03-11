import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveUrl } from "@/lib/api";
import { Pill, Plus, CheckCircle, XCircle, Package, MapPin, Phone, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

export default function AdminPharmaciesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ALL");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/pharmacies", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const res = await fetch(resolveUrl(`/api/admin/pharmacies?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (pharmacyData: any) => {
      const res = await fetch(resolveUrl("/api/admin/pharmacies"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(pharmacyData),
      });
      if (!res.ok) throw new Error("Failed to create pharmacy");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pharmacy created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pharmacies"] });
      setShowCreate(false);
    },
    onError: () => {
      toast({ title: "Error creating pharmacy", variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await fetch(resolveUrl(`/api/admin/pharmacies/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ active }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pharmacy updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pharmacies"] });
    },
  });

  const pharmacies = data?.pharmacies || [];
  const stats = data?.stats || { total: 0, active: 0, inactive: 0 };

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      name: fd.get("name"),
      licenseNumber: fd.get("licenseNumber"),
      npiNumber: fd.get("npiNumber"),
      address: fd.get("address"),
      phone: fd.get("phone"),
      email: fd.get("email"),
      contactName: fd.get("contactName"),
      operatingHoursStart: fd.get("operatingHoursStart") || "08:00",
      operatingHoursEnd: fd.get("operatingHoursEnd") || "20:00",
      acceptsControlledSubstances: fd.get("acceptsControlledSubstances") === "on",
      hasRefrigeratedStorage: fd.get("hasRefrigeratedStorage") === "on",
      maxDeliveryRadiusMiles: parseInt(fd.get("maxDeliveryRadiusMiles") as string) || 25,
      averagePrepTimeMinutes: parseInt(fd.get("averagePrepTimeMinutes") as string) || 30,
    });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500">
            <Pill className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Pharmacies</h1>
            <p className="text-sm text-muted-foreground">Manage pharmacy partners and delivery settings</p>
          </div>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Pharmacy
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Pharmacy</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label htmlFor="name">Pharmacy Name *</Label>
                  <Input id="name" name="name" required placeholder="e.g. CVS Pharmacy #1234" />
                </div>
                <div>
                  <Label htmlFor="licenseNumber">License Number</Label>
                  <Input id="licenseNumber" name="licenseNumber" placeholder="PH-XXXX" />
                </div>
                <div>
                  <Label htmlFor="npiNumber">NPI Number</Label>
                  <Input id="npiNumber" name="npiNumber" placeholder="10 digits" />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="address">Address *</Label>
                  <Input id="address" name="address" required placeholder="Full address" />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" name="phone" type="tel" placeholder="(555) 123-4567" />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" placeholder="pharmacy@example.com" />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="contactName">Contact Person</Label>
                  <Input id="contactName" name="contactName" placeholder="Pharmacist name" />
                </div>
                <div>
                  <Label htmlFor="operatingHoursStart">Opens At</Label>
                  <Input id="operatingHoursStart" name="operatingHoursStart" type="time" defaultValue="08:00" />
                </div>
                <div>
                  <Label htmlFor="operatingHoursEnd">Closes At</Label>
                  <Input id="operatingHoursEnd" name="operatingHoursEnd" type="time" defaultValue="20:00" />
                </div>
                <div>
                  <Label htmlFor="maxDeliveryRadiusMiles">Max Delivery Radius (mi)</Label>
                  <Input id="maxDeliveryRadiusMiles" name="maxDeliveryRadiusMiles" type="number" defaultValue="25" />
                </div>
                <div>
                  <Label htmlFor="averagePrepTimeMinutes">Avg Prep Time (min)</Label>
                  <Input id="averagePrepTimeMinutes" name="averagePrepTimeMinutes" type="number" defaultValue="30" />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="acceptsControlledSubstances" name="acceptsControlledSubstances" className="rounded" />
                  <Label htmlFor="acceptsControlledSubstances" className="text-sm">Controlled Substances</Label>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="hasRefrigeratedStorage" name="hasRefrigeratedStorage" className="rounded" />
                  <Label htmlFor="hasRefrigeratedStorage" className="text-sm">Refrigerated Storage</Label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating..." : "Create Pharmacy"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500/10">
              <Pill className="w-5 h-5 text-violet-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total Pharmacies</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-green-500/10">
              <CheckCircle className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.active}</p>
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-500/10">
              <XCircle className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.inactive}</p>
              <p className="text-xs text-muted-foreground">Inactive</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {["ALL", "ACTIVE", "INACTIVE"].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => setStatusFilter(s)}
          >
            {s === "ALL" ? "All" : s === "ACTIVE" ? "Active" : "Inactive"}
          </Button>
        ))}
      </div>

      {/* Pharmacy list */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading pharmacies...</div>
      ) : pharmacies.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Pill className="w-12 h-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">No pharmacies found</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Add your first pharmacy partner to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {pharmacies.map((p: any) => (
            <Card key={p.id} className={!p.active ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-base font-semibold">{p.name}</h3>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        p.active
                          ? "bg-green-500/10 text-green-500"
                          : "bg-red-500/10 text-red-500"
                      }`}>
                        {p.active ? "Active" : "Inactive"}
                      </span>
                      {p.acceptsControlledSubstances && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-500">
                          CII
                        </span>
                      )}
                      {p.hasRefrigeratedStorage && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-500">
                          COLD
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5" />
                        <span className="truncate">{p.address}</span>
                      </div>
                      {p.phone && (
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5" />
                          <span>{p.phone}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{p.operatingHoursStart || "08:00"} - {p.operatingHoursEnd || "20:00"}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Package className="w-3.5 h-3.5" />
                        <span>{p.maxDeliveryRadiusMiles || 25} mi radius</span>
                      </div>
                    </div>
                    {p.licenseNumber && (
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        License: {p.licenseNumber} {p.npiNumber ? `• NPI: ${p.npiNumber}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Button
                      size="sm"
                      variant={p.active ? "destructive" : "default"}
                      onClick={() => toggleMutation.mutate({ id: p.id, active: !p.active })}
                    >
                      {p.active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
