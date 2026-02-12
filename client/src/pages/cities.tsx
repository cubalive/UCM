import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, MapPin } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function CitiesPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: cities, isLoading } = useQuery<any[]>({
    queryKey: ["/api/cities"],
    queryFn: () => apiFetch("/api/cities", token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/cities", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cities"] });
      setOpen(false);
      toast({ title: "City added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cities</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage service areas</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-city"><Plus className="w-4 h-4 mr-2" />Add City</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add City</DialogTitle></DialogHeader>
            <CityForm onSubmit={(d) => createMutation.mutate(d)} loading={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !cities?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No cities configured</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {cities.map((c: any) => (
            <Card key={c.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-medium" data-testid={`text-city-name-${c.id}`}>{c.name}</p>
                    <p className="text-sm text-muted-foreground">{c.state}</p>
                    <p className="text-xs text-muted-foreground">{c.timezone}</p>
                  </div>
                  <Badge variant={c.active ? "secondary" : "destructive"} className="flex-shrink-0">
                    {c.active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CityForm({ onSubmit, loading }: { onSubmit: (data: any) => void; loading: boolean }) {
  const [form, setForm] = useState({ name: "", state: "", timezone: "America/New_York" });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>City Name *</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-city-name" />
      </div>
      <div className="space-y-2">
        <Label>State *</Label>
        <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} required placeholder="e.g. TX" data-testid="input-city-state" />
      </div>
      <div className="space-y-2">
        <Label>Timezone</Label>
        <Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} data-testid="input-city-timezone" />
      </div>
      <Button type="submit" className="w-full" disabled={loading} data-testid="button-submit-city">
        {loading ? "Adding..." : "Add City"}
      </Button>
    </form>
  );
}
