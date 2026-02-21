import { describe, it, expect } from "vitest";
import {
  TripState,
  TripEvent,
  transition,
  allowedEvents,
  isTerminal,
  derivePhase,
  deriveStateFromTrip,
  uiActions,
  getNavLabel,
  InvalidTransitionError,
  VALID_TRANSITIONS,
  STATUS_TIMESTAMP_MAP,
  getNavTarget,
} from "./tripStateMachine";

describe("TripStateMachine", () => {
  describe("transition()", () => {
    it("SCHEDULED -> ASSIGNED via ASSIGN_DRIVER", () => {
      expect(transition(TripState.SCHEDULED, TripEvent.ASSIGN_DRIVER)).toBe(TripState.ASSIGNED);
    });

    it("ASSIGNED -> EN_ROUTE_TO_PICKUP via START_TO_PICKUP", () => {
      expect(transition(TripState.ASSIGNED, TripEvent.START_TO_PICKUP)).toBe(TripState.EN_ROUTE_TO_PICKUP);
    });

    it("EN_ROUTE_TO_PICKUP -> ARRIVED_PICKUP via MARK_ARRIVED_PICKUP", () => {
      expect(transition(TripState.EN_ROUTE_TO_PICKUP, TripEvent.MARK_ARRIVED_PICKUP)).toBe(TripState.ARRIVED_PICKUP);
    });

    it("ARRIVED_PICKUP -> PICKED_UP via MARK_PICKED_UP", () => {
      expect(transition(TripState.ARRIVED_PICKUP, TripEvent.MARK_PICKED_UP)).toBe(TripState.PICKED_UP);
    });

    it("PICKED_UP -> EN_ROUTE_TO_DROPOFF via START_TO_DROPOFF", () => {
      expect(transition(TripState.PICKED_UP, TripEvent.START_TO_DROPOFF)).toBe(TripState.EN_ROUTE_TO_DROPOFF);
    });

    it("EN_ROUTE_TO_DROPOFF -> ARRIVED_DROPOFF via MARK_ARRIVED_DROPOFF", () => {
      expect(transition(TripState.EN_ROUTE_TO_DROPOFF, TripEvent.MARK_ARRIVED_DROPOFF)).toBe(TripState.ARRIVED_DROPOFF);
    });

    it("ARRIVED_DROPOFF -> COMPLETED via MARK_COMPLETE", () => {
      expect(transition(TripState.ARRIVED_DROPOFF, TripEvent.MARK_COMPLETE)).toBe(TripState.COMPLETED);
    });

    it("ARRIVED_PICKUP -> NO_SHOW via MARK_NO_SHOW", () => {
      expect(transition(TripState.ARRIVED_PICKUP, TripEvent.MARK_NO_SHOW)).toBe(TripState.NO_SHOW);
    });

    it("PICKED_UP -> IN_PROGRESS via START_IN_PROGRESS", () => {
      expect(transition(TripState.PICKED_UP, TripEvent.START_IN_PROGRESS)).toBe(TripState.IN_PROGRESS);
    });

    it("IN_PROGRESS -> COMPLETED via MARK_COMPLETE", () => {
      expect(transition(TripState.IN_PROGRESS, TripEvent.MARK_COMPLETE)).toBe(TripState.COMPLETED);
    });

    it("every non-terminal state can be cancelled", () => {
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
      for (const state of nonTerminal) {
        expect(transition(state, TripEvent.CANCEL_TRIP)).toBe(TripState.CANCELLED);
      }
    });
  });

  describe("invalid transitions throw InvalidTransitionError", () => {
    it("cannot go from SCHEDULED directly to PICKED_UP", () => {
      expect(() => transition(TripState.SCHEDULED, TripEvent.MARK_PICKED_UP)).toThrow(InvalidTransitionError);
    });

    it("cannot go from ASSIGNED directly to ARRIVED_DROPOFF", () => {
      expect(() => transition(TripState.ASSIGNED, TripEvent.MARK_ARRIVED_DROPOFF)).toThrow(InvalidTransitionError);
    });

    it("cannot go from COMPLETED to anything", () => {
      expect(() => transition(TripState.COMPLETED, TripEvent.START_TO_PICKUP)).toThrow(InvalidTransitionError);
      expect(() => transition(TripState.COMPLETED, TripEvent.CANCEL_TRIP)).toThrow(InvalidTransitionError);
    });

    it("cannot go from CANCELLED to anything", () => {
      expect(() => transition(TripState.CANCELLED, TripEvent.MARK_COMPLETE)).toThrow(InvalidTransitionError);
    });

    it("cannot go from NO_SHOW to anything", () => {
      expect(() => transition(TripState.NO_SHOW, TripEvent.MARK_COMPLETE)).toThrow(InvalidTransitionError);
    });

    it("cannot skip pickup phase (ASSIGNED -> EN_ROUTE_TO_DROPOFF)", () => {
      expect(() => transition(TripState.ASSIGNED, TripEvent.START_TO_DROPOFF)).toThrow(InvalidTransitionError);
    });

    it("cannot skip arrival (EN_ROUTE_TO_PICKUP -> PICKED_UP)", () => {
      expect(() => transition(TripState.EN_ROUTE_TO_PICKUP, TripEvent.MARK_PICKED_UP)).toThrow(InvalidTransitionError);
    });

    it("cannot complete from EN_ROUTE_TO_PICKUP", () => {
      expect(() => transition(TripState.EN_ROUTE_TO_PICKUP, TripEvent.MARK_COMPLETE)).toThrow(InvalidTransitionError);
    });

    it("throws with correct error properties", () => {
      try {
        transition(TripState.SCHEDULED, TripEvent.MARK_COMPLETE);
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e).toBeInstanceOf(InvalidTransitionError);
        expect(e.fromState).toBe("SCHEDULED");
        expect(e.event).toBe("MARK_COMPLETE");
      }
    });
  });

  describe("allowedEvents()", () => {
    it("SCHEDULED allows ASSIGN_DRIVER and CANCEL_TRIP", () => {
      const events = allowedEvents(TripState.SCHEDULED);
      expect(events).toContain(TripEvent.ASSIGN_DRIVER);
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

    it("terminal states have no allowed events", () => {
      expect(allowedEvents(TripState.COMPLETED)).toHaveLength(0);
      expect(allowedEvents(TripState.CANCELLED)).toHaveLength(0);
      expect(allowedEvents(TripState.NO_SHOW)).toHaveLength(0);
    });

    it("every state has defined allowed events", () => {
      const allStates = Object.values(TripState);
      for (const state of allStates) {
        const events = allowedEvents(state);
        expect(Array.isArray(events)).toBe(true);
      }
    });
  });

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
    it("ASSIGNED is not terminal", () => {
      expect(isTerminal(TripState.ASSIGNED)).toBe(false);
    });
    it("SCHEDULED is not terminal", () => {
      expect(isTerminal(TripState.SCHEDULED)).toBe(false);
    });
  });

  describe("derivePhase()", () => {
    it("pickup phases", () => {
      expect(derivePhase(TripState.SCHEDULED)).toBe("PICKUP");
      expect(derivePhase(TripState.ASSIGNED)).toBe("PICKUP");
      expect(derivePhase(TripState.EN_ROUTE_TO_PICKUP)).toBe("PICKUP");
      expect(derivePhase(TripState.ARRIVED_PICKUP)).toBe("PICKUP");
    });

    it("dropoff phases", () => {
      expect(derivePhase(TripState.PICKED_UP)).toBe("DROPOFF");
      expect(derivePhase(TripState.EN_ROUTE_TO_DROPOFF)).toBe("DROPOFF");
      expect(derivePhase(TripState.ARRIVED_DROPOFF)).toBe("DROPOFF");
      expect(derivePhase(TripState.IN_PROGRESS)).toBe("DROPOFF");
    });

    it("done phases", () => {
      expect(derivePhase(TripState.COMPLETED)).toBe("DONE");
      expect(derivePhase(TripState.CANCELLED)).toBe("DONE");
      expect(derivePhase(TripState.NO_SHOW)).toBe("DONE");
    });
  });

  describe("deriveStateFromTrip()", () => {
    it("maps known statuses correctly", () => {
      expect(deriveStateFromTrip({ status: "ASSIGNED" })).toBe(TripState.ASSIGNED);
      expect(deriveStateFromTrip({ status: "COMPLETED" })).toBe(TripState.COMPLETED);
      expect(deriveStateFromTrip({ status: "EN_ROUTE_TO_PICKUP" })).toBe(TripState.EN_ROUTE_TO_PICKUP);
    });

    it("defaults unknown status to SCHEDULED", () => {
      expect(deriveStateFromTrip({ status: "UNKNOWN_STATUS" })).toBe(TripState.SCHEDULED);
    });
  });

  describe("uiActions()", () => {
    it("ASSIGNED has status action Go to Pickup + nav to pickup", () => {
      const { statusAction, navAction } = uiActions(TripState.ASSIGNED);
      expect(statusAction).not.toBeNull();
      expect(statusAction!.label).toBe("Go to Pickup");
      expect(statusAction!.targetStatus).toBe(TripState.EN_ROUTE_TO_PICKUP);
      expect(navAction).not.toBeNull();
      expect(navAction!.target).toBe("pickup");
    });

    it("EN_ROUTE_TO_PICKUP has Mark Arrived at Pickup + nav to pickup", () => {
      const { statusAction, navAction } = uiActions(TripState.EN_ROUTE_TO_PICKUP);
      expect(statusAction!.label).toBe("Mark Arrived at Pickup");
      expect(statusAction!.targetStatus).toBe(TripState.ARRIVED_PICKUP);
      expect(navAction!.target).toBe("pickup");
    });

    it("ARRIVED_PICKUP has Picked Up Patient + nav to pickup", () => {
      const { statusAction, navAction } = uiActions(TripState.ARRIVED_PICKUP);
      expect(statusAction!.label).toBe("Picked Up Patient");
      expect(navAction!.target).toBe("pickup");
    });

    it("PICKED_UP has Start Trip to Dropoff + nav to dropoff", () => {
      const { statusAction, navAction } = uiActions(TripState.PICKED_UP);
      expect(statusAction!.label).toBe("Start Trip to Dropoff");
      expect(navAction!.target).toBe("dropoff");
    });

    it("EN_ROUTE_TO_DROPOFF has Mark Arrived at Dropoff + nav to dropoff", () => {
      const { statusAction, navAction } = uiActions(TripState.EN_ROUTE_TO_DROPOFF);
      expect(statusAction!.label).toBe("Mark Arrived at Dropoff");
      expect(navAction!.target).toBe("dropoff");
    });

    it("ARRIVED_DROPOFF has Complete Trip + nav to dropoff", () => {
      const { statusAction, navAction } = uiActions(TripState.ARRIVED_DROPOFF);
      expect(statusAction!.label).toBe("Complete Trip");
      expect(navAction!.target).toBe("dropoff");
    });

    it("COMPLETED has no actions", () => {
      const { statusAction, navAction } = uiActions(TripState.COMPLETED);
      expect(statusAction).toBeNull();
      expect(navAction).toBeNull();
    });

    it("CANCELLED has no actions", () => {
      const { statusAction, navAction } = uiActions(TripState.CANCELLED);
      expect(statusAction).toBeNull();
      expect(navAction).toBeNull();
    });
  });

  describe("getNavLabel()", () => {
    it("pickup phase states return Go to Pickup", () => {
      expect(getNavLabel(TripState.ASSIGNED)).toBe("Go to Pickup");
      expect(getNavLabel(TripState.EN_ROUTE_TO_PICKUP)).toBe("Go to Pickup");
      expect(getNavLabel(TripState.ARRIVED_PICKUP)).toBe("Go to Pickup");
    });

    it("dropoff phase states return Go to Dropoff", () => {
      expect(getNavLabel(TripState.PICKED_UP)).toBe("Go to Dropoff");
      expect(getNavLabel(TripState.EN_ROUTE_TO_DROPOFF)).toBe("Go to Dropoff");
      expect(getNavLabel(TripState.ARRIVED_DROPOFF)).toBe("Go to Dropoff");
    });

    it("done states return empty string", () => {
      expect(getNavLabel(TripState.COMPLETED)).toBe("");
      expect(getNavLabel(TripState.CANCELLED)).toBe("");
    });
  });

  describe("VALID_TRANSITIONS (server compat)", () => {
    it("has entries for all states", () => {
      const allStates = Object.values(TripState);
      for (const state of allStates) {
        expect(VALID_TRANSITIONS).toHaveProperty(state);
      }
    });

    it("terminal states have empty arrays", () => {
      expect(VALID_TRANSITIONS[TripState.COMPLETED]).toEqual([]);
      expect(VALID_TRANSITIONS[TripState.CANCELLED]).toEqual([]);
      expect(VALID_TRANSITIONS[TripState.NO_SHOW]).toEqual([]);
    });

    it("ASSIGNED allows EN_ROUTE_TO_PICKUP and CANCELLED", () => {
      expect(VALID_TRANSITIONS[TripState.ASSIGNED]).toContain(TripState.EN_ROUTE_TO_PICKUP);
      expect(VALID_TRANSITIONS[TripState.ASSIGNED]).toContain(TripState.CANCELLED);
    });
  });

  describe("STATUS_TIMESTAMP_MAP", () => {
    it("maps EN_ROUTE_TO_PICKUP to startedAt", () => {
      expect(STATUS_TIMESTAMP_MAP["EN_ROUTE_TO_PICKUP"]).toBe("startedAt");
    });
    it("maps COMPLETED to completedAt", () => {
      expect(STATUS_TIMESTAMP_MAP["COMPLETED"]).toBe("completedAt");
    });
    it("maps CANCELLED to cancelledAt", () => {
      expect(STATUS_TIMESTAMP_MAP["CANCELLED"]).toBe("cancelledAt");
    });
    it("maps NO_SHOW to cancelledAt", () => {
      expect(STATUS_TIMESTAMP_MAP["NO_SHOW"]).toBe("cancelledAt");
    });
  });

  describe("full trip lifecycle (no jumps)", () => {
    it("completes happy path without skipping any state", () => {
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

    it("no-show path terminates correctly", () => {
      let state: string = TripState.SCHEDULED;
      state = transition(state, TripEvent.ASSIGN_DRIVER);
      state = transition(state, TripEvent.START_TO_PICKUP);
      state = transition(state, TripEvent.MARK_ARRIVED_PICKUP);
      state = transition(state, TripEvent.MARK_NO_SHOW);
      expect(state).toBe(TripState.NO_SHOW);
      expect(isTerminal(state)).toBe(true);
    });

    it("cancellation from mid-trip terminates correctly", () => {
      let state: string = TripState.PICKED_UP;
      state = transition(state, TripEvent.CANCEL_TRIP);
      expect(state).toBe(TripState.CANCELLED);
      expect(isTerminal(state)).toBe(true);
    });
  });

  describe("getNavTarget()", () => {
    it("returns pickup for pickup-phase statuses", () => {
      expect(getNavTarget(TripState.ASSIGNED)).toBe("pickup");
      expect(getNavTarget(TripState.EN_ROUTE_TO_PICKUP)).toBe("pickup");
      expect(getNavTarget(TripState.ARRIVED_PICKUP)).toBe("pickup");
    });

    it("returns dropoff for dropoff-phase statuses", () => {
      expect(getNavTarget(TripState.PICKED_UP)).toBe("dropoff");
      expect(getNavTarget(TripState.EN_ROUTE_TO_DROPOFF)).toBe("dropoff");
      expect(getNavTarget(TripState.ARRIVED_DROPOFF)).toBe("dropoff");
    });

    it("returns null for terminal/done statuses", () => {
      expect(getNavTarget(TripState.COMPLETED)).toBeNull();
      expect(getNavTarget(TripState.CANCELLED)).toBeNull();
      expect(getNavTarget(TripState.NO_SHOW)).toBeNull();
    });
  });
});
