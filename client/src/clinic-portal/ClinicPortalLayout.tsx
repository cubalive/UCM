import { Switch, Route, Redirect, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { ClinicSidebar } from "./components/ClinicSidebar";
import ClinicDashboard from "./pages/ClinicDashboard";
import ClinicTrips from "./pages/ClinicTrips";
import ClinicLiveView from "./pages/ClinicLiveView";
import ClinicBilling from "./pages/ClinicBilling";
import ClinicProfile from "./pages/ClinicProfile";
import LoginPage from "@/pages/login";
import UnauthorizedPage from "@/pages/unauthorized";
import { useState } from "react";
import { Menu, X } from "lucide-react";

const ALLOWED_ROLES = ["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER", "CLINIC", "SUPER_ADMIN"];

function ClinicPortalRoutes() {
  return (
    <Switch>
      <Route path="/" component={ClinicDashboard} />
      <Route path="/trips" component={ClinicTrips} />
      <Route path="/live" component={ClinicLiveView} />
      <Route path="/billing" component={ClinicBilling} />
      <Route path="/profile" component={ClinicProfile} />
      <Route>{() => <Redirect to="/" />}</Route>
    </Switch>
  );
}

function ClinicHostUnauthorized() {
  const { logout } = useAuth();
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0a0f1e]">
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-8 max-w-md text-center space-y-4">
        <div className="w-16 h-16 mx-auto bg-red-500/10 rounded-full flex items-center justify-center">
          <X className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-xl font-semibold text-white">Access Denied</h2>
        <p className="text-gray-400">
          This portal is restricted to clinic users only. Please contact your administrator if you believe this is an error.
        </p>
        <button
          onClick={() => logout()}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          data-testid="button-clinic-logout"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

export function ClinicPortalLayout() {
  const { user, loading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [location] = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0f1e]">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading clinic portal...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    if (location === "/login") {
      return <LoginPage />;
    }
    return <LoginPage />;
  }

  const role = user.role.toUpperCase();
  if (!ALLOWED_ROLES.includes(role) && !user.clinicId) {
    return <ClinicHostUnauthorized />;
  }

  return (
    <div className="flex h-screen w-full bg-[#0a0f1e] text-white overflow-hidden" data-testid="clinic-portal-layout">
      <ClinicSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        currentPath={location}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-[#1e293b] bg-[#0f172a]/80 backdrop-blur-sm flex items-center px-4 shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 hover:bg-white/5 rounded-lg transition-colors"
            data-testid="button-toggle-sidebar"
          >
            <Menu className="w-5 h-5 text-gray-400" />
          </button>
          <div className="flex items-center gap-3 ml-2 lg:ml-0">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center text-white font-bold text-sm">
              UC
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white leading-none">UCM Clinic Portal</h1>
              <p className="text-xs text-gray-500 leading-none mt-0.5">{user.clinicId ? "Clinic Dashboard" : "Administrator"}</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-gray-400">{user.email}</p>
              <p className="text-[10px] text-gray-600 uppercase">{user.role}</p>
            </div>
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
              {user.email?.[0]?.toUpperCase() || "U"}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <ClinicPortalRoutes />
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
