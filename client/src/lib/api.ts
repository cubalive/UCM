import { isDriverHost, isProductionSubdomain, DRIVER_TOKEN_KEY } from "@/lib/hostDetection";

const PROD_API_DEFAULT = "https://app.unitedcaremobility.com";

export const API_BASE_URL: string = (() => {
  const envVal = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (envVal) return envVal.replace(/\/+$/, "");
  if (isProductionSubdomain) return PROD_API_DEFAULT;
  return "";
})();

/**
 * Get CSRF token from the ucm_csrf cookie (non-httpOnly, readable by JS).
 */
function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)ucm_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * WebSocket URL — NO token in URL. Auth is via cookie or subprotocol.
 */
export function getWsUrl(): string {
  if (API_BASE_URL) {
    const url = new URL(API_BASE_URL);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${url.host}/ws`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function resolveUrl(path: string): string {
  if (API_BASE_URL && path.startsWith("/")) {
    return `${API_BASE_URL}${path}`;
  }
  return path;
}

export function getStoredCityId(): string | null {
  try {
    return localStorage.getItem("ucm_working_city_id");
  } catch {
    return null;
  }
}

/**
 * Get driver token for native driver app only.
 * For web app, tokens are in httpOnly cookies — not accessible from JS.
 */
export function getStoredToken(): string | null {
  if (isDriverHost) {
    try { return localStorage.getItem(DRIVER_TOKEN_KEY); } catch { return null; }
  }
  return null;
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

export function getStoredCompanyScopeId(): string | null {
  try {
    return localStorage.getItem("ucm.superadmin.companyScopeId");
  } catch {
    return null;
  }
}

export function setStoredCompanyScopeId(id: string | null) {
  try {
    if (id) {
      localStorage.setItem("ucm.superadmin.companyScopeId", id);
    } else {
      localStorage.removeItem("ucm.superadmin.companyScopeId");
    }
  } catch {}
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  // For driver host (native app), still send Bearer token
  if (isDriverHost) {
    const token = getStoredToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  // CSRF token for cookie-based auth
  const csrfToken = getCsrfToken();
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const cityId = getStoredCityId();
  if (cityId) headers["X-City-Id"] = cityId;
  const fp = getDeviceFingerprint();
  if (fp) headers["X-UCM-Device"] = fp;
  const scopeId = getStoredCompanyScopeId();
  if (scopeId) headers["x-ucm-company-id"] = scopeId;
  return headers;
}

function clearSessionAndRedirect() {
  if (isDriverHost) {
    try { localStorage.removeItem(DRIVER_TOKEN_KEY); } catch {}
  }
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

/**
 * Attempt to refresh access token via refresh cookie.
 */
async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(resolveUrl("/api/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function apiFetch(
  url: string,
  _token: string | null,
  options?: RequestInit,
  _retryCount: number = 0
) {
  if (isDriverHost && (url.startsWith("/api/ops") || url.startsWith("/api/admin/metrics"))) {
    const error: any = new Error("Ops endpoints are not available on this host");
    error.code = "OPS_BLOCKED";
    error.data = { blocked: true, reason: "ops_blocked_on_driver_host" };
    throw error;
  }

  const extraHeaders = (options?.headers as Record<string, string>) || {};
  if (options?.body) extraHeaders["Content-Type"] = "application/json";

  const headers = buildHeaders(extraHeaders);
  const credentials: RequestCredentials = isDriverHost ? "omit" : "include";

  const res = await fetch(resolveUrl(url), { ...options, headers, credentials });
  if (!res.ok) {
    if (res.status === 401) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      if (err.code === "SESSION_REVOKED") {
        window.dispatchEvent(new CustomEvent("ucm-session-revoked", { detail: { code: "SESSION_REVOKED" } }));
        clearSessionAndRedirect();
        const error: any = new Error(err.message || "Session revoked");
        error.code = "SESSION_REVOKED";
        error.data = err;
        throw error;
      }
      if (_retryCount < 1 && !isDriverHost) {
        // Try refreshing the access token
        const refreshed = await tryRefresh();
        if (refreshed) {
          return apiFetch(url, _token, options, _retryCount + 1);
        }
      }
      console.debug(`[AUTH] 401 on ${url} – logging out`);
      clearSessionAndRedirect();
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
  const extraHeaders = (init?.headers as Record<string, string>) || {};
  const headers = buildHeaders(extraHeaders);
  const credentials: RequestCredentials = isDriverHost ? "omit" : "include";
  return fetch(resolveUrl(url), { ...init, headers, credentials });
}
