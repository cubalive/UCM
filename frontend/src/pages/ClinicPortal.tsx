import React, { useState, useEffect, useCallback } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { clinicApi, logout } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";
import { formatDateTime, localInputToUTC } from "../lib/timezone";

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
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
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

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPatient) return;
    try {
      await clinicApi.updatePatient(editingPatient.id, {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone || undefined,
        insuranceId: form.membershipId || undefined,
      });
      setMsg("Patient updated");
      setEditingPatient(null);
      load();
      setTimeout(() => setMsg(""), 3000);
    } catch (err: any) { setMsg(`Error: ${err.message}`); }
  }

  async function handleDelete(patient: Patient) {
    if (!confirm(`Delete patient ${patient.firstName} ${patient.lastName}? This cannot be undone.`)) return;
    try {
      await clinicApi.deletePatient(patient.id);
      setMsg("Patient deleted");
      load();
      setTimeout(() => setMsg(""), 3000);
    } catch (err: any) { setMsg(`Error: ${err.message}`); }
  }

  function startEdit(patient: Patient) {
    setEditingPatient(patient);
    setForm({ firstName: patient.firstName, lastName: patient.lastName, phone: patient.phone || "", membershipId: patient.membershipId || "" });
    setShowForm(false);
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 style={{ fontSize: "1.2rem", fontWeight: 600 }}>Patients</h2>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowForm(!showForm); setEditingPatient(null); }}>
          {showForm ? "Cancel" : "+ Add Patient"}
        </button>
      </div>

      {msg && <div className="card mb-3" style={{ background: msg.startsWith("Error") ? "var(--red-50)" : "var(--blue-50)", padding: "0.75rem" }}><p className="text-sm">{msg}</p></div>}

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

      {editingPatient && (
        <div className="card mb-3">
          <h3 className="text-sm font-medium mb-2">Editing: {editingPatient.firstName} {editingPatient.lastName}</h3>
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
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Membership ID</label>
                <input className="form-input" value={form.membershipId} onChange={e => setForm({ ...form, membershipId: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary" type="submit">Save</button>
              <button className="btn btn-outline" type="button" onClick={() => setEditingPatient(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Member ID</th><th>Actions</th></tr></thead>
            <tbody>
              {patients.map(p => (
                <tr key={p.id}>
                  <td className="font-medium">{p.firstName} {p.lastName}</td>
                  <td>{p.phone || "—"}</td>
                  <td className="text-sm text-gray">{p.membershipId || "—"}</td>
                  <td>
                    <div className="flex gap-1">
                      <button className="btn btn-outline btn-sm" onClick={() => startEdit(p)}>Edit</button>
                      <button className="btn btn-outline btn-sm" style={{ color: "var(--red-500)" }} onClick={() => handleDelete(p)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {patients.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: "2rem" }} className="text-gray">No patients yet. Add a patient to get started.</td></tr>}
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
  const [timezone, setTimezone] = useState("America/New_York");

  useEffect(() => {
    clinicApi.getPatients().then(res => setPatients(res.patients || res || [])).catch(() => {});
    // Load tenant timezone from a trips call (cached on first load)
    clinicApi.getTrips().then(res => { if (res.timezone) setTimezone(res.timezone); }).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const tz = timezone;
      await clinicApi.requestTrip({
        ...form,
        scheduledAt: form.scheduledPickup ? localInputToUTC(form.scheduledPickup, tz) : new Date().toISOString(),
        timezone: tz,
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
              <label className="form-label">Scheduled Pickup <span className="text-xs text-gray">({timezone.replace(/_/g, " ")})</span></label>
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

const CLINIC_TRIPS_PER_PAGE = 20;

function TripsView() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [filter, setFilter] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [page, setPage] = useState(0);
  const { on } = useWebSocket();

  const load = useCallback(async () => {
    try {
      const res = await clinicApi.getTrips(filter || undefined);
      setTrips(res.trips || res || []);
      if (res.timezone) setTimezone(res.timezone);
    } catch { /* empty */ }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsubs = [
      on("trip:created", load),
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
        <select className="form-input" style={{ width: 160 }} value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}>
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
              {trips.slice(page * CLINIC_TRIPS_PER_PAGE, (page + 1) * CLINIC_TRIPS_PER_PAGE).map(trip => (
                <tr key={trip.id}>
                  <td><span className={`badge badge-${trip.status}`}>{trip.status}</span></td>
                  <td>{trip.patientName || "—"}</td>
                  <td className="truncate" style={{ maxWidth: 180 }}>{trip.pickupAddress}</td>
                  <td className="truncate" style={{ maxWidth: 180 }}>{trip.dropoffAddress}</td>
                  <td>{trip.driverName || <span className="text-gray">Pending</span>}</td>
                  <td className="text-sm">{trip.scheduledPickup ? formatDateTime(trip.scheduledPickup, timezone) : "—"}</td>
                  <td>
                    {["requested", "assigned", "en_route", "arrived"].includes(trip.status) && (
                      <button className="btn btn-outline btn-sm" onClick={() => handleCancel(trip.id)}>Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
              {trips.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: "2rem" }} className="text-gray">No trips found</td></tr>}
            </tbody>
          </table>
        </div>
        {trips.length > CLINIC_TRIPS_PER_PAGE && (
          <div className="flex justify-between items-center" style={{ padding: "0.75rem 1rem", borderTop: "1px solid var(--gray-100)" }}>
            <span className="text-sm text-gray">
              Showing {page * CLINIC_TRIPS_PER_PAGE + 1}–{Math.min((page + 1) * CLINIC_TRIPS_PER_PAGE, trips.length)} of {trips.length}
            </span>
            <div className="flex gap-2">
              <button className="btn btn-outline btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</button>
              <button className="btn btn-outline btn-sm" disabled={(page + 1) * CLINIC_TRIPS_PER_PAGE >= trips.length} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          </div>
        )}
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
        <button className="btn btn-sm btn-outline mt-4" style={{ width: "100%", color: "var(--gray-400)", borderColor: "var(--gray-600)" }} onClick={logout}>
          Sign Out
        </button>
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
