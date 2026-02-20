import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Users, UserPlus, Shield, Eye, Edit2, KeyRound, Copy, Check } from "lucide-react";

interface ClinicUser {
  id: number;
  publicId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  phone: string | null;
  active: boolean;
  clinicId: number;
  companyId: number;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  CLINIC_ADMIN: "Admin",
  CLINIC_USER: "Staff",
  CLINIC_VIEWER: "Viewer",
};

const ROLE_COLORS: Record<string, string> = {
  CLINIC_ADMIN: "default",
  CLINIC_USER: "secondary",
  CLINIC_VIEWER: "outline",
};

export default function ClinicUsersPage() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editUser, setEditUser] = useState<ClinicUser | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const usersQuery = useQuery<ClinicUser[]>({
    queryKey: ["/api/clinic/users"],
    queryFn: () => apiFetch("/api/clinic/users", token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/clinic/users", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/users"] });
      setShowCreateDialog(false);
      if (result.tempPassword) {
        setTempPassword(result.tempPassword);
      } else {
        toast({ title: "User created successfully" });
      }
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) =>
      apiFetch(`/api/clinic/users/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/users"] });
      setEditUser(null);
      toast({ title: "User updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (userId: number) =>
      apiFetch(`/api/clinic/users/${userId}/reset`, token, { method: "POST" }),
    onSuccess: (result: any) => {
      if (result.tempPassword) {
        setTempPassword(result.tempPassword);
      }
      toast({ title: "Password reset successfully" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const clinicUsers = usersQuery.data || [];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-clinic-users-title">
            <Users className="h-6 w-6" />
            Users & Roles
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your clinic team members and their access levels
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-add-user">
          <UserPlus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-primary" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-admin-count">
                  {clinicUsers.filter(u => u.role === "CLINIC_ADMIN").length}
                </p>
                <p className="text-xs text-muted-foreground">Admins</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-staff-count">
                  {clinicUsers.filter(u => u.role === "CLINIC_USER").length}
                </p>
                <p className="text-xs text-muted-foreground">Staff</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Eye className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-viewer-count">
                  {clinicUsers.filter(u => u.role === "CLINIC_VIEWER").length}
                </p>
                <p className="text-xs text-muted-foreground">Viewers</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {usersQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : clinicUsers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground" data-testid="text-no-users">No users found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {clinicUsers.map((u) => (
            <Card key={u.id} className={!u.active ? "opacity-60" : ""} data-testid={`card-user-${u.id}`}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                      {u.firstName[0]}{u.lastName[0]}
                    </div>
                    <div>
                      <p className="font-medium" data-testid={`text-user-name-${u.id}`}>
                        {u.firstName} {u.lastName}
                      </p>
                      <p className="text-sm text-muted-foreground" data-testid={`text-user-email-${u.id}`}>
                        {u.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={ROLE_COLORS[u.role] as any || "outline"} data-testid={`badge-user-role-${u.id}`}>
                      {ROLE_LABELS[u.role] || u.role}
                    </Badge>
                    {!u.active && <Badge variant="destructive">Inactive</Badge>}
                    {u.id !== user?.id && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditUser(u)}
                          data-testid={`button-edit-user-${u.id}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => resetPasswordMutation.mutate(u.id)}
                          disabled={resetPasswordMutation.isPending}
                          data-testid={`button-reset-password-${u.id}`}
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                    {u.id === user?.id && (
                      <Badge variant="secondary">You</Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateUserDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSubmit={(data) => createMutation.mutate(data)}
        loading={createMutation.isPending}
      />

      {editUser && (
        <EditUserDialog
          open={!!editUser}
          onOpenChange={(open) => { if (!open) setEditUser(null); }}
          user={editUser}
          onSubmit={(data) => updateMutation.mutate({ id: editUser.id, ...data })}
          loading={updateMutation.isPending}
        />
      )}

      <Dialog open={!!tempPassword} onOpenChange={(open) => { if (!open) { setTempPassword(null); setCopied(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary Password</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Share this temporary password with the user. They will be asked to change it on first login.
            </p>
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <code className="flex-1 font-mono text-lg" data-testid="text-temp-password">{tempPassword}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(tempPassword || "")}
                data-testid="button-copy-password"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setTempPassword(null); setCopied(false); }} data-testid="button-close-password">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateUserDialog({ open, onOpenChange, onSubmit, loading }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  loading: boolean;
}) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("CLINIC_USER");
  const [phone, setPhone] = useState("");

  const handleSubmit = () => {
    if (!email || !firstName || !lastName) return;
    onSubmit({ email, firstName, lastName, role, phone: phone || null });
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setEmail("");
      setFirstName("");
      setLastName("");
      setRole("CLINIC_USER");
      setPhone("");
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add New User</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First Name</Label>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                data-testid="input-first-name"
              />
            </div>
            <div>
              <Label>Last Name</Label>
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                data-testid="input-last-name"
              />
            </div>
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@clinic.com"
              data-testid="input-email"
            />
          </div>
          <div>
            <Label>Phone (optional)</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 000 0000"
              data-testid="input-phone"
            />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger data-testid="select-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CLINIC_ADMIN">Admin - Full access + user management</SelectItem>
                <SelectItem value="CLINIC_USER">Staff - Create/edit patients & trips</SelectItem>
                <SelectItem value="CLINIC_VIEWER">Viewer - Read-only access</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} data-testid="button-cancel-create">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !email || !firstName || !lastName}
            data-testid="button-submit-create"
          >
            {loading ? "Creating..." : "Create User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ open, onOpenChange, user, onSubmit, loading }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: ClinicUser;
  onSubmit: (data: any) => void;
  loading: boolean;
}) {
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [role, setRole] = useState(user.role);
  const [phone, setPhone] = useState(user.phone || "");
  const [active, setActive] = useState(user.active);

  const handleSubmit = () => {
    const updates: any = {};
    if (firstName !== user.firstName) updates.firstName = firstName;
    if (lastName !== user.lastName) updates.lastName = lastName;
    if (role !== user.role) updates.role = role;
    if (phone !== (user.phone || "")) updates.phone = phone || null;
    if (active !== user.active) updates.active = active;
    if (Object.keys(updates).length === 0) {
      onOpenChange(false);
      return;
    }
    onSubmit(updates);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User: {user.firstName} {user.lastName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First Name</Label>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                data-testid="input-edit-first-name"
              />
            </div>
            <div>
              <Label>Last Name</Label>
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                data-testid="input-edit-last-name"
              />
            </div>
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              data-testid="input-edit-phone"
            />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger data-testid="select-edit-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CLINIC_ADMIN">Admin</SelectItem>
                <SelectItem value="CLINIC_USER">Staff</SelectItem>
                <SelectItem value="CLINIC_VIEWER">Viewer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label>Active</Label>
            <Switch
              checked={active}
              onCheckedChange={setActive}
              data-testid="switch-edit-active"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-edit">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading} data-testid="button-submit-edit">
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
