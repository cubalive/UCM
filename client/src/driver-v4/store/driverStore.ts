import { create } from "zustand";
import { resolveUrl, getStoredToken } from "@/lib/api";
import { DRIVER_TOKEN_KEY } from "@/lib/hostDetection";

export type DriverStatus = "offline" | "online";
export type ShiftStatus = "offShift" | "onShift";
export type TripPhase =
  | "none"
  | "offer"
  | "toPickup"
  | "arrivedPickup"
  | "waiting"
  | "toDropoff"
  | "arrivedDropoff"
  | "complete";

export interface ActiveTrip {
  id: string;
  tripId: number;
  pickupAddress: string;
  dropoffAddress: string;
  pickupLatLng: { lat: number; lng: number };
  dropoffLatLng: { lat: number; lng: number };
  passengerName: string;
  notes: string;
  etaMinutes: number;
  scheduledTime?: string;
  tripType?: string;
  status?: string;
  routePolyline?: string | null;
}

export interface TripOffer {
  offerId: number;
  tripId: number;
  publicId: string;
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  patientName: string | null;
  secondsRemaining: number;
  expiresAt: string;
}

export interface NextAction {
  label: string;
  actionKey: string;
  disabled: boolean;
  hint: string;
  variant: "primary" | "secondary" | "danger";
}

interface DriverState {
  driverStatus: DriverStatus;
  shiftStatus: ShiftStatus;
  activeTrip: ActiveTrip | null;
  tripPhase: TripPhase;
  pendingOffer: TripOffer | null;
  earningsToday: number;
  earningsWeek: number;
  rating: number;
  completedRides: number;
  navPreference: "ask" | "google" | "apple" | "waze";
  driverName: string;
  driverInitials: string;
  driverLat: number | null;
  driverLng: number | null;
  driverHeading: number | null;
  loading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  setOnline: () => Promise<void>;
  setOffline: () => Promise<void>;
  startShift: () => Promise<void>;
  endShift: () => Promise<void>;
  acceptOffer: () => Promise<void>;
  declineOffer: () => Promise<void>;
  advanceTripStatus: (newStatus: string) => Promise<void>;
  markArrivedPickup: () => Promise<void>;
  confirmPickup: () => Promise<void>;
  markArrivedDropoff: () => Promise<void>;
  completeTrip: () => Promise<void>;
  setNavPreference: (p: "ask" | "google" | "apple" | "waze") => void;
  pollOffers: () => Promise<void>;
  pollActiveTrip: () => Promise<void>;
  updateLocation: (lat: number, lng: number, heading?: number) => void;
  reportEmergency: (note?: string) => Promise<void>;
  getNextAction: () => NextAction;
}

function getToken(): string | null {
  return localStorage.getItem(DRIVER_TOKEN_KEY) || getStoredToken();
}

async function driverApi(path: string, options?: RequestInit): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(resolveUrl(path), { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message || `API error ${res.status}`);
  }
  return res.json();
}

function statusToPhase(status: string): TripPhase {
  switch (status) {
    case "ASSIGNED":
    case "EN_ROUTE_TO_PICKUP": return "toPickup";
    case "ARRIVED_PICKUP": return "arrivedPickup";
    case "PICKED_UP":
    case "EN_ROUTE_TO_DROPOFF":
    case "IN_PROGRESS": return "toDropoff";
    case "ARRIVED_DROPOFF": return "arrivedDropoff";
    case "COMPLETED": return "complete";
    default: return "none";
  }
}

function tripFromApiData(trip: any): ActiveTrip {
  return {
    id: trip.publicId || String(trip.id),
    tripId: trip.id,
    pickupAddress: trip.pickupAddress || "",
    dropoffAddress: trip.dropoffAddress || "",
    pickupLatLng: { lat: Number(trip.pickupLat) || 0, lng: Number(trip.pickupLng) || 0 },
    dropoffLatLng: { lat: Number(trip.dropoffLat) || 0, lng: Number(trip.dropoffLng) || 0 },
    passengerName: trip.patientName || "Patient",
    notes: trip.notes || "",
    etaMinutes: trip.lastEtaMinutes || 15,
    scheduledTime: trip.pickupTime || undefined,
    tripType: "Medical",
    status: trip.status,
    routePolyline: trip.routePolyline || null,
  };
}

