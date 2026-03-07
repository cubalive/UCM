import React, { useState, useEffect, useCallback, useRef } from "react";
import { tripApi, driverApi, earningsApi, logout } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";
import { DriverMap } from "../components/DriverMap";
import { formatDateTime, formatDate } from "../lib/timezone";
import { decodePolyline } from "../lib/polyline";

type Trip = {
  id: string; status: string; priority: string;
  pickupAddress: string; dropoffAddress: string;
  pickupLat?: number; pickupLng?: number;
  dropoffLat?: number; dropoffLng?: number;
  estimatedMiles?: number; estimatedMinutes?: number;
  mileage?: number;
  scheduledPickup?: string; patientName?: string;
  patientPhone?: string; notes?: string;
};

const STATUS_ACTIONS: Record<string, { next: string; label: string; color: string; confirm?: string }> = {
  assigned: { next: "en_route", label: "Start - En Route", color: "btn-primary" },
  en_route: { next: "arrived", label: "Arrived at Pickup", color: "btn-warning" },
  arrived: { next: "in_progress", label: "Patient On Board", color: "btn-success" },
  in_progress: { next: "completed", label: "Complete Trip", color: "btn-success", confirm: "Mark this trip as completed?" },
};

const TRIP_STEPS = ["assigned", "en_route", "arrived", "in_progress", "completed"];
const STEP_LABELS = ["Assigned", "En Route", "Arrived", "In Progress", "Done"];

function TripProgress({ status }: { status: string }) {
  const currentIdx = TRIP_STEPS.indexOf(status);
  return (
    <div className="trip-progress">
      {TRIP_STEPS.map((step, i) => (
        <div key={step} className={`trip-step ${i <= currentIdx ? "trip-step-done" : ""} ${i === currentIdx ? "trip-step-current" : ""}`}>
          <div className="trip-step-dot">{i < currentIdx ? "\u2713" : i + 1}</div>
          <span className="trip-step-label">{STEP_LABELS[i]}</span>
        </div>
      ))}
    </div>
  );
}

