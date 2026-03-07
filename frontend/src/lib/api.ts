const API_BASE = "/api";

let authToken: string | null = localStorage.getItem("ucm_token");

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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

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
    return { trips: res.data || res.trips || [] };
  },
  accept: (id: string) => api.post<any>(`/trips/${id}/accept`),
  decline: (id: string, reason?: string) => api.post<any>(`/trips/${id}/decline`, { reason }),
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

export const clinicApi = {
  getPatients: async (page?: number) => {
    const res = await api.get<any>(`/clinic/patients?page=${page || 1}`);
    return { patients: res.data || [] };
  },
  createPatient: (data: any) => api.post<any>("/clinic/patients", data),
  requestTrip: (data: any) => {
    const payload: any = {
      patientId: data.patientId,
      pickupAddress: data.pickupAddress,
      dropoffAddress: data.dropoffAddress,
      scheduledAt: data.scheduledPickup || data.scheduledAt || new Date().toISOString(),
      isImmediate: data.priority === "immediate" || data.isImmediate || false,
      notes: data.notes,
    };
    return api.post<any>("/clinic/request-trip", payload);
  },
  getTrips: async (status?: string) => {
    const res = await api.get<any>(`/clinic/trips${status ? `?status=${status}` : ""}`);
    return { trips: res.data || [] };
  },
  getTrip: (id: string) => api.get<any>(`/clinic/trips/${id}`),
  cancelTrip: (id: string, reason?: string) => api.post<any>(`/clinic/trips/${id}/cancel`, { reason }),
};
