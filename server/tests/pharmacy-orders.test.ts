import { describe, it, expect } from "vitest";

// =========================================================
// Pharmacy Order Tests — Pure Logic (no DB)
// =========================================================

// ─── Pharmacy Order Status State Machine ─────────────────────────────────────

const PHARMACY_ORDER_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "DRIVER_ASSIGNED",
  "EN_ROUTE_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_DELIVERY",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
] as const;

type PharmacyOrderStatus = (typeof PHARMACY_ORDER_STATUSES)[number];

const PHARMACY_ORDER_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY_FOR_PICKUP", "CANCELLED"],
  READY_FOR_PICKUP: ["DRIVER_ASSIGNED", "CANCELLED"],
  DRIVER_ASSIGNED: ["EN_ROUTE_PICKUP", "CANCELLED"],
  EN_ROUTE_PICKUP: ["PICKED_UP", "FAILED", "CANCELLED"],
  PICKED_UP: ["EN_ROUTE_DELIVERY", "FAILED", "CANCELLED"],
  EN_ROUTE_DELIVERY: ["DELIVERED", "FAILED", "CANCELLED"],
  DELIVERED: [],
  FAILED: [],
  CANCELLED: [],
};

function pharmacyTransition(current: string, next: string): boolean {
  const allowed = PHARMACY_ORDER_TRANSITIONS[current];
  if (!allowed) return false;
  return allowed.includes(next);
}

function isPharmacyTerminal(status: string): boolean {
  return (PHARMACY_ORDER_TRANSITIONS[status] || []).length === 0;
}

// ─── Temperature Requirement Validation ──────────────────────────────────────

const TEMPERATURE_REQUIREMENTS = ["AMBIENT", "REFRIGERATED", "FROZEN", "CONTROLLED"] as const;
type TemperatureRequirement = (typeof TEMPERATURE_REQUIREMENTS)[number];

interface PharmacyOrderItem {
  medicationName: string;
  isControlled: boolean;
  scheduleClass: string | null;
  requiresRefrigeration: boolean;
  quantity: number;
}

function deriveTemperatureRequirement(items: PharmacyOrderItem[]): TemperatureRequirement {
  let needsFrozen = false;
  let needsRefrigerated = false;
  let needsControlled = false;

  for (const item of items) {
    if (item.isControlled) needsControlled = true;
    if (item.requiresRefrigeration) needsRefrigerated = true;
  }

  if (needsControlled) return "CONTROLLED";
  if (needsFrozen) return "FROZEN";
  if (needsRefrigerated) return "REFRIGERATED";
  return "AMBIENT";
}

// ─── Controlled Substance Handling ───────────────────────────────────────────

const SCHEDULE_CLASSES = ["II", "III", "IV", "V"] as const;

interface ControlledSubstanceCheck {
  hasControlled: boolean;
  requiresIdVerification: boolean;
  requiresSignature: boolean;
  highestSchedule: string | null;
  chainOfCustodyRequired: boolean;
}

function checkControlledSubstances(items: PharmacyOrderItem[]): ControlledSubstanceCheck {
  const controlledItems = items.filter(i => i.isControlled);
  if (controlledItems.length === 0) {
    return {
      hasControlled: false,
      requiresIdVerification: false,
      requiresSignature: false,
      highestSchedule: null,
      chainOfCustodyRequired: false,
    };
  }

  const schedules = controlledItems
    .map(i => i.scheduleClass)
    .filter((s): s is string => s !== null);

  const scheduleOrder = ["II", "III", "IV", "V"];
  let highestSchedule: string | null = null;
  for (const sched of scheduleOrder) {
    if (schedules.includes(sched)) {
      highestSchedule = sched;
      break;
    }
  }

  const isScheduleII = schedules.includes("II");

  return {
    hasControlled: true,
    requiresIdVerification: true,
    requiresSignature: true,
    highestSchedule,
    chainOfCustodyRequired: isScheduleII,
  };
}

// ─── Priority Rules ──────────────────────────────────────────────────────────

const PRIORITY_LEVELS = ["STANDARD", "EXPRESS", "URGENT", "STAT"] as const;
type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

