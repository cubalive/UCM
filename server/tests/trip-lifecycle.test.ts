import { describe, it, expect } from "vitest";
import {
  transition,
  allowedEvents,
  isTerminal,
  derivePhase,
  InvalidTransitionError,
  TripState,
  TripEvent,
  uiActions,
  getNavTarget,
  eventToTargetStatus,
  TERMINAL_STATUSES,
  ACTIVE_NOW_STATUSES,
} from "@shared/tripStateMachine";

// =========================================================
// 1. Happy Path: Full Trip Lifecycle
// =========================================================
describe("Trip Lifecycle — Happy Path", () => {
  it("completes the full lifecycle: SCHEDULED → ASSIGNED → EN_ROUTE_TO_PICKUP → ARRIVED_PICKUP → PICKED_UP → EN_ROUTE_TO_DROPOFF → ARRIVED_DROPOFF → COMPLETED", () => {
    let state: string = TripState.SCHEDULED;

    state = transition(state, TripEvent.ASSIGN_DRIVER);
    expect(state).toBe(TripState.ASSIGNED);

    state = transition(state, TripEvent.START_TO_PICKUP);
    expect(state).toBe(TripState.EN_ROUTE_TO_PICKUP);

    state = transition(state, TripEvent.MARK_ARRIVED_PICKUP);
    expect(state).toBe(TripState.ARRIVED_PICKUP);

    state = transition(state, TripEvent.MARK_PICKED_UP);
    expect(state).toBe(TripState.PICKED_UP);

    state = transition(state, TripEvent.START_TO_DROPOFF);
    expect(state).toBe(TripState.EN_ROUTE_TO_DROPOFF);

    state = transition(state, TripEvent.MARK_ARRIVED_DROPOFF);
    expect(state).toBe(TripState.ARRIVED_DROPOFF);

    state = transition(state, TripEvent.MARK_COMPLETE);
    expect(state).toBe(TripState.COMPLETED);

    expect(isTerminal(state)).toBe(true);
    expect(allowedEvents(state)).toEqual([]);
  });

  it("supports the IN_PROGRESS alternative path: PICKED_UP → IN_PROGRESS → COMPLETED", () => {
    let state: string = TripState.PICKED_UP;

    state = transition(state, TripEvent.START_IN_PROGRESS);
    expect(state).toBe(TripState.IN_PROGRESS);

    state = transition(state, TripEvent.MARK_COMPLETE);
    expect(state).toBe(TripState.COMPLETED);
  });

  it("allows skipping ASSIGNED: SCHEDULED → EN_ROUTE_TO_PICKUP directly", () => {
    const state = transition(TripState.SCHEDULED, TripEvent.START_TO_PICKUP);
    expect(state).toBe(TripState.EN_ROUTE_TO_PICKUP);
  });
});

// =========================================================
// 2. Cancellation Scenarios
// =========================================================
describe("Trip Lifecycle — Cancellation", () => {
  const cancellableStates = [
    TripState.SCHEDULED,
    TripState.ASSIGNED,
    TripState.EN_ROUTE_TO_PICKUP,
    TripState.ARRIVED_PICKUP,
    TripState.PICKED_UP,
    TripState.EN_ROUTE_TO_DROPOFF,
    TripState.IN_PROGRESS,
    TripState.ARRIVED_DROPOFF,
  ];

  for (const fromState of cancellableStates) {
    it(`allows cancellation from ${fromState}`, () => {
      const result = transition(fromState, TripEvent.CANCEL_TRIP);
      expect(result).toBe(TripState.CANCELLED);
    });
  }

  it("CANCELLED is a terminal state", () => {
    expect(isTerminal(TripState.CANCELLED)).toBe(true);
    expect(allowedEvents(TripState.CANCELLED)).toEqual([]);
  });

  it("cannot transition from CANCELLED to any state", () => {
    expect(() => transition(TripState.CANCELLED, TripEvent.ASSIGN_DRIVER)).toThrow(InvalidTransitionError);
    expect(() => transition(TripState.CANCELLED, TripEvent.START_TO_PICKUP)).toThrow(InvalidTransitionError);
    expect(() => transition(TripState.CANCELLED, TripEvent.CANCEL_TRIP)).toThrow(InvalidTransitionError);
  });
});

