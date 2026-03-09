import React, { useState, useEffect, useCallback } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { adminApi, logout } from "../lib/api";

type User = {
  id: string; email: string; firstName: string; lastName: string;
  role: string; active: boolean; createdAt: string;
};

type TenantInfo = {
  tenant: {
    id: string; name: string; slug: string; timezone: string;
    subscriptionTier: string; subscriptionStatus: string;
    subscriptionExpiresAt?: string; createdAt: string;
  };
  usage: { users: number; patients: number; drivers: number };
  limits: { maxTrips: number; maxDrivers: number; maxUsers: number };
};

function UsersView() {
  const [users, setUsers] = useState<User[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState({ email: "", password: "", firstName: "", lastName: "", role: "dispatcher" });
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await adminApi.getUsers();
      setUsers(res.users || []);
    } catch { /* empty */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await adminApi.createUser(form as any);
      setMsg("User created");
      setShowForm(false);
      setForm({ email: "", password: "", firstName: "", lastName: "", role: "dispatcher" });
      load();
      setTimeout(() => setMsg(""), 3000);
    } catch (err: any) { setMsg(`Error: ${err.message}`); }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await adminApi.updateUser(editingUser.id, {
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role,
      });
      setMsg("User updated");
      setEditingUser(null);
      load();
      setTimeout(() => setMsg(""), 3000);
    } catch (err: any) { setMsg(`Error: ${err.message}`); }
  }

  async function toggleActive(user: User) {
    try {
      await adminApi.updateUser(user.id, { active: !user.active });
      setMsg(user.active ? "User deactivated" : "User reactivated");
      load();
      setTimeout(() => setMsg(""), 3000);
    } catch (err: any) { setMsg(`Error: ${err.message}`); }
  }

  function startEdit(user: User) {
    setEditingUser(user);
    setForm({ email: user.email, password: "", firstName: user.firstName, lastName: user.lastName, role: user.role });
    setShowForm(false);
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 style={{ fontSize: "1.2rem", fontWeight: 600 }}>User Management</h2>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowForm(!showForm); setEditingUser(null); }}>
          {showForm ? "Cancel" : "+ Add User"}
        </button>
      </div>

      {msg && <div className="card mb-3" style={{ background: msg.startsWith("Error") ? "var(--red-50)" : "var(--blue-50)", padding: "0.75rem" }}><p className="text-sm">{msg}</p></div>}

      {showForm && (
        <div className="card mb-3">
          <form onSubmit={handleCreate}>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="form-input" type="password" required minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input className="form-input" required value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input className="form-input" required value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              <select className="form-input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                <option value="admin">Admin</option>
                <option value="dispatcher">Dispatcher</option>
                <option value="driver">Driver</option>
                <option value="clinic">Clinic</option>
                <option value="billing">Billing</option>
              </select>
            </div>
            <button className="btn btn-primary" type="submit">Create User</button>
          </form>
        </div>
      )}

      {editingUser && (
        <div className="card mb-3">
          <h3 className="text-sm font-medium mb-2">Editing: {editingUser.email}</h3>
          <form onSubmit={handleUpdate}>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input className="form-input" required value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input className="form-input" required value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              <select className="form-input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                <option value="admin">Admin</option>
                <option value="dispatcher">Dispatcher</option>
                <option value="driver">Driver</option>
                <option value="clinic">Clinic</option>
                <option value="billing">Billing</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary" type="submit">Save</button>
              <button className="btn btn-outline" type="button" onClick={() => setEditingUser(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                  <td className="font-medium">{u.firstName} {u.lastName}</td>
                  <td className="text-sm">{u.email}</td>
                  <td><span className={`badge badge-${u.role === "admin" ? "completed" : u.role === "driver" ? "en_route" : "assigned"}`}>{u.role}</span></td>
                  <td><span className={`badge ${u.active ? "badge-completed" : "badge-cancelled"}`}>{u.active ? "Active" : "Inactive"}</span></td>
                  <td>
                    <div className="flex gap-1">
                      <button className="btn btn-outline btn-sm" onClick={() => startEdit(u)}>Edit</button>
                      <button className="btn btn-outline btn-sm" onClick={() => toggleActive(u)}>{u.active ? "Deactivate" : "Activate"}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={5} className="text-gray" style={{ textAlign: "center", padding: "2rem" }}>No users</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TenantView() {
  const [info, setInfo] = useState<TenantInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", timezone: "" });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    adminApi.getTenant().then(setInfo).catch(() => {});
  }, []);

  function startEdit() {
    if (!info) return;
    setForm({ name: info.tenant.name, timezone: info.tenant.timezone });
    setEditing(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await adminApi.updateTenant(form);
      setMsg("Settings saved");
      setEditing(false);
      adminApi.getTenant().then(setInfo);
      setTimeout(() => setMsg(""), 3000);
    } catch (err: any) { setMsg(`Error: ${err.message}`); }
  }

  if (!info) return <div className="text-gray" style={{ padding: "2rem", textAlign: "center" }}>Loading tenant info...</div>;

  const { tenant, usage, limits } = info;
  const formatLimit = (v: number) => v === -1 ? "Unlimited" : String(v);

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 style={{ fontSize: "1.2rem", fontWeight: 600 }}>Company Settings</h2>
        {!editing && <button className="btn btn-outline btn-sm" onClick={startEdit}>Edit</button>}
      </div>

      {msg && <div className="card mb-3" style={{ background: msg.startsWith("Error") ? "var(--red-50)" : "var(--green-50)", padding: "0.75rem" }}><p className="text-sm">{msg}</p></div>}

      {editing ? (
        <div className="card mb-3">
          <form onSubmit={handleSave}>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Company Name</label>
                <input className="form-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Timezone</label>
                <input className="form-input" required value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary" type="submit">Save</button>
              <button className="btn btn-outline" type="button" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </form>
        </div>
      ) : (
        <div className="card mb-3">
          <div className="grid-2" style={{ gap: "1rem" }}>
            <div><span className="text-sm text-gray">Company</span><p className="font-medium">{tenant.name}</p></div>
            <div><span className="text-sm text-gray">Slug</span><p className="font-medium">{tenant.slug}</p></div>
            <div><span className="text-sm text-gray">Timezone</span><p className="font-medium">{tenant.timezone}</p></div>
            <div><span className="text-sm text-gray">Created</span><p className="font-medium">{new Date(tenant.createdAt).toLocaleDateString()}</p></div>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: "1rem", fontWeight: 600 }} className="mb-2">Subscription</h3>
      <div className="card mb-3">
        <div className="grid-2" style={{ gap: "1rem" }}>
          <div><span className="text-sm text-gray">Plan</span><p className="font-medium" style={{ textTransform: "capitalize" }}>{tenant.subscriptionTier}</p></div>
          <div><span className="text-sm text-gray">Status</span><p><span className={`badge badge-${tenant.subscriptionStatus === "active" ? "completed" : "cancelled"}`}>{tenant.subscriptionStatus}</span></p></div>
          {tenant.subscriptionExpiresAt && (
            <div><span className="text-sm text-gray">Expires</span><p className="font-medium">{new Date(tenant.subscriptionExpiresAt).toLocaleDateString()}</p></div>
          )}
        </div>
      </div>

      <h3 style={{ fontSize: "1rem", fontWeight: 600 }} className="mb-2">Usage</h3>
      <div className="card">
        <div className="grid-2" style={{ gap: "1rem" }}>
          <div>
            <span className="text-sm text-gray">Users</span>
            <p className="font-medium">{usage.users} / {formatLimit(limits.maxUsers)}</p>
          </div>
          <div>
            <span className="text-sm text-gray">Drivers</span>
            <p className="font-medium">{usage.drivers} / {formatLimit(limits.maxDrivers)}</p>
          </div>
          <div>
            <span className="text-sm text-gray">Patients</span>
            <p className="font-medium">{usage.patients}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function OperationsView() {
  const [pipeline, setPipeline] = useState<Record<string, number> | null>(null);
  const [alerts, setAlerts] = useState<Array<{ level: string; type: string; message: string }>>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);

  useEffect(() => {
    adminApi.getTripPipeline().then(setPipeline).catch(() => {});
    adminApi.getOperationalAlerts().then(data => setAlerts(data.alerts || [])).catch(() => {});
    adminApi.getAuditLog(20).then(data => setAuditLog(data.data || [])).catch(() => {});
  }, []);

  return (
    <div>
      <h2 style={{ fontSize: "1.2rem", fontWeight: 600 }} className="mb-3">Operations</h2>

      {alerts.length > 0 && (
        <div className="mb-3">
          {alerts.map((a, i) => (
            <div key={i} className="card mb-2" style={{ background: "var(--red-50)", padding: "0.75rem", borderLeft: "3px solid var(--red-500)" }}>
              <p className="text-sm font-medium">{a.message}</p>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: "1rem", fontWeight: 600 }} className="mb-2">Trip Pipeline</h3>
      {pipeline ? (
        <div className="card mb-3">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
            {Object.entries(pipeline).map(([key, val]) => (
              <div key={key} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{val}</div>
                <div className="text-xs text-gray" style={{ textTransform: "capitalize" }}>{key.replace(/_/g, " ")}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card mb-3 text-gray" style={{ padding: "2rem", textAlign: "center" }}>Loading pipeline...</div>
      )}

      <h3 style={{ fontSize: "1rem", fontWeight: 600 }} className="mb-2">Recent Activity</h3>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Action</th><th>Resource</th><th>Time</th></tr></thead>
            <tbody>
              {auditLog.map((entry: any) => (
                <tr key={entry.id}>
                  <td className="text-sm">{entry.action}</td>
                  <td className="text-sm">{entry.resource}{entry.resourceId ? ` (${entry.resourceId.substring(0, 8)}...)` : ""}</td>
                  <td className="text-sm text-gray">{new Date(entry.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {auditLog.length === 0 && <tr><td colSpan={3} className="text-gray" style={{ textAlign: "center", padding: "2rem" }}>No recent activity</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function AdminDashboard() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>UCM Admin</h2>
        <nav>
          <NavLink to="/admin/users" className={({ isActive }) => isActive ? "active" : ""}>Users</NavLink>
          <NavLink to="/admin/company" className={({ isActive }) => isActive ? "active" : ""}>Company</NavLink>
          <NavLink to="/admin/operations" className={({ isActive }) => isActive ? "active" : ""}>Operations</NavLink>
        </nav>
        <button className="btn btn-sm btn-outline mt-4" style={{ width: "100%", color: "var(--gray-400)", borderColor: "var(--gray-600)" }} onClick={logout}>
          Sign Out
        </button>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="users" element={<UsersView />} />
          <Route path="company" element={<TenantView />} />
          <Route path="operations" element={<OperationsView />} />
          <Route path="*" element={<Navigate to="/admin/users" replace />} />
        </Routes>
      </main>
    </div>
  );
}
