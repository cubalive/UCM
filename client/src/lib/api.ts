export function getStoredCityId(): string | null {
  try {
    return localStorage.getItem("ucm_working_city_id");
  } catch {
    return null;
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem("ucm_token");
  } catch {
    return null;
  }
}

function buildHeaders(token: string | null, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const cityId = getStoredCityId();
  if (cityId) headers["X-City-Id"] = cityId;
  return headers;
}

export async function apiFetch(
  url: string,
  token: string | null,
  options?: RequestInit
) {
  const extraHeaders = (options?.headers as Record<string, string>) || {};
  if (options?.body) extraHeaders["Content-Type"] = "application/json";

  const headers = buildHeaders(token, extraHeaders);

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const error: any = new Error(err.message || "Request failed");
    error.data = err;
    throw error;
  }
  return res.json();
}
