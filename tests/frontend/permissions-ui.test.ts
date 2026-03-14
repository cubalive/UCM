import { describe, it, expect } from "vitest";
import {
  can,
  getVisibleNavItems,
  isClinicRole,
  isBrokerRole,
  isPharmacyRole,
  ROLE_PERMISSIONS,
  type AppRole,
  type Resource,
} from "@shared/permissions";

describe("Permissions UI Logic", () => {
  // ── Clinic portal sidebar visibility ──────────────────────────────
  describe("Clinic portal sidebar visibility", () => {
    it("CLINIC_ADMIN sees dashboard", () => {
      expect(can("CLINIC_ADMIN", "dashboard")).toBe(true);
    });

    it("CLINIC_ADMIN can manage users", () => {
      expect(can("CLINIC_ADMIN", "users", "read")).toBe(true);
      expect(can("CLINIC_ADMIN", "users", "write")).toBe(true);
    });

    it("CLINIC_USER cannot manage users", () => {
      expect(can("CLINIC_USER", "users", "read")).toBe(false);
      expect(can("CLINIC_USER", "users", "write")).toBe(false);
    });

    it("CLINIC_ADMIN can read/write trips and patients", () => {
      expect(can("CLINIC_ADMIN", "trips", "read")).toBe(true);
      expect(can("CLINIC_ADMIN", "trips", "write")).toBe(true);
      expect(can("CLINIC_ADMIN", "patients", "read")).toBe(true);
      expect(can("CLINIC_ADMIN", "patients", "write")).toBe(true);
    });

    it("CLINIC_USER can read/write trips and patients", () => {
      expect(can("CLINIC_USER", "trips", "read")).toBe(true);
      expect(can("CLINIC_USER", "trips", "write")).toBe(true);
      expect(can("CLINIC_USER", "patients", "read")).toBe(true);
    });

    it("CLINIC_VIEWER has read-only access", () => {
      expect(can("CLINIC_VIEWER", "trips", "read")).toBe(true);
      expect(can("CLINIC_VIEWER", "trips", "write")).toBe(false);
      expect(can("CLINIC_VIEWER", "patients", "read")).toBe(true);
      expect(can("CLINIC_VIEWER", "patients", "write")).toBe(false);
    });

    it("CLINIC_USER cannot see invoices", () => {
      expect(can("CLINIC_USER", "invoices", "read")).toBe(false);
    });

    it("CLINIC_ADMIN can see invoices (read only)", () => {
      expect(can("CLINIC_ADMIN", "invoices", "read")).toBe(true);
      expect(can("CLINIC_ADMIN", "invoices", "write")).toBe(false);
    });

    it("No clinic role can access dispatch", () => {
      expect(can("CLINIC_ADMIN", "dispatch", "read")).toBe(false);
      expect(can("CLINIC_USER", "dispatch", "read")).toBe(false);
      expect(can("CLINIC_VIEWER", "dispatch", "read")).toBe(false);
    });
  });

  // ── Broker portal sidebar visibility ──────────────────────────────
  describe("Broker portal sidebar visibility", () => {
    it("BROKER_ADMIN sees marketplace with full access", () => {
      expect(can("BROKER_ADMIN", "broker_marketplace", "read")).toBe(true);
      expect(can("BROKER_ADMIN", "broker_marketplace", "write")).toBe(true);
    });

    it("BROKER_ADMIN sees contracts with full access", () => {
      expect(can("BROKER_ADMIN", "broker_contracts", "read")).toBe(true);
      expect(can("BROKER_ADMIN", "broker_contracts", "write")).toBe(true);
    });

    it("BROKER_ADMIN sees settlements with full access", () => {
      expect(can("BROKER_ADMIN", "broker_settlements", "read")).toBe(true);
      expect(can("BROKER_ADMIN", "broker_settlements", "write")).toBe(true);
    });

    it("BROKER_USER sees contracts as read-only", () => {
      expect(can("BROKER_USER", "broker_contracts", "read")).toBe(true);
      expect(can("BROKER_USER", "broker_contracts", "write")).toBe(false);
    });

    it("BROKER_USER sees settlements as read-only", () => {
      expect(can("BROKER_USER", "broker_settlements", "read")).toBe(true);
      expect(can("BROKER_USER", "broker_settlements", "write")).toBe(false);
    });

    it("BROKER_ADMIN can manage users", () => {
      expect(can("BROKER_ADMIN", "users", "write")).toBe(true);
    });

    it("BROKER_USER cannot manage users", () => {
      expect(can("BROKER_USER", "users", "read")).toBe(false);
    });
  });

  // ── Pharmacy portal sidebar visibility ────────────────────────────
  describe("Pharmacy portal sidebar visibility", () => {
    it("PHARMACY_ADMIN sees pharmacy orders with full access", () => {
      expect(can("PHARMACY_ADMIN", "pharmacy_orders", "read")).toBe(true);
      expect(can("PHARMACY_ADMIN", "pharmacy_orders", "write")).toBe(true);
    });

    it("PHARMACY_USER sees pharmacy orders with full access", () => {
      expect(can("PHARMACY_USER", "pharmacy_orders", "read")).toBe(true);
      expect(can("PHARMACY_USER", "pharmacy_orders", "write")).toBe(true);
    });

    it("PHARMACY_ADMIN can manage users (settings)", () => {
      expect(can("PHARMACY_ADMIN", "users", "read")).toBe(true);
      expect(can("PHARMACY_ADMIN", "users", "write")).toBe(true);
    });

    it("PHARMACY_USER cannot manage users", () => {
      expect(can("PHARMACY_USER", "users", "read")).toBe(false);
      expect(can("PHARMACY_USER", "users", "write")).toBe(false);
    });

    it("PHARMACY_ADMIN can see patients", () => {
      expect(can("PHARMACY_ADMIN", "patients", "read")).toBe(true);
    });

    it("PHARMACY_USER can see patients", () => {
      expect(can("PHARMACY_USER", "patients", "read")).toBe(true);
    });
  });

  // ── Driver app visibility ────────────────────────────────────────
  describe("Driver app visibility", () => {
    it("DRIVER sees own trips only (self)", () => {
      expect(can("DRIVER", "trips", "self")).toBe(true);
      expect(can("DRIVER", "trips", "read")).toBe(false);
      expect(can("DRIVER", "trips", "write")).toBe(false);
    });

    it("DRIVER sees own time entries (self)", () => {
      expect(can("DRIVER", "time_entries", "self")).toBe(true);
    });

    it("DRIVER sees own driver record (self)", () => {
      expect(can("DRIVER", "drivers", "self")).toBe(true);
    });

    it("DRIVER cannot see dashboard", () => {
      expect(can("DRIVER", "dashboard")).toBe(false);
    });

    it("DRIVER cannot see dispatch", () => {
      expect(can("DRIVER", "dispatch")).toBe(false);
    });

    it("DRIVER cannot see patients, vehicles, clinics, invoices", () => {
      expect(can("DRIVER", "patients")).toBe(false);
      expect(can("DRIVER", "vehicles")).toBe(false);
      expect(can("DRIVER", "clinics")).toBe(false);
      expect(can("DRIVER", "invoices")).toBe(false);
    });

    it("DRIVER cannot see billing or payroll", () => {
      expect(can("DRIVER", "billing")).toBe(false);
      expect(can("DRIVER", "payroll")).toBe(false);
    });
  });

  // ── Dispatch visibility ──────────────────────────────────────────
  describe("Dispatch role visibility", () => {
    it("DISPATCH sees dispatch with full access", () => {
      expect(can("DISPATCH", "dispatch", "read")).toBe(true);
      expect(can("DISPATCH", "dispatch", "write")).toBe(true);
    });

    it("DISPATCH sees trips with full access", () => {
      expect(can("DISPATCH", "trips", "read")).toBe(true);
      expect(can("DISPATCH", "trips", "write")).toBe(true);
    });

    it("DISPATCH sees patients and drivers", () => {
      expect(can("DISPATCH", "patients", "read")).toBe(true);
      expect(can("DISPATCH", "drivers", "read")).toBe(true);
      expect(can("DISPATCH", "vehicles", "read")).toBe(true);
    });

    it("DISPATCH sees clinics read-only", () => {
      expect(can("DISPATCH", "clinics", "read")).toBe(true);
      expect(can("DISPATCH", "clinics", "write")).toBe(false);
    });

    it("DISPATCH cannot see cities or users", () => {
      expect(can("DISPATCH", "cities")).toBe(false);
      expect(can("DISPATCH", "users")).toBe(false);
    });
  });

  // ── Navigation item count per role ────────────────────────────────
  describe("Navigation item count per role", () => {
    it("SUPER_ADMIN sees all resources", () => {
      const items = getVisibleNavItems("SUPER_ADMIN");
      const allResources = Object.keys(ROLE_PERMISSIONS["SUPER_ADMIN"]);
      expect(items.length).toBe(allResources.length);
    });

    it("DRIVER sees very few nav items", () => {
      const items = getVisibleNavItems("DRIVER");
      // trips (self), drivers (self), audit (read), time_entries (self) = 4
      expect(items.length).toBe(4);
    });

    it("VIEWER sees limited nav items", () => {
      const items = getVisibleNavItems("VIEWER");
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThan(getVisibleNavItems("ADMIN").length);
    });

    it("CLINIC_ADMIN sees more items than CLINIC_USER", () => {
      const adminItems = getVisibleNavItems("CLINIC_ADMIN");
      const userItems = getVisibleNavItems("CLINIC_USER");
      expect(adminItems.length).toBeGreaterThan(userItems.length);
    });

    it("BROKER_ADMIN sees more items than BROKER_USER", () => {
      const adminItems = getVisibleNavItems("BROKER_ADMIN");
      const userItems = getVisibleNavItems("BROKER_USER");
      expect(adminItems.length).toBeGreaterThan(userItems.length);
    });

    it("PHARMACY_ADMIN sees more items than PHARMACY_USER", () => {
      const adminItems = getVisibleNavItems("PHARMACY_ADMIN");
      const userItems = getVisibleNavItems("PHARMACY_USER");
      expect(adminItems.length).toBeGreaterThan(userItems.length);
    });

    it("unknown role sees no nav items", () => {
      const items = getVisibleNavItems("UNKNOWN_ROLE");
      expect(items).toEqual([]);
    });
  });

  // ── Role detection functions ──────────────────────────────────────
  describe("Role detection functions", () => {
    it("isClinicRole detects clinic roles", () => {
      expect(isClinicRole("CLINIC_ADMIN")).toBe(true);
      expect(isClinicRole("CLINIC_USER")).toBe(true);
      expect(isClinicRole("CLINIC_VIEWER")).toBe(true);
    });

    it("isClinicRole rejects non-clinic roles", () => {
      expect(isClinicRole("ADMIN")).toBe(false);
      expect(isClinicRole("DRIVER")).toBe(false);
      expect(isClinicRole("BROKER_ADMIN")).toBe(false);
    });

    it("isClinicRole is case-insensitive", () => {
      expect(isClinicRole("clinic_admin")).toBe(true);
      expect(isClinicRole("Clinic_User")).toBe(true);
      expect(isClinicRole("CLINIC_VIEWER")).toBe(true);
    });

    it("isBrokerRole detects broker roles", () => {
      expect(isBrokerRole("BROKER_ADMIN")).toBe(true);
      expect(isBrokerRole("BROKER_USER")).toBe(true);
    });

    it("isBrokerRole rejects non-broker roles", () => {
      expect(isBrokerRole("ADMIN")).toBe(false);
      expect(isBrokerRole("CLINIC_ADMIN")).toBe(false);
      expect(isBrokerRole("PHARMACY_ADMIN")).toBe(false);
    });

    it("isBrokerRole is case-insensitive", () => {
      expect(isBrokerRole("broker_admin")).toBe(true);
      expect(isBrokerRole("Broker_User")).toBe(true);
    });

    it("isPharmacyRole detects pharmacy roles", () => {
      expect(isPharmacyRole("PHARMACY_ADMIN")).toBe(true);
      expect(isPharmacyRole("PHARMACY_USER")).toBe(true);
    });

    it("isPharmacyRole rejects non-pharmacy roles", () => {
      expect(isPharmacyRole("ADMIN")).toBe(false);
      expect(isPharmacyRole("BROKER_ADMIN")).toBe(false);
      expect(isPharmacyRole("DRIVER")).toBe(false);
    });

    it("isPharmacyRole is case-insensitive", () => {
      expect(isPharmacyRole("pharmacy_admin")).toBe(true);
      expect(isPharmacyRole("Pharmacy_User")).toBe(true);
    });
  });

  // ── can() with case-insensitive roles ─────────────────────────────
  describe("can() case insensitivity", () => {
    it("accepts lowercase role", () => {
      expect(can("admin", "dashboard")).toBe(true);
    });

    it("accepts mixed case role", () => {
      expect(can("Dispatch", "trips", "read")).toBe(true);
    });

    it("returns false for unknown role", () => {
      expect(can("UNKNOWN", "dashboard")).toBe(false);
    });
  });
});
