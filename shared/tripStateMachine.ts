export const TripState = {
  SCHEDULED: "SCHEDULED",
  ASSIGNED: "ASSIGNED",
  EN_ROUTE_TO_PICKUP: "EN_ROUTE_TO_PICKUP",
  ARRIVED_PICKUP: "ARRIVED_PICKUP",
  PICKED_UP: "PICKED_UP",
  EN_ROUTE_TO_DROPOFF: "EN_ROUTE_TO_DROPOFF",
  IN_PROGRESS: "IN_PROGRESS",
  ARRIVED_DROPOFF: "ARRIVED_DROPOFF",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
} as const;

export type TripStateValue = (typeof TripState)[keyof typeof TripState];

export const TripEvent = {
  ASSIGN_DRIVER: "ASSIGN_DRIVER",
  START_TO_PICKUP: "START_TO_PICKUP",
  MARK_ARRIVED_PICKUP: "MARK_ARRIVED_PICKUP",
  MARK_PICKED_UP: "MARK_PICKED_UP",
  START_TO_DROPOFF: "START_TO_DROPOFF",
  START_IN_PROGRESS: "START_IN_PROGRESS",
  MARK_ARRIVED_DROPOFF: "MARK_ARRIVED_DROPOFF",
  MARK_COMPLETE: "MARK_COMPLETE",
  CANCEL_TRIP: "CANCEL_TRIP",
  MARK_NO_SHOW: "MARK_NO_SHOW",
} as const;

export type TripEventValue = (typeof TripEvent)[keyof typeof TripEvent];

export type TripPhase = "PICKUP" | "DROPOFF" | "DONE";

const TRANSITION_TABLE: Record<string, Partial<Record<string, string>>> = {
  [TripState.SCHEDULED]: {
    [TripEvent.ASSIGN_DRIVER]: TripState.ASSIGNED,
    [TripEvent.START_TO_PICKUP]: TripState.EN_ROUTE_TO_PICKUP,
    [TripEvent.CANCEL_TRIP]: TripState.CANCELLED,
  },
  [TripState.ASSIGNED]: {
    [TripEvent.START_TO_PICKUP]: TripState.EN_ROUTE_TO_PICKUP,
    [TripEvent.CANCEL_TRIP]: TripState.CANCELLED,
  },
  [TripState.EN_ROUTE_TO_PICKUP]: {
    [TripEvent.MARK_ARRIVED_PICKUP]: TripState.ARRIVED_PICKUP,
    [TripEvent.CANCEL_TRIP]: TripState.CANCELLED,
  },
  [TripState.ARRIVED_PICKUP]: {
    [TripEvent.MARK_PICKED_UP]: TripState.PICKED_UP,
    [TripEvent.MARK_NO_SHOW]: TripState.NO_SHOW,
    [TripEvent.CANCEL_TRIP]: TripState.CANCELLED,
  },
  [TripState.PICKED_UP]: {
    [TripEvent.START_TO_DROPOFF]: TripState.EN_ROUTE_TO_DROPOFF,
    [TripEvent.START_IN_PROGRESS]: TripState.IN_PROGRESS,
    [TripEvent.CANCEL_TRIP]: TripState.CANCELLED,
  },
  [TripState.EN_ROUTE_TO_DROPOFF]: {
    [TripEvent.MARK_ARRIVED_DROPOFF]: TripState.ARRIVED_DROPOFF,
    [TripEvent.CANCEL_TRIP]: TripState.CANCELLED,
  },
  [TripState.IN_PROGRESS]: {
    [TripEvent.MARK_COMPLETE]: TripState.COMPLETED,
    [TripEvent.CANCEL_TRIP]: TripState.CANCELLED,
  },
  [TripState.ARRIVED_DROPOFF]: {
    [TripEvent.MARK_COMPLETE]: TripState.COMPLETED,
    [TripEvent.CANCEL_TRIP]: TripState.CANCELLED,
  },
  [TripState.COMPLETED]: {},
  [TripState.CANCELLED]: {},
  [TripState.NO_SHOW]: {},
};

export class InvalidTransitionError extends Error {
  public readonly fromState: string;
  public readonly event: string;

  constructor(fromState: string, event: string) {
    super(`Invalid transition: cannot apply event '${event}' in state '${fromState}'`);
    this.name = "InvalidTransitionError";
    this.fromState = fromState;
    this.event = event;
  }
}

export function transition(currentState: string, event: string): string {
  const stateTransitions = TRANSITION_TABLE[currentState];
  if (!stateTransitions) {
    throw new InvalidTransitionError(currentState, event);
  }
  const nextState = stateTransitions[event];
  if (!nextState) {
    throw new InvalidTransitionError(currentState, event);
  }
  return nextState;
}

export function allowedEvents(state: string): string[] {
  const stateTransitions = TRANSITION_TABLE[state];
  if (!stateTransitions) return [];
  return Object.keys(stateTransitions);
}

export function isTerminal(state: string): boolean {
  const events = allowedEvents(state);
  return events.length === 0;
}

const PICKUP_PHASE_SET = new Set<string>([
  TripState.SCHEDULED,
  TripState.ASSIGNED,
  TripState.EN_ROUTE_TO_PICKUP,
  TripState.ARRIVED_PICKUP,
]);

const DONE_PHASE_SET = new Set<string>([
  TripState.COMPLETED,
  TripState.CANCELLED,
  TripState.NO_SHOW,
]);

