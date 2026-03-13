import { create } from "zustand";
import { persist } from "zustand/middleware";
import { resolveUrl, getStoredToken } from "@/lib/api";
import { DRIVER_TOKEN_KEY } from "@/lib/hostDetection";
import { showToast } from "../components/ui/Toast";

export type DriverStatus = "offline" | "online";
export type ShiftStatus = "offShift" | "onShift";
export type ServiceType = "transport" | "delivery" | "ambulatory" | "wheelchair" | "stretcher" | "bariatric" | "gurney" | "long_distance" | "multi_load";
export type ServiceFilter = "all" | ServiceType;

// Map vehicle capabilities to allowed service types
const VEHICLE_SERVICE_MAP: Record<string, ServiceType[]> = {
  sedan: ["ambulatory", "delivery", "long_distance"],
  suv: ["ambulatory", "delivery", "long_distance", "multi_load"],
  wheelchair: ["ambulatory", "wheelchair", "delivery", "long_distance"],
  stretcher: ["ambulatory", "wheelchair", "stretcher", "delivery", "long_distance"],
  both: ["ambulatory", "wheelchair", "delivery", "long_distance"],
  bariatric: ["ambulatory", "wheelchair", "bariatric", "delivery", "long_distance"],
  gurney: ["ambulatory", "wheelchair", "stretcher", "gurney", "delivery", "long_distance"],
};

const SERVICE_LABELS: Record<string, string> = {
  transport: "Medical",
  delivery: "Delivery",
  ambulatory: "Ambulatory",
  wheelchair: "Wheelchair",
  stretcher: "Stretcher",
  bariatric: "Bariatric",
  gurney: "Gurney",
  long_distance: "Long Distance",
  multi_load: "Multi-Load",
};

function getServiceLabel(serviceType?: string): string {
  return SERVICE_LABELS[serviceType || "transport"] || "Medical";
}
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
  passengerPhone?: string | null;
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
  etaToPickupMinutes?: number;
  estimatedTripMinutes?: number;
}

export interface PharmacyDelivery {
  id: number;
  publicId: string;
  status: string;
  priority: string;
  pickupAddress: string;
  pickupLat: string | null;
  pickupLng: string | null;
  deliveryAddress: string;
  deliveryLat: string | null;
  deliveryLng: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  isControlledSubstance: boolean;
  requiresSignature: boolean;
  requiresIdVerification: boolean;
  temperatureRequirement: string | null;
  items: { medicationName: string; quantity: number; isControlled: boolean }[];
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
  serviceFilter: ServiceFilter;
  activeServiceFilters: ServiceType[];
  vehicleCapability: string;
  allowedServiceTypes: ServiceType[];
  navPreference: "ask" | "google" | "apple" | "waze";
  driverName: string;
  driverInitials: string;
  driverLat: number | null;
  driverLng: number | null;
  driverHeading: number | null;
  pharmacyDeliveries: PharmacyDelivery[];
  loading: boolean;
  actionLoading: boolean;
  error: string | null;
  offerExpiresAt: number | null;

  initialize: () => Promise<void>;
  setOnline: () => Promise<void>;
  setOffline: () => Promise<void>;
  startShift: () => Promise<void>;
  endShift: () => Promise<void>;
  connectAndStartShift: () => Promise<void>;
  acceptOffer: () => Promise<void>;
  declineOffer: () => Promise<void>;
  advanceTripStatus: (newStatus: string) => Promise<void>;
  markArrivedPickup: () => Promise<void>;
  confirmPickup: () => Promise<void>;
  markArrivedDropoff: () => Promise<void>;
  completeTrip: () => Promise<void>;
  setServiceFilter: (f: ServiceFilter) => void;
  toggleServiceFilter: (s: ServiceType) => void;
  setNavPreference: (p: "ask" | "google" | "apple" | "waze") => void;
  pollOffers: () => Promise<void>;
  pollActiveTrip: () => Promise<void>;
  updateLocation: (lat: number, lng: number, heading?: number) => void;
  reportEmergency: (note?: string) => Promise<void>;
  flushOfflineQueue: () => Promise<void>;
  pollPharmacyDeliveries: () => Promise<void>;
  advancePharmacyStatus: (orderId: number, newStatus: string) => Promise<void>;
  getNextAction: () => NextAction;
}

