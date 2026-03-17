import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { User, City } from "@shared/schema";
import { isDriverHost, DRIVER_TOKEN_KEY, getCredentials } from "@/lib/hostDetection";
import { API_BASE_URL } from "@/lib/api";

function apiUrl(path: string): string {
  if (API_BASE_URL && path.startsWith("/")) return `${API_BASE_URL}${path}`;
  return path;
}

interface AuthUser extends Omit<User, "password"> {
  cityAccess: number[];
}

interface MeData {
  id: string | number;
  email: string;
  role: string;
  city_id: string | number | null;
  ucm_id: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  /** @deprecated Token is now in httpOnly cookie. This is a placeholder for backward compat. */
  token: string | null;
  selectedCity: City | null;
  cities: City[];
  loading: boolean;
  error: string | null;
  meData: MeData | null;
  mustChangePassword: boolean;
  cityRequired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void> | void;
  retry: () => void;
  setSelectedCity: (city: City | null) => void;
  selectWorkingCity: (city: City | null) => void;
  hasAccess: (cityId: number) => boolean;
  isSuperAdmin: boolean;
  clearMustChangePassword: () => void;
  lastAuthStatus: number | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

const CITY_REQUIRING_ROLES = ["SUPER_ADMIN", "super_admin", "ADMIN", "admin", "COMPANY_ADMIN", "company_admin", "DISPATCH", "dispatch"];

function getStoredCityId(): number | null {
  try {
    const v = localStorage.getItem("ucm_working_city_id");
    return v ? parseInt(v, 10) : null;
  } catch {
    return null;
  }
}

function storeWorkingCityId(cityId: number | null) {
  try {
    if (cityId === null) {
      localStorage.setItem("ucm_working_city_id", "all");
    } else {
      localStorage.setItem("ucm_working_city_id", String(cityId));
    }
  } catch {}
}

/**
 * Read CSRF token from the ucm_csrf cookie (non-httpOnly, readable by JS).
 */
function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)ucm_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * Build headers for API requests. Includes CSRF token for state-changing requests.
 * Does NOT include Authorization header — cookies are sent automatically.
 */
function buildSecureHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const csrfToken = getCsrfToken();
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const cityId = localStorage.getItem("ucm_working_city_id");
  if (cityId) headers["X-City-Id"] = cityId;
  try {
    const scopeId = localStorage.getItem("ucm.superadmin.companyScopeId");
    if (scopeId) headers["x-ucm-company-id"] = scopeId;
  } catch {}
  return headers;
}

/**
 * Attempt to refresh the access token via the /api/auth/refresh endpoint.
 * Returns true if refresh succeeded.
 */