function getDeliveryWindowMinutes(priority: PriorityLevel): number {
  switch (priority) {
    case "STAT": return 60;
    case "URGENT": return 120;
    case "EXPRESS": return 240;
    case "STANDARD": return 480;
  }
}

function isOverdue(priority: PriorityLevel, createdAt: Date, now: Date): boolean {
  const windowMs = getDeliveryWindowMinutes(priority) * 60 * 1000;
  return now.getTime() - createdAt.getTime() > windowMs;
}

// ─── Public ID Generation ────────────────────────────────────────────────────

function generatePublicId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "RX-";
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// =========================================================
// Tests
// =========================================================

describe("Pharmacy Orders — Status State Machine", () => {
  describe("happy path lifecycle", () => {
    it("follows full happy path: PENDING → CONFIRMED → PREPARING → READY_FOR_PICKUP → DRIVER_ASSIGNED → EN_ROUTE_PICKUP → PICKED_UP → EN_ROUTE_DELIVERY → DELIVERED", () => {
      const path: string[] = [
        "PENDING", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP",
        "DRIVER_ASSIGNED", "EN_ROUTE_PICKUP", "PICKED_UP",
        "EN_ROUTE_DELIVERY", "DELIVERED",
      ];

      for (let i = 0; i < path.length - 1; i++) {
        expect(pharmacyTransition(path[i], path[i + 1])).toBe(true);
      }
    });

    it("DELIVERED is terminal", () => {
      expect(isPharmacyTerminal("DELIVERED")).toBe(true);
    });
  });

  describe("cancellation", () => {
    const cancellableStates = [
      "PENDING", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP",
      "DRIVER_ASSIGNED", "EN_ROUTE_PICKUP", "PICKED_UP", "EN_ROUTE_DELIVERY",
    ];

    for (const state of cancellableStates) {
      it(`allows cancellation from ${state}`, () => {
        expect(pharmacyTransition(state, "CANCELLED")).toBe(true);
      });
    }

    it("CANCELLED is terminal", () => {
      expect(isPharmacyTerminal("CANCELLED")).toBe(true);
    });
  });

  describe("failure", () => {
    it("allows FAILED from EN_ROUTE_PICKUP", () => {
      expect(pharmacyTransition("EN_ROUTE_PICKUP", "FAILED")).toBe(true);
    });

    it("allows FAILED from PICKED_UP", () => {
      expect(pharmacyTransition("PICKED_UP", "FAILED")).toBe(true);
    });

    it("allows FAILED from EN_ROUTE_DELIVERY", () => {
      expect(pharmacyTransition("EN_ROUTE_DELIVERY", "FAILED")).toBe(true);
    });

    it("FAILED is terminal", () => {
      expect(isPharmacyTerminal("FAILED")).toBe(true);
    });

    it("does not allow FAILED from PENDING", () => {
      expect(pharmacyTransition("PENDING", "FAILED")).toBe(false);
    });
  });

  describe("invalid transitions", () => {
    it("cannot skip from PENDING to READY_FOR_PICKUP", () => {
      expect(pharmacyTransition("PENDING", "READY_FOR_PICKUP")).toBe(false);
    });

    it("cannot go backwards from CONFIRMED to PENDING", () => {
      expect(pharmacyTransition("CONFIRMED", "PENDING")).toBe(false);
    });

    it("cannot transition from DELIVERED", () => {
      expect(pharmacyTransition("DELIVERED", "PENDING")).toBe(false);
      expect(pharmacyTransition("DELIVERED", "CANCELLED")).toBe(false);
    });

    it("cannot transition from CANCELLED", () => {
      expect(pharmacyTransition("CANCELLED", "CONFIRMED")).toBe(false);
    });

    it("cannot skip from PENDING to DELIVERED", () => {
      expect(pharmacyTransition("PENDING", "DELIVERED")).toBe(false);
    });
  });
});

