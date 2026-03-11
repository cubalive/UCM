export type AppRole = "SUPER_ADMIN" | "ADMIN" | "COMPANY_ADMIN" | "DISPATCH" | "DRIVER" | "VIEWER" | "CLINIC_ADMIN" | "CLINIC_USER" | "CLINIC_VIEWER" | "BROKER_ADMIN" | "BROKER_USER" | "PHARMACY_ADMIN" | "PHARMACY_USER";

export type Resource =
  | "dashboard"
  | "dispatch"
  | "trips"
  | "patients"
  | "drivers"
  | "vehicles"
  | "clinics"
  | "invoices"
  | "cities"
  | "users"
  | "audit"
  | "time_entries"
  | "payroll"
  | "billing"
  | "support"
  | "broker_marketplace"
  | "broker_contracts"
  | "broker_settlements"
  | "pharmacy_orders";

export type Permission = "read" | "write" | "self";

const ROLE_PERMISSIONS: Record<AppRole, Record<Resource, Permission[]>> = {
  SUPER_ADMIN: {
    dashboard: ["read"],
    dispatch: ["read", "write"],
    trips: ["read", "write"],
    patients: ["read", "write"],
    drivers: ["read", "write"],
    vehicles: ["read", "write"],
    clinics: ["read", "write"],
    invoices: ["read", "write"],
    cities: ["read", "write"],
    users: ["read", "write"],
    audit: ["read"],
    time_entries: ["read", "write"],
    payroll: ["read", "write"],
    billing: ["read", "write"],
    support: ["read", "write"],
    broker_marketplace: ["read", "write"],
    broker_contracts: ["read", "write"],
    broker_settlements: ["read", "write"],
    pharmacy_orders: ["read", "write"],
  },
  ADMIN: {
    dashboard: ["read"],
    dispatch: ["read", "write"],
    trips: ["read", "write"],
    patients: ["read", "write"],
    drivers: ["read", "write"],
    vehicles: ["read", "write"],
    clinics: ["read", "write"],
    invoices: ["read", "write"],
    cities: ["read", "write"],
    users: ["read", "write"],
    audit: ["read"],
    time_entries: ["read", "write"],
    payroll: ["read", "write"],
    billing: ["read", "write"],
    support: ["read", "write"],
    broker_marketplace: ["read", "write"],
    broker_contracts: ["read", "write"],
    broker_settlements: ["read", "write"],
    pharmacy_orders: ["read", "write"],
  },
  COMPANY_ADMIN: {
    dashboard: ["read"],
    dispatch: ["read", "write"],
    trips: ["read", "write"],
    patients: ["read", "write"],
    drivers: ["read", "write"],
    vehicles: ["read", "write"],
    clinics: ["read", "write"],
    invoices: ["read", "write"],
    cities: ["read"],
    users: ["read", "write"],
    audit: ["read"],
    time_entries: ["read", "write"],
    payroll: ["read", "write"],
    billing: ["read", "write"],
    support: ["read", "write"],
    broker_marketplace: ["read", "write"],
    broker_contracts: ["read"],
    broker_settlements: ["read"],
    pharmacy_orders: ["read", "write"],
  },
  DISPATCH: {
    dashboard: ["read"],
    dispatch: ["read", "write"],
    trips: ["read", "write"],
    patients: ["read", "write"],
    drivers: ["read", "write"],
    vehicles: ["read", "write"],
    clinics: ["read"],
    invoices: ["read"],
    cities: [],
    users: [],
    audit: ["read"],
    time_entries: ["read", "write"],
    payroll: ["read"],
    billing: ["read", "write"],
    support: ["read", "write"],
    broker_marketplace: ["read"],
    broker_contracts: [],
    broker_settlements: [],
    pharmacy_orders: ["read"],
  },
  DRIVER: {
    dashboard: [],
    dispatch: [],
    trips: ["self"],
    patients: [],
    drivers: ["self"],
    vehicles: [],
    clinics: [],
    invoices: [],
    cities: [],
    users: [],
    audit: ["read"],
    time_entries: ["self"],
    payroll: [],
    billing: [],
    support: [],
    broker_marketplace: [],
    broker_contracts: [],
    broker_settlements: [],
    pharmacy_orders: [],
  },
  VIEWER: {
    dashboard: [],
    dispatch: [],
    trips: ["read"],
    patients: ["read"],
    drivers: [],
    vehicles: [],
    clinics: [],
    invoices: ["read"],
    cities: [],
    users: [],
    audit: ["read"],
    time_entries: [],
    payroll: [],
    billing: ["read"],
    support: ["read", "write"],
    broker_marketplace: [],
    broker_contracts: [],
    broker_settlements: [],
    pharmacy_orders: [],
  },
  CLINIC_ADMIN: {
    dashboard: ["read"],
    dispatch: [],
    trips: ["read", "write"],
    patients: ["read", "write"],
    drivers: [],
    vehicles: [],
    clinics: ["read"],
    invoices: ["read"],
    cities: [],
    users: ["read", "write"],
    audit: ["read"],
    time_entries: [],
    payroll: [],
    billing: ["read"],
    support: ["read", "write"],
    broker_marketplace: [],
    broker_contracts: [],
    broker_settlements: [],
    pharmacy_orders: [],
  },
  CLINIC_USER: {
    dashboard: ["read"],
    dispatch: [],
    trips: ["read", "write"],
    patients: ["read", "write"],
    drivers: [],
    vehicles: [],
    clinics: ["read"],
    invoices: [],
    cities: [],
    users: [],
    audit: ["read"],
    time_entries: [],
    payroll: [],
    billing: [],
    support: ["read", "write"],
    broker_marketplace: [],
    broker_contracts: [],
    broker_settlements: [],
    pharmacy_orders: [],
  },
  CLINIC_VIEWER: {
    dashboard: ["read"],
    dispatch: [],
    trips: ["read"],
    patients: ["read"],
    drivers: [],
    vehicles: [],
    clinics: ["read"],
    invoices: ["read"],
    cities: [],
    users: [],
    audit: ["read"],
    time_entries: [],
    payroll: [],
    billing: ["read"],
    support: ["read"],
    broker_marketplace: [],
    broker_contracts: [],
    broker_settlements: [],
    pharmacy_orders: [],
  },
  BROKER_ADMIN: {
    dashboard: ["read"],
    dispatch: [],
    trips: ["read"],
    patients: [],
    drivers: [],
    vehicles: [],
    clinics: [],
    invoices: ["read"],
    cities: [],
    users: ["read", "write"],
    audit: ["read"],
    time_entries: [],
    payroll: [],
    billing: ["read"],
    support: ["read", "write"],
    broker_marketplace: ["read", "write"],
    broker_contracts: ["read", "write"],
    broker_settlements: ["read", "write"],
    pharmacy_orders: [],
  },
  BROKER_USER: {
    dashboard: ["read"],
    dispatch: [],
    trips: ["read"],
    patients: [],
    drivers: [],
    vehicles: [],
    clinics: [],
    invoices: [],
    cities: [],
    users: [],
    audit: ["read"],
    time_entries: [],
    payroll: [],
    billing: [],
    support: ["read", "write"],
    broker_marketplace: ["read", "write"],
    broker_contracts: ["read"],
    broker_settlements: ["read"],
    pharmacy_orders: [],
  },
  PHARMACY_ADMIN: {
    dashboard: ["read"],
    dispatch: [],
    trips: ["read"],
    patients: ["read"],
    drivers: [],
    vehicles: [],
    clinics: [],
    invoices: ["read"],
    cities: [],
    users: ["read", "write"],
    audit: ["read"],
    time_entries: [],
    payroll: [],
    billing: ["read"],
    support: ["read", "write"],
    broker_marketplace: [],
    broker_contracts: [],
    broker_settlements: [],
    pharmacy_orders: ["read", "write"],
  },
  PHARMACY_USER: {
    dashboard: ["read"],
    dispatch: [],
    trips: ["read"],
    patients: ["read"],
    drivers: [],
    vehicles: [],
    clinics: [],
    invoices: [],
    cities: [],
    users: [],
    audit: ["read"],
    time_entries: [],
    payroll: [],
    billing: [],
    support: ["read", "write"],
    broker_marketplace: [],
    broker_contracts: [],
    broker_settlements: [],
    pharmacy_orders: ["read", "write"],
  },
};