async function attemptTokenRefresh(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl("/api/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // For driver host (native app), still use localStorage token
  const [driverToken, setDriverToken] = useState<string | null>(() => {
    if (isDriverHost) {
      try { return localStorage.getItem(DRIVER_TOKEN_KEY); } catch { return null; }
    }
    return null;
  });
  const [selectedCity, setSelectedCityRaw] = useState<City | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meData, setMeData] = useState<MeData | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [cityChosen, setCityChosen] = useState(false);
  const [lastAuthStatus, setLastAuthStatus] = useState<number | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  const isSuperAdmin = user?.role === "SUPER_ADMIN" || (user?.role as string) === "super_admin";

  const needsCitySelection = user ? CITY_REQUIRING_ROLES.includes(user.role) : false;
  const cityRequired = needsCitySelection && !cityChosen;

  const hasAccess = useCallback(
    (cityId: number) => {
      if (!user) return false;
      if (user.role === "SUPER_ADMIN" || (user.role as string) === "super_admin") return true;
      if (user.role === "COMPANY_ADMIN" && user.cityAccess.length === 0) return true;
      return user.cityAccess.includes(cityId);
    },
    [user]
  );

  const setSelectedCity = useCallback((city: City | null) => {
    setSelectedCityRaw(city);
    storeWorkingCityId(city?.id ?? null);
    setCityChosen(true);
  }, []);

  const selectWorkingCity = useCallback((city: City | null) => {
    setSelectedCityRaw(city);
    storeWorkingCityId(city?.id ?? null);
    setCityChosen(true);
    fetch(apiUrl("/api/auth/working-city"), {
      method: "POST",
      headers: buildSecureHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify({ cityId: city?.id ?? null, scope: city ? "CITY" : "ALL" }),
    }).catch(() => {});
  }, []);

  const restoreCity = useCallback((availableCities: City[], userRole: string, serverCityId?: number | null, serverScope?: string | null) => {
    if (serverCityId != null) {
      const found = availableCities.find(c => c.id === serverCityId);
      if (found) {
        setSelectedCityRaw(found);
        storeWorkingCityId(found.id);
        setCityChosen(true);
        return;
      }
    }
    if (serverScope === "ALL" || (serverCityId === null && serverScope)) {
      setSelectedCityRaw(null);
      storeWorkingCityId(null);
      setCityChosen(true);
      return;
    }
    const storedId = getStoredCityId();
    if (storedId !== null) {
      const found = availableCities.find(c => c.id === storedId);
      if (found) {
        setSelectedCityRaw(found);
        setCityChosen(true);
        return;
      }
    }
    const storedRaw = localStorage.getItem("ucm_working_city_id");
    if (storedRaw === "all") {
      setCityChosen(true);
      return;
    }
    const requiresCity = CITY_REQUIRING_ROLES.includes(userRole);
    if (!requiresCity && availableCities.length > 0) {
      setSelectedCityRaw(availableCities[0]);
      storeWorkingCityId(availableCities[0].id);
      setCityChosen(true);
    }
  }, []);

  const fetchDriverUser = useCallback(async (t: string, _retry = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/auth/me"), {
        headers: { Authorization: `Bearer ${t}` },
        credentials: "omit",
      });
      setLastAuthStatus(res.status);

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        const msg = `Auth failed (${res.status}): ${body.message || "Session expired"}`;

        if (res.status === 401 || res.status === 403) {
          if (!_retry) {
            console.debug(`[AUTH] 401 detected on /api/auth/me (driver) – retrying before logout`);
            await new Promise((r) => setTimeout(r, 800));
            return fetchDriverUser(t, true);
          }
          console.debug(`[AUTH] 401 retry failed on /api/auth/me (driver) – clearing session`);
          setError(msg);
          setUser(null);
          setMeData(null);
          localStorage.removeItem(DRIVER_TOKEN_KEY);
          setDriverToken(null);
          setLoading(false);
          return;
        }
        throw new Error(msg);
      }

      const data = await res.json();
      setUser(data.user);
      setCities(data.cities || []);
      setMeData(null);
      setMustChangePassword(data.user?.mustChangePassword || false);
      setCityChosen(true);
      setError(null);

      try {
        const meRes = await fetch(apiUrl("/api/me"), {
          headers: { Authorization: `Bearer ${t}` },
          credentials: "omit",
        });
        if (meRes.ok) {
          setMeData(await meRes.json());
        }
      } catch {}
    } catch (e: any) {
      console.debug(`[AUTH] Driver session fetch error: ${e.message}`);
      setError(e.message || "Failed to load driver session");
      setUser(null);
      setMeData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAppUser = useCallback(async (_retry = false) => {
    setLoading(true);
    setError(null);
    try {
      const authRes = await fetch(apiUrl("/api/auth/me"), {
        headers: buildSecureHeaders(),
        credentials: "include",
      });
      setLastAuthStatus(authRes.status);

      if (!authRes.ok) {
        if (authRes.status === 401 || authRes.status === 403) {
          if (!_retry) {
            // Try refreshing the access token
            const refreshed = await attemptTokenRefresh();
            if (refreshed) {
              return fetchAppUser(true);
            }
          }
          console.debug(`[AUTH] Session expired – redirecting to login`);
          setUser(null);
          setMeData(null);
          setLoading(false);
          return;
        }
        throw new Error("Session expired. Please log in again.");
      }

      const data = await authRes.json();

      setUser(data.user);
      setCities(data.cities || []);
      setError(null);

      if (data.user?.mustChangePassword) {
        setMustChangePassword(true);
      }

      restoreCity(data.cities || [], data.user?.role || "", data.workingCityId, data.workingCityScope);

      try {
        const meRes = await fetch(apiUrl("/api/me"), {
          headers: buildSecureHeaders(),
          credentials: "include",
        });
        if (meRes.ok) {
          setMeData(await meRes.json());
        }
      } catch {}
    } catch (e: any) {
      console.debug(`[AUTH] App session fetch error: ${e.message}`);
      setError(e.message || "Failed to load user session");
      setUser(null);
      setMeData(null);
    } finally {
      setLoading(false);
    }
  }, [restoreCity]);

  const fetchUser = useCallback(async () => {
    if (isDriverHost && driverToken) {
      return fetchDriverUser(driverToken);
    }
    return fetchAppUser();
  }, [fetchDriverUser, fetchAppUser, driverToken]);

  useEffect(() => {
    if (isDriverHost) {
      if (driverToken) {
        fetchDriverUser(driverToken);
      } else {
        setLoading(false);
      }
    } else if (!sessionChecked) {
      setSessionChecked(true);
      // For web app, try to load session via cookie (no token needed)
      fetchAppUser();
    }
  }, [driverToken, fetchDriverUser, fetchAppUser, sessionChecked]);

  const login = async (email: string, password: string) => {
    setError(null);
    setLastAuthStatus(null);

    if (isDriverHost) {
      const res = await fetch(apiUrl("/api/auth/login-jwt"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
        credentials: "omit",
      });
      setLastAuthStatus(res.status);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Login failed");
      }
      const data = await res.json();

      // Handle MFA responses (server may require MFA setup or verification)
      if (data.mfaSetupRequired) {
        throw new Error(data.message || "Two-factor authentication setup is required. Please contact your administrator.");
      }
      if (data.mfaPending) {
        throw new Error("Two-factor authentication verification required. This feature is not yet available.");
      }

      // Driver app still uses token in localStorage (native app, not browser)
      if (!data.token || !data.user) {
        throw new Error("Login failed: invalid server response");
      }
      localStorage.setItem(DRIVER_TOKEN_KEY, data.token);
      setDriverToken(data.token);
      setUser(data.user);
      setCities(data.cities || []);
      setMeData(null);
      setMustChangePassword(data.mustChangePassword || false);
      setCityChosen(true);
      return;
    }

    const res = await fetch(apiUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      credentials: "include",
    });
    setLastAuthStatus(res.status);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Login failed");
    }
    const data = await res.json();

    // Handle MFA responses (server may require MFA setup or verification)
    if (data.mfaSetupRequired) {
      throw new Error(data.message || "Two-factor authentication setup is required. Please contact your administrator.");
    }
    if (data.mfaPending) {
      throw new Error("Two-factor authentication verification required. This feature is not yet available.");
    }

    // Validate the response contains user data
    if (!data.user) {
      throw new Error("Login failed: invalid server response");
    }

    // No token in response body — auth is via httpOnly cookies set by server
    setUser(data.user);
    setCities(data.cities || []);

    setSelectedCityRaw(null);
    localStorage.removeItem("ucm_working_city_id");

    if (data.mustChangePassword) {
      setMustChangePassword(true);
    }

    try {
      const meRes = await fetch(apiUrl("/api/me"), {
        headers: buildSecureHeaders(),
        credentials: "include",
      });
      if (meRes.ok) {
        setMeData(await meRes.json());
      }
    } catch {}
  };

  const logout = async () => {
    if (isDriverHost) {
      try {
        await fetch(apiUrl("/api/auth/driver-logout"), {
          method: "POST",
          headers: { Authorization: `Bearer ${driverToken}`, "Content-Type": "application/json" },
          credentials: "omit",
        });
      } catch {}
      localStorage.removeItem(DRIVER_TOKEN_KEY);
      setDriverToken(null);
    } else {
      try {
        await fetch(apiUrl("/api/auth/logout"), {
          method: "POST",
          headers: buildSecureHeaders({ "Content-Type": "application/json" }),
          credentials: "include",
        });
      } catch {}
    }
    setUser(null);
    setCities([]);
    setSelectedCityRaw(null);
    setCityChosen(false);
    setMeData(null);
    setError(null);
    setMustChangePassword(false);
    setLastAuthStatus(null);
    setSessionChecked(false);
    localStorage.removeItem("ucm_working_city_id");
  };

  const retry = () => {
    fetchUser();
  };

  const clearMustChangePassword = () => {
    setMustChangePassword(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token: user ? "cookie-auth" : null,
        selectedCity,
        cities,
        loading,
        error,
        meData,
        mustChangePassword,
        cityRequired,
        login,
        logout,
        retry,
        setSelectedCity,
        selectWorkingCity,
        hasAccess,
        isSuperAdmin,
        clearMustChangePassword,
        lastAuthStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * @deprecated Token is now in httpOnly cookie. This returns CSRF + city headers only.
 * Kept for backward compat with pages that use `authHeaders(token)`.
 */
export function authHeaders(_token: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  const csrfToken = getCsrfToken();
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  return headers;
}
