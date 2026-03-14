import { describe, it, expect } from "vitest";
import {
  transition,
  allowedEvents,
  isTerminal,
  derivePhase,
  deriveStateFromTrip,
  InvalidTransitionError,
  TripState,
  TripEvent,
  uiActions,
  getNavTarget,
  getNavLabel,
  eventToTargetStatus,
  TERMINAL_STATUSES,
  ACTIVE_NOW_STATUSES,
  VALID_TRANSITIONS,
  STATUS_TIMESTAMP_MAP,
  DISPATCH_STAGES,
} from "@shared/tripStateMachine";

const ALL_STATES = Object.values(TripState);
const ALL_EVENTS = Object.values(TripEvent);
const NON_TERMINAL_STATES = ALL_STATES.filter(
  (s) => s !== TripState.COMPLETED && s !== TripState.CANCELLED && s !== TripState.NO_SHOW
);
const TERMINAL_STATES = [TripState.COMPLETED, TripState.CANCELLED, TripState.NO_SHOW];

// ---------------------------------------------------------------------------
// VALID TRANSITIONS
// ---------------------------------------------------------------------------
describe("transition() - valid transitions", () => {
  const validCases: [string, string, string][] = [
    [TripState.SCHEDULED, TripEvent.ASSIGN_DRIVER, TripState.ASSIGNED],
    [TripState.SCHEDULED, TripEvent.START_TO_PICKUP, TripState.EN_ROUTE_TO_PICKUP],
    [TripState.SCHEDULED, TripEvent.CANCEL_TRIP, TripState.CANCELLED],
    [TripState.ASSIGNED, TripEvent.START_TO_PICKUP, TripState.EN_ROUTE_TO_PICKUP],
    [TripState.ASSIGNED, TripEvent.CANCEL_TRIP, TripState.CANCELLED],
    [TripState.EN_ROUTE_TO_PICKUP, TripEvent.MARK_ARRIVED_PICKUP, TripState.ARRIVED_PICKUP],
    [TripState.EN_ROUTE_TO_PICKUP, TripEvent.CANCEL_TRIP, TripState.CANCELLED],
    [TripState.ARRIVED_PICKUP, TripEvent.MARK_PICKED_UP, TripState.PICKED_UP],
    [TripState.ARRIVED_PICKUP, TripEvent.MARK_NO_SHOW, TripState.NO_SHOW],
    [TripState.ARRIVED_PICKUP, TripEvent.CANCEL_TRIP, TripState.CANCELLED],
    [TripState.PICKED_UP, TripEvent.START_TO_DROPOFF, TripState.EN_ROUTE_TO_DROPOFF],
    [TripState.PICKED_UP, TripEvent.START_IN_PROGRESS, TripState.IN_PROGRESS],
    [TripState.PICKED_UP, TripEvent.CANCEL_TRIP, TripState.CANCELLED],
    [TripState.EN_ROUTE_TO_DROPOFF, TripEvent.MARK_ARRIVED_DROPOFF, TripState.ARRIVED_DROPOFF],
    [TripState.EN_ROUTE_TO_DROPOFF, TripEvent.CANCEL_TRIP, TripState.CANCELLED],
    [TripState.IN_PROGRESS, TripEvent.MARK_COMPLETE, TripState.COMPLETED],
    [TripState.IN_PROGRESS, TripEvent.CANCEL_TRIP, TripState.CANCELLED],
    [TripState.ARRIVED_DROPOFF, TripEvent.MARK_COMPLETE, TripState.COMPLETED],
    [TripState.ARRIVED_DROPOFF, TripEvent.CANCEL_TRIP, TripState.CANCELLED],
  ];

  it.each(validCases)(
    "%s + %s -> %s",
    (fromState, event, expectedState) => {
      expect(transition(fromState, event)).toBe(expectedState);
    }
  );
});

