import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  UserPlus,
  Shield,
  Edit,
  Trash2,
  Key,
  Mail,
  X,
  Check,
  ShieldAlert,
  Eye,
  Loader2,
} from "lucide-react";

type ClinicRole = "CLINIC_ADMIN" | "CLINIC_USER" | "CLINIC_VIEWER";

interface ClinicUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: ClinicRole;
  status: string;
  createdAt: string;
}

const ROLE_CONFIG: Record<ClinicRole, { label: string; color: string; bg: string; icon: typeof Shield }> = {
  CLINIC_ADMIN: { label: "Admin", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", icon: Shield },
  CLINIC_USER: { label: "User", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", icon: Users },
  CLINIC_VIEWER: { label: "Viewer", color: "text-gray-400", bg: "bg-gray-500/10 border-gray-500/20", icon: Eye },
};

function RoleBadge({ role }: { role: ClinicRole }) {
  const config = ROLE_CONFIG[role] || ROLE_CONFIG.CLINIC_VIEWER;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border ${config.bg} ${config.color}`}>
      <config.icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

export default function ClinicUsers() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editingRole, setEditingRole] = useState<ClinicRole>("CLINIC_USER");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // Access control
  if (user?.role !== "CLINIC_ADMIN") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-8 text-center max-w-sm">
          <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">
            Only Clinic Admins can manage users. Contact your administrator for access.
          </p>
        </div>
      </div>
    );
  }

  const { data, isLoading } = useQuery({
    queryKey: ["/api/clinic/users"],
    enabled: user?.role === "CLINIC_ADMIN",
  });

  const users: ClinicUser[] = (data as any)?.users || [];

  const createMutation = useMutation({
    mutationFn: async (body: { email: string; firstName: string; lastName: string; role: ClinicRole }) => {
      const res = await apiRequest("POST", "/api/clinic/users", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/users"] });
      setShowAddModal(false);
      toast({ title: "User created", description: "An invitation has been sent to the user." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create user", description: err.message, variant: "destructive" });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: ClinicRole }) => {
      const res = await apiRequest("PATCH", `/api/clinic/users/${id}`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/users"] });
      setEditingUserId(null);
      toast({ title: "Role updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update role", description: err.message, variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/clinic/users/${id}/reset`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Password reset sent", description: "The user will receive a reset link via email." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to reset password", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/clinic/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/users"] });
      setDeleteConfirmId(null);
      toast({ title: "User removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete user", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" />
            User Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage clinic staff accounts and permissions</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {(["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"] as ClinicRole[]).map((role) => {
          const config = ROLE_CONFIG[role];
          const count = users.filter((u) => u.role === role).length;
          return (
            <div key={role} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <config.icon className={`w-4 h-4 ${config.color}`} />
                <span className="text-xs text-gray-500">{config.label}s</span>
              </div>
              <p className="text-2xl font-bold text-white">{count}</p>
            </div>
          );
        })}
      </div>

      {/* User List */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e293b]">
          <h2 className="text-sm font-semibold text-white">All Users ({users.length})</h2>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <Users className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No users found</p>
            <p className="text-xs mt-1">Add your first clinic user to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-[#1e293b]">
            {users.map((u) => (
              <div key={u.id} className="px-5 py-4 flex items-center gap-4 hover:bg-[#0f172a] transition-colors">
                {/* Avatar */}
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-[#1e293b] rounded-full flex items-center justify-center text-sm font-semibold text-emerald-400 shrink-0">
                  {(u.firstName?.[0] || u.email[0]).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {u.firstName} {u.lastName}
                  </p>
                  <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                    <Mail className="w-3 h-3" />
                    {u.email}
                  </p>
                </div>

                {/* Role */}
                <div className="shrink-0">
                  {editingUserId === u.id ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={editingRole}
                        onChange={(e) => setEditingRole(e.target.value as ClinicRole)}
                        className="bg-[#0a0f1e] border border-[#1e293b] text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="CLINIC_ADMIN">Admin</option>
                        <option value="CLINIC_USER">User</option>
                        <option value="CLINIC_VIEWER">Viewer</option>
                      </select>
                      <button
                        onClick={() => updateRoleMutation.mutate({ id: u.id, role: editingRole })}
                        disabled={updateRoleMutation.isPending}
                        className="p-1 text-emerald-400 hover:text-emerald-300"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setEditingUserId(null)}
                        className="p-1 text-gray-400 hover:text-gray-300"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <RoleBadge role={u.role} />
                  )}
                </div>

                {/* Status */}
                <span className={`shrink-0 text-xs px-2 py-1 rounded-full ${
                  u.status === "active"
                    ? "bg-green-500/10 text-green-400"
                    : "bg-yellow-500/10 text-yellow-400"
                }`}>
                  {u.status || "active"}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => {
                      setEditingUserId(u.id);
                      setEditingRole(u.role);
                    }}
                    title="Edit role"
                    className="p-2 text-gray-400 hover:text-white hover:bg-[#1e293b] rounded-lg transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => resetPasswordMutation.mutate(u.id)}
                    disabled={resetPasswordMutation.isPending}
                    title="Reset password"
                    className="p-2 text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors"
                  >
                    <Key className="w-4 h-4" />
                  </button>
                  {deleteConfirmId === u.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => deleteMutation.mutate(u.id)}
                        disabled={deleteMutation.isPending}
                        className="px-2 py-1 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="px-2 py-1 text-xs text-gray-400 hover:text-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(u.id)}
                      title="Delete user"
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <AddUserModal
          onClose={() => setShowAddModal(false)}
          onSubmit={(data) => createMutation.mutate(data)}
          isPending={createMutation.isPending}
        />
      )}
    </div>
  );
}

function AddUserModal({
  onClose,
  onSubmit,
  isPending,
}: {
  onClose: () => void;
  onSubmit: (data: { email: string; firstName: string; lastName: string; role: ClinicRole }) => void;
  isPending: boolean;
}) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<ClinicRole>("CLINIC_USER");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !firstName.trim() || !lastName.trim()) return;
    onSubmit({ email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), role });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} role="presentation" aria-hidden="true" />

      {/* Modal */}
      <div className="relative bg-[#111827] border border-[#1e293b] rounded-xl w-full max-w-md mx-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e293b]">
          <h2 id="add-user-title" className="text-base font-semibold text-white flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-emerald-400" />
            Add New User
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">First Name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                placeholder="John"
                className="w-full bg-[#0a0f1e] border border-[#1e293b] text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500 placeholder-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                placeholder="Doe"
                className="w-full bg-[#0a0f1e] border border-[#1e293b] text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500 placeholder-gray-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="user@clinic.com"
                className="w-full bg-[#0a0f1e] border border-[#1e293b] text-white text-sm rounded-lg pl-10 pr-3 py-2.5 focus:outline-none focus:border-emerald-500 placeholder-gray-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ClinicRole)}
              className="w-full bg-[#0a0f1e] border border-[#1e293b] text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500"
            >
              <option value="CLINIC_ADMIN">Admin - Full access</option>
              <option value="CLINIC_USER">User - Can manage trips</option>
              <option value="CLINIC_VIEWER">Viewer - Read-only access</option>
            </select>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm text-gray-400 border border-[#1e293b] rounded-lg hover:bg-[#1e293b] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {isPending ? "Creating..." : "Add User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
