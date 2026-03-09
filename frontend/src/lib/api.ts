const API_BASE = "/api";

let authToken: string | null = localStorage.getItem("ucm_token");
let csrfToken: string | null = null;

async function ensureCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  try {
    const res = await fetch(`${API_BASE}/csrf-token`, { credentials: "same-origin" });
    if (res.ok) {
      const data = await res.json();
      csrfToken = data.csrfToken;
      return csrfToken;
    }
  } catch { /* CSRF token fetch failed — continue without it */ }
  return null;
}

export function setToken(token: string) {
  authToken = token;
  localStorage.setItem("ucm_token", token);
}

export function getToken() {
  return authToken;
}

export function clearToken() {
  authToken = null;
  localStorage.removeItem("ucm_token");
}

export function logout() {
  clearToken();
  window.location.href = "/login";
}

/** Decode JWT payload and check expiration (with 60s buffer) */
export function isTokenExpired(): boolean {
  if (!authToken) return true;
  try {
    const payload = JSON.parse(atob(authToken.split(".")[1]));
    return payload.exp * 1000 < Date.now() + 60_000;
  } catch {
    return true;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Check token expiration before making request
  if (authToken && isTokenExpired()) {
    logout();
    throw new Error("Session expired. Please sign in again.");
  }

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  // Attach CSRF token for state-changing requests
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const token = await ensureCsrfToken();
    if (token) headers["X-CSRF-Token"] = token;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: "same-origin" });

  // Auto-logout on 401 (expired/invalid token)
  if (res.status === 401) {
    logout();
    throw new Error("Session expired. Please sign in again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// Typed API calls
export const dispatchApi = {
  getDashboard: () => api.get<any>("/dispatch/dashboard"),
  autoAssignAll: () => api.post<any>("/dispatch/auto-assign-all"),
  reassignTrip: (tripId: string, driverId: string, reason?: string) =>
    api.post<any>(`/dispatch/trips/${tripId}/reassign`, { driverId, reason }),
  releaseDriver: (driverId: string) => api.post<any>(`/dispatch/drivers/${driverId}/release`),
  resyncStale: (minutes?: number) => api.post<any>(`/dispatch/resync-stale?minutes=${minutes || 15}`),
  unassignTrip: (tripId: string, reason?: string) =>
    api.post<any>(`/dispatch/trips/${tripId}/unassign`, { reason }),
  cancelTrip: (tripId: string, reason?: string) =>
    api.post<any>(`/dispatch/trips/${tripId}/cancel`, { reason }),
  repairTrip: (tripId: string, newStatus: string, reason: string) =>
    api.post<any>(`/dispatch/trips/${tripId}/repair`, { newStatus, reason }),
  autoAssignPreview: (tripId: string) =>
    api.get<any>(`/dispatch/auto-assign-preview/${tripId}`),
};

export const tripApi = {
  list: (filters?: Record<string, string>) => {
    const params = new URLSearchParams(filters).toString();
    return api.get<any>(`/trips${params ? `?${params}` : ""}`);
  },
  get: (id: string) => api.get<any>(`/trips/${id}`),
  create: (data: any) => api.post<any>("/trips", data),
  assign: (id: string, driverId: string) => api.post<any>(`/trips/${id}/assign`, { driverId }),
  autoAssign: (id: string) => api.post<any>(`/trips/${id}/auto-assign`),
  updateStatus: (id: string, status: string, extra?: any) =>
    api.post<any>(`/trips/${id}/status`, { status, ...extra }),
  driverTrips: async (activeOnly?: boolean) => {
    const res = await api.get<any>(`/trips/driver/my-trips${activeOnly ? "?active=true" : ""}`);
    return { trips: res.data || res.trips || [], timezone: res.timezone || "America/New_York" };
  },
  accept: (id: string) => api.post<any>(`/trips/${id}/accept`),
  decline: (id: string, reason?: string) => api.post<any>(`/trips/${id}/decline`, { reason }),
  getRoute: (id: string) => api.get<{
    source: string;
    distanceMiles: number;
    durationMinutes: number;
    polyline: string | null;
    summary: string;
  }>(`/trips/${id}/route`),
};

export const earningsApi = {
  getEarnings: () => api.get<any>("/driver-payouts/earnings"),
  requestPayout: () => api.post<any>("/driver-payouts/payout"),
};

export const driverApi = {
  list: () => api.get<any>("/drivers"),
  updateAvailability: (availability: string) => api.post<any>("/drivers/me/availability", { availability }),
  updateLocation: (lat: number, lng: number, heading?: number, speed?: number) =>
    api.post<any>("/drivers/me/location", { latitude: lat, longitude: lng, heading, speed }),
  overrideStatus: (driverId: string, availability: string, reason?: string) =>
    api.post<any>(`/drivers/${driverId}/override-status`, { availability, reason }),
  stale: (minutes?: number) => api.get<any>(`/drivers/stale?minutes=${minutes || 15}`),
};

export const importApi = {
  preview: async (file: File, entity: string, columnOverrides?: Record<string, string>) => {
    const form = new FormData();
    form.append("file", file);
    form.append("entity", entity);
    if (columnOverrides) form.append("columnOverrides", JSON.stringify(columnOverrides));
    const csrf = await ensureCsrfToken();
    const hdrs: Record<string, string> = {};
    if (authToken) hdrs.Authorization = `Bearer ${authToken}`;
    if (csrf) hdrs["X-CSRF-Token"] = csrf;
    const res = await fetch(`${API_BASE}/import/preview`, {
      method: "POST",
      headers: hdrs,
      body: form,
      credentials: "same-origin",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `Request failed: ${res.status}`);
    }
    return res.json();
  },
  execute: async (file: File, entity: string, opts: {
    dryRun?: boolean;
    dedupeStrategies?: string[];
    columnOverrides?: Record<string, string>;
    skipDuplicates?: boolean;
    timezone?: string;
  } = {}) => {
    const form = new FormData();
    form.append("file", file);
    form.append("entity", entity);
    if (opts.dryRun) form.append("dryRun", "true");
    if (opts.dedupeStrategies) form.append("dedupeStrategies", JSON.stringify(opts.dedupeStrategies));
    if (opts.columnOverrides) form.append("columnOverrides", JSON.stringify(opts.columnOverrides));
    if (opts.skipDuplicates !== undefined) form.append("skipDuplicates", String(opts.skipDuplicates));
    if (opts.timezone) form.append("timezone", opts.timezone);
    const csrf2 = await ensureCsrfToken();
    const hdrs2: Record<string, string> = {};
    if (authToken) hdrs2.Authorization = `Bearer ${authToken}`;
    if (csrf2) hdrs2["X-CSRF-Token"] = csrf2;
    const res = await fetch(`${API_BASE}/import/execute`, {
      method: "POST",
      headers: hdrs2,
      body: form,
      credentials: "same-origin",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `Request failed: ${res.status}`);
    }
    return res.json();
  },
  downloadTemplate: (entity: string) => `${API_BASE}/import/template/${entity}`,
};

/** Auth API — bypasses token check since these are unauthenticated endpoints */
async function authRequest<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export const authApi = {
  forgotPassword: (email: string) => authRequest<{ success: boolean; message: string }>("/auth/forgot-password", { email }),
  resetPassword: (resetToken: string, newPassword: string) =>
    authRequest<{ success: boolean; message: string }>("/auth/reset-password", { resetToken, newPassword }),
};

export const adminApi = {
  getUsers: async (page?: number) => {
    const res = await api.get<any>(`/admin/users?page=${page || 1}`);
    return { users: res.data || [], pagination: res.pagination };
  },
  createUser: (data: { email: string; password: string; firstName: string; lastName: string; role: string }) =>
    api.post<any>("/admin/users", data),
  updateUser: (id: string, data: any) => api.put<any>(`/admin/users/${id}`, data),
  getTenant: () => api.get<any>("/admin/tenant"),
  updateTenant: (data: any) => api.put<any>("/admin/tenant", data),
  getSubscription: () => api.get<any>("/admin/subscription"),
  getAuditLog: (limit?: number, offset?: number) =>
    api.get<any>(`/admin/audit-log?limit=${limit || 50}&offset=${offset || 0}`),
  getTripPipeline: () => api.get<any>("/admin/trip-pipeline"),
  getOperationalAlerts: () => api.get<any>("/admin/operational-alerts"),
  getDriversOnline: () => api.get<any>("/admin/drivers/online"),
  getBillingReport: () => api.get<any>("/admin/billing-report"),
};

export const clinicApi = {
  getPatients: async (page?: number) => {
    const res = await api.get<any>(`/clinic/patients?page=${page || 1}`);
    return { patients: res.data || [] };
  },
  createPatient: (data: any) => api.post<any>("/clinic/patients", data),
  updatePatient: (id: string, data: any) => api.put<any>(`/clinic/patients/${id}`, data),
  deletePatient: (id: string) => api.delete<any>(`/clinic/patients/${id}`),
  requestTrip: (data: any) => {
    const payload: any = {
      patientId: data.patientId,
      pickupAddress: data.pickupAddress,
      dropoffAddress: data.dropoffAddress,
      scheduledAt: data.scheduledAt,
      timezone: data.timezone,
      isImmediate: data.priority === "immediate" || data.isImmediate || false,
      notes: data.notes,
    };
    return api.post<any>("/clinic/request-trip", payload);
  },
  getTrips: async (status?: string) => {
    const res = await api.get<any>(`/clinic/trips${status ? `?status=${status}` : ""}`);
    return { trips: res.data || [], timezone: res.timezone as string | undefined };
  },
  getTrip: (id: string) => api.get<any>(`/clinic/trips/${id}`),
  cancelTrip: (id: string, reason?: string) => api.post<any>(`/clinic/trips/${id}/cancel`, { reason }),
};