describe("Pharmacy Orders — Controlled Substance Handling", () => {
  it("no controlled substances returns all false", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "Amoxicillin", isControlled: false, scheduleClass: null, requiresRefrigeration: false, quantity: 1 },
    ];
    const result = checkControlledSubstances(items);
    expect(result.hasControlled).toBe(false);
    expect(result.requiresIdVerification).toBe(false);
    expect(result.requiresSignature).toBe(false);
    expect(result.highestSchedule).toBeNull();
    expect(result.chainOfCustodyRequired).toBe(false);
  });

  it("Schedule II substance requires chain of custody", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "Oxycodone", isControlled: true, scheduleClass: "II", requiresRefrigeration: false, quantity: 1 },
    ];
    const result = checkControlledSubstances(items);
    expect(result.hasControlled).toBe(true);
    expect(result.requiresIdVerification).toBe(true);
    expect(result.requiresSignature).toBe(true);
    expect(result.highestSchedule).toBe("II");
    expect(result.chainOfCustodyRequired).toBe(true);
  });

  it("Schedule IV substance does NOT require chain of custody", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "Alprazolam", isControlled: true, scheduleClass: "IV", requiresRefrigeration: false, quantity: 1 },
    ];
    const result = checkControlledSubstances(items);
    expect(result.hasControlled).toBe(true);
    expect(result.requiresIdVerification).toBe(true);
    expect(result.requiresSignature).toBe(true);
    expect(result.highestSchedule).toBe("IV");
    expect(result.chainOfCustodyRequired).toBe(false);
  });

  it("mixed items: highest schedule wins", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "Amoxicillin", isControlled: false, scheduleClass: null, requiresRefrigeration: false, quantity: 1 },
      { medicationName: "Tramadol", isControlled: true, scheduleClass: "IV", requiresRefrigeration: false, quantity: 1 },
      { medicationName: "Oxycodone", isControlled: true, scheduleClass: "II", requiresRefrigeration: false, quantity: 1 },
    ];
    const result = checkControlledSubstances(items);
    expect(result.hasControlled).toBe(true);
    expect(result.highestSchedule).toBe("II");
    expect(result.chainOfCustodyRequired).toBe(true);
  });

  it("controlled without schedule class still requires ID and signature", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "Unknown Controlled", isControlled: true, scheduleClass: null, requiresRefrigeration: false, quantity: 1 },
    ];
    const result = checkControlledSubstances(items);
    expect(result.hasControlled).toBe(true);
    expect(result.requiresIdVerification).toBe(true);
    expect(result.requiresSignature).toBe(true);
    expect(result.highestSchedule).toBeNull();
    expect(result.chainOfCustodyRequired).toBe(false);
  });
});

describe("Pharmacy Orders — Temperature Requirement Validation", () => {
  it("ambient items default to AMBIENT", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "Ibuprofen", isControlled: false, scheduleClass: null, requiresRefrigeration: false, quantity: 1 },
    ];
    expect(deriveTemperatureRequirement(items)).toBe("AMBIENT");
  });

  it("refrigerated items require REFRIGERATED", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "Insulin", isControlled: false, scheduleClass: null, requiresRefrigeration: true, quantity: 1 },
    ];
    expect(deriveTemperatureRequirement(items)).toBe("REFRIGERATED");
  });

  it("controlled substances override to CONTROLLED", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "Oxycodone", isControlled: true, scheduleClass: "II", requiresRefrigeration: false, quantity: 1 },
    ];
    expect(deriveTemperatureRequirement(items)).toBe("CONTROLLED");
  });

  it("controlled + refrigerated resolves to CONTROLLED (higher priority)", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "Controlled Cold Med", isControlled: true, scheduleClass: "III", requiresRefrigeration: true, quantity: 1 },
    ];
    expect(deriveTemperatureRequirement(items)).toBe("CONTROLLED");
  });

  it("mixed items: highest requirement wins", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "Regular Med", isControlled: false, scheduleClass: null, requiresRefrigeration: false, quantity: 1 },
      { medicationName: "Cold Med", isControlled: false, scheduleClass: null, requiresRefrigeration: true, quantity: 1 },
    ];
    expect(deriveTemperatureRequirement(items)).toBe("REFRIGERATED");
  });

  it("empty items default to AMBIENT", () => {
    expect(deriveTemperatureRequirement([])).toBe("AMBIENT");
  });
});

