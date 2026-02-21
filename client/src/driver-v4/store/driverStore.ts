import { create } from "zustand";

export type DriverStatus = "offline" | "online";
export type ShiftStatus = "offShift" | "onShift";
export type TripPhase =
  | "none"
  | "offer"
  | "toPickup"
  | "arrivedPickup"
  | "waiting"
  | "pickedUp"
  | "toDropoff"
  | "arrivedDropoff"
  | "complete";

export interface ActiveTrip {
  id: string;
  pickupAddress: string;
  dropoffAddress: string;
  pickupLatLng: { lat: number; lng: number };
  dropoffLatLng: { lat: number; lng: number };
  passengerName: string;
  notes: string;
  etaMinutes: number;
  scheduledTime?: string;
  tripType?: string;
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
  earningsToday: number;
  earningsWeek: number;
  rating: number;
  completedRides: number;
  navPreference: "ask" | "google" | "apple" | "waze";

  setOnline: () => void;
  setOffline: () => void;
  startShift: () => void;
  endShift: () => void;
  acceptTrip: () => void;
  goToPickup: () => void;
  goToDropoff: () => void;
  markArrivedPickup: () => void;
  startWaiting: () => void;
  confirmPickup: () => void;
  markArrivedDropoff: () => void;
  completeTrip: () => void;
  setNavPreference: (p: "ask" | "google" | "apple" | "waze") => void;
  simulateTripOffer: () => void;
  getNextAction: () => NextAction;
}

const MOCK_TRIP: ActiveTrip = {
  id: "TRP-20260221-0042",
  pickupAddress: "4521 Cedar Park Dr, Houston TX 77063",
  dropoffAddress: "MD Anderson Cancer Center, 1515 Holcombe Blvd",
  pickupLatLng: { lat: 29.7287, lng: -95.5044 },
  dropoffLatLng: { lat: 29.7069, lng: -95.3974 },
  passengerName: "Margaret Johnson",
  notes: "Wheelchair accessible. Patient needs extra time boarding.",
  etaMinutes: 12,
  scheduledTime: "2:30 PM",
  tripType: "Medical",
};

export const useDriverStore = create<DriverState>((set, get) => ({
  driverStatus: "offline",
  shiftStatus: "offShift",
  activeTrip: null,
  tripPhase: "none",
  earningsToday: 187.50,
  earningsWeek: 892.25,
  rating: 4.92,
  completedRides: 14,
  navPreference: "ask",

  setOnline: () => set({ driverStatus: "online" }),
  setOffline: () => set({ driverStatus: "offline", shiftStatus: "offShift", activeTrip: null, tripPhase: "none" }),
  startShift: () => {
    const s = get();
    if (s.driverStatus === "online") set({ shiftStatus: "onShift" });
  },
  endShift: () => set({ shiftStatus: "offShift", activeTrip: null, tripPhase: "none" }),

  acceptTrip: () => {
    const s = get();
    if (s.tripPhase === "offer") set({ tripPhase: "toPickup" });
  },
  goToPickup: () => set({ tripPhase: "toPickup" }),
  goToDropoff: () => set({ tripPhase: "toDropoff" }),
  markArrivedPickup: () => {
    const s = get();
    if (s.tripPhase === "toPickup") set({ tripPhase: "arrivedPickup" });
  },
  startWaiting: () => {
    const s = get();
    if (s.tripPhase === "arrivedPickup") set({ tripPhase: "waiting" });
  },
  confirmPickup: () => {
    const s = get();
    if (s.tripPhase === "waiting" || s.tripPhase === "arrivedPickup") set({ tripPhase: "toDropoff" });
  },
  markArrivedDropoff: () => {
    const s = get();
    if (s.tripPhase === "toDropoff") set({ tripPhase: "arrivedDropoff" });
  },
  completeTrip: () => {
    set((s) => ({
      tripPhase: "complete",
      activeTrip: null,
      completedRides: s.completedRides + 1,
      earningsToday: s.earningsToday + 32.50,
      earningsWeek: s.earningsWeek + 32.50,
    }));
    setTimeout(() => set({ tripPhase: "none" }), 2000);
  },

  setNavPreference: (p) => set({ navPreference: p }),

  simulateTripOffer: () => {
    const s = get();
    if (s.driverStatus === "online" && s.shiftStatus === "onShift" && s.tripPhase === "none") {
      set({ activeTrip: MOCK_TRIP, tripPhase: "offer" });
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
        return { label: "Waiting for Trips", actionKey: "simulateTripOffer", disabled: false, hint: "Tap to simulate a trip offer", variant: "secondary" };
      case "offer":
        return { label: "Accept Trip", actionKey: "acceptTrip", disabled: false, hint: `${s.activeTrip?.passengerName} • ${s.activeTrip?.etaMinutes} min`, variant: "primary" };
      case "toPickup":
        return { label: "Arrived at Pickup", actionKey: "markArrivedPickup", disabled: false, hint: s.activeTrip?.pickupAddress || "", variant: "primary" };
      case "arrivedPickup":
        return { label: "Start Waiting", actionKey: "startWaiting", disabled: false, hint: "Patient is being notified", variant: "secondary" };
      case "waiting":
        return { label: "Confirm Pickup", actionKey: "confirmPickup", disabled: false, hint: "Patient is on board", variant: "primary" };
      case "pickedUp":
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
