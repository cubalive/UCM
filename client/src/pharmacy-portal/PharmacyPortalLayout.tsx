import { Switch, Route, Redirect, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { PharmacySidebar } from "./components/PharmacySidebar";
import PharmacyDashboard from "./pages/PharmacyDashboard";
import PharmacyOrders from "./pages/PharmacyOrders";
import PharmacyOrderDetail from "./pages/PharmacyOrderDetail";
import PharmacyNewOrder from "./pages/PharmacyNewOrder";
import PharmacyTracking from "./pages/PharmacyTracking";
import PharmacyMetrics from "./pages/PharmacyMetrics";
import PharmacySettings from "./pages/PharmacySettings";
import PharmacyInventory from "./pages/PharmacyInventory";
import PharmacyPrescriptions from "./pages/PharmacyPrescriptions";
import PharmacyBilling from "./pages/PharmacyBilling";
import PharmacyCompliance from "./pages/PharmacyCompliance";
import LoginPage from "@/pages/login";
import { useState } from "react";
import { Menu, X, Pill } from "lucide-react";

const ALLOWED_ROLES = ["PHARMACY_ADMIN", "PHARMACY_USER", "SUPER_ADMIN"];

function PharmacyPortalRoutes() {
  return (
    <Switch>
      <Route path="/" component={PharmacyDashboard} />
      <Route path="/orders/new" component={PharmacyNewOrder} />
      <Route path="/orders/:id" component={PharmacyOrderDetail} />
      <Route path="/orders" component={PharmacyOrders} />
      <Route path="/tracking" component={PharmacyTracking} />
      <Route path="/inventory" component={PharmacyInventory} />
      <Route path="/prescriptions" component={PharmacyPrescriptions} />
      <Route path="/billing" component={PharmacyBilling} />
      <Route path="/metrics" component={PharmacyMetrics} />
      <Route path="/compliance" component={PharmacyCompliance} />
      <Route path="/settings" component={PharmacySettings} />
      <Route>{() => <Redirect to="/" />}</Route>
    </Switch>
  );
}

function PharmacyHostUnauthorized() {
  const { logout } = useAuth();
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0a0f1e]">
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-8 max-w-md text-center space-y-4">
        <div className="w-16 h-16 mx-auto bg-red-500/10 rounded-full flex items-center justify-center">
          <X className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-xl font-semibold text-white">Access Denied</h2>
        <p className="text-gray-400">
          This portal is restricted to pharmacy users only. Please contact your administrator if you believe this is an error.
        </p>
        <button
          onClick={() => logout()}
          className="px-6 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

export function PharmacyPortalLayout() {
  const { user, token, loading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [location] = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0f1e]">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading pharmacy portal...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const role = user.role.toUpperCase();
  if (!ALLOWED_ROLES.includes(role) && !user.pharmacyId) {
    return <PharmacyHostUnauthorized />;
  }

  return (
    <div className="flex h-screen w-full bg-[#0a0f1e] text-white overflow-hidden">
      <PharmacySidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        currentPath={location}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-[#1e293b] bg-[#0f172a]/80 backdrop-blur-sm flex items-center px-4 shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <Menu className="w-5 h-5 text-gray-400" />
          </button>
          <div className="flex items-center gap-3 ml-2 lg:ml-0">
            <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center">
              <Pill className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white leading-none">UCM Pharmacy Portal</h1>
              <p className="text-xs text-gray-500 leading-none mt-0.5">Delivery Management</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-gray-400">{user.email}</p>
              <p className="text-[10px] text-gray-600 uppercase">{user.role}</p>
            </div>
            <div className="w-8 h-8 bg-gradient-to-br from-violet-600 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
              {user.email?.[0]?.toUpperCase() || "P"}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <PharmacyPortalRoutes />
        </main>
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
