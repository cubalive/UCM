import { Switch, Route, Redirect, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { BrokerSidebar } from "./components/BrokerSidebar";
import BrokerDashboard from "./pages/BrokerDashboard";
import BrokerTripRequests from "./pages/BrokerTripRequests";
import BrokerTripRequestDetail from "./pages/BrokerTripRequestDetail";
import BrokerTripRequestNew from "./pages/BrokerTripRequestNew";
import BrokerMarketplace from "./pages/BrokerMarketplace";
import BrokerContracts from "./pages/BrokerContracts";
import BrokerContractDetail from "./pages/BrokerContractDetail";
import BrokerSettlements from "./pages/BrokerSettlements";
import BrokerSettlementDetail from "./pages/BrokerSettlementDetail";
import BrokerAnalytics from "./pages/BrokerAnalytics";
import BrokerProfile from "./pages/BrokerProfile";
import LoginPage from "@/pages/login";
import { useState } from "react";
import { Menu, X } from "lucide-react";

const ALLOWED_ROLES = ["BROKER_ADMIN", "BROKER_USER", "SUPER_ADMIN"];

function BrokerPortalRoutes() {
  return (
    <Switch>
      <Route path="/" component={BrokerDashboard} />
      <Route path="/trip-requests/new" component={BrokerTripRequestNew} />
      <Route path="/trip-requests/:id" component={BrokerTripRequestDetail} />
      <Route path="/trip-requests" component={BrokerTripRequests} />
      <Route path="/marketplace" component={BrokerMarketplace} />
      <Route path="/contracts/:id" component={BrokerContractDetail} />
      <Route path="/contracts" component={BrokerContracts} />
      <Route path="/settlements/:id" component={BrokerSettlementDetail} />
      <Route path="/settlements" component={BrokerSettlements} />
      <Route path="/analytics" component={BrokerAnalytics} />
      <Route path="/profile" component={BrokerProfile} />
      <Route>{() => <Redirect to="/" />}</Route>
    </Switch>
  );
}

export function BrokerPortalLayout() {
  const { user, token, loading, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [location] = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0f1e]">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading broker portal...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const role = user.role.toUpperCase();
  if (!ALLOWED_ROLES.includes(role)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0f1e]">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-8 max-w-md text-center space-y-4">
          <div className="w-16 h-16 mx-auto bg-red-500/10 rounded-full flex items-center justify-center">
            <X className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-white">Access Denied</h2>
          <p className="text-gray-400">
            This portal is restricted to broker users only. Please contact your administrator.
          </p>
          <button
            onClick={() => logout()}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-[#0a0f1e] text-white overflow-hidden" data-testid="broker-portal-layout">
      <BrokerSidebar
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
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-400 rounded-full flex items-center justify-center text-white font-bold text-sm">
              UC
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white leading-none">UCM Broker Portal</h1>
              <p className="text-xs text-gray-500 leading-none mt-0.5">Transportation Marketplace</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-gray-400">{user.email}</p>
              <p className="text-[10px] text-gray-600 uppercase">{user.role}</p>
            </div>
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
              {user.email?.[0]?.toUpperCase() || "B"}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <BrokerPortalRoutes />
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
