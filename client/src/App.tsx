import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, RefreshCw } from "lucide-react";
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
import NotFound from "@/pages/not-found";
import { Skeleton } from "@/components/ui/skeleton";

function Router() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/trips" component={TripsPage} />
      <Route path="/patients" component={PatientsPage} />
      <Route path="/drivers" component={DriversPage} />
      <Route path="/vehicles" component={VehiclesPage} />
      <Route path="/clinics" component={ClinicsPage} />
      <Route path="/cities" component={CitiesPage} />
      <Route path="/users" component={UsersPage} />
      <Route path="/audit" component={AuditPage} />
      <Route path="/dispatch" component={DispatchMapPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-screen" data-testid="error-panel">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="flex flex-row items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
          <CardTitle className="text-lg">Connection Error</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground" data-testid="text-error-message">
            {message}
          </p>
          <Button onClick={onRetry} className="w-full" data-testid="button-retry">
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function AuthenticatedApp() {
  const { user, loading, error, retry } = useAuth();

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

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center gap-2 p-2 border-b flex-shrink-0">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </header>
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
      <TooltipProvider>
        <AuthProvider>
          <AuthenticatedApp />
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
