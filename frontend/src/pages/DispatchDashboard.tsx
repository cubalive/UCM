import React, { useState, useEffect, useCallback, useRef } from "react";
import { dispatchApi, driverApi, tripApi } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";
import { DispatchMap } from "../components/DispatchMap";
import { formatDateTime, formatTime } from "../lib/timezone";

type Trip = {
  id: string; status: string; priority: string;
  pickupAddress: string; dropoffAddress: string;
  pickupLat?: number; pickupLng?: number;
  dropoffLat?: number; dropoffLng?: number;
  estimatedMiles?: number; estimatedMinutes?: number;
  mileage?: number;
  scheduledPickup?: string; patientName?: string;
  driverId?: string; driverName?: string;
  createdAt: string;
};

type Driver = {
  id: string; name: string; email: string;
  availability: string; activeTripCount: number;
  latitude?: number; longitude?: number;
  lastLocationAt?: string; isOnline?: boolean;
};

export function DispatchDashboard() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [timezone, setTimezone] = useState("America/New_York");
  const [tab, setTab] = useState<"trips" | "drivers" | "map" | "tools" | "urgent">("trips");
  const [actionMsg, setActionMsg] = useState("");
  const [repairModal, setRepairModal] = useState<{ tripId: string; currentStatus: string } | null>(null);
  const [repairStatus, setRepairStatus] = useState("");
  const [repairReason, setRepairReason] = useState("");
  const { connected, on } = useWebSocket();

  const loadDashboard = useCallback(async () => {
    try {
      const data = await dispatchApi.getDashboard();
      setTrips(data.trips || []);
      setDrivers(data.drivers || []);
      setStats(data.stats || null);
      if (data.timezone) setTimezone(data.timezone);
    } catch {
      const [t, d] = await Promise.allSettled([tripApi.list(), driverApi.list()]);
      if (t.status === "fulfilled") setTrips(t.value.trips || t.value || []);
      if (d.status === "fulfilled") setDrivers(d.value.drivers || d.value || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const debouncedReloadRef = useRef<number>();
  const debouncedReload = useCallback(() => {
    clearTimeout(debouncedReloadRef.current);
    debouncedReloadRef.current = window.setTimeout(loadDashboard, 5000);
  }, [loadDashboard]);

  useEffect(() => {
    const unsubs = [
      on("trip:created", (data: any) => {
        if (data?.trip) {
          setTrips(prev => [{ ...data.trip, priority: data.isImmediate ? "immediate" : "scheduled" }, ...prev]);
        } else {
          loadDashboard();
        }
      }),
      on("trip:updated", (data: any) => {
        if (data?.trip) {
          setTrips(prev => prev.map(t => t.id === data.trip.id ? { ...t, ...data.trip } : t));
        } else {
          loadDashboard();
        }
      }),
      on("trip:assigned", (data: any) => {
        if (data?.trip) {
          setTrips(prev => prev.map(t => t.id === data.trip.id ? { ...t, ...data.trip } : t));
        } else {
          loadDashboard();
        }
      }),
      on("trip:accepted", (data: any) => {
        if (data?.trip) {
          setTrips(prev => prev.map(t => t.id === data.trip.id ? { ...t, ...data.trip } : t));
        } else {
          loadDashboard();
        }
      }),
      on("trip:cancelled", (data: any) => {
        if (data?.trip) {
          setTrips(prev => prev.filter(t => t.id !== data.trip.id));
        } else {
          loadDashboard();
        }
      }),
      on("driver:status_changed", (data: any) => {
        if (data?.driverId) {
          setDrivers(prev => prev.map(d =>
            d.id === data.driverId ? { ...d, availability: data.availability } : d
          ));
        } else {
          loadDashboard();
        }
      }),
      on("trip:urgent", (data: any) => {
        flash(data?.message || "Urgent trip request received!");
        setTab("urgent");
        if (data?.trip) {
          setTrips(prev => {
            if (prev.some(t => t.id === data.trip.id)) return prev;
            return [{ ...data.trip, priority: "immediate" }, ...prev];
          });
        } else {
          loadDashboard();
        }
      }),
      on("driver:location", (data: any) => {
        if (data?.driverId) {
          setDrivers(prev => prev.map(d =>
            d.id === data.driverId ? { ...d, latitude: data.latitude, longitude: data.longitude, lastLocationAt: data.timestamp } : d
          ));
        }
      }),
      on("operational:alert", (data: any) => {
        if (data?.message) {
          flash(data.message);
        }
      }),
    ];
    return () => { unsubs.forEach(u => u()); clearTimeout(debouncedReloadRef.current); };
  }, [on, loadDashboard, debouncedReload]);

  function flash(msg: string) { setActionMsg(msg); setTimeout(() => setActionMsg(""), 4000); }

  async function handleAutoAssignAll() {
    try {
      const res = await dispatchApi.autoAssignAll();
      flash(`Auto-assigned ${res.assigned || 0} trips`);
      loadDashboard();
    } catch (err: any) { flash(`Error: ${err.message}`); }
  }

  async function handleAssignTrip(tripId: string, driverId: string) {
    try { await tripApi.assign(tripId, driverId); flash("Trip assigned"); loadDashboard(); }
    catch (err: any) { flash(`Error: ${err.message}`); }
  }

  async function handleOverrideDriver(driverId: string, availability: string) {
    try { await driverApi.overrideStatus(driverId, availability, "Dispatch override"); flash(`Driver set to ${availability}`); loadDashboard(); }
    catch (err: any) { flash(`Error: ${err.message}`); }
  }

  async function handleReleaseDriver(driverId: string) {
    try { await dispatchApi.releaseDriver(driverId); flash("Driver released"); loadDashboard(); }
    catch (err: any) { flash(`Error: ${err.message}`); }
  }

  async function handleResyncStale() {
    try { const res = await dispatchApi.resyncStale(15); flash(`Resynced ${res.corrected || 0} stale drivers`); loadDashboard(); }
    catch (err: any) { flash(`Error: ${err.message}`); }
  }

  async function handleRepairTrip() {
    if (!repairModal || !repairStatus || !repairReason) return;
    try {
      await dispatchApi.repairTrip(repairModal.tripId, repairStatus, repairReason);
      flash("Trip status repaired");
      setRepairModal(null);
      setRepairStatus("");
      setRepairReason("");
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
  const onlineDrivers = drivers.filter(d => d.isOnline);

  if (loading) return <div className="app-shell"><div className="main-content"><p>Loading dashboard...</p></div></div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>UCM Dispatch</h2>
        <nav>
          <a className={tab === "urgent" ? "active" : ""} onClick={() => setTab("urgent")} href="#">
            Urgent {urgentTrips.length > 0 && <span className="badge badge-immediate ml-1" style={{ fontSize: "0.65rem", padding: "0.1rem 0.4rem" }}>{urgentTrips.length}</span>}
          </a>
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

        {/* Stats */}
        <div className="grid-5 mb-4">
          <div className="stat-card stat-card-amber"><div className="stat-value">{pendingTrips.length}</div><div className="stat-label">Pending</div></div>
          <div className="stat-card stat-card-purple"><div className="stat-value">{activeTrips.length}</div><div className="stat-label">Active</div></div>
          <div className="stat-card stat-card-green"><div className="stat-value">{availableDrivers.length}</div><div className="stat-label">Available</div></div>
          <div className="stat-card stat-card-red"><div className="stat-value">{urgentTrips.length}</div><div className="stat-label">Urgent</div></div>
          <div className="stat-card stat-card-blue"><div className="stat-value">{onlineDrivers.length}</div><div className="stat-label">Online</div></div>
        </div>

        {/* Repair Modal */}
        {repairModal && (
          <div className="trip-popup-overlay" onClick={() => setRepairModal(null)}>
            <div className="card" style={{ width: 400, maxWidth: "90vw" }} onClick={e => e.stopPropagation()}>
              <h3 className="font-bold mb-3">Repair Trip Status</h3>
              <p className="text-sm text-gray mb-3">Current: <span className="badge badge-{repairModal.currentStatus}">{repairModal.currentStatus}</span></p>
              <div className="form-group">
                <label className="form-label">New Status</label>
                <select className="form-input" value={repairStatus} onChange={e => setRepairStatus(e.target.value)}>
                  <option value="">Select...</option>
                  {["requested", "assigned", "en_route", "arrived", "in_progress", "completed", "cancelled"].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Reason (required)</label>
                <input className="form-input" value={repairReason} onChange={e => setRepairReason(e.target.value)} placeholder="Why is this repair needed?" />
              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={!repairStatus || !repairReason} onClick={handleRepairTrip}>Apply Repair</button>
                <button className="btn btn-outline" onClick={() => setRepairModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* URGENT QUEUE */}
        {tab === "urgent" && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <h3 style={{ fontSize: "1.1rem", fontWeight: 600 }}>Urgent Trip Queue</h3>
              <button className="btn btn-primary btn-sm" onClick={handleAutoAssignAll}>Auto-Assign All</button>
            </div>
            {urgentTrips.length === 0 && (
              <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
                <p className="text-gray">No urgent trips at this time</p>
              </div>
            )}
            {urgentTrips.map(trip => (
              <div key={trip.id} className="urgent-card mb-3">
                <div className="flex justify-between items-center">
                  <div className="urgent-label">Immediate Request</div>
                  <span className="text-sm font-bold" style={{ color: "var(--red-600)" }}>Waiting {waitTime(trip.createdAt)}</span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <div>
                    <p className="font-bold">{trip.patientName || "Patient"}</p>
                    <p className="text-sm">{trip.pickupAddress} &rarr; {trip.dropoffAddress}</p>
                    {trip.scheduledPickup && <p className="text-xs text-gray mt-1">Scheduled: {formatDateTime(trip.scheduledPickup, timezone)}</p>}
                  </div>
                  <div className="flex gap-2">
                    <select className="form-input" style={{ width: 160 }} onChange={e => e.target.value && handleAssignTrip(trip.id, e.target.value)}>
                      <option value="">Assign to...</option>
                      {availableDrivers.map(d => <option key={d.id} value={d.id}>{d.name} {d.isOnline ? "(online)" : ""}</option>)}
                    </select>
                    <button className="btn btn-outline btn-sm" style={{ color: "var(--red-600)" }} onClick={() => {
                      if (confirm("Reject this trip?")) {
                        dispatchApi.cancelTrip(trip.id, "Rejected by dispatch").then(() => { flash("Trip rejected"); loadDashboard(); });
                      }
                    }}>Reject</button>
                  </div>
                </div>
              </div>
            ))}

            {/* Also show non-urgent pending trips */}
            {pendingTrips.filter(t => t.priority !== "immediate").length > 0 && (
              <div className="mt-4">
                <h4 className="font-medium mb-2">Pending Scheduled Trips</h4>
                {pendingTrips.filter(t => t.priority !== "immediate").map(trip => (
                  <div key={trip.id} className="card mb-2">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="badge badge-requested mr-1">requested</span>
                        <span className="font-medium">{trip.patientName || "Patient"}</span>
                        <span className="text-sm text-gray ml-1">{trip.pickupAddress}</span>
                      </div>
                      <select className="form-input btn-sm" style={{ width: 150 }} onChange={e => e.target.value && handleAssignTrip(trip.id, e.target.value)}>
                        <option value="">Assign...</option>
                        {availableDrivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TRIPS TAB */}
        {tab === "trips" && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">All Trips</span>
              <button className="btn btn-primary btn-sm" onClick={handleAutoAssignAll}>Auto-Assign All</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Status</th><th>Priority</th><th>Patient</th><th>Pickup</th><th>Dropoff</th><th>Distance</th><th>Driver</th><th>Wait</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {trips.map(trip => (
                    <tr key={trip.id} className={trip.priority === "immediate" && trip.status === "requested" ? "trip-row-urgent" : ""}>
                      <td><span className={`badge badge-${trip.status}`}>{trip.status}</span></td>
                      <td><span className={`badge ${trip.priority === "immediate" ? "badge-immediate" : ""}`}>{trip.priority}</span></td>
                      <td>{trip.patientName || "—"}</td>
                      <td className="truncate" style={{ maxWidth: 180 }}>{trip.pickupAddress}</td>
                      <td className="truncate" style={{ maxWidth: 180 }}>{trip.dropoffAddress}</td>
                      <td className="text-sm text-gray">
                        {trip.mileage ? `${trip.mileage} mi` : trip.estimatedMiles ? `~${trip.estimatedMiles} mi` : "—"}
                        {trip.estimatedMinutes ? <span className="text-xs ml-1">({trip.estimatedMinutes}m)</span> : null}
                      </td>
                      <td>{trip.driverName || "—"}</td>
                      <td className="text-sm" style={{ color: trip.status === "requested" ? "var(--amber-600)" : undefined, fontWeight: trip.status === "requested" ? 600 : undefined }}>
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
                            {["assigned", "en_route", "arrived"].includes(trip.status) && (
                              <button className="btn btn-outline btn-sm" style={{ color: "var(--amber-600)", borderColor: "var(--amber-200)" }} onClick={() => {
                                if (confirm("Unassign this trip?")) {
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
                          <button className="btn btn-outline btn-sm mt-1" style={{ color: "var(--red-600)", borderColor: "var(--red-200)" }} onClick={() => {
                            if (confirm("Cancel this trip?")) {
                              dispatchApi.cancelTrip(trip.id, "Cancelled by dispatch").then(() => { flash("Trip cancelled"); loadDashboard(); }).catch((err: any) => flash(`Error: ${err.message}`));
                            }
                          }}>Cancel</button>
                        )}
                        <button className="btn btn-outline btn-sm mt-1" style={{ fontSize: "0.7rem" }} onClick={() => setRepairModal({ tripId: trip.id, currentStatus: trip.status })}>Repair</button>
                      </td>
                    </tr>
                  ))}
                  {trips.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", padding: "2rem" }} className="text-gray">No trips found</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* DRIVERS TAB */}
        {tab === "drivers" && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Drivers</span>
              <button className="btn btn-outline btn-sm" onClick={handleResyncStale}>Resync Stale</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Status</th><th>Online</th><th>Active Trips</th><th>Last Location</th><th>Actions</th></tr></thead>
                <tbody>
                  {drivers.map(driver => (
                    <tr key={driver.id}>
                      <td className="font-medium">{driver.name}</td>
                      <td><span className={`badge badge-${driver.availability}`}>{driver.availability}</span></td>
                      <td>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", display: "inline-block", background: driver.isOnline ? "var(--green-500)" : "var(--gray-300)" }}></span>
                      </td>
                      <td>{driver.activeTripCount}</td>
                      <td className="text-sm text-gray">
                        {driver.latitude && driver.longitude ? `${Number(driver.latitude).toFixed(4)}, ${Number(driver.longitude).toFixed(4)}` : "No location"}
                        {driver.lastLocationAt && <span className="text-xs ml-1">({formatTime(driver.lastLocationAt, timezone)})</span>}
                      </td>
                      <td className="flex gap-2">
                        {driver.availability !== "available" && <button className="btn btn-success btn-sm" onClick={() => handleOverrideDriver(driver.id, "available")}>Available</button>}
                        {driver.availability === "available" && <button className="btn btn-outline btn-sm" onClick={() => handleOverrideDriver(driver.id, "break")}>Break</button>}
                        {driver.availability === "busy" && <button className="btn btn-warning btn-sm" onClick={() => handleReleaseDriver(driver.id)}>Release</button>}
                        <button className="btn btn-outline btn-sm" onClick={() => handleOverrideDriver(driver.id, "offline")}>Offline</button>
                      </td>
                    </tr>
                  ))}
                  {drivers.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: "2rem" }} className="text-gray">No drivers found</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MAP TAB */}
        {tab === "map" && (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ height: "calc(100vh - 220px)", minHeight: 400 }}>
              <DispatchMap drivers={drivers} trips={pendingTrips} />
            </div>
          </div>
        )}

        {/* TOOLS TAB */}
        {tab === "tools" && (
          <div>
            <h3 className="mb-3" style={{ fontSize: "1.1rem", fontWeight: 600 }}>Dispatch Tools</h3>
            <div className="grid-2">
              <div className="card">
                <h4 className="card-title mb-2">Auto-Assign</h4>
                <p className="text-sm text-gray mb-3">Assign all pending trips to the best available driver.</p>
                <button className="btn btn-primary" onClick={handleAutoAssignAll}>Run Auto-Assign</button>
              </div>
              <div className="card">
                <h4 className="card-title mb-2">Resync Stale Drivers</h4>
                <p className="text-sm text-gray mb-3">Set drivers with no location in 15+ min to offline.</p>
                <button className="btn btn-warning" onClick={handleResyncStale}>Resync Stale</button>
              </div>
              <div className="card">
                <h4 className="card-title mb-2">Release Stuck Busy</h4>
                <p className="text-sm text-gray mb-3">Release busy drivers with 0 active trips.</p>
                <button className="btn btn-warning" onClick={async () => {
                  const stuckBusy = drivers.filter(d => d.availability === "busy" && d.activeTripCount === 0);
                  if (stuckBusy.length === 0) { flash("No stuck busy drivers found"); return; }
                  if (!confirm(`Release ${stuckBusy.length} stuck busy driver(s)?`)) return;
                  let released = 0;
                  for (const d of stuckBusy) { try { await dispatchApi.releaseDriver(d.id); released++; } catch { /* skip */ } }
                  flash(`Released ${released} driver(s)`);
                  loadDashboard();
                }}>Release Stuck</button>
              </div>
              <div className="card">
                <h4 className="card-title mb-2">Refresh Dashboard</h4>
                <p className="text-sm text-gray mb-3">Force reload all data from server.</p>
                <button className="btn btn-outline" onClick={() => { setLoading(true); loadDashboard(); }}>Refresh</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
