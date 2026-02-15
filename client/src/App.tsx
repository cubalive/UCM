import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardHeader } from "@/components/dashboard-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { can, type Resource } from "@shared/permissions";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { CitySelectionModal } from "@/components/city-selection-modal";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import TripsPage from "@/pages/trips";
import PatientsPage from "@/pages/patients";
import DriversPage from "@/pages/drivers";
import VehiclesPage from "@/pages/vehicles";
import ClinicsPage from "@/pages/clinics";
import CitiesPage from "@/pages/cities";
import UsersPage from "@/pages/users-management";
import AuditPage from "@/pages/audit";
import DispatchMapPage from "@/pages/dispatch-map";
import ChangePasswordPage from "@/pages/change-password";
import ClinicInvoicesPage from "@/pages/clinic-invoices";
import FleetOpsPage from "@/pages/fleet-ops";
import AssignmentsPage from "@/pages/assignments";
import ReportsPage from "@/pages/reports";
import FinancialPage from "@/pages/financial";
import OpsHealthPage from "@/pages/ops-health";
import OpsChecksPage from "@/pages/ops-checks";
import LiveMapPage from "@/pages/live-map";
import ArchivePage from "@/pages/archive";
import AutoAssignmentPage from "@/pages/auto-assignment";
import DispatchBoardPage from "@/pages/dispatch-board";
import ClinicTripsPage from "@/pages/clinic-trips";
import DriverDashboard from "@/pages/driver-dashboard";
import BillingPage from "@/pages/billing";
import SchedulePage from "@/pages/schedule";
import UnauthorizedPage from "@/pages/unauthorized";
import PublicTrackingPage from "@/pages/public-tracking";
import NotFound from "@/pages/not-found";
import { Skeleton } from "@/components/ui/skeleton";

function ProtectedRoute({ resource, component: Component }: { resource: Resource; component: React.ComponentType }) {
  const { user } = useAuth();
  if (!user || !can(user.role, resource)) {
    return <Redirect to="/unauthorized" />;
  }
  return <Component />;
}

function LiveMapRoute() {
  const { user } = useAuth();
  if (!user) return <Redirect to="/unauthorized" />;
  const role = user.role.toUpperCase();
  if (user.clinicId && role === "VIEWER") return <Redirect to="/unauthorized" />;
  const hasAccess = can(user.role, "dispatch") || ["VIEWER", "DRIVER"].includes(role);
  if (!hasAccess) return <Redirect to="/unauthorized" />;
  return <LiveMapPage />;
}

function ArchiveRoute() {
  const { user } = useAuth();
  if (!user) return <Redirect to="/unauthorized" />;
  const role = user.role.toUpperCase();
  const hasAccess = ["SUPER_ADMIN", "ADMIN", "DISPATCH"].includes(role);
  if (!hasAccess) return <Redirect to="/unauthorized" />;
  return <ArchivePage />;
}

function DriverRoute({ component: Component }: { component: React.ComponentType }) {
  const { user } = useAuth();
  if (!user) return <Redirect to="/unauthorized" />;
  const role = user.role.toUpperCase();
  if (role !== "DRIVER") return <Redirect to="/unauthorized" />;
  return <Component />;
}

