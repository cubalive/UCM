import React, { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);

    this.setState((prev) => ({ errorCount: prev.errorCount + 1 }));

    // Report to Sentry if available (production)
    if (typeof window !== "undefined" && (window as any).__SENTRY__) {
      try {
        (window as any).__SENTRY__.hub?.captureException(error, {
          contexts: { react: { componentStack: info.componentStack } },
        });
      } catch {
        // Sentry not initialized — ignore
      }
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const isChunkError =
        this.state.error?.message?.includes("Loading chunk") ||
        this.state.error?.message?.includes("dynamically imported module");

      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem" }}>
          <div style={{ textAlign: "center", maxWidth: 480 }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem", color: "#dc2626" }}>
              {isChunkError ? "App Update Available" : "Something went wrong"}
            </h1>
            <p style={{ color: "#6b7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
              {isChunkError
                ? "A new version of the app is available. Please reload to update."
                : this.state.error?.message || "An unexpected error occurred."}
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
              {!isChunkError && this.state.errorCount < 3 && (
                <button
                  onClick={this.handleRetry}
                  style={{
                    padding: "0.5rem 1.5rem", background: "#f3f4f6", color: "#374151",
                    border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: "0.9rem",
                  }}
                >
                  Try Again
                </button>
              )}
              <button
                onClick={this.handleReload}
                style={{
                  padding: "0.5rem 1.5rem", background: "#2563eb", color: "#fff",
                  border: "none", borderRadius: 6, cursor: "pointer", fontSize: "0.9rem",
                }}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