// ─── Offline Queue Utilities ─────────────────────────────────────────────────

const LOC_QUEUE_KEY = "ucm_driver_v4_loc_queue";
const ACTION_QUEUE_KEY = "ucm_driver_v4_action_queue";

interface QueuedLocation {
  lat: number;
  lng: number;
  heading?: number;
  ts: number;
}

interface QueuedAction {
  id: string;
  type: "status_transition";
  tripId: number;
  status: string;
  idempotencyKey: string;
  ts: number;
}

function getQueuedLocations(): QueuedLocation[] {
  try { return JSON.parse(localStorage.getItem(LOC_QUEUE_KEY) || "[]"); } catch { return []; }
}

function queueLocation(loc: QueuedLocation) {
  const q = getQueuedLocations();
  q.push(loc);
  // Keep max 200 entries to avoid storage bloat
  if (q.length > 200) q.splice(0, q.length - 200);
  localStorage.setItem(LOC_QUEUE_KEY, JSON.stringify(q));
}

function clearLocationQueue() {
  localStorage.removeItem(LOC_QUEUE_KEY);
}

function getQueuedActions(): QueuedAction[] {
  try { return JSON.parse(localStorage.getItem(ACTION_QUEUE_KEY) || "[]"); } catch { return []; }
}

function queueActionItem(action: QueuedAction) {
  const q = getQueuedActions();
  q.push(action);
  localStorage.setItem(ACTION_QUEUE_KEY, JSON.stringify(q));
}

function clearActionQueue() {
  localStorage.removeItem(ACTION_QUEUE_KEY);
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
    tripType: getServiceLabel(trip.serviceType),
    status: trip.status,
    routePolyline: trip.routePolyline || null,
    passengerPhone: trip.patientPhone || trip.passengerPhone || null,
  };
}

function handleError(err: any, context: string, set: any) {
  const msg = err.message || "Something went wrong";
  set({ error: msg, actionLoading: false });
  showToast("error", `${context}: ${msg}`);
}

