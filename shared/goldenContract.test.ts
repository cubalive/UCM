import { describe, it, expect } from "vitest";
import {
  TripState,
  TripEvent,
  transition,
  uiActions,
  allowedEvents,
  isTerminal,
  derivePhase,
  ACTIVE_NOW_STATUSES,
  TERMINAL_STATUSES,
  VALID_TRANSITIONS,
  InvalidTransitionError,
} from "./tripStateMachine";

describe("Golden Contract: Driver Shift Buttons", () => {
  it("ASSIGNED state has 'Go to Pickup' button", () => {
    const { statusAction } = uiActions(TripState.ASSIGNED);
    expect(statusAction).not.toBeNull();
    expect(statusAction!.label).toBe("Go to Pickup");
    expect(statusAction!.event).toBe(TripEvent.START_TO_PICKUP);
    expect(statusAction!.enabled).toBe(true);
  });

  it("SCHEDULED state has 'Accept & Start Trip' button", () => {
    const { statusAction } = uiActions(TripState.SCHEDULED);
    expect(statusAction).not.toBeNull();
    expect(statusAction!.label).toBe("Accept & Start Trip");
    expect(statusAction!.enabled).toBe(true);
  });

  it("every active trip state provides a status action button", () => {
    const activeStates = [
      TripState.SCHEDULED,
      TripState.ASSIGNED,
      TripState.EN_ROUTE_TO_PICKUP,
      TripState.ARRIVED_PICKUP,
      TripState.PICKED_UP,
      TripState.EN_ROUTE_TO_DROPOFF,
      TripState.IN_PROGRESS,
      TripState.ARRIVED_DROPOFF,
    ];
    for (const state of activeStates) {
      const { statusAction } = uiActions(state);
      expect(statusAction, `Missing button for state ${state}`).not.toBeNull();
      expect(statusAction!.label.length, `Empty label for state ${state}`).toBeGreaterThan(0);
      expect(statusAction!.enabled, `Button disabled for state ${state}`).toBe(true);
    }
  });

  it("terminal states have NO action buttons", () => {
    for (const state of TERMINAL_STATUSES) {
      const { statusAction, navAction } = uiActions(state);
      expect(statusAction, `Unexpected button for terminal ${state}`).toBeNull();
      expect(navAction, `Unexpected nav for terminal ${state}`).toBeNull();
    }
  });
});

describe("Golden Contract: Trip Actions (full lifecycle)", () => {
  it("go-to-pickup action exists from ASSIGNED", () => {
    const nextState = transition(TripState.ASSIGNED, TripEvent.START_TO_PICKUP);
    expect(nextState).toBe(TripState.EN_ROUTE_TO_PICKUP);
  });

  it("arrived-at-pickup action exists from EN_ROUTE_TO_PICKUP", () => {
    const nextState = transition(TripState.EN_ROUTE_TO_PICKUP, TripEvent.MARK_ARRIVED_PICKUP);
    expect(nextState).toBe(TripState.ARRIVED_PICKUP);
  });

  it("start-trip action exists from ARRIVED_PICKUP", () => {
    const nextState = transition(TripState.ARRIVED_PICKUP, TripEvent.MARK_PICKED_UP);
    expect(nextState).toBe(TripState.PICKED_UP);
  });

  it("complete action exists from ARRIVED_DROPOFF", () => {
    const nextState = transition(TripState.ARRIVED_DROPOFF, TripEvent.MARK_COMPLETE);
    expect(nextState).toBe(TripState.COMPLETED);
  });

  it("no-show action exists only from ARRIVED_PICKUP", () => {
    expect(transition(TripState.ARRIVED_PICKUP, TripEvent.MARK_NO_SHOW)).toBe(TripState.NO_SHOW);
    expect(() => transition(TripState.EN_ROUTE_TO_PICKUP, TripEvent.MARK_NO_SHOW)).toThrow(InvalidTransitionError);
    expect(() => transition(TripState.ASSIGNED, TripEvent.MARK_NO_SHOW)).toThrow(InvalidTransitionError);
  });

  it("cancel action available from all non-terminal states", () => {
    const nonTerminal = [
      TripState.SCHEDULED, TripState.ASSIGNED, TripState.EN_ROUTE_TO_PICKUP,
      TripState.ARRIVED_PICKUP, TripState.PICKED_UP, TripState.EN_ROUTE_TO_DROPOFF,
      TripState.IN_PROGRESS, TripState.ARRIVED_DROPOFF,
    ];
    for (const state of nonTerminal) {
      expect(transition(state, TripEvent.CANCEL_TRIP)).toBe(TripState.CANCELLED);
    }
  });

  it("happy path runs without error end-to-end", () => {
    const events = [
      TripEvent.ASSIGN_DRIVER,
      TripEvent.START_TO_PICKUP,
      TripEvent.MARK_ARRIVED_PICKUP,
      TripEvent.MARK_PICKED_UP,
      TripEvent.START_TO_DROPOFF,
      TripEvent.MARK_ARRIVED_DROPOFF,
      TripEvent.MARK_COMPLETE,
    ];
    let state = TripState.SCHEDULED as string;
    for (const event of events) {
      state = transition(state, event);
    }
    expect(state).toBe(TripState.COMPLETED);
    expect(isTerminal(state)).toBe(true);
  });
});

