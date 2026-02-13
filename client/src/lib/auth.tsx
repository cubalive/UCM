import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { User, City } from "@shared/schema";

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
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  retry: () => void;
  setSelectedCity: (city: City | null) => void;
  hasAccess: (cityId: number) => boolean;
  isSuperAdmin: boolean;
  clearMustChangePassword: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const IS_DEV = import.meta.env.DEV;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("ucm_token"));
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meData, setMeData] = useState<MeData | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [devLoginAttempts, setDevLoginAttempts] = useState(0);
  const [devBypassed, setDevBypassed] = useState(false);

  const isSuperAdmin = user?.role === "SUPER_ADMIN" || user?.role === "super_admin";

  const hasAccess = useCallback(
    (cityId: number) => {
      if (!user) return false;
      if (user.role === "SUPER_ADMIN" || user.role === "super_admin") return true;
      return user.cityAccess.includes(cityId);
    },
    [user]
  );

  const fetchUser = useCallback(async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      const [authRes, meRes] = await Promise.all([
        fetch("/api/auth/me", { headers: { Authorization: `Bearer ${t}` } }),
        fetch("/api/me", { headers: { Authorization: `Bearer ${t}` } }),
      ]);

      if (!authRes.ok) throw new Error("Session expired. Please log in again.");

      if (!meRes.ok) {
        const meErr = await meRes.json().catch(() => ({ message: "Failed to load user context" }));
        throw new Error(meErr.message || "Failed to load user context");
      }

      const data = await authRes.json();
      const me = await meRes.json();

      setUser(data.user);
      setCities(data.cities || []);
      setMeData(me);
      setError(null);

      if (data.user?.mustChangePassword) {
        setMustChangePassword(true);
      }

      if (data.cities?.length > 0 && !selectedCity) {
        setSelectedCity(data.cities[0]);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load user session");
      setToken(null);
      setUser(null);
      setMeData(null);
      localStorage.removeItem("ucm_token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      fetchUser(token);
    } else if (IS_DEV && devLoginAttempts < 2 && !devBypassed) {
      setLoading(true);
      fetch("/api/auth/dev-session")
        .then((res) => {
          if (!res.ok) throw new Error("Dev session failed");
          return res.json();
        })
        .then((data) => {
          setToken(data.token);
          localStorage.setItem("ucm_token", data.token);
          setUser(data.user);
          setCities(data.cities || []);
          if (data.cities?.length > 0) setSelectedCity(data.cities[0]);
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
  }, [token, fetchUser, devLoginAttempts, devBypassed]);

  const login = async (email: string, password: string) => {
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Login failed");
    }
    const data = await res.json();
    setToken(data.token);
    localStorage.setItem("ucm_token", data.token);
    setUser(data.user);
    setCities(data.cities || []);
    if (data.cities?.length > 0) {
      setSelectedCity(data.cities[0]);
    }

    if (data.mustChangePassword) {
      setMustChangePassword(true);
    }

    try {
      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      if (meRes.ok) {
        setMeData(await meRes.json());
      }
    } catch {}
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setCities([]);
    setSelectedCity(null);
    setMeData(null);
    setError(null);
    setMustChangePassword(false);
    localStorage.removeItem("ucm_token");
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
        login,
        logout,
        retry,
        setSelectedCity,
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
