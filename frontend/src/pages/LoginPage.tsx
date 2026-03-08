import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, setToken } from "../lib/api";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Forced reset state (imported drivers)
  const [forcedResetToken, setForcedResetToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();

      if (res.status === 403 && body.mustResetPassword && body.resetToken) {
        setForcedResetToken(body.resetToken);
        setError("");
        return;
      }

      if (!res.ok) {
        setError(body.error || "Login failed");
        return;
      }

      setToken(body.token);
      const role = body.user.role;
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

  async function handleForcedReset(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { resetToken: forcedResetToken, newPassword });
      setResetSuccess(true);
      setForcedResetToken(null);
    } catch (err: any) {
      setError(err.message || "Password reset failed");
    } finally {
      setLoading(false);
    }
  }

  const cardStyle = { width: 400, maxWidth: "90vw" };

  // Forced password reset form
  if (forcedResetToken) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, var(--blue-700), var(--blue-500))" }}>
        <div className="card" style={cardStyle}>
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--blue-700)" }}>Password Reset Required</h1>
            <p className="text-sm text-gray">Please set a new password to continue.</p>
          </div>
          <form onSubmit={handleForcedReset}>
            <div className="form-group">
              <label className="form-label">New Password</label>
              <input className="form-input" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8} autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input className="form-input" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} />
            </div>
            {error && <p className="text-red text-sm mb-3">{error}</p>}
            <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: "100%" }}>
              {loading ? "Resetting..." : "Set New Password"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Success after forced reset
  if (resetSuccess) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, var(--blue-700), var(--blue-500))" }}>
        <div className="card" style={cardStyle}>
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--green-600, #16a34a)" }}>Password Reset</h1>
            <p className="text-sm" style={{ marginTop: "0.5rem" }}>Your password has been reset successfully.</p>
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => { setResetSuccess(false); setNewPassword(""); setConfirmPassword(""); }} style={{ width: "100%" }}>
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, var(--blue-700), var(--blue-500))" }}>
      <div className="card" style={cardStyle}>
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

          <div style={{ textAlign: "center", marginTop: "1rem" }}>
            <Link to="/forgot-password" style={{ fontSize: "0.875rem", color: "var(--blue-600)" }}>Forgot password?</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
