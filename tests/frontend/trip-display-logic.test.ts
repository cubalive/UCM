import { describe, it, expect } from "vitest";
import {
  TripState,
  TripEvent,
  transition,
  derivePhase,
  uiActions,
  getNavTarget,
  getNavLabel,
  isTerminal,
  ACTIVE_NOW_STATUSES,
  TERMINAL_STATUSES,
  eventToTargetStatus,
  STATUS_TIMESTAMP_MAP,
  InvalidTransitionError,
  allowedEvents,
} from "@shared/tripStateMachine";

// ── Status display mappings (mirrors what UI components use) ──────
const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "blue",
  ASSIGNED: "indigo",
  EN_ROUTE_TO_PICKUP: "orange",
  ARRIVED_PICKUP: "yellow",
  PICKED_UP: "teal",
  EN_ROUTE_TO_DROPOFF: "orange",
  IN_PROGRESS: "purple",
  ARRIVED_DROPOFF: "yellow",
  COMPLETED: "green",
  CANCELLED: "red",
  NO_SHOW: "gray",
};

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  ASSIGNED: "Assigned",
  EN_ROUTE_TO_PICKUP: "En Route to Pickup",
  ARRIVED_PICKUP: "Arrived at Pickup",
  PICKED_UP: "Picked Up",
  EN_ROUTE_TO_DROPOFF: "En Route to Dropoff",
  IN_PROGRESS: "In Progress",
  ARRIVED_DROPOFF: "Arrived at Dropoff",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
};

const PHASE_PROGRESS: Record<string, number> = {
  PICKUP: 33,
  DROPOFF: 66,
  DONE: 100,
};

