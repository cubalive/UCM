import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../lib/api";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post<{ token: string; user: { role: string } }>("/auth/login", { email, password });
      setToken(res.token);
      const role = res.user.role;
      if (role === "driver") navigate("/driver");
      else if (role === "clinic") navigate("/clinic");
      else if (role === "admin") navigate("/admin");
      else navigate("/dispatch");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, var(--blue-700), var(--blue-500))" }}>
      <div className="card" style={{ width: 400, maxWidth: "90vw" }}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--blue-700)" }}>UCM Platform</h1>
          <p className="text-sm text-gray">Non-Emergency Medical Transportation</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>

          {error && <p className="text-red text-sm mb-3">{error}</p>}

          <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