// ---------------------------------------------------------------------------
// INVALID TRANSITIONS
// ---------------------------------------------------------------------------
describe("transition() - invalid transitions", () => {
  describe("terminal states reject all events", () => {
    for (const terminalState of TERMINAL_STATES) {
      describe(`from ${terminalState}`, () => {
        it.each(ALL_EVENTS)(`+ %s throws InvalidTransitionError`, (event) => {
          expect(() => transition(terminalState, event)).toThrow(InvalidTransitionError);
        });
      });
    }
  });

  describe("invalid event from non-terminal states", () => {
    const invalidCases: [string, string][] = [
      [TripState.SCHEDULED, TripEvent.MARK_COMPLETE],
      [TripState.SCHEDULED, TripEvent.MARK_PICKED_UP],
      [TripState.SCHEDULED, TripEvent.MARK_ARRIVED_PICKUP],
      [TripState.SCHEDULED, TripEvent.START_TO_DROPOFF],
      [TripState.SCHEDULED, TripEvent.MARK_ARRIVED_DROPOFF],
      [TripState.SCHEDULED, TripEvent.START_IN_PROGRESS],
      [TripState.SCHEDULED, TripEvent.MARK_NO_SHOW],
      [TripState.ASSIGNED, TripEvent.MARK_COMPLETE],
      [TripState.ASSIGNED, TripEvent.MARK_PICKED_UP],
      [TripState.ASSIGNED, TripEvent.MARK_ARRIVED_PICKUP],
      [TripState.ASSIGNED, TripEvent.ASSIGN_DRIVER],
      [TripState.EN_ROUTE_TO_PICKUP, TripEvent.MARK_PICKED_UP],
      [TripState.EN_ROUTE_TO_PICKUP, TripEvent.START_TO_DROPOFF],
      [TripState.EN_ROUTE_TO_PICKUP, TripEvent.MARK_COMPLETE],
      [TripState.EN_ROUTE_TO_PICKUP, TripEvent.ASSIGN_DRIVER],
      [TripState.ARRIVED_PICKUP, TripEvent.MARK_COMPLETE],
      [TripState.ARRIVED_PICKUP, TripEvent.START_TO_DROPOFF],
      [TripState.ARRIVED_PICKUP, TripEvent.ASSIGN_DRIVER],
      [TripState.PICKED_UP, TripEvent.MARK_COMPLETE],
      [TripState.PICKED_UP, TripEvent.MARK_ARRIVED_PICKUP],
      [TripState.PICKED_UP, TripEvent.ASSIGN_DRIVER],
      [TripState.EN_ROUTE_TO_DROPOFF, TripEvent.MARK_PICKED_UP],
      [TripState.EN_ROUTE_TO_DROPOFF, TripEvent.START_TO_PICKUP],
      [TripState.EN_ROUTE_TO_DROPOFF, TripEvent.ASSIGN_DRIVER],
      [TripState.IN_PROGRESS, TripEvent.START_TO_PICKUP],
      [TripState.IN_PROGRESS, TripEvent.MARK_PICKED_UP],
      [TripState.IN_PROGRESS, TripEvent.ASSIGN_DRIVER],
      [TripState.ARRIVED_DROPOFF, TripEvent.START_TO_PICKUP],
      [TripState.ARRIVED_DROPOFF, TripEvent.MARK_PICKED_UP],
      [TripState.ARRIVED_DROPOFF, TripEvent.ASSIGN_DRIVER],
    ];

    it.each(invalidCases)(
      "%s + %s throws InvalidTransitionError",
      (fromState, event) => {
        expect(() => transition(fromState, event)).toThrow(InvalidTransitionError);
      }
    );
  });

  it("unknown state throws InvalidTransitionError", () => {
    expect(() => transition("BOGUS_STATE", TripEvent.ASSIGN_DRIVER)).toThrow(
      InvalidTransitionError
    );
  });

  it("unknown state with unknown event throws InvalidTransitionError", () => {
    expect(() => transition("BOGUS", "BOGUS_EVENT")).toThrow(InvalidTransitionError);
  });

  it("valid state with unknown event throws InvalidTransitionError", () => {
    expect(() => transition(TripState.SCHEDULED, "UNKNOWN_EVENT")).toThrow(
      InvalidTransitionError
    );
  });
});