describe("Trip Display Logic", () => {
  // ── TripCard status rendering ─────────────────────────────────────
  describe("TripCard status color mapping", () => {
    for (const [status, color] of Object.entries(STATUS_COLORS)) {
      it(`${status} maps to ${color}`, () => {
        expect(STATUS_COLORS[status]).toBe(color);
        // Verify the status exists in TripState
        expect(Object.values(TripState)).toContain(status);
      });
    }

    it("every TripState has a color", () => {
      for (const state of Object.values(TripState)) {
        expect(STATUS_COLORS[state]).toBeDefined();
      }
    });

    it("every TripState has a label", () => {
      for (const state of Object.values(TripState)) {
        expect(STATUS_LABELS[state]).toBeDefined();
      }
    });
  });

  // ── Terminal state styling ────────────────────────────────────────
  describe("Status badge: terminal states show different styling", () => {
    it("COMPLETED is terminal", () => {
      expect(isTerminal(TripState.COMPLETED)).toBe(true);
    });

    it("CANCELLED is terminal", () => {
      expect(isTerminal(TripState.CANCELLED)).toBe(true);
    });

    it("NO_SHOW is terminal", () => {
      expect(isTerminal(TripState.NO_SHOW)).toBe(true);
    });

    it("SCHEDULED is not terminal", () => {
      expect(isTerminal(TripState.SCHEDULED)).toBe(false);
    });

    it("EN_ROUTE_TO_PICKUP is not terminal", () => {
      expect(isTerminal(TripState.EN_ROUTE_TO_PICKUP)).toBe(false);
    });

    it("IN_PROGRESS is not terminal", () => {
      expect(isTerminal(TripState.IN_PROGRESS)).toBe(false);
    });

    it("TERMINAL_STATUSES constant matches isTerminal()", () => {
      for (const status of TERMINAL_STATUSES) {
        expect(isTerminal(status)).toBe(true);
      }
    });

    it("ACTIVE_NOW_STATUSES are all non-terminal", () => {
      for (const status of ACTIVE_NOW_STATUSES) {
        expect(isTerminal(status)).toBe(false);
      }
    });
  });

  // ── Driver action buttons per state ───────────────────────────────
  describe("Driver action buttons per state", () => {
    it("SCHEDULED shows 'Accept & Start Trip'", () => {
      const { statusAction } = uiActions(TripState.SCHEDULED);
      expect(statusAction).not.toBeNull();
      expect(statusAction!.label).toBe("Accept & Start Trip");
      expect(statusAction!.event).toBe(TripEvent.START_TO_PICKUP);
    });

    it("ASSIGNED shows 'Go to Pickup'", () => {
      const { statusAction } = uiActions(TripState.ASSIGNED);
      expect(statusAction).not.toBeNull();
      expect(statusAction!.label).toBe("Go to Pickup");
    });

    it("EN_ROUTE_TO_PICKUP shows 'Mark Arrived at Pickup'", () => {
      const { statusAction } = uiActions(TripState.EN_ROUTE_TO_PICKUP);
      expect(statusAction!.label).toBe("Mark Arrived at Pickup");
    });

    it("ARRIVED_PICKUP shows 'Picked Up Patient'", () => {
      const { statusAction } = uiActions(TripState.ARRIVED_PICKUP);
      expect(statusAction!.label).toBe("Picked Up Patient");
    });

    it("PICKED_UP shows 'Start Trip to Dropoff'", () => {
      const { statusAction } = uiActions(TripState.PICKED_UP);
      expect(statusAction!.label).toBe("Start Trip to Dropoff");
    });

    it("EN_ROUTE_TO_DROPOFF shows 'Mark Arrived at Dropoff'", () => {
      const { statusAction } = uiActions(TripState.EN_ROUTE_TO_DROPOFF);
      expect(statusAction!.label).toBe("Mark Arrived at Dropoff");
    });

    it("IN_PROGRESS shows 'Complete Trip'", () => {
      const { statusAction } = uiActions(TripState.IN_PROGRESS);
      expect(statusAction!.label).toBe("Complete Trip");
    });

    it("ARRIVED_DROPOFF shows 'Complete Trip'", () => {
      const { statusAction } = uiActions(TripState.ARRIVED_DROPOFF);
      expect(statusAction!.label).toBe("Complete Trip");
    });

    it("COMPLETED has no status action", () => {
      const { statusAction } = uiActions(TripState.COMPLETED);
      expect(statusAction).toBeNull();
    });

    it("CANCELLED has no status action", () => {
      const { statusAction } = uiActions(TripState.CANCELLED);
      expect(statusAction).toBeNull();
    });

    it("NO_SHOW has no status action", () => {
      const { statusAction } = uiActions(TripState.NO_SHOW);
      expect(statusAction).toBeNull();
    });

    it("all non-terminal states have enabled actions", () => {
      const nonTerminalStates = Object.values(TripState).filter(
        (s) => !isTerminal(s)
      );
      for (const state of nonTerminalStates) {
        const { statusAction } = uiActions(state);
        expect(statusAction).not.toBeNull();
        expect(statusAction!.enabled).toBe(true);
      }
    });
  });

  // ── Progress indicator: phase mapping ─────────────────────────────
  describe("Progress indicator phase mapping", () => {
    it("SCHEDULED is in PICKUP phase (33%)", () => {
      expect(derivePhase(TripState.SCHEDULED)).toBe("PICKUP");
      expect(PHASE_PROGRESS[derivePhase(TripState.SCHEDULED)]).toBe(33);
    });

    it("ASSIGNED is in PICKUP phase", () => {
      expect(derivePhase(TripState.ASSIGNED)).toBe("PICKUP");
    });

    it("EN_ROUTE_TO_PICKUP is in PICKUP phase", () => {
      expect(derivePhase(TripState.EN_ROUTE_TO_PICKUP)).toBe("PICKUP");
    });

    it("ARRIVED_PICKUP is in PICKUP phase", () => {
      expect(derivePhase(TripState.ARRIVED_PICKUP)).toBe("PICKUP");
    });

    it("PICKED_UP is in DROPOFF phase (66%)", () => {
      expect(derivePhase(TripState.PICKED_UP)).toBe("DROPOFF");
      expect(PHASE_PROGRESS[derivePhase(TripState.PICKED_UP)]).toBe(66);
    });

    it("EN_ROUTE_TO_DROPOFF is in DROPOFF phase", () => {
      expect(derivePhase(TripState.EN_ROUTE_TO_DROPOFF)).toBe("DROPOFF");
    });

    it("IN_PROGRESS is in DROPOFF phase", () => {
      expect(derivePhase(TripState.IN_PROGRESS)).toBe("DROPOFF");
    });

    it("ARRIVED_DROPOFF is in DROPOFF phase", () => {
      expect(derivePhase(TripState.ARRIVED_DROPOFF)).toBe("DROPOFF");
    });

    it("COMPLETED is in DONE phase (100%)", () => {
      expect(derivePhase(TripState.COMPLETED)).toBe("DONE");
      expect(PHASE_PROGRESS[derivePhase(TripState.COMPLETED)]).toBe(100);
    });

    it("CANCELLED is in DONE phase", () => {
      expect(derivePhase(TripState.CANCELLED)).toBe("DONE");
    });

    it("NO_SHOW is in DONE phase", () => {
      expect(derivePhase(TripState.NO_SHOW)).toBe("DONE");
    });
  });

  // ── Trip timeline timestamp field mapping ─────────────────────────
  describe("Trip timeline timestamp field mapping", () => {
    it("EN_ROUTE_TO_PICKUP maps to startedAt", () => {
      expect(STATUS_TIMESTAMP_MAP["EN_ROUTE_TO_PICKUP"]).toBe("startedAt");
    });

    it("ARRIVED_PICKUP maps to arrivedPickupAt", () => {
      expect(STATUS_TIMESTAMP_MAP["ARRIVED_PICKUP"]).toBe("arrivedPickupAt");
    });

    it("PICKED_UP maps to pickedUpAt", () => {
      expect(STATUS_TIMESTAMP_MAP["PICKED_UP"]).toBe("pickedUpAt");
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

  // ── Navigation button target per state ────────────────────────────
  describe("Navigation button target per state", () => {
    it("PICKUP phase states navigate to pickup", () => {
      expect(getNavTarget(TripState.SCHEDULED)).toBe("pickup");
      expect(getNavTarget(TripState.ASSIGNED)).toBe("pickup");
      expect(getNavTarget(TripState.EN_ROUTE_TO_PICKUP)).toBe("pickup");
      expect(getNavTarget(TripState.ARRIVED_PICKUP)).toBe("pickup");
    });

    it("DROPOFF phase states navigate to dropoff", () => {
      expect(getNavTarget(TripState.PICKED_UP)).toBe("dropoff");
      expect(getNavTarget(TripState.EN_ROUTE_TO_DROPOFF)).toBe("dropoff");
      expect(getNavTarget(TripState.IN_PROGRESS)).toBe("dropoff");
      expect(getNavTarget(TripState.ARRIVED_DROPOFF)).toBe("dropoff");
    });

    it("DONE phase states have no navigation", () => {
      expect(getNavTarget(TripState.COMPLETED)).toBeNull();
      expect(getNavTarget(TripState.CANCELLED)).toBeNull();
      expect(getNavTarget(TripState.NO_SHOW)).toBeNull();
    });

    it("PICKUP phase shows 'Go to Pickup' label", () => {
      expect(getNavLabel(TripState.SCHEDULED)).toBe("Go to Pickup");
    });

    it("DROPOFF phase shows 'Go to Dropoff' label", () => {
      expect(getNavLabel(TripState.PICKED_UP)).toBe("Go to Dropoff");
    });

    it("DONE phase shows empty label", () => {
      expect(getNavLabel(TripState.COMPLETED)).toBe("");
    });
  });

  // ── eventToTargetStatus ───────────────────────────────────────────
  describe("eventToTargetStatus", () => {
    it("returns correct target for valid transition", () => {
      expect(eventToTargetStatus(TripEvent.START_TO_PICKUP, TripState.SCHEDULED)).toBe(
        TripState.EN_ROUTE_TO_PICKUP
      );
    });

    it("returns null for invalid transition", () => {
      expect(eventToTargetStatus(TripEvent.MARK_COMPLETE, TripState.SCHEDULED)).toBeNull();
    });

    it("CANCEL_TRIP always targets CANCELLED from non-terminal states", () => {
      const cancelable = [
        TripState.SCHEDULED,
        TripState.ASSIGNED,
        TripState.EN_ROUTE_TO_PICKUP,
        TripState.ARRIVED_PICKUP,
        TripState.PICKED_UP,
        TripState.EN_ROUTE_TO_DROPOFF,
        TripState.IN_PROGRESS,
        TripState.ARRIVED_DROPOFF,
      ];
      for (const state of cancelable) {
        expect(eventToTargetStatus(TripEvent.CANCEL_TRIP, state)).toBe(TripState.CANCELLED);
      }
    });
  });

  // ── State transition validation ───────────────────────────────────
  describe("State transitions for UI flow", () => {
    it("full happy path: SCHEDULED -> COMPLETED", () => {
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
    });

    it("invalid transition throws InvalidTransitionError", () => {
      expect(() =>
        transition(TripState.COMPLETED, TripEvent.START_TO_PICKUP)
      ).toThrow(InvalidTransitionError);
    });

    it("NO_SHOW from ARRIVED_PICKUP", () => {
      const state = transition(TripState.ARRIVED_PICKUP, TripEvent.MARK_NO_SHOW);
      expect(state).toBe(TripState.NO_SHOW);
    });
  });
});
