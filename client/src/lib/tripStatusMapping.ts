export interface TripStatusStyle {
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  icon: string;
  priority: number;
  markerColor: string;
}

export const TRIP_STATUS_MAP: Record<string, TripStatusStyle> = {
  SCHEDULED: {
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
    borderColor: "border-emerald-200 dark:border-emerald-800",
    label: "Scheduled",
    icon: "calendar",
    priority: 1,
    markerColor: "#3B82F6",
  },
  ASSIGNED: {
    color: "text-emerald-700 dark:text-emerald-300",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/40",
    borderColor: "border-emerald-300 dark:border-emerald-700",
    label: "Assigned",
    icon: "user-check",
    priority: 2,
    markerColor: "#2563EB",
  },
  EN_ROUTE_TO_PICKUP: {
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50 dark:bg-orange-950/30",
    borderColor: "border-orange-200 dark:border-orange-800",
    label: "En route to pickup",
    icon: "navigation",
    priority: 3,
    markerColor: "#EA580C",
  },
  ARRIVED_PICKUP: {
    color: "text-yellow-600 dark:text-yellow-400",
    bgColor: "bg-yellow-50 dark:bg-yellow-950/30",
    borderColor: "border-yellow-200 dark:border-yellow-800",
    label: "Arrived pickup",
    icon: "map-pin",
    priority: 4,
    markerColor: "#D97706",
  },
  PICKED_UP: {
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-950/30",
    borderColor: "border-purple-200 dark:border-purple-800",
    label: "On trip",
    icon: "users",
    priority: 5,
    markerColor: "#9333EA",
  },
  EN_ROUTE_TO_DROPOFF: {
    color: "text-purple-700 dark:text-purple-300",
    bgColor: "bg-purple-100 dark:bg-purple-900/40",
    borderColor: "border-purple-300 dark:border-purple-700",
    label: "On trip",
    icon: "navigation",
    priority: 6,
    markerColor: "#7C3AED",
  },
  IN_PROGRESS: {
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-950/30",
    borderColor: "border-purple-200 dark:border-purple-800",
    label: "In progress",
    icon: "activity",
    priority: 5,
    markerColor: "#9333EA",
  },
  ARRIVED_DROPOFF: {
    color: "text-teal-600 dark:text-teal-400",
    bgColor: "bg-teal-50 dark:bg-teal-950/30",
    borderColor: "border-teal-200 dark:border-teal-800",
    label: "Arrived dropoff",
    icon: "flag",
    priority: 7,
    markerColor: "#0D9488",
  },
  COMPLETED: {
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-50 dark:bg-green-950/30",
    borderColor: "border-green-200 dark:border-green-800",
    label: "Completed",
    icon: "check-circle",
    priority: 8,
    markerColor: "#16A34A",
  },
  CANCELLED: {
    color: "text-gray-500 dark:text-gray-400",
    bgColor: "bg-gray-50 dark:bg-gray-900/30",
    borderColor: "border-gray-200 dark:border-gray-700",
    label: "Cancelled",
    icon: "x-circle",
    priority: 9,
    markerColor: "#6B7280",
  },
  NO_SHOW: {
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/30",
    borderColor: "border-red-200 dark:border-red-800",
    label: "No-show",
    icon: "alert-triangle",
    priority: 10,
    markerColor: "#DC2626",
  },
};

export function getTripStatusStyle(status: string): TripStatusStyle {
  return TRIP_STATUS_MAP[status] || TRIP_STATUS_MAP.SCHEDULED;
}

export function getTripMarkerColor(status: string): string {
  return (TRIP_STATUS_MAP[status] || TRIP_STATUS_MAP.SCHEDULED).markerColor;
}

export function getTripStatusLabel(status: string): string {
  return (TRIP_STATUS_MAP[status] || { label: status.replace(/_/g, " ").toLowerCase() }).label;
}

export const ACTIVE_TRIP_STATUSES = [
  "EN_ROUTE_TO_PICKUP",
  "ARRIVED_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_TO_DROPOFF",
  "IN_PROGRESS",
  "ARRIVED_DROPOFF",
];

export function isDriverBusy(tripStatus: string): boolean {
  return ACTIVE_TRIP_STATUSES.includes(tripStatus);
}

export const DRIVER_AVAILABILITY_COLORS = {
  AVAILABLE: "#22C55E",
  BUSY: "#EF4444",
  OFFLINE: "#9CA3AF",
};

export const MAP_LEGEND_ITEMS = [
  { status: "SCHEDULED", label: "Scheduled", color: "#3B82F6" },
  { status: "ASSIGNED", label: "Assigned", color: "#2563EB" },
  { status: "EN_ROUTE_TO_PICKUP", label: "En route to pickup", color: "#EA580C" },
  { status: "ARRIVED_PICKUP", label: "Arrived pickup", color: "#D97706" },
  { status: "PICKED_UP", label: "On trip", color: "#9333EA" },
  { status: "ARRIVED_DROPOFF", label: "Arrived dropoff", color: "#0D9488" },
  { status: "COMPLETED", label: "Completed", color: "#16A34A" },
  { status: "CANCELLED", label: "Cancelled", color: "#6B7280" },
  { status: "NO_SHOW", label: "No-show", color: "#DC2626" },
];

export const DRIVER_LEGEND_ITEMS = [
  { label: "Available", color: "#22C55E" },
  { label: "Busy / On Trip", color: "#EF4444" },
  { label: "Offline", color: "#9CA3AF" },
];