export const CLINIC_ROLES = ["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"] as const;
export const BROKER_ROLES = ["BROKER_ADMIN", "BROKER_USER"] as const;
export const PHARMACY_ROLES = ["PHARMACY_ADMIN", "PHARMACY_USER"] as const;

export function isClinicRole(role: string): boolean {
  return CLINIC_ROLES.includes(role.toUpperCase() as any);
}

export function isBrokerRole(role: string): boolean {
  return BROKER_ROLES.includes(role.toUpperCase() as any);
}

export function isPharmacyRole(role: string): boolean {
  return PHARMACY_ROLES.includes(role.toUpperCase() as any);
}

export function can(role: string, resource: Resource, permission: Permission = "read"): boolean {
  const normalizedRole = role.toUpperCase() as AppRole;
  const perms = ROLE_PERMISSIONS[normalizedRole];
  if (!perms) return false;
  const resourcePerms = perms[resource];
  if (!resourcePerms) return false;
  return resourcePerms.includes(permission);
}

export function getVisibleNavItems(role: string): Resource[] {
  const normalizedRole = role.toUpperCase() as AppRole;
  const perms = ROLE_PERMISSIONS[normalizedRole];
  if (!perms) return [];
  return (Object.keys(perms) as Resource[]).filter((r) => perms[r].length > 0);
}

export { ROLE_PERMISSIONS };
