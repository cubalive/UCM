import { describe, it, expect } from "vitest";

// Replicate the state machine from tripService to test in isolation
const VALID_TRANSITIONS: Record<string, string[]> = {
  requested: ["assigned", "cancelled"],
  assigned: ["en_route", "cancelled", "requested"],
  en_route: ["arrived", "cancelled", "assigned"],
  arrived: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

describe("Trip State Machine", () => {
  describe("valid transitions", () => {
    const valid: [string, string][] = [
      ["requested", "assigned"],
      ["requested", "cancelled"],
      ["assigned", "en_route"],
      ["assigned", "cancelled"],
      ["assigned", "requested"], // decline → back to pool
      ["en_route", "arrived"],
      ["en_route", "cancelled"],
      ["en_route", "assigned"],  // reassignment
      ["arrived", "in_progress"],
      ["arrived", "cancelled"],
      ["in_progress", "completed"],
      ["in_progress", "cancelled"],
    ];

    valid.forEach(([from, to]) => {
      it(`allows ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(true);
      });
    });
  });

  describe("invalid transitions", () => {
    const invalid: [string, string][] = [
      ["requested", "completed"],
      ["requested", "in_progress"],
      ["requested", "arrived"],
      ["requested", "en_route"],
      ["assigned", "completed"],
      ["assigned", "in_progress"],
      ["assigned", "arrived"],
      ["en_route", "completed"],
      ["en_route", "in_progress"],
      ["en_route", "requested"],
      ["arrived", "completed"],
      ["arrived", "requested"],
      ["arrived", "assigned"],
      ["completed", "cancelled"],
      ["completed", "requested"],
      ["completed", "assigned"],
      ["cancelled", "requested"],
      ["cancelled", "assigned"],
      ["cancelled", "completed"],
    ];

    invalid.forEach(([from, to]) => {
      it(`blocks ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(false);
      });
    });
  });

  describe("terminal states", () => {
    it("completed has no valid transitions", () => {
      expect(VALID_TRANSITIONS["completed"]).toHaveLength(0);
    });
    it("cancelled has no valid transitions", () => {
      expect(VALID_TRANSITIONS["cancelled"]).toHaveLength(0);
    });
  });

  describe("unknown states", () => {
    it("returns false for unknown source state", () => {
      expect(canTransition("nonexistent", "assigned")).toBe(false);
    });
    it("returns false for unknown target state", () => {
      expect(canTransition("requested", "nonexistent")).toBe(false);
    });
  });

  describe("all states have defined transitions", () => {
    const allStates = ["requested", "assigned", "en_route", "arrived", "in_progress", "completed", "cancelled"];
    allStates.forEach((state) => {
      it(`${state} is a defined state`, () => {
        expect(VALID_TRANSITIONS).toHaveProperty(state);
        expect(Array.isArray(VALID_TRANSITIONS[state])).toBe(true);
      });
    });
  });

  describe("cancellation is always reachable from active states", () => {
    const activeStates = ["requested", "assigned", "en_route", "arrived", "in_progress"];
    activeStates.forEach((state) => {
      it(`${state} can transition to cancelled`, () => {
        expect(canTransition(state, "cancelled")).toBe(true);
      });
    });
  });
});
