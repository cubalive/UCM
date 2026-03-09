import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authApi } from "../lib/api";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!token) {
      setError("Missing reset token. Please use the link from your email.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Password reset failed");
    } finally {
      setLoading(false);
    }
  }

  const cardStyle = { width: 400, maxWidth: "90vw" };

  if (!token) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, var(--blue-700), var(--blue-500))" }}>
        <div className="card" style={cardStyle}>
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--red-600, #dc2626)" }}>Invalid Reset Link</h1>
            <p className="text-sm" style={{ marginTop: "0.5rem", color: "var(--gray-600)" }}>
              This password reset link is invalid or missing. Please request a new one.
            </p>
          </div>
          <Link to="/forgot-password" className="btn btn-primary btn-lg" style={{ width: "100%", display: "block", textAlign: "center", textDecoration: "none" }}>
            Request New Link
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, var(--blue-700), var(--blue-500))" }}>
        <div className="card" style={cardStyle}>
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--green-600, #16a34a)" }}>Password Reset</h1>
            <p className="text-sm" style={{ marginTop: "0.5rem" }}>Your password has been reset successfully. You can now sign in.</p>
          </div>
          <Link to="/login" className="btn btn-primary btn-lg" style={{ width: "100%", display: "block", textAlign: "center", textDecoration: "none" }}>
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, var(--blue-700), var(--blue-500))" }}>
      <div className="card" style={cardStyle}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--blue-700)" }}>Reset Password</h1>
          <p className="text-sm text-gray">Enter your new password below.</p>
        </div>

        <form onSubmit={handleSubmit}>
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
            {loading ? "Resetting..." : "Reset Password"}
          </button>

          <div style={{ textAlign: "center", marginTop: "1rem" }}>
            <Link to="/login" style={{ fontSize: "0.875rem", color: "var(--blue-600)" }}>Back to Sign In</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
