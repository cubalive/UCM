import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./styles/globals.css";

// Lazy-load all page-level components for code splitting
const LoginPage = lazy(() => import("./pages/LoginPage").then(m => ({ default: m.LoginPage })));
const DispatchDashboard = lazy(() => import("./pages/DispatchDashboard").then(m => ({ default: m.DispatchDashboard })));
const DriverApp = lazy(() => import("./pages/DriverApp").then(m => ({ default: m.DriverApp })));
const ClinicPortal = lazy(() => import("./pages/ClinicPortal").then(m => ({ default: m.ClinicPortal })));

function LoadingFallback() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center" }}>
        <div className="loading-spinner" />
        <p style={{ marginTop: "1rem", color: "var(--gray-500)", fontSize: "0.875rem" }}>Loading...</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dispatch/*" element={<DispatchDashboard />} />
          <Route path="/driver/*" element={<DriverApp />} />
          <Route path="/clinic/*" element={<ClinicPortal />} />
          <Route path="/" element={<Navigate to="/dispatch" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
