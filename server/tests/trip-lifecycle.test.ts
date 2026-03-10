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
  STATUS_TIMESTAMP_MAP,
} from "@shared/tripStateMachine";

// =========================================================
// 1. Happy Path: Full Trip Lifecycle
// =========================================================
describe("Trip Lifecycle — Happy Path", () => {
  it("SCHEDULED → ASSIGNED → EN_ROUTE_TO_PICKUP → ARRIVED_PICKUP → PICKED_UP → EN_ROUTE_TO_DROPOFF → ARRIVED_DROPOFF → COMPLETED", () => {
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
  });

  it("supports direct SCHEDULED → EN_ROUTE_TO_PICKUP (skip explicit assign)", () => {
    let state: string = TripState.SCHEDULED;
    state = transition(state, TripEvent.START_TO_PICKUP);
    expect(state).toBe(TripState.EN_ROUTE_TO_PICKUP);
  });

  it("supports IN_PROGRESS alternative path (PICKED_UP → IN_PROGRESS → COMPLETED)", () => {
    let state: string = TripState.PICKED_UP;

    state = transition(state, TripEvent.START_IN_PROGRESS);
    expect(state).toBe(TripState.IN_PROGRESS);

    state = transition(state, TripEvent.MARK_COMPLETE);
    expect(state).toBe(TripState.COMPLETED);
  });
});

// =========================================================
// 2. Cancellation Scenarios
// =========================================================
describe("Trip Lifecycle — Cancellation", () => {
  it("SCHEDULED → CANCELLED", () => {
    const state = transition(TripState.SCHEDULED, TripEvent.CANCEL_TRIP);
    expect(state).toBe(TripState.CANCELLED);
    expect(isTerminal(state)).toBe(true);
  });

  it("ASSIGNED → CANCELLED", () => {
    const state = transition(TripState.ASSIGNED, TripEvent.CANCEL_TRIP);
    expect(state).toBe(TripState.CANCELLED);
  });

  it("EN_ROUTE_TO_PICKUP → CANCELLED", () => {
    const state = transition(TripState.EN_ROUTE_TO_PICKUP, TripEvent.CANCEL_TRIP);
    expect(state).toBe(TripState.CANCELLED);
  });

  it("ARRIVED_PICKUP → CANCELLED", () => {
    const state = transition(TripState.ARRIVED_PICKUP, TripEvent.CANCEL_TRIP);
    expect(state).toBe(TripState.CANCELLED);
  });

  it("PICKED_UP → CANCELLED", () => {
    const state = transition(TripState.PICKED_UP, TripEvent.CANCEL_TRIP);
    expect(state).toBe(TripState.CANCELLED);
  });

  it("EN_ROUTE_TO_DROPOFF → CANCELLED", () => {
    const state = transition(TripState.EN_ROUTE_TO_DROPOFF, TripEvent.CANCEL_TRIP);
    expect(state).toBe(TripState.CANCELLED);
  });

  it("IN_PROGRESS → CANCELLED", () => {
    const state = transition(TripState.IN_PROGRESS, TripEvent.CANCEL_TRIP);
    expect(state).toBe(TripState.CANCELLED);
  });

  it("ARRIVED_DROPOFF → CANCELLED", () => {
    const state = transition(TripState.ARRIVED_DROPOFF, TripEvent.CANCEL_TRIP);
    expect(state).toBe(TripState.CANCELLED);
  });

  it("cannot cancel from COMPLETED", () => {
    expect(() => transition(TripState.COMPLETED, TripEvent.CANCEL_TRIP)).toThrow(InvalidTransitionError);
  });

  it("cannot cancel from CANCELLED (already cancelled)", () => {
    expect(() => transition(TripState.CANCELLED, TripEvent.CANCEL_TRIP)).toThrow(InvalidTransitionError);
  });
});