export function DriverApp() {
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [upcomingTrips, setUpcomingTrips] = useState<Trip[]>([]);
  const [availability, setAvailability] = useState<string>("offline");
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState("");
  const [showTripPopup, setShowTripPopup] = useState(false);
  const [pendingTrip, setPendingTrip] = useState<Trip | null>(null);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [tab, setTab] = useState<"trip" | "earnings">("trip");
  const [earnings, setEarnings] = useState<any>(null);
  const [timezone, setTimezone] = useState("America/New_York");
  const [routeCoords, setRouteCoords] = useState<[number, number][] | undefined>();
  const [routeInfo, setRouteInfo] = useState<{ miles: number; minutes: number; source: string } | null>(null);
  const { connected, on, send } = useWebSocket();
  const locationInterval = useRef<number>();
  const prevTripIdRef = useRef<string | null>(null);
  const popupTimeoutRef = useRef<number>();

  const loadTrips = useCallback(async () => {
    try {
      const res = await tripApi.driverTrips(true);
      const trips: Trip[] = res.trips || res || [];
      if (res.timezone) setTimezone(res.timezone);
      const active = trips.find((t: Trip) => ["assigned", "en_route", "arrived", "in_progress"].includes(t.status));

      // Show trip acceptance popup for new assignments
      if (active && active.id !== prevTripIdRef.current && active.status === "assigned") {
        setPendingTrip(active);
        setShowTripPopup(true);
        // Auto-dismiss popup after 30s
        clearTimeout(popupTimeoutRef.current);
        popupTimeoutRef.current = window.setTimeout(() => setShowTripPopup(false), 30000);
      }
      prevTripIdRef.current = active?.id || null;

      setActiveTrip(active || null);
      setUpcomingTrips(trips.filter((t: Trip) => t.status === "assigned" && t.id !== active?.id));
    } catch { /* empty */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadTrips(); }, [loadTrips]);

  // Realtime
  useEffect(() => {
    const unsubs = [
      on("trip:assigned", loadTrips),
      on("trip:accepted", loadTrips),
      on("trip:updated", loadTrips),
      on("trip:cancelled", () => { setShowTripPopup(false); loadTrips(); }),
      on("driver:status_changed", (data: any) => {
        if (data?.availability) setAvailability(data.availability);
      }),
    ];
    return () => { unsubs.forEach(u => u()); clearTimeout(popupTimeoutRef.current); };
  }, [on, loadTrips]);

  // Fetch driving route when active trip changes
  useEffect(() => {
    if (!activeTrip?.id || !activeTrip.pickupLat || !activeTrip.dropoffLat) {
      setRouteCoords(undefined);
      setRouteInfo(null);
      return;
    }
    let cancelled = false;
    tripApi.getRoute(activeTrip.id).then(data => {
      if (cancelled) return;
      if (data.polyline) {
        setRouteCoords(decodePolyline(data.polyline));
      } else {
        // Fallback: straight line between pickup and dropoff
        setRouteCoords([
          [activeTrip.pickupLng!, activeTrip.pickupLat!],
          [activeTrip.dropoffLng!, activeTrip.dropoffLat!],
        ]);
      }
      setRouteInfo({ miles: data.distanceMiles, minutes: data.durationMinutes, source: data.source });
    }).catch(() => {
      if (!cancelled) {
        setRouteCoords(undefined);
        setRouteInfo(null);
      }
    });
    return () => { cancelled = true; };
  }, [activeTrip?.id]);

  // Location tracking — adaptive interval: 5s during active trip, 15s when idle
  useEffect(() => {
    if (!navigator.geolocation) return;
    function sendLocation() {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setDriverPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          driverApi.updateLocation(pos.coords.latitude, pos.coords.longitude, undefined, Math.round(pos.coords.speed || 0));
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
    const interval = activeTrip && ["en_route", "arrived", "in_progress"].includes(activeTrip.status) ? 5000 : 15000;
    sendLocation();
    locationInterval.current = window.setInterval(sendLocation, interval);
    return () => clearInterval(locationInterval.current);
  }, [send, activeTrip?.status]);

  function flash(msg: string) {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(""), 3000);
  }

  async function handleAccept(tripId: string) {
    try {
      await tripApi.accept(tripId);
      setShowTripPopup(false);
      flash("Trip accepted!");
      loadTrips();
    } catch (err: any) { flash(`Error: ${err.message}`); }
  }

  async function handleDecline(tripId: string) {
    if (!confirm("Decline this trip? It will go back to dispatch.")) return;
    try {
      await tripApi.decline(tripId, "Driver declined");
      setShowTripPopup(false);
      flash("Trip declined");
      loadTrips();
    } catch (err: any) { flash(`Error: ${err.message}`); }
  }

  async function handleStatusUpdate(tripId: string, newStatus: string) {
    try {
      await tripApi.updateStatus(tripId, newStatus);
      flash(`Trip ${newStatus.replace("_", " ")}`);
      loadTrips();
    } catch (err: any) { flash(`Error: ${err.message}`); }
  }

  async function handleAvailability(newStatus: string) {
    try {
      await driverApi.updateAvailability(newStatus);
      setAvailability(newStatus);
      flash(`Status: ${newStatus}`);
    } catch (err: any) { flash(`Error: ${err.message}`); }
  }

  async function loadEarnings() {
    try {
      const data = await earningsApi.getEarnings();
      setEarnings(data);
    } catch { /* empty */ }
  }

  if (loading) return <div className="driver-shell"><div className="driver-header"><h2>Loading...</h2></div></div>;

  const action = activeTrip ? STATUS_ACTIONS[activeTrip.status] : null;

  return (
    <div className="driver-shell">
      {/* TRIP ACCEPTANCE POPUP */}
      {showTripPopup && pendingTrip && (
        <div className="trip-popup-overlay">
          <div className="trip-popup">
            <div className="trip-popup-header">
              {pendingTrip.priority === "immediate" ? "URGENT TRIP REQUEST" : "TRIP REQUEST"}
            </div>
            <div className="trip-popup-body">
              {pendingTrip.patientName && (
                <p className="font-bold" style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>{pendingTrip.patientName}</p>
              )}
              <div className="trip-addresses">
                <div className="address-line">
                  <span className="address-dot dot-pickup"></span>
                  <span>{pendingTrip.pickupAddress}</span>
                </div>
                <div className="address-line">
                  <span className="address-dot dot-dropoff"></span>
                  <span>{pendingTrip.dropoffAddress}</span>
                </div>
              </div>
              {pendingTrip.scheduledPickup && (
                <p className="text-sm text-gray mt-2">Pickup: {formatDateTime(pendingTrip.scheduledPickup, timezone)}</p>
              )}
              {pendingTrip.notes && (
                <p className="text-sm mt-2" style={{ background: "var(--amber-50)", padding: "0.5rem", borderRadius: "var(--radius)" }}>{pendingTrip.notes}</p>
              )}
            </div>
            <div className="trip-popup-actions">
              <button className="btn btn-success btn-xl" style={{ flex: 2 }} onClick={() => handleAccept(pendingTrip.id)}>
                ACCEPT
              </button>
              <button className="btn btn-danger btn-xl" style={{ flex: 1 }} onClick={() => handleDecline(pendingTrip.id)}>
                DECLINE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="driver-header">
        <div>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700 }}>UCM Driver</h2>
          <span className="text-xs" style={{ opacity: 0.8 }}>{connected ? "Connected" : "Offline"}</span>
        </div>
        <div className="flex gap-2">
          {["available", "break", "offline"].map(s => (
            <button
              key={s}
              className={`btn btn-sm ${availability === s ? "btn-success" : "btn-outline"}`}
              style={availability !== s ? { color: "white", borderColor: "rgba(255,255,255,0.3)" } : {}}
              onClick={() => handleAvailability(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          <button className="btn btn-sm btn-outline" style={{ color: "white", borderColor: "rgba(255,255,255,0.3)" }} onClick={logout}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div className="driver-tabs">
        <button className={`driver-tab ${tab === "trip" ? "driver-tab-active" : ""}`} onClick={() => setTab("trip")}>Trip</button>
        <button className={`driver-tab ${tab === "earnings" ? "driver-tab-active" : ""}`} onClick={() => { setTab("earnings"); loadEarnings(); }}>Earnings</button>
      </div>

      {tab === "trip" && (
        <>
          {/* Map */}
          <div className="driver-map">
            <DriverMap
              driverLat={driverPos?.lat}
              driverLng={driverPos?.lng}
              pickupLat={activeTrip?.pickupLat}
              pickupLng={activeTrip?.pickupLng}
              dropoffLat={activeTrip?.dropoffLat}
              dropoffLng={activeTrip?.dropoffLng}
              routeCoords={routeCoords}
            />
          </div>

          {actionMsg && (
            <div style={{ padding: "0.5rem 1rem", background: "var(--blue-50)", borderBottom: "1px solid var(--blue-100)" }}>
              <p className="text-sm font-medium" style={{ color: "var(--blue-700)" }}>{actionMsg}</p>
            </div>
          )}

          <div className="driver-panel">
            {activeTrip ? (
              <div className={`trip-card ${activeTrip.priority === "immediate" ? "trip-card-urgent" : ""}`}>
                <div className="flex justify-between items-center mb-2">
                  <span className={`badge badge-${activeTrip.status}`}>{activeTrip.status.replace("_", " ")}</span>
                  {activeTrip.priority === "immediate" && <span className="badge badge-immediate">URGENT</span>}
                </div>

                <TripProgress status={activeTrip.status} />

                {activeTrip.patientName && (
                  <p className="font-bold" style={{ fontSize: "1.1rem", marginTop: "0.75rem" }}>{activeTrip.patientName}</p>
                )}

                <div className="trip-addresses">
                  <div className="address-line">
                    <span className="address-dot dot-pickup"></span>
                    <span>{activeTrip.pickupAddress}</span>
                  </div>
                  <div className="address-line">
                    <span className="address-dot dot-dropoff"></span>
                    <span>{activeTrip.dropoffAddress}</span>
                  </div>
                </div>

                {(routeInfo || activeTrip.estimatedMiles || activeTrip.mileage) && (
                  <p className="text-sm text-gray mb-1" style={{ paddingLeft: "1.25rem" }}>
                    {routeInfo
                      ? `${routeInfo.miles} mi / ~${routeInfo.minutes} min`
                      : activeTrip.mileage
                        ? `${activeTrip.mileage} mi`
                        : `~${activeTrip.estimatedMiles} mi`}
                    {!routeInfo && activeTrip.estimatedMinutes ? ` / ~${activeTrip.estimatedMinutes} min` : ""}
                    {routeInfo?.source === "google_directions" && (
                      <span className="text-xs ml-1" style={{ color: "var(--green-600)" }}>(driving route)</span>
                    )}
                  </p>
                )}

                {activeTrip.scheduledPickup && (
                  <p className="text-sm text-gray mb-2">Pickup: {formatDateTime(activeTrip.scheduledPickup, timezone)}</p>
                )}

                {activeTrip.notes && (
                  <p className="text-sm mb-3" style={{ background: "var(--amber-50)", padding: "0.5rem", borderRadius: "var(--radius)" }}>{activeTrip.notes}</p>
                )}

                <div className="flex gap-2 mb-3">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                      activeTrip.status === "in_progress" ? activeTrip.dropoffAddress : activeTrip.pickupAddress
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary"
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    Navigate {activeTrip.status === "in_progress" ? "to Dropoff" : "to Pickup"}
                  </a>
                  {activeTrip.patientPhone && (
                    <a href={`tel:${activeTrip.patientPhone}`} className="btn btn-outline" style={{ flex: 1, justifyContent: "center" }}>Call Patient</a>
                  )}
                </div>

                {action && (
                  <button
                    className={`btn ${action.color} btn-xl`}
                    style={{ width: "100%" }}
                    onClick={() => {
                      if (action.confirm && !confirm(action.confirm)) return;
                      handleStatusUpdate(activeTrip.id, action.next);
                    }}
                  >
                    {action.label}
                  </button>
                )}

                {activeTrip.status === "assigned" && (
                  <button className="btn btn-danger btn-sm mt-3" style={{ width: "100%", justifyContent: "center" }} onClick={() => handleDecline(activeTrip.id)}>
                    Decline Trip
                  </button>
                )}

                {activeTrip.status !== "completed" && activeTrip.status !== "assigned" && (
                  <button className="btn btn-outline btn-sm mt-2" style={{ width: "100%", justifyContent: "center" }} onClick={() => {
                    if (confirm("Cancel this trip?")) {
                      tripApi.updateStatus(activeTrip.id, "cancelled").then(() => { flash("Trip cancelled"); loadTrips(); });
                    }
                  }}>
                    Cancel Trip
                  </button>
                )}
              </div>
            ) : (
              <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
                <div style={{ fontSize: "2rem", marginBottom: "0.5rem", opacity: 0.3 }}>&#128663;</div>
                <p className="font-medium" style={{ color: "var(--gray-700)" }}>No active trip</p>
                {availability !== "available" ? (
                  <div className="mt-3">
                    <p className="text-sm text-gray mb-2">Set yourself as available to receive trips</p>
                    <button className="btn btn-success" onClick={() => handleAvailability("available")}>Go Available</button>
                  </div>
                ) : (
                  <p className="text-sm text-gray mt-1">You're available. Waiting for dispatch to assign a trip.</p>
                )}
              </div>
            )}

            {upcomingTrips.length > 0 && (
              <div className="mt-4">
                <h3 className="font-medium mb-2" style={{ fontSize: "0.95rem" }}>Upcoming ({upcomingTrips.length})</h3>
                {upcomingTrips.map(trip => (
                  <div key={trip.id} className="trip-card">
                    <div className="flex justify-between items-center">
                      <span className="badge badge-assigned">Assigned</span>
                      {trip.priority === "immediate" && <span className="badge badge-immediate">URGENT</span>}
                    </div>
                    {trip.patientName && <p className="font-medium mt-1">{trip.patientName}</p>}
                    <div className="trip-addresses mt-2">
                      <div className="address-line">
                        <span className="address-dot dot-pickup"></span>
                        <span className="text-sm">{trip.pickupAddress}</span>
                      </div>
                      <div className="address-line">
                        <span className="address-dot dot-dropoff"></span>
                        <span className="text-sm">{trip.dropoffAddress}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "earnings" && (
        <div className="driver-panel">
          {earnings ? (
            <>
              <div className="grid-3 mb-4">
                <div className="stat-card stat-card-green">
                  <div className="stat-value">${earnings.balance?.toFixed(2) || "0.00"}</div>
                  <div className="stat-label">Balance</div>
                </div>
                <div className="stat-card stat-card-blue">
                  <div className="stat-value">${earnings.totalEarnings?.toFixed(2) || "0.00"}</div>
                  <div className="stat-label">Total Earned</div>
                </div>
                <div className="stat-card stat-card-purple">
                  <div className="stat-value">${earnings.totalPayouts?.toFixed(2) || "0.00"}</div>
                  <div className="stat-label">Total Payouts</div>
                </div>
              </div>
              {earnings.balance >= 5 && (
                <button className="btn btn-success btn-lg mb-4" style={{ width: "100%" }} onClick={async () => {
                  if (!confirm(`Request payout of $${earnings.balance.toFixed(2)}?`)) return;
                  try {
                    await earningsApi.requestPayout();
                    flash("Payout requested!");
                    loadEarnings();
                  } catch (err: any) { flash(`Error: ${err.message}`); }
                }}>
                  Request Payout (${earnings.balance.toFixed(2)})
                </button>
              )}
              <div className="card">
                <div className="card-header"><span className="card-title">Earnings History</span></div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Type</th><th>Amount</th><th>Date</th><th>Description</th></tr></thead>
                    <tbody>
                      {(earnings.history || []).map((e: any) => (
                        <tr key={e.id}>
                          <td><span className={`badge ${e.type === "payout" ? "badge-cancelled" : "badge-completed"}`}>{e.type}</span></td>
                          <td className={e.type === "payout" ? "text-red" : "text-green"} style={{ fontWeight: 600 }}>
                            {e.type === "payout" ? "-" : "+"}${Math.abs(Number(e.amount)).toFixed(2)}
                          </td>
                          <td className="text-sm text-gray">{formatDate(e.createdAt, timezone)}</td>
                          <td className="text-sm">{e.description || "—"}</td>
                        </tr>
                      ))}
                      {(!earnings.history || earnings.history.length === 0) && (
                        <tr><td colSpan={4} className="text-gray" style={{ textAlign: "center", padding: "2rem" }}>No earnings yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <p className="text-gray">Loading earnings...</p>
          )}
        </div>
      )}
    </div>
  );
}
