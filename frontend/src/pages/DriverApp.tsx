import React, { useState, useEffect, useCallback, useRef } from "react";
import { tripApi, driverApi } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";
import { DriverMap } from "../components/DriverMap";

type Trip = {
  id: string; status: string; priority: string;
  pickupAddress: string; dropoffAddress: string;
  pickupLat?: number; pickupLng?: number;
  dropoffLat?: number; dropoffLng?: number;
  scheduledPickup?: string; patientName?: string;
  patientPhone?: string; notes?: string;
};

const STATUS_ACTIONS: Record<string, { next: string; label: string; color: string }> = {
  assigned: { next: "en_route", label: "Start - En Route", color: "btn-primary" },
  en_route: { next: "arrived", label: "Arrived at Pickup", color: "btn-warning" },
  arrived: { next: "in_progress", label: "Patient On Board", color: "btn-success" },
  in_progress: { next: "completed", label: "Complete Trip", color: "btn-success" },
};

export function DriverApp() {
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [upcomingTrips, setUpcomingTrips] = useState<Trip[]>([]);
  const [availability, setAvailability] = useState<string>("offline");
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState("");
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const { connected, on, send } = useWebSocket();
  const locationInterval = useRef<number>();

  const loadTrips = useCallback(async () => {
    try {
      const res = await tripApi.driverTrips(true);
      const trips: Trip[] = res.trips || res || [];
      const active = trips.find((t: Trip) => ["assigned", "en_route", "arrived", "in_progress"].includes(t.status));
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
      on("trip:updated", loadTrips),
    ];
    return () => unsubs.forEach(u => u());
  }, [on, loadTrips]);

  // Location tracking
  useEffect(() => {
    if (!navigator.geolocation) return;

    function sendLocation() {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setDriverPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          driverApi.updateLocation(pos.coords.latitude, pos.coords.longitude, undefined, Math.round(pos.coords.speed || 0));
          send("driver:location_update", { latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        },
        () => { /* location error, silently ignore */ },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }

    sendLocation();
    locationInterval.current = window.setInterval(sendLocation, 15000);
    return () => clearInterval(locationInterval.current);
  }, [send]);

  function flash(msg: string) {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(""), 3000);
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

  if (loading) return <div className="driver-shell"><div className="driver-header"><h2>Loading...</h2></div></div>;

  const action = activeTrip ? STATUS_ACTIONS[activeTrip.status] : null;

  return (
    <div className="driver-shell">
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
        </div>
      </header>

      {/* Map */}
      <div className="driver-map">
        <DriverMap
          driverLat={driverPos?.lat}
          driverLng={driverPos?.lng}
          pickupLat={activeTrip?.pickupLat}
          pickupLng={activeTrip?.pickupLng}
          dropoffLat={activeTrip?.dropoffLat}
          dropoffLng={activeTrip?.dropoffLng}
        />
      </div>

      {/* Action message */}
      {actionMsg && (
        <div style={{ padding: "0.5rem 1rem", background: "var(--blue-50)", borderBottom: "1px solid var(--blue-100)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--blue-700)" }}>{actionMsg}</p>
        </div>
      )}

      {/* Driver panel */}
      <div className="driver-panel">
        {/* Active trip */}
        {activeTrip ? (
          <div className="trip-card">
            <div className="flex justify-between items-center mb-2">
              <span className={`badge badge-${activeTrip.status}`}>{activeTrip.status.replace("_", " ")}</span>
              {activeTrip.priority === "immediate" && <span className="badge badge-immediate">URGENT</span>}
            </div>

            {activeTrip.patientName && (
              <p className="font-bold" style={{ fontSize: "1.1rem" }}>{activeTrip.patientName}</p>
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

            {activeTrip.scheduledPickup && (
              <p className="text-sm text-gray mb-2">Pickup: {new Date(activeTrip.scheduledPickup).toLocaleString()}</p>
            )}

            {activeTrip.notes && (
              <p className="text-sm mb-3" style={{ background: "var(--amber-50)", padding: "0.5rem", borderRadius: "var(--radius)" }}>
                {activeTrip.notes}
              </p>
            )}

            {/* Quick action buttons row */}
            <div className="flex gap-2 mb-3">
              {activeTrip.pickupAddress && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                    activeTrip.status === "in_progress" ? activeTrip.dropoffAddress : activeTrip.pickupAddress
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  Navigate
                </a>
              )}
              {activeTrip.patientPhone && (
                <a href={`tel:${activeTrip.patientPhone}`} className="btn btn-outline" style={{ flex: 1, justifyContent: "center" }}>
                  Call Patient
                </a>
              )}
            </div>

            {/* Big action button */}
            {action && (
              <button
                className={`btn ${action.color} btn-xl`}
                style={{ width: "100%" }}
                onClick={() => handleStatusUpdate(activeTrip.id, action.next)}
              >
                {action.label}
              </button>
            )}

            {/* Decline option for newly assigned trips */}
            {activeTrip.status === "assigned" && (
              <button
                className="btn btn-danger btn-sm mt-3"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => {
                  if (confirm("Decline this trip? It will go back to dispatch.")) {
                    tripApi.updateStatus(activeTrip.id, "cancelled", { cancellationReason: "Driver declined" }).then(() => { flash("Trip declined"); loadTrips(); });
                  }
                }}
              >
                Decline Trip
              </button>
            )}

            {activeTrip.status !== "completed" && activeTrip.status !== "assigned" && (
              <button
                className="btn btn-outline btn-sm mt-2"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => {
                  if (confirm("Cancel this trip?")) {
                    tripApi.updateStatus(activeTrip.id, "cancelled").then(() => { flash("Trip cancelled"); loadTrips(); });
                  }
                }}
              >
                Cancel Trip
              </button>
            )}
          </div>
        ) : (
          <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
            <p className="text-gray font-medium">No active trip</p>
            <p className="text-sm text-gray mt-1">Set yourself as available to receive trips</p>
          </div>
        )}

        {/* Upcoming trips */}
        {upcomingTrips.length > 0 && (
          <div className="mt-4">
            <h3 className="font-medium mb-2" style={{ fontSize: "0.95rem" }}>Upcoming</h3>
            {upcomingTrips.map(trip => (
              <div key={trip.id} className="trip-card">
                <div className="flex justify-between items-center">
                  <span className="badge badge-assigned">Assigned</span>
                  {trip.scheduledPickup && <span className="text-sm text-gray">{new Date(trip.scheduledPickup).toLocaleTimeString()}</span>}
                </div>
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
    </div>
  );
}