// =========================================================
// 3. No-Show
// =========================================================
describe("Trip Lifecycle — No-Show", () => {
  it("ARRIVED_PICKUP → NO_SHOW (driver arrived but patient absent)", () => {
    const state = transition(TripState.ARRIVED_PICKUP, TripEvent.MARK_NO_SHOW);
    expect(state).toBe(TripState.NO_SHOW);
    expect(isTerminal(state)).toBe(true);
  });

  it("cannot no-show from SCHEDULED (must arrive first)", () => {
    expect(() => transition(TripState.SCHEDULED, TripEvent.MARK_NO_SHOW)).toThrow(InvalidTransitionError);
  });

  it("cannot no-show from ASSIGNED (must arrive first)", () => {
    expect(() => transition(TripState.ASSIGNED, TripEvent.MARK_NO_SHOW)).toThrow(InvalidTransitionError);
  });

  it("cannot no-show from EN_ROUTE_TO_PICKUP", () => {
    expect(() => transition(TripState.EN_ROUTE_TO_PICKUP, TripEvent.MARK_NO_SHOW)).toThrow(InvalidTransitionError);
  });

  it("cannot no-show after PICKED_UP", () => {
    expect(() => transition(TripState.PICKED_UP, TripEvent.MARK_NO_SHOW)).toThrow(InvalidTransitionError);
  });
});

// =========================================================
// 4. Invalid Transitions (should throw)
// =========================================================
describe("Trip Lifecycle — Invalid Transitions", () => {
  it("rejects skipping from SCHEDULED to PICKED_UP", () => {
    expect(() => transition(TripState.SCHEDULED, TripEvent.MARK_PICKED_UP)).toThrow(InvalidTransitionError);
  });

  it("rejects skipping from SCHEDULED to MARK_COMPLETE", () => {
    expect(() => transition(TripState.SCHEDULED, TripEvent.MARK_COMPLETE)).toThrow(InvalidTransitionError);
  });

  it("rejects going backward from EN_ROUTE_TO_DROPOFF to START_TO_PICKUP", () => {
    expect(() => transition(TripState.EN_ROUTE_TO_DROPOFF, TripEvent.START_TO_PICKUP)).toThrow(InvalidTransitionError);
  });

  it("rejects any event from COMPLETED (terminal state)", () => {
    for (const event of Object.values(TripEvent)) {
      expect(() => transition(TripState.COMPLETED, event)).toThrow(InvalidTransitionError);
    }
  });

  it("rejects any event from NO_SHOW (terminal state)", () => {
    for (const event of Object.values(TripEvent)) {
      expect(() => transition(TripState.NO_SHOW, event)).toThrow(InvalidTransitionError);
    }
  });

  it("rejects any event from CANCELLED (terminal state)", () => {
    for (const event of Object.values(TripEvent)) {
      expect(() => transition(TripState.CANCELLED, event)).toThrow(InvalidTransitionError);
    }
  });

  it("throws InvalidTransitionError with correct fromState and event", () => {
    try {
      transition(TripState.COMPLETED, TripEvent.ASSIGN_DRIVER);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const ite = err as InvalidTransitionError;
      expect(ite.fromState).toBe(TripState.COMPLETED);
      expect(ite.event).toBe(TripEvent.ASSIGN_DRIVER);
    }
  });

  it("rejects unknown state", () => {
    expect(() => transition("NONEXISTENT", TripEvent.ASSIGN_DRIVER)).toThrow(InvalidTransitionError);
  });
});

// =========================================================
// 5. Terminal States
// =========================================================
describe("Trip Lifecycle — Terminal States", () => {
  it("COMPLETED is terminal", () => {
    expect(isTerminal(TripState.COMPLETED)).toBe(true);
  });

  it("CANCELLED is terminal", () => {
    expect(isTerminal(TripState.CANCELLED)).toBe(true);
  });

  it("NO_SHOW is terminal", () => {
    expect(isTerminal(TripState.NO_SHOW)).toBe(true);
  });

  it("TERMINAL_STATUSES constant matches", () => {
    for (const ts of TERMINAL_STATUSES) {
      expect(isTerminal(ts)).toBe(true);
    }
  });

  it("non-terminal states have allowed events", () => {
    const nonTerminal = [
      TripState.SCHEDULED,
      TripState.ASSIGNED,
      TripState.EN_ROUTE_TO_PICKUP,
      TripState.ARRIVED_PICKUP,
      TripState.PICKED_UP,
      TripState.EN_ROUTE_TO_DROPOFF,
      TripState.IN_PROGRESS,
      TripState.ARRIVED_DROPOFF,
    ];
    for (const s of nonTerminal) {
      expect(isTerminal(s)).toBe(false);
      expect(allowedEvents(s).length).toBeGreaterThan(0);
    }
  });
});

