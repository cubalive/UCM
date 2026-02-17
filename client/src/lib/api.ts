import { isDriverHost, getTokenKey } from "@/lib/hostDetection";

export function getStoredCityId(): string | null {
  try {
    return localStorage.getItem("ucm_working_city_id");
  } catch {
    return null;
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(getTokenKey());
  } catch {
    return null;
  }
}

function getDeviceFingerprint(): string | null {
  try {
    let installId = localStorage.getItem("ucm_install_id");
    if (!installId) {
      installId = crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("ucm_install_id", installId);
    }
    const raw = [
      navigator.userAgent,
      navigator.platform || "",
      Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      `${screen.width}x${screen.height}`,
      installId,
    ].join("|");
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  } catch {
    return null;
  }
}

function buildHeaders(token: string | null, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const cityId = getStoredCityId();
  if (cityId) headers["X-City-Id"] = cityId;
  const fp = getDeviceFingerprint();
  if (fp) headers["X-UCM-Device"] = fp;
  return headers;
}

function clearTokenAndRedirect() {
  try {
    localStorage.removeItem(getTokenKey());
  } catch {}
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

export async function apiFetch(
  url: string,
  token: string | null,
  options?: RequestInit
) {
  if (isDriverHost && (url.startsWith("/api/ops") || url.startsWith("/api/admin/metrics"))) {
    const error: any = new Error("Ops endpoints are not available on this host");
    error.code = "OPS_BLOCKED";
    error.data = { blocked: true, reason: "ops_blocked_on_driver_host" };
    throw error;
  }

  const extraHeaders = (options?.headers as Record<string, string>) || {};
  if (options?.body) extraHeaders["Content-Type"] = "application/json";

  const headers = buildHeaders(token, extraHeaders);
  const credentials: RequestCredentials = isDriverHost ? "omit" : "include";

  const res = await fetch(url, { ...options, headers, credentials });
  if (!res.ok) {
    if (res.status === 401) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      if (err.code === "SESSION_REVOKED") {
        window.dispatchEvent(new CustomEvent("ucm-session-revoked", { detail: { code: "SESSION_REVOKED" } }));
      }
      clearTokenAndRedirect();
      const error: any = new Error(err.message || "Session expired");
      error.code = err.code || "UNAUTHORIZED";
      error.data = err;
      throw error;
    }
    const err = await res.json().catch(() => ({ message: res.statusText }));
    if (err.code === "MAX_DEVICES") {
      const error: any = new Error(err.message || "Maximum devices reached");
      error.code = err.code;
      error.data = err;
      throw error;
    }
    const error: any = new Error(err.message || "Request failed");
    error.data = err;
    throw error;
  }
  return res.json();
}

export function rawAuthFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isDriverHost && (url.startsWith("/api/ops") || url.startsWith("/api/admin/metrics"))) {
    return Promise.resolve(new Response(JSON.stringify({ message: "Ops blocked on driver host" }), { status: 403 }));
  }
  const token = getStoredToken();
  const extraHeaders = (init?.headers as Record<string, string>) || {};
  const headers = buildHeaders(token, extraHeaders);
  const credentials: RequestCredentials = isDriverHost ? "omit" : "include";
  return fetch(url, { ...init, headers, credentials });
}
