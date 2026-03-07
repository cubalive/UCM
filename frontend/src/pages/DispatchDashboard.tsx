import React, { useState, useEffect, useCallback, useRef } from "react";
import { dispatchApi, driverApi, tripApi } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";
import { DispatchMap } from "../components/DispatchMap";

type Trip = {
  id: string; status: string; priority: string;
  pickupAddress: string; dropoffAddress: string;
  scheduledPickup?: string; patientName?: string;
  driverId?: string; driverName?: string;
  createdAt: string;
};

type Driver = {
  id: string; name: string; email: string;
  availability: string; activeTripCount: number;
  latitude?: number; longitude?: number; lastLocationAt?: string;
};

export function DispatchDashboard() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"trips" | "drivers" | "map" | "tools">("trips");
  const [actionMsg, setActionMsg] = useState("");
  const { connected, on } = useWebSocket();

  const loadDashboard = useCallback(async () => {
    try {
      const data = await dispatchApi.getDashboard();
      setTrips(data.trips || []);
      setDrivers(data.drivers || []);
      setStats(data.stats || null);
    } catch {
      // fallback: load separately
      const [t, d] = await Promise.allSettled([
        tripApi.list(),
        driverApi.list(),
      ]);
      if (t.status === "fulfilled") setTrips(t.value.trips || t.value || []);
      if (d.status === "fulfilled") setDrivers(d.value.drivers || d.value || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  // Debounced reload for high-frequency events (driver location)
  const debouncedReloadRef = useRef<number>();
  const debouncedReload = useCallback(() => {
    clearTimeout(debouncedReloadRef.current);
    debouncedReloadRef.current = window.setTimeout(loadDashboard, 5000);
  }, [loadDashboard]);

  // Realtime: update driver locations locally, reload for trip changes immediately
  useEffect(() => {
    const unsubs = [
      on("trip:created", () => loadDashboard()),
      on("trip:updated", () => loadDashboard()),
      on("trip:assigned", () => loadDashboard()),
      on("driver:status_changed", () => loadDashboard()),
      // Location updates: update driver markers locally, debounce full reload
      on("driver:location", (data: any) => {
        if (data?.driverId) {
          setDrivers(prev => prev.map(d =>
            d.id === data.driverId
              ? { ...d, latitude: data.latitude, longitude: data.longitude, lastLocationAt: data.timestamp }
              : d
          ));
        }
        debouncedReload();
      }),
    ];
    return () => {
      unsubs.forEach(u => u());
      clearTimeout(debouncedReloadRef.current);
    };
  }, [on, loadDashboard, debouncedReload]);

  function flash(msg: string) {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(""), 3000);
  }

  async function handleAutoAssignAll() {
    try {
      const res = await dispatchApi.autoAssignAll();
      flash(`Auto-assigned ${res.assigned || 0} trips`);
      loadDashboard();
    } catch (err: any) { flash(`Error: ${err.message}`); }
  }

  async function handleAssignTrip(tripId: string, driverId: string) {
    try {
      await tripApi.assign(tripId, driverId);
      flash("Trip assigned");
      loadDashboard();
    } catch (err: any) { flash(`Error: ${err.message}`); }
  }

  async function handleOverrideDriver(driverId: string, availability: string) {
    try {
      await driverApi.overrideStatus(driverId, availability, "Dispatch override");
      flash(`Driver set to ${availability}`);
      loadDashboard();
    } catch (err: any) { flash(`Error: ${err.message}`); }
  }

  async function handleReleaseDriver(driverId: string) {
    try {
      await dispatchApi.releaseDriver(driverId);
      flash("Driver released");
      loadDashboard();
    } catch (err: any) { flash(`Error: ${err.message}`); }
  }

  async function handleResyncStale() {
    try {
      const res = await dispatchApi.resyncStale(15);
      flash(`Resynced ${res.corrected || 0} stale drivers`);
      loadDashboard();
    } catch (err: any) { flash(`Error: ${err.message}`); }
  }

  function waitTime(createdAt: string): string {
    const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  const urgentTrips = trips.filter(t => t.priority === "immediate" && t.status === "requested");
  const pendingTrips = trips.filter(t => t.status === "requested");
  const activeTrips = trips.filter(t => ["assigned", "en_route", "arrived", "in_progress"].includes(t.status));
  const availableDrivers = drivers.filter(d => d.availability === "available");
  const busyDrivers = drivers.filter(d => d.availability === "busy");

  if (loading) return <div className="app-shell"><div className="main-content"><p>Loading dashboard...</p></div></div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>UCM Dispatch</h2>
        <nav>
          <a className={tab === "trips" ? "active" : ""} onClick={() => setTab("trips")} href="#">Trips</a>
          <a className={tab === "drivers" ? "active" : ""} onClick={() => setTab("drivers")} href="#">Drivers</a>
          <a className={tab === "map" ? "active" : ""} onClick={() => setTab("map")} href="#">Map</a>
          <a className={tab === "tools" ? "active" : ""} onClick={() => setTab("tools")} href="#">Tools</a>
        </nav>
        <div className="mt-4 text-sm flex items-center gap-1" style={{ color: connected ? "var(--green-500)" : "var(--red-500)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? "var(--green-500)" : "var(--red-500)", display: "inline-block" }}></span>
          {connected ? "Live" : "Disconnected"}
        </div>
      </aside>

      <main className="main-content">
        {actionMsg && (
          <div className="card mb-3" style={{ background: "var(--blue-50)", borderLeft: "4px solid var(--blue-500)" }}>
            <p className="text-sm font-medium">{actionMsg}</p>
          </div>
        )}

        {/* Stats row */}
        <div className="grid-5 mb-4">
          <div className="stat-card stat-card-amber">
            <div className="stat-value">{pendingTrips.length}</div>
            <div className="stat-label">Pending Trips</div>
          </div>
          <div className="stat-card stat-card-purple">
            <div className="stat-value">{activeTrips.length}</div>
            <div className="stat-label">Active Trips</div>
          </div>
          <div className="stat-card stat-card-green">
            <div className="stat-value">{availableDrivers.length}</div>
            <div className="stat-label">Available Drivers</div>
          </div>
          <div className="stat-card stat-card-red">
            <div className="stat-value">{urgentTrips.length}</div>
            <div className="stat-label">Urgent Requests</div>
          </div>
          <div className="stat-card stat-card-blue">
            <div className="stat-value">{busyDrivers.length}</div>
            <div className="stat-label">Busy Drivers</div>
          </div>
        </div>

        {/* Urgent alerts */}
        {urgentTrips.map(trip => (
          <div key={trip.id} className="urgent-card mb-3">
            <div className="flex justify-between items-center">
              <div className="urgent-label">Immediate Request</div>
              <span className="text-sm font-bold" style={{ color: "var(--red-600)" }}>Waiting {waitTime(trip.createdAt)}</span>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <p className="font-bold">{trip.patientName || "Patient"}</p>
                <p className="text-sm">{trip.pickupAddress} &rarr; {trip.dropoffAddress}</p>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-danger btn-sm" onClick={() => handleAutoAssignAll()}>Auto-Assign</button>
                <select className="form-input" style={{ width: 160 }} onChange={e => e.target.value && handleAssignTrip(trip.id, e.target.value)}>
                  <option value="">Assign to...</option>
                  {availableDrivers.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}

        {/* Tab content */}
        {tab === "trips" && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">All Trips</span>
              <button className="btn btn-primary btn-sm" onClick={handleAutoAssignAll}>Auto-Assign All</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Patient</th>
                    <th>Pickup</th>
                    <th>Dropoff</th>
                    <th>Driver</th>
                    <th>Scheduled</th>
                    <th>Wait</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map(trip => (
                    <tr key={trip.id} className={trip.priority === "immediate" && trip.status === "requested" ? "trip-row-urgent" : ""}>
                      <td><span className={`badge badge-${trip.status}`}>{trip.status}</span></td>
                      <td><span className={`badge ${trip.priority === "immediate" ? "badge-immediate" : ""}`}>{trip.priority}</span></td>
                      <td>{trip.patientName || "—"}</td>
                      <td className="truncate" style={{ maxWidth: 200 }}>{trip.pickupAddress}</td>
                      <td className="truncate" style={{ maxWidth: 200 }}>{trip.dropoffAddress}</td>
                      <td>{trip.driverName || "—"}</td>
                      <td className="text-sm">{trip.scheduledPickup ? new Date(trip.scheduledPickup).toLocaleString() : "—"}</td>
                      <td className="text-sm" style={{ color: trip.status === "requested" && trip.createdAt ? "var(--amber-600)" : undefined, fontWeight: trip.status === "requested" ? 600 : undefined }}>
                        {trip.createdAt ? waitTime(trip.createdAt) : "—"}
                      </td>
                      <td>
                        {trip.status === "requested" && (
                          <select className="form-input btn-sm" style={{ width: 130 }} onChange={e => e.target.value && handleAssignTrip(trip.id, e.target.value)}>
                            <option value="">Assign...</option>
                            {availableDrivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        )}
                        {["assigned", "en_route", "arrived", "in_progress"].includes(trip.status) && trip.driverId && (
                          <div className="flex gap-1">
                            <select className="form-input btn-sm" style={{ width: 110 }} onChange={e => {
                              if (e.target.value) {
                                dispatchApi.reassignTrip(trip.id, e.target.value, "Dispatch reassignment").then(() => { flash("Reassigned"); loadDashboard(); });
                                e.target.value = "";
                              }
                            }}>
                              <option value="">Reassign...</option>
                              {drivers.filter(d => d.id !== trip.driverId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                            {["assigned", "en_route", "arrived"].includes(trip.status) && (
                              <button className="btn btn-outline btn-sm" style={{ color: "var(--amber-600)", borderColor: "var(--amber-200)" }} onClick={() => {
                                if (confirm("Unassign this trip? It will return to the pending pool.")) {
                                  dispatchApi.unassignTrip(trip.id, "Dispatch unassign").then(() => { flash("Trip unassigned"); loadDashboard(); }).catch((err: any) => flash(`Error: ${err.message}`));
                                }
                              }}>Unassign</button>
                            )}
                            <button className="btn btn-outline btn-sm" style={{ color: "var(--red-600)", borderColor: "var(--red-200)" }} onClick={() => {
                              if (confirm("Cancel this trip?")) {
                                dispatchApi.cancelTrip(trip.id, "Cancelled by dispatch").then(() => { flash("Trip cancelled"); loadDashboard(); }).catch((err: any) => flash(`Error: ${err.message}`));
                              }
                            }}>Cancel</button>
                          </div>
                        )}
                        {trip.status === "requested" && (
                          <button className="btn btn-outline btn-sm" style={{ color: "var(--red-600)", borderColor: "var(--red-200)", marginTop: 4 }} onClick={() => {
                            if (confirm("Cancel this trip?")) {
                              dispatchApi.cancelTrip(trip.id, "Cancelled by dispatch").then(() => { flash("Trip cancelled"); loadDashboard(); }).catch((err: any) => flash(`Error: ${err.message}`));
                            }
                          }}>Cancel</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {trips.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", padding: "2rem" }} className="text-gray">No trips found</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "drivers" && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Drivers</span>
              <button className="btn btn-outline btn-sm" onClick={handleResyncStale}>Resync Stale</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Active Trips</th>
                    <th>Last Location</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map(driver => (
                    <tr key={driver.id}>
                      <td className="font-medium">{driver.name}</td>
                      <td><span className={`badge badge-${driver.availability}`}>{driver.availability}</span></td>
                      <td>{driver.activeTripCount}</td>
                      <td className="text-sm text-gray">
                        {driver.latitude && driver.longitude
                          ? `${Number(driver.latitude).toFixed(4)}, ${Number(driver.longitude).toFixed(4)}`
                          : "No location"}
                        {driver.lastLocationAt && <span className="text-xs ml-1">({new Date(driver.lastLocationAt).toLocaleTimeString()})</span>}
                      </td>
                      <td className="flex gap-2">
                        {driver.availability !== "available" && (
                          <button className="btn btn-success btn-sm" onClick={() => handleOverrideDriver(driver.id, "available")}>Set Available</button>
                        )}
                        {driver.availability === "available" && (
                          <button className="btn btn-outline btn-sm" onClick={() => handleOverrideDriver(driver.id, "break")}>Set Break</button>
                        )}
                        {driver.availability === "busy" && (
                          <button className="btn btn-warning btn-sm" onClick={() => handleReleaseDriver(driver.id)}>Release</button>
                        )}
                        <button className="btn btn-outline btn-sm" onClick={() => handleOverrideDriver(driver.id, "offline")}>Offline</button>
                      </td>
                    </tr>
                  ))}
                  {drivers.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", padding: "2rem" }} className="text-gray">No drivers found</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "map" && (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ height: "calc(100vh - 220px)", minHeight: 400 }}>
              <DispatchMap drivers={drivers} trips={pendingTrips} />
            </div>
          </div>
        )}

        {tab === "tools" && (
          <div>
            <h3 className="mb-3" style={{ fontSize: "1.1rem", fontWeight: 600 }}>Dispatch Tools</h3>
            <div className="grid-2">
              <div className="card">
                <h4 className="card-title mb-2">Auto-Assign</h4>
                <p className="text-sm text-gray mb-3">Automatically assign all pending trips to the best available driver based on proximity and workload.</p>
                <button className="btn btn-primary" onClick={handleAutoAssignAll}>Run Auto-Assign</button>
              </div>
              <div className="card">
                <h4 className="card-title mb-2">Resync Stale Drivers</h4>
                <p className="text-sm text-gray mb-3">Set drivers with no location update in 15+ minutes to offline status.</p>
                <button className="btn btn-warning" onClick={handleResyncStale}>Resync Stale</button>
              </div>
              <div className="card">
                <h4 className="card-title mb-2">Release All Busy</h4>
                <p className="text-sm text-gray mb-3">Force all busy drivers with 0 active trips back to available.</p>
                <button className="btn btn-warning" onClick={async () => {
                  const stuckBusy = drivers.filter(d => d.availability === "busy" && d.activeTripCount === 0);
                  if (stuckBusy.length === 0) { flash("No stuck busy drivers found"); return; }
                  if (!confirm(`Release ${stuckBusy.length} stuck busy driver(s)?`)) return;
                  let released = 0;
                  for (const d of stuckBusy) {
                    try { await dispatchApi.releaseDriver(d.id); released++; } catch { /* skip */ }
                  }
                  flash(`Released ${released} driver(s)`);
                  loadDashboard();
                }}>Release Stuck</button>
              </div>
              <div className="card">
                <h4 className="card-title mb-2">Refresh Dashboard</h4>
                <p className="text-sm text-gray mb-3">Force reload all data from the server.</p>
                <button className="btn btn-outline" onClick={() => { setLoading(true); loadDashboard(); }}>Refresh</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