// ---------------------------------------------------------------------------
// ALLOWED EVENTS
// ---------------------------------------------------------------------------
describe("allowedEvents()", () => {
  it("SCHEDULED allows ASSIGN_DRIVER, START_TO_PICKUP, CANCEL_TRIP", () => {
    const events = allowedEvents(TripState.SCHEDULED);
    expect(events).toEqual(
      expect.arrayContaining([TripEvent.ASSIGN_DRIVER, TripEvent.START_TO_PICKUP, TripEvent.CANCEL_TRIP])
    );
    expect(events).toHaveLength(3);
  });

  it("ASSIGNED allows START_TO_PICKUP, CANCEL_TRIP", () => {
    const events = allowedEvents(TripState.ASSIGNED);
    expect(events).toEqual(
      expect.arrayContaining([TripEvent.START_TO_PICKUP, TripEvent.CANCEL_TRIP])
    );
    expect(events).toHaveLength(2);
  });

  it("EN_ROUTE_TO_PICKUP allows MARK_ARRIVED_PICKUP, CANCEL_TRIP", () => {
    const events = allowedEvents(TripState.EN_ROUTE_TO_PICKUP);
    expect(events).toEqual(
      expect.arrayContaining([TripEvent.MARK_ARRIVED_PICKUP, TripEvent.CANCEL_TRIP])
    );
    expect(events).toHaveLength(2);
  });

  it("ARRIVED_PICKUP allows MARK_PICKED_UP, MARK_NO_SHOW, CANCEL_TRIP", () => {
    const events = allowedEvents(TripState.ARRIVED_PICKUP);
    expect(events).toEqual(
      expect.arrayContaining([TripEvent.MARK_PICKED_UP, TripEvent.MARK_NO_SHOW, TripEvent.CANCEL_TRIP])
    );
    expect(events).toHaveLength(3);
  });

  it("PICKED_UP allows START_TO_DROPOFF, START_IN_PROGRESS, CANCEL_TRIP", () => {
    const events = allowedEvents(TripState.PICKED_UP);
    expect(events).toEqual(
      expect.arrayContaining([TripEvent.START_TO_DROPOFF, TripEvent.START_IN_PROGRESS, TripEvent.CANCEL_TRIP])
    );
    expect(events).toHaveLength(3);
  });

  it("EN_ROUTE_TO_DROPOFF allows MARK_ARRIVED_DROPOFF, CANCEL_TRIP", () => {
    const events = allowedEvents(TripState.EN_ROUTE_TO_DROPOFF);
    expect(events).toEqual(
      expect.arrayContaining([TripEvent.MARK_ARRIVED_DROPOFF, TripEvent.CANCEL_TRIP])
    );
    expect(events).toHaveLength(2);
  });

  it("IN_PROGRESS allows MARK_COMPLETE, CANCEL_TRIP", () => {
    const events = allowedEvents(TripState.IN_PROGRESS);
    expect(events).toEqual(
      expect.arrayContaining([TripEvent.MARK_COMPLETE, TripEvent.CANCEL_TRIP])
    );
    expect(events).toHaveLength(2);
  });

  it("ARRIVED_DROPOFF allows MARK_COMPLETE, CANCEL_TRIP", () => {
    const events = allowedEvents(TripState.ARRIVED_DROPOFF);
    expect(events).toEqual(
      expect.arrayContaining([TripEvent.MARK_COMPLETE, TripEvent.CANCEL_TRIP])
    );
    expect(events).toHaveLength(2);
  });

  it.each(TERMINAL_STATES)("%s returns empty array", (state) => {
    expect(allowedEvents(state)).toEqual([]);
  });

  it("unknown state returns empty array", () => {
    expect(allowedEvents("NONEXISTENT")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TERMINAL STATE CHECKS
// ---------------------------------------------------------------------------
describe("isTerminal()", () => {
  it("COMPLETED is terminal", () => {
    expect(isTerminal(TripState.COMPLETED)).toBe(true);
  });

  it("CANCELLED is terminal", () => {
    expect(isTerminal(TripState.CANCELLED)).toBe(true);
  });

  it("NO_SHOW is terminal", () => {
    expect(isTerminal(TripState.NO_SHOW)).toBe(true);
  });

  it.each(NON_TERMINAL_STATES)("%s is not terminal", (state) => {
    expect(isTerminal(state)).toBe(false);
  });

  it("unknown state is treated as terminal (no allowed events)", () => {
    expect(isTerminal("UNKNOWN_STATE")).toBe(true);
  });
});

describe("TERMINAL_STATUSES constant", () => {
  it("contains exactly COMPLETED, CANCELLED, NO_SHOW", () => {
    expect([...TERMINAL_STATUSES]).toEqual([
      TripState.COMPLETED,
      TripState.CANCELLED,
      TripState.NO_SHOW,
    ]);
  });

  it("has length 3", () => {
    expect(TERMINAL_STATUSES).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// PHASE DERIVATION
// ---------------------------------------------------------------------------
describe("derivePhase()", () => {
  const phaseCases: [string, string][] = [
    [TripState.SCHEDULED, "PICKUP"],
    [TripState.ASSIGNED, "PICKUP"],
    [TripState.EN_ROUTE_TO_PICKUP, "PICKUP"],
    [TripState.ARRIVED_PICKUP, "PICKUP"],
    [TripState.PICKED_UP, "DROPOFF"],
    [TripState.EN_ROUTE_TO_DROPOFF, "DROPOFF"],
    [TripState.IN_PROGRESS, "DROPOFF"],
    [TripState.ARRIVED_DROPOFF, "DROPOFF"],
    [TripState.COMPLETED, "DONE"],
    [TripState.CANCELLED, "DONE"],
    [TripState.NO_SHOW, "DONE"],
  ];

  it.each(phaseCases)("%s -> %s phase", (state, expectedPhase) => {
    expect(derivePhase(state)).toBe(expectedPhase);
  });

  it("unknown state defaults to DROPOFF phase", () => {
    expect(derivePhase("UNKNOWN")).toBe("DROPOFF");
  });
});

// ---------------------------------------------------------------------------
// UI ACTIONS
// ---------------------------------------------------------------------------
describe("uiActions()", () => {
  describe("non-terminal states have statusAction and navAction", () => {
    it("SCHEDULED has statusAction with START_TO_PICKUP event", () => {
      const actions = uiActions(TripState.SCHEDULED);
      expect(actions.statusAction).not.toBeNull();
      expect(actions.statusAction!.event).toBe(TripEvent.START_TO_PICKUP);
      expect(actions.statusAction!.targetStatus).toBe(TripState.EN_ROUTE_TO_PICKUP);
      expect(actions.statusAction!.label).toBe("Accept & Start Trip");
      expect(actions.statusAction!.type).toBe("status_change");
      expect(actions.statusAction!.enabled).toBe(true);
    });

    it("ASSIGNED has statusAction with START_TO_PICKUP event", () => {
      const actions = uiActions(TripState.ASSIGNED);
      expect(actions.statusAction).not.toBeNull();
      expect(actions.statusAction!.event).toBe(TripEvent.START_TO_PICKUP);
      expect(actions.statusAction!.targetStatus).toBe(TripState.EN_ROUTE_TO_PICKUP);
      expect(actions.statusAction!.label).toBe("Go to Pickup");
    });

    it("EN_ROUTE_TO_PICKUP has statusAction with MARK_ARRIVED_PICKUP event", () => {
      const actions = uiActions(TripState.EN_ROUTE_TO_PICKUP);
      expect(actions.statusAction!.event).toBe(TripEvent.MARK_ARRIVED_PICKUP);
      expect(actions.statusAction!.targetStatus).toBe(TripState.ARRIVED_PICKUP);
      expect(actions.statusAction!.label).toBe("Mark Arrived at Pickup");
    });

    it("ARRIVED_PICKUP has statusAction with MARK_PICKED_UP event", () => {
      const actions = uiActions(TripState.ARRIVED_PICKUP);
      expect(actions.statusAction!.event).toBe(TripEvent.MARK_PICKED_UP);
      expect(actions.statusAction!.targetStatus).toBe(TripState.PICKED_UP);
      expect(actions.statusAction!.label).toBe("Picked Up Patient");
    });

    it("PICKED_UP has statusAction with START_TO_DROPOFF event", () => {
      const actions = uiActions(TripState.PICKED_UP);
      expect(actions.statusAction!.event).toBe(TripEvent.START_TO_DROPOFF);
      expect(actions.statusAction!.targetStatus).toBe(TripState.EN_ROUTE_TO_DROPOFF);
      expect(actions.statusAction!.label).toBe("Start Trip to Dropoff");
    });

    it("EN_ROUTE_TO_DROPOFF has statusAction with MARK_ARRIVED_DROPOFF event", () => {
      const actions = uiActions(TripState.EN_ROUTE_TO_DROPOFF);
      expect(actions.statusAction!.event).toBe(TripEvent.MARK_ARRIVED_DROPOFF);
      expect(actions.statusAction!.targetStatus).toBe(TripState.ARRIVED_DROPOFF);
      expect(actions.statusAction!.label).toBe("Mark Arrived at Dropoff");
    });

    it("IN_PROGRESS has statusAction with MARK_COMPLETE event", () => {
      const actions = uiActions(TripState.IN_PROGRESS);
      expect(actions.statusAction!.event).toBe(TripEvent.MARK_COMPLETE);
      expect(actions.statusAction!.targetStatus).toBe(TripState.COMPLETED);
      expect(actions.statusAction!.label).toBe("Complete Trip");
    });

    it("ARRIVED_DROPOFF has statusAction with MARK_COMPLETE event", () => {
      const actions = uiActions(TripState.ARRIVED_DROPOFF);
      expect(actions.statusAction!.event).toBe(TripEvent.MARK_COMPLETE);
      expect(actions.statusAction!.targetStatus).toBe(TripState.COMPLETED);
      expect(actions.statusAction!.label).toBe("Complete Trip");
    });
  });

  describe("navAction targets", () => {
    it.each([
      [TripState.SCHEDULED, "pickup"],
      [TripState.ASSIGNED, "pickup"],
      [TripState.EN_ROUTE_TO_PICKUP, "pickup"],
      [TripState.ARRIVED_PICKUP, "pickup"],
    ] as [string, string][])("%s navAction target is %s", (state, target) => {
      const actions = uiActions(state);
      expect(actions.navAction).not.toBeNull();
      expect(actions.navAction!.target).toBe(target);
      expect(actions.navAction!.type).toBe("navigation");
    });

    it.each([
      [TripState.PICKED_UP, "dropoff"],
      [TripState.EN_ROUTE_TO_DROPOFF, "dropoff"],
      [TripState.IN_PROGRESS, "dropoff"],
      [TripState.ARRIVED_DROPOFF, "dropoff"],
    ] as [string, string][])("%s navAction target is %s", (state, target) => {
      const actions = uiActions(state);
      expect(actions.navAction).not.toBeNull();
      expect(actions.navAction!.target).toBe(target);
    });
  });

  describe("terminal states have no actions", () => {
    it.each(TERMINAL_STATES)("%s has no statusAction or navAction", (state) => {
      const actions = uiActions(state);
      expect(actions.statusAction).toBeNull();
      expect(actions.navAction).toBeNull();
    });
  });

  it("unknown state returns null actions", () => {
    const actions = uiActions("UNKNOWN");
    expect(actions.statusAction).toBeNull();
    expect(actions.navAction).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// NAV TARGET
// ---------------------------------------------------------------------------
describe("getNavTarget()", () => {
  it.each([
    [TripState.SCHEDULED, "pickup"],
    [TripState.ASSIGNED, "pickup"],
    [TripState.EN_ROUTE_TO_PICKUP, "pickup"],
    [TripState.ARRIVED_PICKUP, "pickup"],
  ] as [string, string | null][])("%s -> %s", (state, expected) => {
    expect(getNavTarget(state)).toBe(expected);
  });

  it.each([
    [TripState.PICKED_UP, "dropoff"],
    [TripState.EN_ROUTE_TO_DROPOFF, "dropoff"],
    [TripState.IN_PROGRESS, "dropoff"],
    [TripState.ARRIVED_DROPOFF, "dropoff"],
  ] as [string, string | null][])("%s -> %s", (state, expected) => {
    expect(getNavTarget(state)).toBe(expected);
  });

  it.each(TERMINAL_STATES)("%s -> null", (state) => {
    expect(getNavTarget(state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// NAV LABEL
// ---------------------------------------------------------------------------
describe("getNavLabel()", () => {
  it.each([
    TripState.SCHEDULED,
    TripState.ASSIGNED,
    TripState.EN_ROUTE_TO_PICKUP,
    TripState.ARRIVED_PICKUP,
  ])('%s -> "Go to Pickup"', (state) => {
    expect(getNavLabel(state)).toBe("Go to Pickup");
  });

  it.each([
    TripState.PICKED_UP,
    TripState.EN_ROUTE_TO_DROPOFF,
    TripState.IN_PROGRESS,
    TripState.ARRIVED_DROPOFF,
  ])('%s -> "Go to Dropoff"', (state) => {
    expect(getNavLabel(state)).toBe("Go to Dropoff");
  });

  it.each(TERMINAL_STATES)('%s -> ""', (state) => {
    expect(getNavLabel(state)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// deriveStateFromTrip
// ---------------------------------------------------------------------------
describe("deriveStateFromTrip()", () => {
  it.each(ALL_STATES)("valid status %s returns that status", (state) => {
    expect(deriveStateFromTrip({ status: state })).toBe(state);
  });

  it("unknown status returns SCHEDULED as default", () => {
    expect(deriveStateFromTrip({ status: "BOGUS" })).toBe(TripState.SCHEDULED);
  });

  it("empty status returns SCHEDULED as default", () => {
    expect(deriveStateFromTrip({ status: "" })).toBe(TripState.SCHEDULED);
  });
});

// ---------------------------------------------------------------------------
// eventToTargetStatus
// ---------------------------------------------------------------------------
describe("eventToTargetStatus()", () => {
  it("valid transition returns target status", () => {
    expect(eventToTargetStatus(TripEvent.ASSIGN_DRIVER, TripState.SCHEDULED)).toBe(
      TripState.ASSIGNED
    );
  });

  it("valid CANCEL_TRIP returns CANCELLED", () => {
    expect(eventToTargetStatus(TripEvent.CANCEL_TRIP, TripState.SCHEDULED)).toBe(
      TripState.CANCELLED
    );
  });

  it("invalid transition returns null", () => {
    expect(eventToTargetStatus(TripEvent.MARK_COMPLETE, TripState.SCHEDULED)).toBeNull();
  });

  it("event from terminal state returns null", () => {
    expect(eventToTargetStatus(TripEvent.ASSIGN_DRIVER, TripState.COMPLETED)).toBeNull();
  });

  it("unknown event returns null", () => {
    expect(eventToTargetStatus("BOGUS", TripState.SCHEDULED)).toBeNull();
  });

  it("unknown state returns null", () => {
    expect(eventToTargetStatus(TripEvent.ASSIGN_DRIVER, "BOGUS")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ACTIVE_NOW_STATUSES
// ---------------------------------------------------------------------------
describe("ACTIVE_NOW_STATUSES", () => {
  it("contains exactly 6 active states", () => {
    expect(ACTIVE_NOW_STATUSES).toHaveLength(6);
  });

  it("contains the correct states", () => {
    expect([...ACTIVE_NOW_STATUSES]).toEqual([
      TripState.EN_ROUTE_TO_PICKUP,
      TripState.ARRIVED_PICKUP,
      TripState.PICKED_UP,
      TripState.EN_ROUTE_TO_DROPOFF,
      TripState.IN_PROGRESS,
      TripState.ARRIVED_DROPOFF,
    ]);
  });

  it("does not contain SCHEDULED", () => {
    expect(ACTIVE_NOW_STATUSES).not.toContain(TripState.SCHEDULED);
  });

  it("does not contain ASSIGNED", () => {
    expect(ACTIVE_NOW_STATUSES).not.toContain(TripState.ASSIGNED);
  });

  it.each(TERMINAL_STATES)("does not contain %s", (state) => {
    expect(ACTIVE_NOW_STATUSES).not.toContain(state);
  });
});

// ---------------------------------------------------------------------------
// STATUS_TIMESTAMP_MAP
// ---------------------------------------------------------------------------
describe("STATUS_TIMESTAMP_MAP", () => {
  const expectedMap: Record<string, string> = {
    EN_ROUTE_TO_PICKUP: "startedAt",
    ARRIVED_PICKUP: "arrivedPickupAt",
    PICKED_UP: "pickedUpAt",
    IN_PROGRESS: "inProgressAt",
    EN_ROUTE_TO_DROPOFF: "enRouteDropoffAt",
    ARRIVED_DROPOFF: "arrivedDropoffAt",
    COMPLETED: "completedAt",
    CANCELLED: "cancelledAt",
    NO_SHOW: "cancelledAt",
  };

  it.each(Object.entries(expectedMap))(
    "%s maps to %s",
    (status, field) => {
      expect(STATUS_TIMESTAMP_MAP[status]).toBe(field);
    }
  );

  it("does not have SCHEDULED mapped", () => {
    expect(STATUS_TIMESTAMP_MAP[TripState.SCHEDULED]).toBeUndefined();
  });

  it("does not have ASSIGNED mapped", () => {
    expect(STATUS_TIMESTAMP_MAP[TripState.ASSIGNED]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DISPATCH_STAGES
// ---------------------------------------------------------------------------
describe("DISPATCH_STAGES", () => {
  it("has NONE", () => {
    expect(DISPATCH_STAGES.NONE).toBe("NONE");
  });

  it("has NOTIFIED", () => {
    expect(DISPATCH_STAGES.NOTIFIED).toBe("NOTIFIED");
  });

  it("has DISPATCHED", () => {
    expect(DISPATCH_STAGES.DISPATCHED).toBe("DISPATCHED");
  });

  it("has exactly 3 keys", () => {
    expect(Object.keys(DISPATCH_STAGES)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// VALID_TRANSITIONS export
// ---------------------------------------------------------------------------
describe("VALID_TRANSITIONS export", () => {
  it("SCHEDULED has 3 target states", () => {
    expect(VALID_TRANSITIONS[TripState.SCHEDULED]).toHaveLength(3);
    expect(VALID_TRANSITIONS[TripState.SCHEDULED]).toEqual(
      expect.arrayContaining([TripState.ASSIGNED, TripState.EN_ROUTE_TO_PICKUP, TripState.CANCELLED])
    );
  });

  it("ASSIGNED has 2 target states", () => {
    expect(VALID_TRANSITIONS[TripState.ASSIGNED]).toHaveLength(2);
    expect(VALID_TRANSITIONS[TripState.ASSIGNED]).toEqual(
      expect.arrayContaining([TripState.EN_ROUTE_TO_PICKUP, TripState.CANCELLED])
    );
  });

  it("ARRIVED_PICKUP has 3 target states", () => {
    expect(VALID_TRANSITIONS[TripState.ARRIVED_PICKUP]).toHaveLength(3);
    expect(VALID_TRANSITIONS[TripState.ARRIVED_PICKUP]).toEqual(
      expect.arrayContaining([TripState.PICKED_UP, TripState.NO_SHOW, TripState.CANCELLED])
    );
  });

  it("PICKED_UP has 3 target states", () => {
    expect(VALID_TRANSITIONS[TripState.PICKED_UP]).toHaveLength(3);
    expect(VALID_TRANSITIONS[TripState.PICKED_UP]).toEqual(
      expect.arrayContaining([TripState.EN_ROUTE_TO_DROPOFF, TripState.IN_PROGRESS, TripState.CANCELLED])
    );
  });

  it.each(TERMINAL_STATES)("%s has empty target states", (state) => {
    expect(VALID_TRANSITIONS[state]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FULL LIFECYCLE SCENARIOS
// ---------------------------------------------------------------------------
describe("full lifecycle scenarios", () => {
  it("happy path 1: full dropoff flow with assignment", () => {
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

  it("happy path 2: in-progress flow with assignment", () => {
    let state: string = TripState.SCHEDULED;
    state = transition(state, TripEvent.ASSIGN_DRIVER);
    expect(state).toBe(TripState.ASSIGNED);
    state = transition(state, TripEvent.START_TO_PICKUP);
    expect(state).toBe(TripState.EN_ROUTE_TO_PICKUP);
    state = transition(state, TripEvent.MARK_ARRIVED_PICKUP);
    expect(state).toBe(TripState.ARRIVED_PICKUP);
    state = transition(state, TripEvent.MARK_PICKED_UP);
    expect(state).toBe(TripState.PICKED_UP);
    state = transition(state, TripEvent.START_IN_PROGRESS);
    expect(state).toBe(TripState.IN_PROGRESS);
    state = transition(state, TripEvent.MARK_COMPLETE);
    expect(state).toBe(TripState.COMPLETED);
    expect(isTerminal(state)).toBe(true);
  });

  it("direct path: skip assignment, go straight to pickup", () => {
    let state: string = TripState.SCHEDULED;
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
  });

  it("no-show path", () => {
    let state: string = TripState.SCHEDULED;
    state = transition(state, TripEvent.ASSIGN_DRIVER);
    state = transition(state, TripEvent.START_TO_PICKUP);
    state = transition(state, TripEvent.MARK_ARRIVED_PICKUP);
    expect(state).toBe(TripState.ARRIVED_PICKUP);
    state = transition(state, TripEvent.MARK_NO_SHOW);
    expect(state).toBe(TripState.NO_SHOW);
    expect(isTerminal(state)).toBe(true);
  });

  describe("cancellation at each non-terminal state", () => {
    it("cancel from SCHEDULED", () => {
      expect(transition(TripState.SCHEDULED, TripEvent.CANCEL_TRIP)).toBe(TripState.CANCELLED);
    });

    it("cancel from ASSIGNED", () => {
      expect(transition(TripState.ASSIGNED, TripEvent.CANCEL_TRIP)).toBe(TripState.CANCELLED);
    });

    it("cancel from EN_ROUTE_TO_PICKUP", () => {
      expect(transition(TripState.EN_ROUTE_TO_PICKUP, TripEvent.CANCEL_TRIP)).toBe(
        TripState.CANCELLED
      );
    });

    it("cancel from ARRIVED_PICKUP", () => {
      expect(transition(TripState.ARRIVED_PICKUP, TripEvent.CANCEL_TRIP)).toBe(
        TripState.CANCELLED
      );
    });

    it("cancel from PICKED_UP", () => {
      expect(transition(TripState.PICKED_UP, TripEvent.CANCEL_TRIP)).toBe(TripState.CANCELLED);
    });

    it("cancel from EN_ROUTE_TO_DROPOFF", () => {
      expect(transition(TripState.EN_ROUTE_TO_DROPOFF, TripEvent.CANCEL_TRIP)).toBe(
        TripState.CANCELLED
      );
    });

    it("cancel from IN_PROGRESS", () => {
      expect(transition(TripState.IN_PROGRESS, TripEvent.CANCEL_TRIP)).toBe(TripState.CANCELLED);
    });

    it("cancel from ARRIVED_DROPOFF", () => {
      expect(transition(TripState.ARRIVED_DROPOFF, TripEvent.CANCEL_TRIP)).toBe(
        TripState.CANCELLED
      );
    });
  });
});

// ---------------------------------------------------------------------------
// InvalidTransitionError
// ---------------------------------------------------------------------------
describe("InvalidTransitionError", () => {
  it("has correct name", () => {
    const err = new InvalidTransitionError("STATE_A", "EVENT_B");
    expect(err.name).toBe("InvalidTransitionError");
  });

  it("has correct fromState property", () => {
    const err = new InvalidTransitionError("STATE_A", "EVENT_B");
    expect(err.fromState).toBe("STATE_A");
  });

  it("has correct event property", () => {
    const err = new InvalidTransitionError("STATE_A", "EVENT_B");
    expect(err.event).toBe("EVENT_B");
  });

  it("has descriptive message", () => {
    const err = new InvalidTransitionError("COMPLETED", "ASSIGN_DRIVER");
    expect(err.message).toContain("COMPLETED");
    expect(err.message).toContain("ASSIGN_DRIVER");
    expect(err.message).toContain("Invalid transition");
  });

  it("is an instance of Error", () => {
    const err = new InvalidTransitionError("A", "B");
    expect(err).toBeInstanceOf(Error);
  });

  it("is an instance of InvalidTransitionError", () => {
    try {
      transition(TripState.COMPLETED, TripEvent.ASSIGN_DRIVER);
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      expect((e as InvalidTransitionError).fromState).toBe(TripState.COMPLETED);
      expect((e as InvalidTransitionError).event).toBe(TripEvent.ASSIGN_DRIVER);
    }
  });
});

// ---------------------------------------------------------------------------
// TripState and TripEvent constants
// ---------------------------------------------------------------------------
describe("TripState constant", () => {
  it("has all 11 states", () => {
    expect(Object.keys(TripState)).toHaveLength(11);
  });

  it.each([
    "SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP",
    "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "IN_PROGRESS", "ARRIVED_DROPOFF",
    "COMPLETED", "CANCELLED", "NO_SHOW",
  ])("has %s", (state) => {
    expect(TripState).toHaveProperty(state, state);
  });
});

describe("TripEvent constant", () => {
  it("has all 10 events", () => {
    expect(Object.keys(TripEvent)).toHaveLength(10);
  });

  it.each([
    "ASSIGN_DRIVER", "START_TO_PICKUP", "MARK_ARRIVED_PICKUP", "MARK_PICKED_UP",
    "START_TO_DROPOFF", "START_IN_PROGRESS", "MARK_ARRIVED_DROPOFF",
    "MARK_COMPLETE", "CANCEL_TRIP", "MARK_NO_SHOW",
  ])("has %s", (event) => {
    expect(TripEvent).toHaveProperty(event, event);
  });
});
