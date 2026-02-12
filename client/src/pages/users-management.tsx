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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Users, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function UsersPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: usersData, isLoading } = useQuery<any[]>({
    queryKey: ["/api/users"],
    queryFn: () => apiFetch("/api/users", token),
    enabled: !!token,
  });

  const { data: citiesData } = useQuery<any[]>({
    queryKey: ["/api/cities"],
    queryFn: () => apiFetch("/api/cities", token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/users", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setOpen(false);
      toast({ title: "User created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filtered = usersData?.filter(
    (u: any) =>
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase()) ||
      u.publicId?.toLowerCase().includes(search.toLowerCase())
  );

  const roleColors: Record<string, string> = {
    SUPER_ADMIN: "default",
    ADMIN: "default",
    DISPATCH: "secondary",
    DRIVER: "secondary",
    VIEWER: "secondary",
  };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage system users</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-user"><Plus className="w-4 h-4 mr-2" />Add User</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
            <UserForm cities={citiesData || []} onSubmit={(d) => createMutation.mutate(d)} loading={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-users" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : !filtered?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No users found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((u: any) => (
            <Card key={u.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <p className="font-medium" data-testid={`text-user-fullname-${u.id}`}>{u.firstName} {u.lastName}</p>
                    <p className="text-xs font-mono text-muted-foreground">{u.publicId}</p>
                    <p className="text-sm text-muted-foreground">{u.email}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge variant={roleColors[u.role] as any || "secondary"}>{u.role.replace("_", " ")}</Badge>
                    <Badge variant={u.active ? "secondary" : "destructive"}>
                      {u.active ? "Active" : "Inactive"}
                    </Badge>
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

function UserForm({ cities, onSubmit, loading }: { cities: any[]; onSubmit: (data: any) => void; loading: boolean }) {
  const [form, setForm] = useState({
    email: "", password: "", firstName: "", lastName: "", role: "VIEWER", phone: "", cityIds: [] as string[],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ ...form, cityIds: form.cityIds.map(Number) });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>First Name *</Label>
          <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required data-testid="input-user-first" />
        </div>
        <div className="space-y-2">
          <Label>Last Name *</Label>
          <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required data-testid="input-user-last" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Email *</Label>
        <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required data-testid="input-user-email" />
      </div>
      <div className="space-y-2">
        <Label>Password *</Label>
        <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required data-testid="input-user-password" />
      </div>
      <div className="space-y-2">
        <Label>Role</Label>
        <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
          <SelectTrigger data-testid="select-user-role"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ADMIN">Admin</SelectItem>
            <SelectItem value="DISPATCH">Dispatch</SelectItem>
            <SelectItem value="DRIVER">Driver</SelectItem>
            <SelectItem value="VIEWER">Viewer</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Phone</Label>
        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-user-phone" />
      </div>
      {cities.length > 0 && (
        <div className="space-y-2">
          <Label>City Access</Label>
          <div className="space-y-2 max-h-32 overflow-y-auto border rounded-md p-2">
            {cities.map((c: any) => (
              <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.cityIds.includes(c.id.toString())}
                  onChange={(e) => {
                    const id = c.id.toString();
                    setForm({
                      ...form,
                      cityIds: e.target.checked ? [...form.cityIds, id] : form.cityIds.filter((i) => i !== id),
                    });
                  }}
                />
                {c.name}, {c.state}
              </label>
            ))}
          </div>
        </div>
      )}
      <Button type="submit" className="w-full" disabled={loading} data-testid="button-submit-user">
        {loading ? "Creating..." : "Create User"}
      </Button>
    </form>
  );
}