function ClinicRoute({ component: Component }: { component: React.ComponentType }) {
  const { user } = useAuth();
  if (!user) return <Redirect to="/unauthorized" />;
  if (!user.clinicId) return <Redirect to="/unauthorized" />;
  return <Component />;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return null;
  const role = user.role.toUpperCase();
  if (role === "DRIVER") {
    return <Redirect to="/driver" />;
  }
  if (user.clinicId && role === "VIEWER") {
    return <Redirect to="/clinic-trips" />;
  }
  if (can(user.role, "dashboard")) {
    return <DashboardPage />;
  }
  if (can(user.role, "invoices")) {
    return <Redirect to="/invoices" />;
  }
  if (can(user.role, "trips")) {
    return <Redirect to="/trips" />;
  }
  return <Redirect to="/unauthorized" />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/trips">{() => <ProtectedRoute resource="trips" component={TripsPage} />}</Route>
      <Route path="/patients">{() => <ProtectedRoute resource="patients" component={PatientsPage} />}</Route>
      <Route path="/drivers">{() => <ProtectedRoute resource="drivers" component={DriversPage} />}</Route>
      <Route path="/vehicles">{() => <ProtectedRoute resource="vehicles" component={VehiclesPage} />}</Route>
      <Route path="/clinics">{() => <ProtectedRoute resource="clinics" component={ClinicsPage} />}</Route>
      <Route path="/cities">{() => <ProtectedRoute resource="cities" component={CitiesPage} />}</Route>
      <Route path="/users">{() => <ProtectedRoute resource="users" component={UsersPage} />}</Route>
      <Route path="/audit">{() => <ProtectedRoute resource="audit" component={AuditPage} />}</Route>
      <Route path="/archive">{() => <ArchiveRoute />}</Route>
      <Route path="/dispatch">{() => <ProtectedRoute resource="dispatch" component={DispatchMapPage} />}</Route>
      <Route path="/fleet">{() => <ProtectedRoute resource="dispatch" component={FleetOpsPage} />}</Route>
      <Route path="/assignments">{() => <ProtectedRoute resource="dispatch" component={AssignmentsPage} />}</Route>
      <Route path="/reports">{() => <ProtectedRoute resource="audit" component={ReportsPage} />}</Route>
      <Route path="/financial">{() => <ProtectedRoute resource="audit" component={FinancialPage} />}</Route>
      <Route path="/ops-health">{() => <ProtectedRoute resource="dispatch" component={OpsHealthPage} />}</Route>
      <Route path="/ops-checks">{() => <ProtectedRoute resource="dispatch" component={OpsChecksPage} />}</Route>
      <Route path="/live-map">{() => <LiveMapRoute />}</Route>
      <Route path="/auto-assignment">{() => <ProtectedRoute resource="dispatch" component={AutoAssignmentPage} />}</Route>
      <Route path="/dispatch-board">{() => <ProtectedRoute resource="dispatch" component={DispatchBoardPage} />}</Route>
      <Route path="/schedule">{() => <ProtectedRoute resource="dispatch" component={SchedulePage} />}</Route>
      <Route path="/clinic-trips">{() => <ClinicRoute component={ClinicTripsPage} />}</Route>
      <Route path="/driver">{() => <DriverRoute component={DriverDashboard} />}</Route>
      <Route path="/driver/:rest*">{() => <DriverRoute component={DriverDashboard} />}</Route>
      <Route path="/invoices">{() => <ProtectedRoute resource="invoices" component={ClinicInvoicesPage} />}</Route>
      <Route path="/billing">{() => <ProtectedRoute resource="invoices" component={BillingPage} />}</Route>
      <Route path="/unauthorized" component={UnauthorizedPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center min-h-screen" data-testid="error-panel">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="flex flex-row items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
          <CardTitle className="text-lg">{t("common.connectionError")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground" data-testid="text-error-message">
            {message}
          </p>
          <Button onClick={onRetry} className="w-full" data-testid="button-retry">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("common.retry")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function AuthenticatedApp() {
  const { user, loading, error, retry, mustChangePassword, cityRequired } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (error && !user) {
    return <ErrorPanel message={error} onRetry={retry} />;
  }

  if (!user) {
    return <LoginPage />;
  }

  if (mustChangePassword) {
    return <ChangePasswordPage />;
  }

  if (cityRequired) {
    return <CitySelectionModal />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <DashboardHeader />
          <main className="flex-1 overflow-auto">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Switch>
            <Route path="/t/:token" component={PublicTrackingPage} />
            <Route>
              <AuthProvider>
                <AuthenticatedApp />
              </AuthProvider>
            </Route>
          </Switch>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