// =========================================================
// 3. No-Show Scenarios
// =========================================================
describe("Trip Lifecycle — No-Show", () => {
  it("allows NO_SHOW from ARRIVED_PICKUP", () => {
    const result = transition(TripState.ARRIVED_PICKUP, TripEvent.MARK_NO_SHOW);
    expect(result).toBe(TripState.NO_SHOW);
  });

  it("NO_SHOW is a terminal state", () => {
    expect(isTerminal(TripState.NO_SHOW)).toBe(true);
    expect(allowedEvents(TripState.NO_SHOW)).toEqual([]);
  });

  it("cannot mark NO_SHOW from states other than ARRIVED_PICKUP", () => {
    const nonNoShowStates = [
      TripState.SCHEDULED,
      TripState.ASSIGNED,
      TripState.EN_ROUTE_TO_PICKUP,
      TripState.PICKED_UP,
      TripState.EN_ROUTE_TO_DROPOFF,
      TripState.IN_PROGRESS,
      TripState.ARRIVED_DROPOFF,
      TripState.COMPLETED,
    ];

    for (const fromState of nonNoShowStates) {
      expect(() => transition(fromState, TripEvent.MARK_NO_SHOW)).toThrow(InvalidTransitionError);
    }
  });

  it("cannot transition from NO_SHOW to any state", () => {
    expect(() => transition(TripState.NO_SHOW, TripEvent.ASSIGN_DRIVER)).toThrow(InvalidTransitionError);
    expect(() => transition(TripState.NO_SHOW, TripEvent.CANCEL_TRIP)).toThrow(InvalidTransitionError);
  });
});

// =========================================================
// 4. Invalid Transitions
// =========================================================
describe("Trip Lifecycle — Invalid Transitions", () => {
  it("rejects skipping from SCHEDULED to PICKED_UP", () => {
    expect(() => transition(TripState.SCHEDULED, TripEvent.MARK_PICKED_UP)).toThrow(InvalidTransitionError);
  });

  it("rejects skipping from SCHEDULED to COMPLETED", () => {
    expect(() => transition(TripState.SCHEDULED, TripEvent.MARK_COMPLETE)).toThrow(InvalidTransitionError);
  });

  it("rejects MARK_ARRIVED_PICKUP from ASSIGNED (must go EN_ROUTE first)", () => {
    expect(() => transition(TripState.ASSIGNED, TripEvent.MARK_ARRIVED_PICKUP)).toThrow(InvalidTransitionError);
  });

  it("rejects ASSIGN_DRIVER from EN_ROUTE_TO_PICKUP", () => {
    expect(() => transition(TripState.EN_ROUTE_TO_PICKUP, TripEvent.ASSIGN_DRIVER)).toThrow(InvalidTransitionError);
  });

  it("rejects START_TO_DROPOFF from EN_ROUTE_TO_PICKUP (must pick up first)", () => {
    expect(() => transition(TripState.EN_ROUTE_TO_PICKUP, TripEvent.START_TO_DROPOFF)).toThrow(InvalidTransitionError);
  });

  it("rejects MARK_COMPLETE from SCHEDULED", () => {
    expect(() => transition(TripState.SCHEDULED, TripEvent.MARK_COMPLETE)).toThrow(InvalidTransitionError);
  });

  it("rejects transitions from COMPLETED", () => {
    expect(() => transition(TripState.COMPLETED, TripEvent.ASSIGN_DRIVER)).toThrow(InvalidTransitionError);
    expect(() => transition(TripState.COMPLETED, TripEvent.CANCEL_TRIP)).toThrow(InvalidTransitionError);
    expect(() => transition(TripState.COMPLETED, TripEvent.MARK_COMPLETE)).toThrow(InvalidTransitionError);
  });

  it("InvalidTransitionError includes fromState and event", () => {
    try {
      transition(TripState.COMPLETED, TripEvent.ASSIGN_DRIVER);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const e = err as InvalidTransitionError;
      expect(e.fromState).toBe(TripState.COMPLETED);
      expect(e.event).toBe(TripEvent.ASSIGN_DRIVER);
      expect(e.message).toContain("COMPLETED");
      expect(e.message).toContain("ASSIGN_DRIVER");
    }
  });

  it("rejects completely unknown state", () => {
    expect(() => transition("FAKE_STATE", TripEvent.ASSIGN_DRIVER)).toThrow(InvalidTransitionError);
  });

  it("rejects unknown event on valid state", () => {
    expect(() => transition(TripState.SCHEDULED, "FAKE_EVENT")).toThrow(InvalidTransitionError);
  });
});

// =========================================================
// 5. Phase Derivation Throughout Lifecycle
// =========================================================
describe("Trip Lifecycle — Phase Tracking", () => {
  it("PICKUP phase for pre-pickup states", () => {
    expect(derivePhase(TripState.SCHEDULED)).toBe("PICKUP");
    expect(derivePhase(TripState.ASSIGNED)).toBe("PICKUP");
    expect(derivePhase(TripState.EN_ROUTE_TO_PICKUP)).toBe("PICKUP");
    expect(derivePhase(TripState.ARRIVED_PICKUP)).toBe("PICKUP");
  });

  it("DROPOFF phase for post-pickup, pre-complete states", () => {
    expect(derivePhase(TripState.PICKED_UP)).toBe("DROPOFF");
    expect(derivePhase(TripState.EN_ROUTE_TO_DROPOFF)).toBe("DROPOFF");
    expect(derivePhase(TripState.IN_PROGRESS)).toBe("DROPOFF");
    expect(derivePhase(TripState.ARRIVED_DROPOFF)).toBe("DROPOFF");
  });

  it("DONE phase for terminal states", () => {
    expect(derivePhase(TripState.COMPLETED)).toBe("DONE");
    expect(derivePhase(TripState.CANCELLED)).toBe("DONE");
    expect(derivePhase(TripState.NO_SHOW)).toBe("DONE");
  });
});

