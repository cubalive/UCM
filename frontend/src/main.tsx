import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./styles/globals.css";
import { DispatchDashboard } from "./pages/DispatchDashboard";
import { DriverApp } from "./pages/DriverApp";
import { ClinicPortal } from "./pages/ClinicPortal";
import { LoginPage } from "./pages/LoginPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dispatch/*" element={<DispatchDashboard />} />
        <Route path="/driver/*" element={<DriverApp />} />
        <Route path="/clinic/*" element={<ClinicPortal />} />
        <Route path="/" element={<Navigate to="/dispatch" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