describe("Pharmacy Orders — Priority & Delivery Windows", () => {
  it("STAT priority has 60-minute window", () => {
    expect(getDeliveryWindowMinutes("STAT")).toBe(60);
  });

  it("URGENT priority has 120-minute window", () => {
    expect(getDeliveryWindowMinutes("URGENT")).toBe(120);
  });

  it("EXPRESS priority has 240-minute window", () => {
    expect(getDeliveryWindowMinutes("EXPRESS")).toBe(240);
  });

  it("STANDARD priority has 480-minute window", () => {
    expect(getDeliveryWindowMinutes("STANDARD")).toBe(480);
  });

  it("detects overdue STAT order after 61 minutes", () => {
    const created = new Date("2026-03-10T10:00:00Z");
    const now = new Date("2026-03-10T11:01:00Z");
    expect(isOverdue("STAT", created, now)).toBe(true);
  });

  it("STAT order is NOT overdue within window", () => {
    const created = new Date("2026-03-10T10:00:00Z");
    const now = new Date("2026-03-10T10:59:00Z");
    expect(isOverdue("STAT", created, now)).toBe(false);
  });

  it("detects overdue STANDARD order after 8 hours", () => {
    const created = new Date("2026-03-10T08:00:00Z");
    const now = new Date("2026-03-10T16:01:00Z");
    expect(isOverdue("STANDARD", created, now)).toBe(true);
  });
});

describe("Pharmacy Orders — Public ID Generation", () => {
  it("generates IDs with RX- prefix", () => {
    const id = generatePublicId();
    expect(id.startsWith("RX-")).toBe(true);
  });

  it("generates 11-character IDs (RX- + 8 chars)", () => {
    const id = generatePublicId();
    expect(id.length).toBe(11);
  });

  it("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generatePublicId());
    }
    expect(ids.size).toBe(100);
  });

  it("uses only allowed characters (no ambiguous 0/O/1/I/L)", () => {
    const allowed = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let i = 0; i < 50; i++) {
      const id = generatePublicId();
      const suffix = id.slice(3); // remove RX-
      for (const ch of suffix) {
        expect(allowed).toContain(ch);
      }
    }
  });
});

describe("Pharmacy Orders — Order Item Validation", () => {
  function validateOrderItems(items: PharmacyOrderItem[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (items.length === 0) {
      errors.push("At least one item is required");
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.medicationName || item.medicationName.trim() === "") {
        errors.push(`Item ${i + 1}: medication name is required`);
      }
      if (item.quantity <= 0) {
        errors.push(`Item ${i + 1}: quantity must be positive`);
      }
      if (item.isControlled && !item.scheduleClass) {
        errors.push(`Item ${i + 1}: controlled substance must have a schedule class`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  it("valid items pass", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "Amoxicillin", isControlled: false, scheduleClass: null, requiresRefrigeration: false, quantity: 1 },
    ];
    const result = validateOrderItems(items);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("empty items list fails", () => {
    const result = validateOrderItems([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("At least one item is required");
  });

  it("missing medication name fails", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "", isControlled: false, scheduleClass: null, requiresRefrigeration: false, quantity: 1 },
    ];
    const result = validateOrderItems(items);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
  });

  it("zero quantity fails", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "Test", isControlled: false, scheduleClass: null, requiresRefrigeration: false, quantity: 0 },
    ];
    const result = validateOrderItems(items);
    expect(result.valid).toBe(false);
  });

  it("controlled without schedule class fails", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "Controlled Med", isControlled: true, scheduleClass: null, requiresRefrigeration: false, quantity: 1 },
    ];
    const result = validateOrderItems(items);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("schedule class");
  });

  it("multiple errors are collected", () => {
    const items: PharmacyOrderItem[] = [
      { medicationName: "", isControlled: true, scheduleClass: null, requiresRefrigeration: false, quantity: -1 },
    ];
    const result = validateOrderItems(items);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
  });
});
