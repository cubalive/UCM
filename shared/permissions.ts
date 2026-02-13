export type AppRole = "SUPER_ADMIN" | "ADMIN" | "DISPATCH" | "DRIVER" | "VIEWER";

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
  | "audit";

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
