import React, { useState, useEffect, useCallback } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { clinicApi } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";

type Patient = { id: string; firstName: string; lastName: string; phone?: string; membershipId?: string };
type Trip = {
  id: string; status: string; priority: string;
  pickupAddress: string; dropoffAddress: string;
  scheduledPickup?: string; patientName?: string;
  driverName?: string; createdAt: string;
};

function PatientsView() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", membershipId: "" });
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await clinicApi.getPatients();
      setPatients(res.patients || res || []);
    } catch { /* empty */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await clinicApi.createPatient(form);
      setMsg("Patient created");
      setShowForm(false);
      setForm({ firstName: "", lastName: "", phone: "", membershipId: "" });
      load();
      setTimeout(() => setMsg(""), 3000);
    } catch (err: any) { setMsg(`Error: ${err.message}`); }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 style={{ fontSize: "1.2rem", fontWeight: 600 }}>Patients</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ Add Patient"}
        </button>
      </div>

      {msg && <div className="card mb-3" style={{ background: "var(--blue-50)", padding: "0.75rem" }}><p className="text-sm">{msg}</p></div>}

      {showForm && (
        <div className="card mb-3">
          <form onSubmit={handleCreate}>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input className="form-input" required value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input className="form-input" required value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Membership ID</label>
                <input className="form-input" value={form.membershipId} onChange={e => setForm({ ...form, membershipId: e.target.value })} />
              </div>
            </div>
            <button className="btn btn-primary" type="submit">Create Patient</button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Member ID</th></tr></thead>
            <tbody>
              {patients.map(p => (
                <tr key={p.id}>
                  <td className="font-medium">{p.firstName} {p.lastName}</td>
                  <td>{p.phone || "—"}</td>
                  <td className="text-sm text-gray">{p.membershipId || "—"}</td>
                </tr>
              ))}
              {patients.length === 0 && <tr><td colSpan={3} style={{ textAlign: "center", padding: "2rem" }} className="text-gray">No patients</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RequestTripView() {
  const [form, setForm] = useState({
    patientId: "", pickupAddress: "", dropoffAddress: "",
    scheduledPickup: "", priority: "scheduled", notes: "",
  });
  const [msg, setMsg] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);

  useEffect(() => {
    clinicApi.getPatients().then(res => setPatients(res.patients || res || [])).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await clinicApi.requestTrip({
        ...form,
        scheduledPickup: form.scheduledPickup ? new Date(form.scheduledPickup).toISOString() : undefined,
      });
      setMsg("Trip requested successfully! Dispatch has been notified.");
      setForm({ patientId: "", pickupAddress: "", dropoffAddress: "", scheduledPickup: "", priority: "scheduled", notes: "" });
      setTimeout(() => setMsg(""), 5000);
    } catch (err: any) { setMsg(`Error: ${err.message}`); }
  }

  return (
    <div>
      <h2 style={{ fontSize: "1.2rem", fontWeight: 600 }} className="mb-3">Request Trip</h2>

      {msg && (
        <div className="card mb-3" style={{ background: msg.startsWith("Error") ? "var(--red-50)" : "var(--green-50)", padding: "0.75rem" }}>
          <p className="text-sm font-medium">{msg}</p>
        </div>
      )}

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Patient</label>
            <select className="form-input" required value={form.patientId} onChange={e => setForm({ ...form, patientId: e.target.value })}>
              <option value="">Select patient...</option>
              {patients.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
            </select>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Pickup Address</label>
              <input className="form-input" required value={form.pickupAddress} onChange={e => setForm({ ...form, pickupAddress: e.target.value })} placeholder="123 Main St, City, ST" />
            </div>
            <div className="form-group">
              <label className="form-label">Dropoff Address</label>
              <input className="form-input" required value={form.dropoffAddress} onChange={e => setForm({ ...form, dropoffAddress: e.target.value })} placeholder="456 Oak Ave, City, ST" />
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Scheduled Pickup</label>
              <input className="form-input" type="datetime-local" value={form.scheduledPickup} onChange={e => setForm({ ...form, scheduledPickup: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="form-input" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value="scheduled">Scheduled</option>
                <option value="immediate">Immediate</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input" rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Wheelchair needed, mobility assistance, etc." />
          </div>

          <button className="btn btn-primary btn-lg" type="submit" style={{ width: "100%" }}>Request Trip</button>
        </form>
      </div>
    </div>
  );
}

function TripsView() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [filter, setFilter] = useState("");
  const { on } = useWebSocket();

  const load = useCallback(async () => {
    try {
      const res = await clinicApi.getTrips(filter || undefined);
      setTrips(res.trips || res || []);
    } catch { /* empty */ }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsubs = [
      on("trip:updated", load),
      on("trip:assigned", load),
    ];
    return () => unsubs.forEach(u => u());
  }, [on, load]);

  async function handleCancel(tripId: string) {
    if (!confirm("Cancel this trip?")) return;
    try {
      await clinicApi.cancelTrip(tripId, "Cancelled by clinic");
      load();
    } catch { /* empty */ }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 style={{ fontSize: "1.2rem", fontWeight: 600 }}>Trip Status</h2>
        <select className="form-input" style={{ width: 160 }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">All trips</option>
          <option value="requested">Requested</option>
          <option value="assigned">Assigned</option>
          <option value="en_route">En Route</option>
          <option value="arrived">Arrived</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Status</th><th>Patient</th><th>Pickup</th><th>Dropoff</th><th>Driver</th><th>Scheduled</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {trips.map(trip => (
                <tr key={trip.id}>
                  <td><span className={`badge badge-${trip.status}`}>{trip.status}</span></td>
                  <td>{trip.patientName || "—"}</td>
                  <td className="truncate" style={{ maxWidth: 180 }}>{trip.pickupAddress}</td>
                  <td className="truncate" style={{ maxWidth: 180 }}>{trip.dropoffAddress}</td>
                  <td>{trip.driverName || <span className="text-gray">Pending</span>}</td>
                  <td className="text-sm">{trip.scheduledPickup ? new Date(trip.scheduledPickup).toLocaleString() : "—"}</td>
                  <td>
                    {["requested", "assigned"].includes(trip.status) && (
                      <button className="btn btn-outline btn-sm" onClick={() => handleCancel(trip.id)}>Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
              {trips.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: "2rem" }} className="text-gray">No trips found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function ClinicPortal() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>UCM Clinic</h2>
        <nav>
          <NavLink to="/clinic/request" className={({ isActive }) => isActive ? "active" : ""}>Request Trip</NavLink>
          <NavLink to="/clinic/trips" className={({ isActive }) => isActive ? "active" : ""}>Trip Status</NavLink>
          <NavLink to="/clinic/patients" className={({ isActive }) => isActive ? "active" : ""}>Patients</NavLink>
        </nav>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="request" element={<RequestTripView />} />
          <Route path="trips" element={<TripsView />} />
          <Route path="patients" element={<PatientsView />} />
          <Route path="*" element={<Navigate to="/clinic/request" replace />} />
        </Routes>
      </main>
    </div>
  );
}