// =========================================================
// 6. Phase Derivation
// =========================================================
describe("Trip Lifecycle — Phase Derivation", () => {
  it("SCHEDULED is PICKUP phase", () => {
    expect(derivePhase(TripState.SCHEDULED)).toBe("PICKUP");
  });

  it("ASSIGNED is PICKUP phase", () => {
    expect(derivePhase(TripState.ASSIGNED)).toBe("PICKUP");
  });

  it("EN_ROUTE_TO_PICKUP is PICKUP phase", () => {
    expect(derivePhase(TripState.EN_ROUTE_TO_PICKUP)).toBe("PICKUP");
  });

  it("ARRIVED_PICKUP is PICKUP phase", () => {
    expect(derivePhase(TripState.ARRIVED_PICKUP)).toBe("PICKUP");
  });

  it("PICKED_UP is DROPOFF phase", () => {
    expect(derivePhase(TripState.PICKED_UP)).toBe("DROPOFF");
  });

  it("EN_ROUTE_TO_DROPOFF is DROPOFF phase", () => {
    expect(derivePhase(TripState.EN_ROUTE_TO_DROPOFF)).toBe("DROPOFF");
  });

  it("IN_PROGRESS is DROPOFF phase", () => {
    expect(derivePhase(TripState.IN_PROGRESS)).toBe("DROPOFF");
  });

  it("ARRIVED_DROPOFF is DROPOFF phase", () => {
    expect(derivePhase(TripState.ARRIVED_DROPOFF)).toBe("DROPOFF");
  });

  it("COMPLETED is DONE phase", () => {
    expect(derivePhase(TripState.COMPLETED)).toBe("DONE");
  });

  it("CANCELLED is DONE phase", () => {
    expect(derivePhase(TripState.CANCELLED)).toBe("DONE");
  });

  it("NO_SHOW is DONE phase", () => {
    expect(derivePhase(TripState.NO_SHOW)).toBe("DONE");
  });
});

// =========================================================
// 7. UI Actions Consistency
// =========================================================
describe("Trip Lifecycle — UI Actions", () => {
  it("every non-terminal state has a status action", () => {
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
    for (const s of activeStates) {
      const actions = uiActions(s);
      expect(actions.statusAction).not.toBeNull();
      // The target status of the UI action should be a valid transition
      if (actions.statusAction) {
        const result = transition(s, actions.statusAction.event);
        expect(result).toBe(actions.statusAction.targetStatus);
      }
    }
  });

  it("PICKUP phase states have pickup nav target", () => {
    for (const s of [TripState.SCHEDULED, TripState.ASSIGNED, TripState.EN_ROUTE_TO_PICKUP, TripState.ARRIVED_PICKUP]) {
      expect(getNavTarget(s)).toBe("pickup");
    }
  });

  it("DROPOFF phase states have dropoff nav target", () => {
    for (const s of [TripState.PICKED_UP, TripState.EN_ROUTE_TO_DROPOFF, TripState.IN_PROGRESS, TripState.ARRIVED_DROPOFF]) {
      expect(getNavTarget(s)).toBe("dropoff");
    }
  });

  it("terminal states have null nav target", () => {
    for (const s of [TripState.COMPLETED, TripState.CANCELLED, TripState.NO_SHOW]) {
      expect(getNavTarget(s)).toBeNull();
    }
  });
});

