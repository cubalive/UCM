import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { User, City } from "@shared/schema";

interface AuthUser extends Omit<User, "password"> {
  cityAccess: number[];
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  selectedCity: City | null;
  cities: City[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setSelectedCity: (city: City | null) => void;
  hasAccess: (cityId: number) => boolean;
  isSuperAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("ucm_token"));
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);

  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const hasAccess = useCallback(
    (cityId: number) => {
      if (!user) return false;
      if (user.role === "SUPER_ADMIN") return true;
      return user.cityAccess.includes(cityId);
    },
    [user]
  );

  const fetchUser = useCallback(async (t: string) => {
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) throw new Error("Unauthorized");
      const data = await res.json();
      setUser(data.user);
      setCities(data.cities || []);
      if (data.cities?.length > 0 && !selectedCity) {
        setSelectedCity(data.cities[0]);
      }
    } catch {
      setToken(null);
      setUser(null);
      localStorage.removeItem("ucm_token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      fetchUser(token);
    } else {
      setLoading(false);
    }
  }, [token, fetchUser]);

  const login = async (email: string, password: string) => {
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
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setCities([]);
    setSelectedCity(null);
    localStorage.removeItem("ucm_token");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        selectedCity,
        cities,
        loading,
        login,
        logout,
        setSelectedCity,
        hasAccess,
        isSuperAdmin,
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

export function authHeaders(token: string | null) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