describe("Golden Contract: Clinic Categorization Logic", () => {
  it("ACTIVE_NOW_STATUSES contains all in-progress states", () => {
    expect(ACTIVE_NOW_STATUSES).toContain(TripState.EN_ROUTE_TO_PICKUP);
    expect(ACTIVE_NOW_STATUSES).toContain(TripState.ARRIVED_PICKUP);
    expect(ACTIVE_NOW_STATUSES).toContain(TripState.PICKED_UP);
    expect(ACTIVE_NOW_STATUSES).toContain(TripState.EN_ROUTE_TO_DROPOFF);
    expect(ACTIVE_NOW_STATUSES).toContain(TripState.IN_PROGRESS);
    expect(ACTIVE_NOW_STATUSES).toContain(TripState.ARRIVED_DROPOFF);
  });

  it("ACTIVE_NOW_STATUSES does NOT contain SCHEDULED or ASSIGNED", () => {
    expect(ACTIVE_NOW_STATUSES).not.toContain(TripState.SCHEDULED);
    expect(ACTIVE_NOW_STATUSES).not.toContain(TripState.ASSIGNED);
  });

  it("ACTIVE_NOW_STATUSES does NOT contain terminal states", () => {
    for (const ts of TERMINAL_STATUSES) {
      expect(ACTIVE_NOW_STATUSES).not.toContain(ts);
    }
  });

  it("today's trips = SCHEDULED + ASSIGNED (upcoming, not active)", () => {
    const todaysTrips = [TripState.SCHEDULED, TripState.ASSIGNED];
    for (const s of todaysTrips) {
      expect(derivePhase(s)).toBe("PICKUP");
      expect(ACTIVE_NOW_STATUSES).not.toContain(s);
    }
  });

  it("active now trips are all in DROPOFF or late PICKUP phase", () => {
    for (const s of ACTIVE_NOW_STATUSES) {
      const phase = derivePhase(s);
      expect(["PICKUP", "DROPOFF"]).toContain(phase);
    }
  });

  it("VALID_TRANSITIONS covers every known state", () => {
    const allStates = Object.values(TripState);
    for (const s of allStates) {
      expect(VALID_TRANSITIONS).toHaveProperty(s);
    }
  });

  it("no state has a transition to itself", () => {
    for (const [state, targets] of Object.entries(VALID_TRANSITIONS)) {
      expect(targets, `State ${state} has self-transition`).not.toContain(state);
    }
  });
});

describe("Golden Contract: State Machine Integrity", () => {
  it("all transition targets are valid states", () => {
    const validStates = new Set(Object.values(TripState));
    for (const [state, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const target of targets) {
        expect(validStates.has(target as any), `${state} -> ${target} is not a valid state`).toBe(true);
      }
    }
  });

  it("no orphan states (every state is reachable from SCHEDULED)", () => {
    const reachable = new Set<string>();
    const queue = [TripState.SCHEDULED as string];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      const targets = VALID_TRANSITIONS[current] || [];
      queue.push(...targets);
    }
    const allStates = Object.values(TripState);
    for (const s of allStates) {
      expect(reachable.has(s), `State ${s} is unreachable from SCHEDULED`).toBe(true);
    }
  });

  it("terminal states are truly terminal (no outgoing transitions)", () => {
    for (const ts of TERMINAL_STATUSES) {
      const events = allowedEvents(ts);
      expect(events, `Terminal state ${ts} has outgoing events`).toHaveLength(0);
    }
  });
});