export const useDriverStore = create<DriverState>((set, get) => ({
  driverStatus: "offline",
  shiftStatus: "offShift",
  activeTrip: null,
  tripPhase: "none",
  pendingOffer: null,
  earningsToday: 0,
  earningsWeek: 0,
  rating: 0,
  completedRides: 0,
  navPreference: "ask",
  driverName: "",
  driverInitials: "",
  driverLat: null,
  driverLng: null,
  driverHeading: null,
  loading: false,
  error: null,

  initialize: async () => {
    set({ loading: true, error: null });
    try {
      const [me, summary, earnings] = await Promise.all([
        driverApi("/api/driver/me"),
        driverApi("/api/driver/summary").catch(() => null),
        driverApi("/api/driver/earnings?range=week").catch(() => null),
      ]);

      const driver = me.driver;
      const firstName = driver.firstName || "";
      const lastName = driver.lastName || "";

      set({
        driverName: driver.displayName || `${firstName} ${lastName}`,
        driverInitials: `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase(),
        driverStatus: driver.dispatchStatus !== "off" ? "online" : "offline",
        shiftStatus: driver.shift?.status === "ON_SHIFT" ? "onShift" : "offShift",
        rating: summary?.score ?? 0,
        completedRides: summary?.today?.completed ?? 0,
        earningsWeek: earnings ? earnings.totalCents / 100 : 0,
        earningsToday: 0,
      });

      if (summary?.activeTripId) {
        await get().pollActiveTrip();
      } else {
        await get().pollOffers();
      }
    } catch (err: any) {
      set({ error: err.message });
    } finally {
      set({ loading: false });
    }
  },

  setOnline: async () => {
    try {
      await driverApi("/api/driver/me/active", { method: "POST", body: JSON.stringify({ active: true }) });
      set({ driverStatus: "online" });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  setOffline: async () => {
    try {
      await driverApi("/api/driver/me/active", { method: "POST", body: JSON.stringify({ active: false }) });
      set({ driverStatus: "offline", shiftStatus: "offShift" });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  startShift: async () => {
    try {
      await driverApi("/api/driver/shift/start", { method: "POST", body: "{}" });
      set({ shiftStatus: "onShift" });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  endShift: async () => {
    try {
      await driverApi("/api/driver/shift/end", { method: "POST", body: "{}" });
      set({ shiftStatus: "offShift" });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  acceptOffer: async () => {
    const offer = get().pendingOffer;
    if (!offer) return;
    try {
      const result = await driverApi(`/api/driver/offers/${offer.offerId}/accept`, { method: "POST", body: "{}" });
      set({ pendingOffer: null });
      if (result.tripId) {
        const tripData = await driverApi(`/api/driver/trips/${result.tripId}`);
        const trip = tripData.trip || tripData;
        set({ activeTrip: tripFromApiData(trip), tripPhase: statusToPhase(trip.status) });
      }
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  declineOffer: async () => {
    const offer = get().pendingOffer;
    if (!offer) return;
    try {
      await driverApi(`/api/driver/offers/${offer.offerId}/decline`, { method: "POST", body: "{}" });
      set({ pendingOffer: null, tripPhase: "none", activeTrip: null });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  advanceTripStatus: async (newStatus: string) => {
    const trip = get().activeTrip;
    if (!trip) return;
    try {
      const idempotencyKey = `${trip.tripId}_${newStatus}_${Date.now()}`;
      await driverApi(`/api/driver/trips/${trip.tripId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: newStatus, idempotencyKey }),
      });
      const newPhase = statusToPhase(newStatus);
      set({ tripPhase: newPhase, activeTrip: { ...trip, status: newStatus } });

      if (newStatus === "COMPLETED") {
        set((s) => ({ completedRides: s.completedRides + 1, activeTrip: null }));
        setTimeout(() => set({ tripPhase: "none" }), 2000);
        driverApi("/api/driver/earnings?range=week").then((data) => {
          set({ earningsWeek: data.totalCents / 100 });
        }).catch(() => {});
      }
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  markArrivedPickup: async () => { await get().advanceTripStatus("ARRIVED_PICKUP"); },
  confirmPickup: async () => { await get().advanceTripStatus("PICKED_UP"); },
  markArrivedDropoff: async () => { await get().advanceTripStatus("ARRIVED_DROPOFF"); },
  completeTrip: async () => { await get().advanceTripStatus("COMPLETED"); },

  setNavPreference: (p) => {
    set({ navPreference: p });
    driverApi("/api/driver/settings", { method: "PATCH", body: JSON.stringify({ navPreference: p }) }).catch(() => {});
  },

  pollOffers: async () => {
    try {
      const data = await driverApi("/api/driver/offers/active");
      const offers = data.offers || [];
      if (offers.length > 0) {
        const offer = offers[0];
        set({
          pendingOffer: offer,
          tripPhase: "offer",
          activeTrip: {
            id: offer.publicId || String(offer.tripId),
            tripId: offer.tripId,
            pickupAddress: offer.pickupAddress || "",
            dropoffAddress: offer.dropoffAddress || "",
            pickupLatLng: { lat: Number(offer.pickupLat) || 0, lng: Number(offer.pickupLng) || 0 },
            dropoffLatLng: { lat: Number(offer.dropoffLat) || 0, lng: Number(offer.dropoffLng) || 0 },
            passengerName: offer.patientName || "Patient",
            notes: "",
            etaMinutes: 15,
            tripType: "Medical",
            routePolyline: null,
          },
        });
      }
    } catch {}
  },

  pollActiveTrip: async () => {
    try {
      const data = await driverApi("/api/driver/active-trip");
      if (data.trip) {
        set({ activeTrip: tripFromApiData(data.trip), tripPhase: statusToPhase(data.trip.status), pendingOffer: null });
      } else {
        set({ activeTrip: null, tripPhase: "none" });
      }
    } catch {}
  },

  updateLocation: (lat, lng, heading?) => {
    set({ driverLat: lat, driverLng: lng, driverHeading: heading ?? null });
    driverApi("/api/driver/me/location", {
      method: "POST",
      body: JSON.stringify({ lat, lng, heading, ts: Date.now(), source: "gps" }),
    }).catch(() => {});
  },

  reportEmergency: async (note?) => {
    const { driverLat, driverLng } = get();
    try {
      await driverApi("/api/driver/emergency", { method: "POST", body: JSON.stringify({ lat: driverLat, lng: driverLng, note }) });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  getNextAction: () => {
    const s = get();

    if (s.driverStatus === "offline") {
      return { label: "Go Online", actionKey: "setOnline", disabled: false, hint: "Start accepting trips", variant: "primary" };
    }
    if (s.shiftStatus === "offShift") {
      return { label: "Start Shift", actionKey: "startShift", disabled: false, hint: "Begin your shift", variant: "primary" };
    }

    switch (s.tripPhase) {
      case "none":
        return { label: "Waiting for Trips", actionKey: "", disabled: true, hint: "You'll be notified when a trip is available", variant: "secondary" };
      case "offer":
        return { label: "Accept Trip", actionKey: "acceptOffer", disabled: false, hint: `${s.activeTrip?.passengerName} • ${s.activeTrip?.scheduledTime || "ASAP"}`, variant: "primary" };
      case "toPickup":
        return { label: "Arrived at Pickup", actionKey: "markArrivedPickup", disabled: false, hint: s.activeTrip?.pickupAddress || "", variant: "primary" };
      case "arrivedPickup":
      case "waiting":
        return { label: "Confirm Pickup", actionKey: "confirmPickup", disabled: false, hint: "Patient is on board", variant: "primary" };
      case "toDropoff":
        return { label: "Arrived at Dropoff", actionKey: "markArrivedDropoff", disabled: false, hint: s.activeTrip?.dropoffAddress || "", variant: "primary" };
      case "arrivedDropoff":
        return { label: "Complete Trip", actionKey: "completeTrip", disabled: false, hint: "Confirm delivery complete", variant: "primary" };
      case "complete":
        return { label: "Trip Complete!", actionKey: "", disabled: true, hint: "Great job!", variant: "secondary" };
      default:
        return { label: "Ready", actionKey: "", disabled: true, hint: "", variant: "secondary" };
    }
  },
}));
