import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getStoredToken, getStoredCityId, getStoredCompanyScopeId, API_BASE_URL } from "./api";
import { isDriverHost } from "./hostDetection";

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

function resolveCredentials(): RequestCredentials {
  return isDriverHost ? "omit" : "include";
}

function buildDefaultHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const cityId = getStoredCityId();
  if (cityId) headers["X-City-Id"] = cityId;
  const fp = getDeviceFingerprint();
  if (fp) headers["X-UCM-Device"] = fp;
  const scopeId = getStoredCompanyScopeId();
  if (scopeId) headers["x-ucm-company-id"] = scopeId;
  return headers;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    try {
      const parsed = JSON.parse(text);
      if (parsed.code === "SESSION_REVOKED") {
        window.dispatchEvent(new CustomEvent("ucm-session-revoked", { detail: { code: "SESSION_REVOKED" } }));
      }
    } catch {}
    throw new Error(`${res.status}: ${text}`);
  }
}

function isBlockedOpsCall(url: string): boolean {
  return isDriverHost && (url.startsWith("/api/ops") || url.startsWith("/api/admin/metrics"));
}

function resolveUrl(path: string): string {
  if (API_BASE_URL && path.startsWith("/")) {
    return `${API_BASE_URL}${path}`;
  }
  return path;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  if (isBlockedOpsCall(url)) {
    const error: any = new Error("Ops endpoints are not available on this host");
    error.code = "OPS_BLOCKED";
    error.data = { blocked: true, reason: "ops_blocked_on_driver_host" };
    throw error;
  }

  const headers: Record<string, string> = {
    ...buildDefaultHeaders(),
  };
  if (data) headers["Content-Type"] = "application/json";

  const res = await fetch(resolveUrl(url), {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: resolveCredentials(),
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey[0] as string;
    if (isBlockedOpsCall(url)) {
      return null;
    }

    const res = await fetch(resolveUrl(url), {
      credentials: resolveCredentials(),
      headers: buildDefaultHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: (failureCount, error) => {
        if (error instanceof Error && error.message.startsWith("401")) {
          return failureCount < 1;
        }
        if (error instanceof Error && error.message.startsWith("4")) return false;
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * Math.pow(2, attemptIndex), 10000),
    },
    mutations: {
      retry: false,
    },
  },
});
