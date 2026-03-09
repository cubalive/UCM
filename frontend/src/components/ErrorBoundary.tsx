import React, { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem" }}>
          <div style={{ textAlign: "center", maxWidth: 480 }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem", color: "var(--red-600)" }}>
              Something went wrong
            </h1>
            <p style={{ color: "var(--gray-500)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              style={{
                padding: "0.5rem 1.5rem", background: "var(--blue-600)", color: "#fff",
                border: "none", borderRadius: 6, cursor: "pointer", fontSize: "0.9rem",
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