// =========================================================
// 8. eventToTargetStatus
// =========================================================
describe("Trip Lifecycle — eventToTargetStatus", () => {
  it("returns target status for valid transition", () => {
    expect(eventToTargetStatus(TripEvent.ASSIGN_DRIVER, TripState.SCHEDULED)).toBe(TripState.ASSIGNED);
  });

  it("returns null for invalid transition", () => {
    expect(eventToTargetStatus(TripEvent.MARK_COMPLETE, TripState.SCHEDULED)).toBeNull();
  });
});

// =========================================================
// 9. STATUS_TIMESTAMP_MAP Coverage
// =========================================================
describe("Trip Lifecycle — Status Timestamp Mapping", () => {
  it("all active states have timestamp mappings", () => {
    for (const s of ACTIVE_NOW_STATUSES) {
      expect(STATUS_TIMESTAMP_MAP[s]).toBeDefined();
    }
  });

  it("COMPLETED maps to completedAt", () => {
    expect(STATUS_TIMESTAMP_MAP["COMPLETED"]).toBe("completedAt");
  });

  it("CANCELLED maps to cancelledAt", () => {
    expect(STATUS_TIMESTAMP_MAP["CANCELLED"]).toBe("cancelledAt");
  });

  it("NO_SHOW maps to cancelledAt", () => {
    expect(STATUS_TIMESTAMP_MAP["NO_SHOW"]).toBe("cancelledAt");
  });
});

// =========================================================
// 10. Allowed Events — Full Coverage
// =========================================================
describe("Trip Lifecycle — Allowed Events", () => {
  it("SCHEDULED allows ASSIGN_DRIVER, START_TO_PICKUP, CANCEL_TRIP", () => {
    const events = allowedEvents(TripState.SCHEDULED);
    expect(events).toContain(TripEvent.ASSIGN_DRIVER);
    expect(events).toContain(TripEvent.START_TO_PICKUP);
    expect(events).toContain(TripEvent.CANCEL_TRIP);
    expect(events).toHaveLength(3);
  });

  it("ASSIGNED allows START_TO_PICKUP, CANCEL_TRIP", () => {
    const events = allowedEvents(TripState.ASSIGNED);
    expect(events).toContain(TripEvent.START_TO_PICKUP);
    expect(events).toContain(TripEvent.CANCEL_TRIP);
    expect(events).toHaveLength(2);
  });

  it("EN_ROUTE_TO_PICKUP allows MARK_ARRIVED_PICKUP, CANCEL_TRIP", () => {
    const events = allowedEvents(TripState.EN_ROUTE_TO_PICKUP);
    expect(events).toContain(TripEvent.MARK_ARRIVED_PICKUP);
    expect(events).toContain(TripEvent.CANCEL_TRIP);
    expect(events).toHaveLength(2);
  });

  it("ARRIVED_PICKUP allows MARK_PICKED_UP, MARK_NO_SHOW, CANCEL_TRIP", () => {
    const events = allowedEvents(TripState.ARRIVED_PICKUP);
    expect(events).toContain(TripEvent.MARK_PICKED_UP);
    expect(events).toContain(TripEvent.MARK_NO_SHOW);
    expect(events).toContain(TripEvent.CANCEL_TRIP);
    expect(events).toHaveLength(3);
  });

  it("PICKED_UP allows START_TO_DROPOFF, START_IN_PROGRESS, CANCEL_TRIP", () => {
    const events = allowedEvents(TripState.PICKED_UP);
    expect(events).toContain(TripEvent.START_TO_DROPOFF);
    expect(events).toContain(TripEvent.START_IN_PROGRESS);
    expect(events).toContain(TripEvent.CANCEL_TRIP);
    expect(events).toHaveLength(3);
  });

  it("COMPLETED has no allowed events", () => {
    expect(allowedEvents(TripState.COMPLETED)).toEqual([]);
  });

  it("CANCELLED has no allowed events", () => {
    expect(allowedEvents(TripState.CANCELLED)).toEqual([]);
  });

  it("NO_SHOW has no allowed events", () => {
    expect(allowedEvents(TripState.NO_SHOW)).toEqual([]);
  });

  it("unknown state returns empty array", () => {
    expect(allowedEvents("UNKNOWN_STATE")).toEqual([]);
  });
});