export const useDriverStore = create<DriverState>()(
  persist(
    (set, get) => ({
  driverStatus: "offline",
  shiftStatus: "offShift",
  activeTrip: null,
  tripPhase: "none",
  pendingOffer: null,
  earningsToday: 0,
  earningsWeek: 0,
  rating: 0,
  completedRides: 0,
  serviceFilter: "all",
  activeServiceFilters: [],
  vehicleCapability: "sedan",
  allowedServiceTypes: ["ambulatory", "delivery", "long_distance"],
  navPreference: "ask",
  driverName: "",
  driverInitials: "",
  driverLat: null,
  driverLng: null,
  driverHeading: null,
  pharmacyDeliveries: [],
  loading: false,
  actionLoading: false,
  error: null,
  offerExpiresAt: null,

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

      const capability = driver.vehicleCapability || driver.assignedVehicle?.category || "sedan";
      const allowed = VEHICLE_SERVICE_MAP[capability] || VEHICLE_SERVICE_MAP.sedan;

      set({
        driverName: driver.displayName || `${firstName} ${lastName}`,
        driverInitials: `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase(),
        driverStatus: driver.dispatchStatus !== "off" ? "online" : "offline",
        shiftStatus: driver.shift?.status === "ON_SHIFT" ? "onShift" : "offShift",
        rating: summary?.score ?? 0,
        completedRides: summary?.today?.completed ?? 0,
        earningsWeek: earnings ? earnings.totalCents / 100 : 0,
        earningsToday: 0,
        vehicleCapability: capability,
        allowedServiceTypes: allowed,
        activeServiceFilters: allowed, // Start with all allowed types active
      });

      if (summary?.activeTripId) {
        await get().pollActiveTrip();
      } else {
        await get().pollOffers();
      }
      // Also poll for pharmacy deliveries
      get().pollPharmacyDeliveries();

      // Flush any offline queued data and listen for reconnects
      get().flushOfflineQueue();
      window.addEventListener("online", () => get().flushOfflineQueue());
    } catch (err: any) {
      set({ error: err.message });
    } finally {
      set({ loading: false });
    }
  },

  setOnline: async () => {
    set({ actionLoading: true });
    try {
      await driverApi("/api/driver/connect", { method: "POST", body: "{}" });
      await driverApi("/api/driver/me/active", { method: "POST", body: JSON.stringify({ active: true }) });
      set({ driverStatus: "online", actionLoading: false });
      showToast("success", "You are now online");
    } catch (err: any) {
      handleError(err, "Go online failed", set);
    }
  },

  setOffline: async () => {
    set({ actionLoading: true });
    try {
      await driverApi("/api/driver/me/active", { method: "POST", body: JSON.stringify({ active: false }) });
      await driverApi("/api/driver/disconnect", { method: "POST", body: "{}" }).catch(() => {});
      set({ driverStatus: "offline", shiftStatus: "offShift", actionLoading: false });
      showToast("info", "You are now offline");
    } catch (err: any) {
      handleError(err, "Go offline failed", set);
    }
  },

  startShift: async () => {
    set({ actionLoading: true });
    try {
      await driverApi("/api/driver/shift/start", { method: "POST", body: "{}" });
      set({ shiftStatus: "onShift", actionLoading: false });
      showToast("success", "Shift started");
    } catch (err: any) {
      handleError(err, "Start shift failed", set);
    }
  },

  endShift: async () => {
    set({ actionLoading: true });
    try {
      await driverApi("/api/driver/shift/end", { method: "POST", body: "{}" });
      set({ shiftStatus: "offShift", actionLoading: false });
      showToast("info", "Shift ended");
    } catch (err: any) {
      handleError(err, "End shift failed", set);
    }
  },

  connectAndStartShift: async () => {
    const s = get();
    set({ actionLoading: true });
    try {
      // Step 1: Establish connection (sets driver.connected=true on server)
      await driverApi("/api/driver/connect", { method: "POST", body: "{}" });

      // Step 2: Set dispatch status to available if offline
      if (s.driverStatus === "offline") {
        await driverApi("/api/driver/me/active", { method: "POST", body: JSON.stringify({ active: true }) });
        set({ driverStatus: "online" });
      }

      // Step 3: Start shift
      if (s.shiftStatus === "offShift" || get().shiftStatus === "offShift") {
        await driverApi("/api/driver/shift/start", { method: "POST", body: "{}" });
        set({ shiftStatus: "onShift" });
      }
      set({ actionLoading: false });
      showToast("success", "You're online and shift started!");
    } catch (err: any) {
      handleError(err, "Connect failed", set);
    }
  },

  acceptOffer: async () => {
    const offer = get().pendingOffer;
    if (!offer) return;
    set({ actionLoading: true });
    try {
      const result = await driverApi(`/api/driver/offers/${offer.offerId}/accept`, { method: "POST", body: "{}" });
      set({ pendingOffer: null, offerExpiresAt: null });
      if (result.tripId) {
        const tripData = await driverApi(`/api/driver/trips/${result.tripId}`);
        const trip = tripData.trip || tripData;
        set({ activeTrip: tripFromApiData(trip), tripPhase: statusToPhase(trip.status), actionLoading: false });
      } else {
        set({ actionLoading: false });
      }
      showToast("success", "Trip accepted!");
    } catch (err: any) {
      handleError(err, "Accept trip failed", set);
    }
  },

  declineOffer: async () => {
    const offer = get().pendingOffer;
    if (!offer) return;
    set({ actionLoading: true });
    try {
      await driverApi(`/api/driver/offers/${offer.offerId}/decline`, { method: "POST", body: "{}" });
      set({ pendingOffer: null, tripPhase: "none", activeTrip: null, offerExpiresAt: null, actionLoading: false });
    } catch (err: any) {
      handleError(err, "Decline failed", set);
    }
  },

  advanceTripStatus: async (newStatus: string) => {
    const trip = get().activeTrip;
    if (!trip) return;
    set({ actionLoading: true });
    const idempotencyKey = `${trip.tripId}_${newStatus}_${Date.now()}`;

    // If offline, queue the action and update UI optimistically
    if (!navigator.onLine) {
      queueActionItem({ id: idempotencyKey, type: "status_transition", tripId: trip.tripId, status: newStatus, idempotencyKey, ts: Date.now() });
      const newPhase = statusToPhase(newStatus);
      set({ tripPhase: newPhase, activeTrip: { ...trip, status: newStatus }, actionLoading: false });
      showToast("info", "Queued — will sync when back online");
      return;
    }

    try {
      await driverApi(`/api/driver/trips/${trip.tripId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: newStatus, idempotencyKey }),
      });
      const newPhase = statusToPhase(newStatus);
      set({ tripPhase: newPhase, activeTrip: { ...trip, status: newStatus }, actionLoading: false });

      const statusLabels: Record<string, string> = {
        ARRIVED_PICKUP: "Arrived at pickup",
        PICKED_UP: "Patient picked up",
        ARRIVED_DROPOFF: "Arrived at dropoff",
        COMPLETED: "Trip completed!",
      };
      showToast("success", statusLabels[newStatus] || `Status: ${newStatus}`);

      if (newStatus === "COMPLETED") {
        set((s) => ({ completedRides: s.completedRides + 1, activeTrip: null }));
        setTimeout(() => set({ tripPhase: "none" }), 2000);
        driverApi("/api/driver/earnings?range=week").then((data) => {
          set({ earningsWeek: data.totalCents / 100 });
        }).catch(() => {});
      }
    } catch (err: any) {
      // Network error — queue for retry
      queueActionItem({ id: idempotencyKey, type: "status_transition", tripId: trip.tripId, status: newStatus, idempotencyKey, ts: Date.now() });
      set({ tripPhase: statusToPhase(newStatus), activeTrip: { ...trip, status: newStatus }, actionLoading: false });
      showToast("info", "Queued — will sync when back online");
    }
  },

  markArrivedPickup: async () => { await get().advanceTripStatus("ARRIVED_PICKUP"); },
  confirmPickup: async () => { await get().advanceTripStatus("PICKED_UP"); },
  markArrivedDropoff: async () => { await get().advanceTripStatus("ARRIVED_DROPOFF"); },
  completeTrip: async () => { await get().advanceTripStatus("COMPLETED"); },

  setServiceFilter: (f) => {
    if (f === "all") {
      set({ serviceFilter: "all", activeServiceFilters: get().allowedServiceTypes });
    } else {
      set({ serviceFilter: f, activeServiceFilters: [f] });
    }
    get().pollOffers();
  },

  toggleServiceFilter: (s) => {
    const current = get().activeServiceFilters;
    const allowed = get().allowedServiceTypes;
    let next: ServiceType[];
    if (current.includes(s)) {
      next = current.filter(x => x !== s);
      if (next.length === 0) next = allowed; // Can't deselect all
    } else {
      if (!allowed.includes(s)) return; // Not allowed for this vehicle
      next = [...current, s];
    }
    const isAll = next.length === allowed.length && allowed.every(a => next.includes(a));
    set({ activeServiceFilters: next, serviceFilter: isAll ? "all" : next[0] });
    get().pollOffers();
  },

  setNavPreference: (p) => {
    set({ navPreference: p });
    driverApi("/api/driver/settings", { method: "PATCH", body: JSON.stringify({ navPreference: p }) }).catch(() => {});
  },

  pollOffers: async () => {
    try {
      const filters = get().activeServiceFilters;
      const allAllowed = get().allowedServiceTypes;
      const isAll = filters.length === allAllowed.length;
      const qs = !isAll && filters.length > 0 ? `?serviceType=${filters.join(",")}` : "";
      const data = await driverApi(`/api/driver/offers/active${qs}`);
      const offers = data.offers || [];
      if (offers.length > 0) {
        const offer = offers[0];
        const enrichedOffer = {
          ...offer,
          etaToPickupMinutes: offer.etaToPickupMinutes || offer.lastEtaMinutes || 12,
          estimatedTripMinutes: offer.estimatedTripMinutes || offer.tripDurationMinutes || 25,
        };
        const expiresAt = offer.expiresAt ? new Date(offer.expiresAt).getTime() : Date.now() + (offer.secondsRemaining || 30) * 1000;
        set({
          pendingOffer: enrichedOffer,
          tripPhase: "offer",
          offerExpiresAt: expiresAt,
          activeTrip: {
            id: offer.publicId || String(offer.tripId),
            tripId: offer.tripId,
            pickupAddress: offer.pickupAddress || "",
            dropoffAddress: offer.dropoffAddress || "",
            pickupLatLng: { lat: Number(offer.pickupLat) || 0, lng: Number(offer.pickupLng) || 0 },
            dropoffLatLng: { lat: Number(offer.dropoffLat) || 0, lng: Number(offer.dropoffLng) || 0 },
            passengerName: offer.patientName || "Patient",
            notes: "",
            etaMinutes: enrichedOffer.etaToPickupMinutes,
            tripType: getServiceLabel(offer.serviceType),
            routePolyline: offer.routePolyline || null,
          },
        });
      } else if (get().tripPhase === "offer") {
        // Offer expired server-side
        set({ pendingOffer: null, tripPhase: "none", activeTrip: null, offerExpiresAt: null });
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
    const ts = Date.now();
    if (!navigator.onLine) {
      queueLocation({ lat, lng, heading, ts });
      return;
    }
    driverApi("/api/driver/me/location", {
      method: "POST",
      body: JSON.stringify({ lat, lng, heading, ts, source: "gps" }),
    }).catch(() => {
      queueLocation({ lat, lng, heading, ts });
    });
  },

  pollPharmacyDeliveries: async () => {
    try {
      const data = await driverApi("/api/driver/pharmacy-deliveries");
      const deliveries = (data.deliveries || []).map((d: any) => ({
        id: d.id,
        publicId: d.publicId,
        status: d.status,
        priority: d.priority || "STANDARD",
        pickupAddress: d.pickupAddress || "",
        pickupLat: d.pickupLat,
        pickupLng: d.pickupLng,
        deliveryAddress: d.deliveryAddress || "",
        deliveryLat: d.deliveryLat,
        deliveryLng: d.deliveryLng,
        recipientName: d.recipientName,
        recipientPhone: d.recipientPhone,
        isControlledSubstance: d.isControlledSubstance || false,
        requiresSignature: d.requiresSignature || false,
        requiresIdVerification: d.requiresIdVerification || false,
        temperatureRequirement: d.temperatureRequirement,
        items: d.items || [],
      }));
      set({ pharmacyDeliveries: deliveries });
    } catch {}
  },

  advancePharmacyStatus: async (orderId: number, newStatus: string) => {
    set({ actionLoading: true });
    try {
      await driverApi(`/api/driver/deliveries/${orderId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ status: newStatus }),
      });
      showToast("success", `Delivery status: ${newStatus.replace(/_/g, " ").toLowerCase()}`);
      await get().pollPharmacyDeliveries();
      set({ actionLoading: false });
    } catch (err: any) {
      handleError(err, "Delivery update failed", set);
    }
  },

  flushOfflineQueue: async () => {
    if (!navigator.onLine) return;

    // Flush queued locations
    const locs = getQueuedLocations();
    if (locs.length > 0) {
      clearLocationQueue();
      for (const loc of locs) {
        try {
          await driverApi("/api/driver/me/location", {
            method: "POST",
            body: JSON.stringify({ lat: loc.lat, lng: loc.lng, heading: loc.heading, ts: loc.ts, source: "gps" }),
          });
        } catch {
          // Re-queue remaining on failure
          queueLocation(loc);
          break;
        }
      }
    }

    // Flush queued status transitions
    const actions = getQueuedActions();
    if (actions.length > 0) {
      clearActionQueue();
      for (const action of actions) {
        try {
          await driverApi(`/api/driver/trips/${action.tripId}/status`, {
            method: "POST",
            body: JSON.stringify({ status: action.status, idempotencyKey: action.idempotencyKey }),
          });
        } catch {
          queueActionItem(action);
          break;
        }
      }
    }
  },

  reportEmergency: async (note?) => {
    const { driverLat, driverLng } = get();
    try {
      await driverApi("/api/driver/emergency", { method: "POST", body: JSON.stringify({ lat: driverLat, lng: driverLng, note }) });
      showToast("info", "Emergency reported — dispatch has been notified");
    } catch (err: any) {
      handleError(err, "Emergency report failed", set);
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
}),
    {
      name: "ucm-driver-store",
      partialize: (state) => ({
        serviceFilter: state.serviceFilter,
        navPreference: state.navPreference,
        driverName: state.driverName,
        driverInitials: state.driverInitials,
      }),
    },
  ),
);
