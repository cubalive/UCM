import React, { useState } from "react";
import { Link } from "react-router-dom";
import { authApi } from "../lib/api";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || "Request failed");
    } finally {
      setLoading(false);
    }
  }

  const cardStyle = { width: 400, maxWidth: "90vw" };

  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, var(--blue-700), var(--blue-500))" }}>
        <div className="card" style={cardStyle}>
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--blue-700)" }}>Check Your Email</h1>
            <p className="text-sm" style={{ marginTop: "0.5rem", color: "var(--gray-600)" }}>
              If an account exists for <strong>{email}</strong>, we've sent a password reset link. The link expires in 15 minutes.
            </p>
          </div>
          <Link to="/login" className="btn btn-primary btn-lg" style={{ width: "100%", display: "block", textAlign: "center", textDecoration: "none" }}>
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, var(--blue-700), var(--blue-500))" }}>
      <div className="card" style={cardStyle}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--blue-700)" }}>Forgot Password</h1>
          <p className="text-sm text-gray">Enter your email address and we'll send you a reset link.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>

          {error && <p className="text-red text-sm mb-3">{error}</p>}

          <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Sending..." : "Send Reset Link"}
          </button>

          <div style={{ textAlign: "center", marginTop: "1rem" }}>
            <Link to="/login" style={{ fontSize: "0.875rem", color: "var(--blue-600)" }}>Back to Sign In</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
