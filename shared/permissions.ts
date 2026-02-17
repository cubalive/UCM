export type AppRole = "SUPER_ADMIN" | "ADMIN" | "COMPANY_ADMIN" | "DISPATCH" | "DRIVER" | "VIEWER";

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
  | "support";

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
    audit: [],
    time_entries: ["read", "write"],
    payroll: ["read"],
    billing: ["read", "write"],
    support: ["read", "write"],
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
    audit: [],
    time_entries: ["self"],
    payroll: [],
    billing: [],
    support: [],
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
    audit: [],
    time_entries: [],
    payroll: [],
    billing: ["read"],
    support: ["read", "write"],
  },
};

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
