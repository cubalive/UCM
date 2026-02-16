import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { User, City } from "@shared/schema";
import { getTokenKey, getCredentials, isDriverHost, DRIVER_TOKEN_KEY, migrateLegacyTokenIfNeeded } from "@/lib/hostDetection";

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
}

const AuthContext = createContext<AuthContextType | null>(null);

const IS_DEV = import.meta.env.DEV;

const CITY_REQUIRING_ROLES = ["SUPER_ADMIN", "super_admin", "ADMIN", "admin", "DISPATCH", "dispatch"];

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

function buildDriverUser(me: any): AuthUser {
  return {
    id: me.userId ?? me.id,
    email: me.email || "",
    role: me.role || "DRIVER",
    firstName: me.firstName || me.email?.split("@")[0] || "",
    lastName: me.lastName || "",
    active: true,
    publicId: me.ucm_id || "",
    phone: me.phone || null,
    cityAccess: [],
    createdAt: new Date(),
    mustChangePassword: false,
    clinicId: null,
    driverId: me.driverId || null,
    companyId: me.companyId || null,
    cityId: me.city_id || null,
  } as unknown as AuthUser;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    migrateLegacyTokenIfNeeded();
    return localStorage.getItem(getTokenKey());
  });
  const [selectedCity, setSelectedCityRaw] = useState<City | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meData, setMeData] = useState<MeData | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [devLoginAttempts, setDevLoginAttempts] = useState(0);
  const [devBypassed, setDevBypassed] = useState(false);
  const [cityChosen, setCityChosen] = useState(false);

  const isSuperAdmin = user?.role === "SUPER_ADMIN" || (user?.role as string) === "super_admin";

  const needsCitySelection = user ? CITY_REQUIRING_ROLES.includes(user.role) : false;
  const cityRequired = needsCitySelection && !cityChosen;

  const hasAccess = useCallback(
    (cityId: number) => {
      if (!user) return false;
      if (user.role === "SUPER_ADMIN" || (user.role as string) === "super_admin") return true;
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
  }, []);

  const restoreCity = useCallback((availableCities: City[], userRole: string) => {
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

  const fetchDriverUser = useCallback(async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${t}` },
        credentials: "omit",
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem(DRIVER_TOKEN_KEY);
          setToken(null);
          setUser(null);
          setMeData(null);
          setLoading(false);
          return;
        }
        throw new Error("Session expired. Please log in again.");
      }

      const me = await res.json();
      const driverUser = buildDriverUser(me);
      setUser(driverUser);
      setCities([]);
      setMeData(me);
      setMustChangePassword(false);
      setCityChosen(true);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load user session");
      setToken(null);
      setUser(null);
      setMeData(null);
      localStorage.removeItem(DRIVER_TOKEN_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAppUser = useCallback(async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      const creds = getCredentials();
      const authRes = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${t}` },
        credentials: creds,
      });

      if (!authRes.ok) {
        if (authRes.status === 401 || authRes.status === 403) {
          localStorage.removeItem(getTokenKey());
          setToken(null);
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

      restoreCity(data.cities || [], data.user?.role || "");

      try {
        const meRes = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${t}` },
          credentials: creds,
        });
        if (meRes.ok) {
          setMeData(await meRes.json());
        }
      } catch {}
    } catch (e: any) {
      setError(e.message || "Failed to load user session");
      setToken(null);
      setUser(null);
      setMeData(null);
      localStorage.removeItem(getTokenKey());
    } finally {
      setLoading(false);
    }
  }, [restoreCity]);

  const fetchUser = useCallback(async (t: string) => {
    if (isDriverHost) {
      return fetchDriverUser(t);
    }
    return fetchAppUser(t);
  }, [fetchDriverUser, fetchAppUser]);

  useEffect(() => {
    if (token) {
      fetchUser(token);
    } else if (!isDriverHost && IS_DEV && devLoginAttempts < 2 && !devBypassed) {
      setLoading(true);
      fetch("/api/auth/dev-session", { credentials: getCredentials() })
        .then((res) => {
          if (!res.ok) throw new Error("Dev session failed");
          return res.json();
        })
        .then((data) => {
          setToken(data.token);
          localStorage.setItem(getTokenKey(), data.token);
          setUser(data.user);
          setCities(data.cities || []);
          restoreCity(data.cities || [], data.user?.role || "");
          console.log("[DEV] Auto-login succeeded as", data.user?.email);
        })
        .catch(() => {
          const next = devLoginAttempts + 1;
          setDevLoginAttempts(next);
          console.warn(`[DEV] Auto-login attempt ${next}/2 failed`);
          if (next >= 2) {
            console.warn("[DEV] Auto-login failed 2 times, bypassing login gate");
            setDevBypassed(true);
            setUser({
              id: 0,
              email: "dev@agent.local",
              role: "SUPER_ADMIN",
              firstName: "Dev",
              lastName: "Agent",
              active: true,
              publicId: "DEV000000",
              phone: null,
              cityAccess: [],
              createdAt: new Date(),
              mustChangePassword: false,
            } as unknown as AuthUser);
            setToken("dev-bypass-token");
          }
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, [token, fetchUser, devLoginAttempts, devBypassed, restoreCity]);

  const login = async (email: string, password: string) => {
    setError(null);

    if (isDriverHost) {
      const res = await fetch("/api/auth/login-jwt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
        credentials: "omit",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Login failed");
      }
      const data = await res.json();
      localStorage.setItem(DRIVER_TOKEN_KEY, data.token);
      setToken(data.token);

      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${data.token}` },
        credentials: "omit",
      });
      if (meRes.ok) {
        const me = await meRes.json();
        const driverUser = buildDriverUser(me);
        setUser(driverUser);
        setCities([]);
        setMeData(me);
        setMustChangePassword(false);
        setCityChosen(true);
      } else {
        setUser(data.user ? buildDriverUser(data.user) : null);
      }
      return;
    }

    const creds = getCredentials();
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      credentials: creds,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Login failed");
    }
    const data = await res.json();
    setToken(data.token);
    localStorage.setItem(getTokenKey(), data.token);
    setUser(data.user);
    setCities(data.cities || []);

    setSelectedCityRaw(null);
    localStorage.removeItem("ucm_working_city_id");

    if (data.mustChangePassword) {
      setMustChangePassword(true);
    }

    try {
      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${data.token}` },
        credentials: creds,
      });
      if (meRes.ok) {
        setMeData(await meRes.json());
      }
    } catch {}
  };

  const logout = async () => {
    if (isDriverHost) {
      try {
        await fetch("/api/auth/driver-logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          credentials: "omit",
        });
      } catch {}
      localStorage.removeItem(DRIVER_TOKEN_KEY);
    } else if (token && user?.role?.toUpperCase() === "DRIVER") {
      try {
        await fetch("/api/auth/driver-logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          credentials: getCredentials(),
        });
      } catch {}
      localStorage.removeItem(getTokenKey());
    } else {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: getCredentials(),
        });
      } catch {}
      localStorage.removeItem(getTokenKey());
    }
    setToken(null);
    setUser(null);
    setCities([]);
    setSelectedCityRaw(null);
    setCityChosen(false);
    setMeData(null);
    setError(null);
    setMustChangePassword(false);
    localStorage.removeItem("ucm_working_city_id");
  };

  const retry = () => {
    if (token) {
      fetchUser(token);
    } else {
      setLoading(false);
      setError(null);
    }
  };

  const clearMustChangePassword = () => {
    setMustChangePassword(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
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

export function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