export function derivePhase(state: string): TripPhase {
  if (PICKUP_PHASE_SET.has(state)) return "PICKUP";
  if (DONE_PHASE_SET.has(state)) return "DONE";
  return "DROPOFF";
}

export function deriveStateFromTrip(trip: { status: string }): TripStateValue {
  const s = trip.status as TripStateValue;
  if (s in TRANSITION_TABLE) return s;
  return TripState.SCHEDULED;
}

export interface UiAction {
  event: string;
  targetStatus: string;
  label: string;
  type: "status_change";
  enabled: boolean;
}

export interface NavAction {
  label: string;
  type: "navigation";
  target: "pickup" | "dropoff";
}

const DRIVER_UI_ACTIONS: Record<string, { statusAction?: UiAction; navAction?: NavAction }> = {
  [TripState.SCHEDULED]: {
    statusAction: {
      event: TripEvent.START_TO_PICKUP,
      targetStatus: TripState.EN_ROUTE_TO_PICKUP,
      label: "Accept & Start Trip",
      type: "status_change",
      enabled: true,
    },
    navAction: { label: "Navigate to Pickup", type: "navigation", target: "pickup" },
  },
  [TripState.ASSIGNED]: {
    statusAction: {
      event: TripEvent.START_TO_PICKUP,
      targetStatus: TripState.EN_ROUTE_TO_PICKUP,
      label: "Go to Pickup",
      type: "status_change",
      enabled: true,
    },
    navAction: { label: "Navigate to Pickup", type: "navigation", target: "pickup" },
  },
  [TripState.EN_ROUTE_TO_PICKUP]: {
    statusAction: {
      event: TripEvent.MARK_ARRIVED_PICKUP,
      targetStatus: TripState.ARRIVED_PICKUP,
      label: "Mark Arrived at Pickup",
      type: "status_change",
      enabled: true,
    },
    navAction: { label: "Navigate to Pickup", type: "navigation", target: "pickup" },
  },
  [TripState.ARRIVED_PICKUP]: {
    statusAction: {
      event: TripEvent.MARK_PICKED_UP,
      targetStatus: TripState.PICKED_UP,
      label: "Picked Up Patient",
      type: "status_change",
      enabled: true,
    },
    navAction: { label: "Navigate to Pickup", type: "navigation", target: "pickup" },
  },
  [TripState.PICKED_UP]: {
    statusAction: {
      event: TripEvent.START_TO_DROPOFF,
      targetStatus: TripState.EN_ROUTE_TO_DROPOFF,
      label: "Start Trip to Dropoff",
      type: "status_change",
      enabled: true,
    },
    navAction: { label: "Navigate to Dropoff", type: "navigation", target: "dropoff" },
  },
  [TripState.EN_ROUTE_TO_DROPOFF]: {
    statusAction: {
      event: TripEvent.MARK_ARRIVED_DROPOFF,
      targetStatus: TripState.ARRIVED_DROPOFF,
      label: "Mark Arrived at Dropoff",
      type: "status_change",
      enabled: true,
    },
    navAction: { label: "Navigate to Dropoff", type: "navigation", target: "dropoff" },
  },
  [TripState.IN_PROGRESS]: {
    statusAction: {
      event: TripEvent.MARK_COMPLETE,
      targetStatus: TripState.COMPLETED,
      label: "Complete Trip",
      type: "status_change",
      enabled: true,
    },
    navAction: { label: "Navigate to Dropoff", type: "navigation", target: "dropoff" },
  },
  [TripState.ARRIVED_DROPOFF]: {
    statusAction: {
      event: TripEvent.MARK_COMPLETE,
      targetStatus: TripState.COMPLETED,
      label: "Complete Trip",
      type: "status_change",
      enabled: true,
    },
    navAction: { label: "Navigate to Dropoff", type: "navigation", target: "dropoff" },
  },
};

export function uiActions(state: string): { statusAction: UiAction | null; navAction: NavAction | null } {
  const actions = DRIVER_UI_ACTIONS[state];
  if (!actions) return { statusAction: null, navAction: null };
  return {
    statusAction: actions.statusAction || null,
    navAction: actions.navAction || null,
  };
}

export function getNavLabel(state: string): string {
  const phase = derivePhase(state);
  if (phase === "PICKUP") return "Go to Pickup";
  if (phase === "DROPOFF") return "Go to Dropoff";
  return "";
}

export function getNavTarget(state: string): "pickup" | "dropoff" | null {
  const phase = derivePhase(state);
  if (phase === "PICKUP") return "pickup";
  if (phase === "DROPOFF") return "dropoff";
  return null;
}

export function eventToTargetStatus(event: string, currentState: string): string | null {
  try {
    return transition(currentState, event);
  } catch {
    return null;
  }
}

export const VALID_TRANSITIONS: Record<string, string[]> = {};
for (const [state, events] of Object.entries(TRANSITION_TABLE)) {
  VALID_TRANSITIONS[state] = Object.values(events).filter((v): v is string => !!v);
}

export const STATUS_TIMESTAMP_MAP: Record<string, string> = {
  EN_ROUTE_TO_PICKUP: "startedAt",
  ARRIVED_PICKUP: "arrivedPickupAt",
  PICKED_UP: "pickedUpAt",
  EN_ROUTE_TO_DROPOFF: "enRouteDropoffAt",
  ARRIVED_DROPOFF: "arrivedDropoffAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
  NO_SHOW: "cancelledAt",
};