// =========================================================
// 6. UI Actions Consistency
// =========================================================
describe("Trip Lifecycle — UI Actions", () => {
  it("every non-terminal state has a status action", () => {
    const nonTerminalStates = [
      TripState.SCHEDULED,
      TripState.ASSIGNED,
      TripState.EN_ROUTE_TO_PICKUP,
      TripState.ARRIVED_PICKUP,
      TripState.PICKED_UP,
      TripState.EN_ROUTE_TO_DROPOFF,
      TripState.IN_PROGRESS,
      TripState.ARRIVED_DROPOFF,
    ];

    for (const state of nonTerminalStates) {
      const { statusAction } = uiActions(state);
      expect(statusAction).not.toBeNull();
      expect(statusAction!.enabled).toBe(true);
      expect(statusAction!.type).toBe("status_change");
    }
  });

  it("terminal states have no UI actions", () => {
    for (const state of TERMINAL_STATUSES) {
      const { statusAction, navAction } = uiActions(state);
      expect(statusAction).toBeNull();
      expect(navAction).toBeNull();
    }
  });

  it("UI action event produces a valid transition", () => {
    const states = [
      TripState.SCHEDULED,
      TripState.ASSIGNED,
      TripState.EN_ROUTE_TO_PICKUP,
      TripState.ARRIVED_PICKUP,
      TripState.PICKED_UP,
      TripState.EN_ROUTE_TO_DROPOFF,
      TripState.IN_PROGRESS,
      TripState.ARRIVED_DROPOFF,
    ];

    for (const state of states) {
      const { statusAction } = uiActions(state);
      if (statusAction) {
        const nextState = transition(state, statusAction.event);
        expect(nextState).toBe(statusAction.targetStatus);
      }
    }
  });
});

// =========================================================
// 7. Navigation Targets
// =========================================================
describe("Trip Lifecycle — Navigation Targets", () => {
  it("pickup phase states navigate to pickup", () => {
    expect(getNavTarget(TripState.SCHEDULED)).toBe("pickup");
    expect(getNavTarget(TripState.ASSIGNED)).toBe("pickup");
    expect(getNavTarget(TripState.EN_ROUTE_TO_PICKUP)).toBe("pickup");
    expect(getNavTarget(TripState.ARRIVED_PICKUP)).toBe("pickup");
  });

  it("dropoff phase states navigate to dropoff", () => {
    expect(getNavTarget(TripState.PICKED_UP)).toBe("dropoff");
    expect(getNavTarget(TripState.EN_ROUTE_TO_DROPOFF)).toBe("dropoff");
    expect(getNavTarget(TripState.ARRIVED_DROPOFF)).toBe("dropoff");
  });

  it("terminal states have no navigation target", () => {
    expect(getNavTarget(TripState.COMPLETED)).toBeNull();
    expect(getNavTarget(TripState.CANCELLED)).toBeNull();
    expect(getNavTarget(TripState.NO_SHOW)).toBeNull();
  });
});

// =========================================================
// 8. eventToTargetStatus Safety
// =========================================================
describe("Trip Lifecycle — eventToTargetStatus", () => {
  it("returns target status for valid transitions", () => {
    expect(eventToTargetStatus(TripEvent.ASSIGN_DRIVER, TripState.SCHEDULED)).toBe(TripState.ASSIGNED);
    expect(eventToTargetStatus(TripEvent.MARK_COMPLETE, TripState.ARRIVED_DROPOFF)).toBe(TripState.COMPLETED);
  });

  it("returns null for invalid transitions instead of throwing", () => {
    expect(eventToTargetStatus(TripEvent.MARK_COMPLETE, TripState.SCHEDULED)).toBeNull();
    expect(eventToTargetStatus(TripEvent.ASSIGN_DRIVER, TripState.COMPLETED)).toBeNull();
  });
});

// =========================================================
// 9. Constants Consistency
// =========================================================
describe("Trip Lifecycle — Constants", () => {
  it("TERMINAL_STATUSES are all terminal", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(isTerminal(status)).toBe(true);
    }
  });

  it("ACTIVE_NOW_STATUSES are all non-terminal", () => {
    for (const status of ACTIVE_NOW_STATUSES) {
      expect(isTerminal(status)).toBe(false);
    }
  });

  it("ACTIVE_NOW_STATUSES do not include SCHEDULED or ASSIGNED", () => {
    const activeSet = new Set(ACTIVE_NOW_STATUSES as readonly string[]);
    expect(activeSet.has(TripState.SCHEDULED)).toBe(false);
    expect(activeSet.has(TripState.ASSIGNED)).toBe(false);
  });
});
