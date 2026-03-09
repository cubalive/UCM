import React from "react";
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
import { API_BASE_URL } from "@/lib/api";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { isDriverHost, isClinicHost, getTokenKey } from "@/lib/hostDetection";
import { pushError } from "@/lib/errorLog";
import { CitySelectionModal } from "@/components/city-selection-modal";
// Critical pages loaded eagerly (auth flow, initial render)
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import ChangePasswordPage from "@/pages/change-password";
import UnauthorizedPage from "@/pages/unauthorized";
import NotFound from "@/pages/not-found";

// Lazy-loaded pages (code-split per route)
const TripsPage = React.lazy(() => import("@/pages/trips"));
const TripDetailPage = React.lazy(() => import("@/pages/trip-detail"));
const PatientDetailPage = React.lazy(() => import("@/pages/patient-detail"));
const DriverDetailPage = React.lazy(() => import("@/pages/driver-detail"));
const VehicleDetailPage = React.lazy(() => import("@/pages/vehicle-detail"));
const ClinicDetailPage = React.lazy(() => import("@/pages/clinic-detail"));
const PatientsPage = React.lazy(() => import("@/pages/patients"));
const DriversPage = React.lazy(() => import("@/pages/drivers"));
const VehiclesPage = React.lazy(() => import("@/pages/vehicles"));
const ClinicsPage = React.lazy(() => import("@/pages/clinics"));
const CitiesPage = React.lazy(() => import("@/pages/cities"));
const UsersPage = React.lazy(() => import("@/pages/users-management"));
const AuditPage = React.lazy(() => import("@/pages/audit"));
const DispatchMapPage = React.lazy(() => import("@/pages/dispatch-map"));
const ClinicInvoicesPage = React.lazy(() => import("@/pages/clinic-invoices"));
const FleetOpsPage = React.lazy(() => import("@/pages/fleet-ops"));
const AssignmentsPage = React.lazy(() => import("@/pages/assignments"));
const ReportsPage = React.lazy(() => import("@/pages/reports"));
const FinancialPage = React.lazy(() => import("@/pages/financial"));
const OpsHealthPage = React.lazy(() => import("@/pages/ops-health"));
const OpsChecksPage = React.lazy(() => import("@/pages/ops-checks"));
const LiveMapPage = React.lazy(() => import("@/pages/live-map"));
const ArchivePage = React.lazy(() => import("@/pages/archive"));
const AutoAssignmentPage = React.lazy(() => import("@/pages/auto-assignment"));
const DispatchBoardPage = React.lazy(() => import("@/pages/dispatch-board"));
const TripRequestsQueuePage = React.lazy(() => import("@/pages/trip-requests-queue"));
const ClinicTripsPage = React.lazy(() => import("@/pages/clinic-trips"));
const DriverDashboard = React.lazy(() => import("@/pages/driver-portal"));
const DriverProfilePage = React.lazy(() => import("@/pages/driver-profile"));
const DriverPerformancePage = React.lazy(() => import("@/pages/driver-performance"));
const BillingPage = React.lazy(() => import("@/pages/billing"));
const ClinicBillingPage = React.lazy(() => import("@/pages/clinic-billing"));
const SchedulePage = React.lazy(() => import("@/pages/schedule"));
const DispatchSwapsPage = React.lazy(() => import("@/pages/dispatch-swaps"));
const PricingPage = React.lazy(() => import("@/pages/pricing"));
const MetricsPage = React.lazy(() => import("@/pages/metrics"));
const IntelligencePage = React.lazy(() => import("@/pages/intelligence"));
const IndexesPage = React.lazy(() => import("@/pages/indexes"));
const CertificationPage = React.lazy(() => import("@/pages/certification"));
const RankingPage = React.lazy(() => import("@/pages/ranking"));
const AuditShieldPage = React.lazy(() => import("@/pages/audit-shield"));
const PredictionPage = React.lazy(() => import("@/pages/prediction"));
const PublishCenterPage = React.lazy(() => import("@/pages/publish-center"));
const DataImportPage = React.lazy(() => import("@/pages/data-import"));
const CompaniesPage = React.lazy(() => import("@/pages/companies"));
const TimecardsPage = React.lazy(() => import("@/pages/timecards"));
const TpPayrollPage = React.lazy(() => import("@/pages/tp-payroll"));
const BillingTariffsPage = React.lazy(() => import("@/pages/billing-tariffs"));
const PlatformFeesPage = React.lazy(() => import("@/pages/platform-fees"));
const ClinicBillingV2Page = React.lazy(() => import("@/pages/clinic-billing-v2"));
const SupportChatPage = React.lazy(() => import("@/pages/support-chat"));
const ClinicTripDetailsPage = React.lazy(() => import("@/pages/clinic-trip-details"));
const ClinicUsersPage = React.lazy(() => import("@/pages/clinic-users"));
const InvoiceDetailPage = React.lazy(() => import("@/pages/invoice-detail"));
const PayrollDetailPage = React.lazy(() => import("@/pages/payroll-detail"));
const PublicTrackingPage = React.lazy(() => import("@/pages/public-tracking"));
const SystemStatusPage = React.lazy(() => import("@/pages/system-status"));
const FinanceConsolePage = React.lazy(() => import("@/pages/finance-console"));
const FeeRulesPage = React.lazy(() => import("@/pages/fee-rules"));
const EtaEscalationsPage = React.lazy(() => import("@/pages/eta-escalations"));
const ZeroTouchDialysisPage = React.lazy(() => import("@/pages/zero-touch-dialysis"));
const PayrollSettingsPage = React.lazy(() => import("@/pages/payroll-settings"));
const DriverEarningsPage = React.lazy(() => import("@/pages/driver-earnings"));
const PrivacyPolicyPage = React.lazy(() => import("@/pages/privacy-policy"));
const TermsOfServicePage = React.lazy(() => import("@/pages/terms-of-service"));
const DeleteAccountPage = React.lazy(() => import("@/pages/delete-account"));

// Lazy-loaded app shells
const DriverAppV4 = React.lazy(() => import("@/driver-v4/DriverAppV4").then(m => ({ default: m.DriverAppV4 })));
const ClinicPortalLayout = React.lazy(() => import("@/clinic-portal/ClinicPortalLayout").then(m => ({ default: m.ClinicPortalLayout })));
import { NetworkStatus } from "@/components/network-status";
import { useAppVersion } from "@/components/version-checker";
import { Skeleton } from "@/components/ui/skeleton";
import { useState as useStateHook } from "react";

function PageLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="space-y-4 w-64">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

const UCM_DEBUG = import.meta.env.VITE_UCM_DEBUG === "true";

function AuthDebugPanel() {
  const { user, token, error: authError, lastAuthStatus } = useAuth();
  const [sessionInfo, setSessionInfo] = useStateHook<{
    cookie: boolean;
    bearer: boolean;
    meStatus: number;
    meResponse: string;
    authMeStatus: number;
    authMeResponse: string;
  } | null>(null);
  const [open, setOpen] = useStateHook(false);

  const debugEnabled = UCM_DEBUG || new URLSearchParams(window.location.search).has("debug");

  const tokenKey = getTokenKey();
  const hasStoredToken = !!localStorage.getItem(tokenKey);
  const storedTokenLength = localStorage.getItem(tokenKey)?.length || 0;

  const checkSession = async () => {
    const creds: RequestCredentials = isDriverHost ? "omit" : "include";
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let meStatus = 0, meResponse = "not tested";
    let authMeStatus = 0, authMeResponse = "not tested";

    try {
      const resolveUrl = (p: string) => API_BASE_URL && p.startsWith("/") ? `${API_BASE_URL}${p}` : p;
      const r1 = await fetch(resolveUrl("/api/me"), { credentials: creds, headers });
      meStatus = r1.status;
      meResponse = (await r1.text()).slice(0, 300);
    } catch (e: any) {
      meResponse = `fetch error: ${e.message}`;
    }

    try {
      const resolveUrl = (p: string) => API_BASE_URL && p.startsWith("/") ? `${API_BASE_URL}${p}` : p;
      const r2 = await fetch(resolveUrl("/api/auth/me"), { credentials: creds, headers });
      authMeStatus = r2.status;
      authMeResponse = (await r2.text()).slice(0, 300);
    } catch (e: any) {
      authMeResponse = `fetch error: ${e.message}`;
    }

    const hasCookie = !isDriverHost && document.cookie.includes("ucm_session");
    setSessionInfo({ cookie: hasCookie, bearer: !!token, meStatus, meResponse, authMeStatus, authMeResponse });
    setOpen(true);
  };

  if (!debugEnabled) return null;

  return (
    <div className="fixed bottom-2 right-2 z-[9999]" data-testid="debug-panel">
      <button
        onClick={checkSession}
        className="text-[10px] px-2 py-1 rounded bg-muted text-muted-foreground border opacity-60 hover:opacity-100"
        data-testid="button-debug-toggle"
      >
        Auth Debug
      </button>
      {open && (
        <div className="absolute bottom-8 right-0 bg-card border rounded p-2 text-[11px] space-y-1 min-w-[280px] max-w-[360px] shadow-md max-h-[70vh] overflow-auto">
          <div className="font-bold text-xs border-b pb-1 mb-1" data-testid="text-debug-title">Auth Debug</div>
          <div data-testid="text-debug-hostname">hostname: {window.location.hostname}</div>
          <div data-testid="text-debug-is-driver">isDriverHost: {String(isDriverHost)}</div>
          <div data-testid="text-debug-token-key">tokenKey: {tokenKey}</div>
          <div data-testid="text-debug-token-present">token stored: {hasStoredToken ? `yes (${storedTokenLength} chars)` : "NO"}</div>
          <div data-testid="text-debug-token-state">token state: {token ? `yes (${token.length} chars)` : "NO"}</div>
          <div data-testid="text-debug-user">user: {user?.email || "none"}</div>
          <div data-testid="text-debug-role">role: {user?.role || "none"}</div>
          <div data-testid="text-debug-user-id">userId: {user?.id ?? "none"}</div>
          <div data-testid="text-debug-last-status">lastAuthStatus: {lastAuthStatus ?? "none"}</div>
          {authError && <div data-testid="text-debug-auth-error" className="text-destructive break-all">authError: {authError}</div>}

          {sessionInfo && (
            <>
              <div className="font-bold text-xs border-t pt-1 mt-1">Live Probe</div>
              <div data-testid="text-debug-bearer">bearer: {sessionInfo.bearer ? "yes" : "no"}</div>
              <div data-testid="text-debug-cookie">cookie: {sessionInfo.cookie ? "yes" : "no"}</div>
              <div data-testid="text-debug-me-status">GET /api/me: {sessionInfo.meStatus}</div>
              <div data-testid="text-debug-me-response" className="break-all max-h-16 overflow-auto text-muted-foreground">{sessionInfo.meResponse}</div>
              <div data-testid="text-debug-authme-status">GET /api/auth/me: {sessionInfo.authMeStatus}</div>
              <div data-testid="text-debug-authme-response" className="break-all max-h-16 overflow-auto text-muted-foreground">{sessionInfo.authMeResponse}</div>
            </>
          )}

          <button
            onClick={() => setOpen(false)}
            className="text-[10px] text-muted-foreground underline mt-1"
            data-testid="button-debug-close"
          >
            close
          </button>
        </div>
      )}
    </div>
  );
}

function ProtectedRoute({ resource, component: Component }: { resource: Resource; component: React.ComponentType }) {
  const { user } = useAuth();
  if (!user || !can(user.role, resource)) {
    return <Redirect to="/unauthorized" />;
  }
  return <Component />;
}

const CLINIC_ROLES = ["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"];

function LiveMapRoute() {
  const { user } = useAuth();
  if (!user) return <Redirect to="/unauthorized" />;
  const role = user.role.toUpperCase();
  if (user.clinicId && CLINIC_ROLES.includes(role)) return <Redirect to="/unauthorized" />;
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

function ClinicOrPermissionRoute({ resource, component: Component }: { resource: Resource; component: React.ComponentType }) {
  const { user } = useAuth();
  if (!user) return <Redirect to="/unauthorized" />;
  const role = user.role.toUpperCase();
  const isClinicScoped = user.clinicId && (CLINIC_ROLES.includes(role) || role === "VIEWER");
  if (isClinicScoped || can(user.role, resource)) {
    return <Component />;
  }
  return <Redirect to="/unauthorized" />;
}

function ClinicAdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user } = useAuth();
  if (!user) return <Redirect to="/unauthorized" />;
  const role = user.role.toUpperCase();
  if (!user.clinicId) return <Redirect to="/unauthorized" />;
  if (role !== "CLINIC_ADMIN" && role !== "SUPER_ADMIN" && role !== "ADMIN" && role !== "COMPANY_ADMIN") {
    return <Redirect to="/unauthorized" />;
  }
  return <Component />;
}

function SuperAdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user } = useAuth();
  if (!user) return <Redirect to="/unauthorized" />;
  if (user.role.toUpperCase() !== "SUPER_ADMIN") return <Redirect to="/unauthorized" />;
  return <Component />;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return null;
  const role = user.role.toUpperCase();
  if (role === "DRIVER") {
    return <Redirect to="/driver" />;
  }
  if (user.clinicId && (CLINIC_ROLES.includes(role) || role === "VIEWER")) {
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

function DriverSubdomainRouter() {
  return (
    <React.Suspense fallback={<PageLoadingFallback />}>
    <Switch>
      <Route path="/">{() => <DriverRoute component={DriverDashboard} />}</Route>
      <Route path="/driver/profile">{() => <DriverRoute component={DriverProfilePage} />}</Route>
      <Route path="/driver/performance">{() => <DriverRoute component={DriverPerformancePage} />}</Route>
      <Route path="/driver">{() => <DriverRoute component={DriverDashboard} />}</Route>
      <Route path="/driver/:rest*">{() => <DriverRoute component={DriverDashboard} />}</Route>
      <Route path="/login" component={LoginPage} />
      <Route path="/unauthorized" component={UnauthorizedPage} />
      <Route>{() => <Redirect to="/driver" />}</Route>
    </Switch>
    </React.Suspense>
  );
}

function Router() {
  if (isDriverHost) {
    return <DriverSubdomainRouter />;
  }

  return (
    <React.Suspense fallback={<PageLoadingFallback />}>
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/trips/:id">{() => <ProtectedRoute resource="trips" component={TripDetailPage} />}</Route>
      <Route path="/trips">{() => <ProtectedRoute resource="trips" component={TripsPage} />}</Route>
      <Route path="/patients/:id">{() => <ProtectedRoute resource="patients" component={PatientDetailPage} />}</Route>
      <Route path="/patients">{() => <ProtectedRoute resource="patients" component={PatientsPage} />}</Route>
      <Route path="/drivers/:id">{() => <ProtectedRoute resource="drivers" component={DriverDetailPage} />}</Route>
      <Route path="/drivers">{() => <ProtectedRoute resource="drivers" component={DriversPage} />}</Route>
      <Route path="/vehicles/:id">{() => <ProtectedRoute resource="vehicles" component={VehicleDetailPage} />}</Route>
      <Route path="/vehicles">{() => <ProtectedRoute resource="vehicles" component={VehiclesPage} />}</Route>
      <Route path="/clinics/:id">{() => <ProtectedRoute resource="clinics" component={ClinicDetailPage} />}</Route>
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
      <Route path="/trip-requests-queue">{() => <ProtectedRoute resource="dispatch" component={TripRequestsQueuePage} />}</Route>
      <Route path="/schedule">{() => <ProtectedRoute resource="dispatch" component={SchedulePage} />}</Route>
      <Route path="/dispatch-swaps">{() => <ProtectedRoute resource="dispatch" component={DispatchSwapsPage} />}</Route>
      <Route path="/clinic-trip/:id">{() => <ClinicRoute component={ClinicTripDetailsPage} />}</Route>
      <Route path="/clinic-trips">{() => <ClinicRoute component={ClinicTripsPage} />}</Route>
      <Route path="/clinic-users">{() => <ClinicAdminRoute component={ClinicUsersPage} />}</Route>
      <Route path="/driver/profile">{() => <DriverRoute component={DriverProfilePage} />}</Route>
      <Route path="/driver/performance">{() => <DriverRoute component={DriverPerformancePage} />}</Route>
      <Route path="/driver">{() => <DriverRoute component={DriverDashboard} />}</Route>
      <Route path="/driver/:rest*">{() => <DriverRoute component={DriverDashboard} />}</Route>
      <Route path="/invoices/:id">{() => <ClinicOrPermissionRoute resource="invoices" component={InvoiceDetailPage} />}</Route>
      <Route path="/invoices">{() => <ClinicOrPermissionRoute resource="invoices" component={ClinicInvoicesPage} />}</Route>
      <Route path="/billing">{() => <ProtectedRoute resource="invoices" component={BillingPage} />}</Route>
      <Route path="/clinic-billing">{() => <ProtectedRoute resource="invoices" component={ClinicBillingPage} />}</Route>
      <Route path="/pricing">{() => <ProtectedRoute resource="audit" component={PricingPage} />}</Route>
      <Route path="/indexes">{() => <SuperAdminRoute component={IndexesPage} />}</Route>
      <Route path="/metrics">{() => <SuperAdminRoute component={MetricsPage} />}</Route>
      <Route path="/intelligence">{() => <ProtectedRoute resource="audit" component={IntelligencePage} />}</Route>
      <Route path="/certification">{() => <SuperAdminRoute component={CertificationPage} />}</Route>
      <Route path="/ranking">{() => <SuperAdminRoute component={RankingPage} />}</Route>
      <Route path="/audit-shield">{() => <SuperAdminRoute component={AuditShieldPage} />}</Route>
      <Route path="/prediction">{() => <SuperAdminRoute component={PredictionPage} />}</Route>
      <Route path="/publish-center">{() => <SuperAdminRoute component={PublishCenterPage} />}</Route>
      <Route path="/admin/imports">{() => <SuperAdminRoute component={DataImportPage} />}</Route>
      <Route path="/companies">{() => <SuperAdminRoute component={CompaniesPage} />}</Route>
      <Route path="/system-status">{() => <SuperAdminRoute component={SystemStatusPage} />}</Route>
      <Route path="/finance-console">{() => <SuperAdminRoute component={FinanceConsolePage} />}</Route>
      <Route path="/fee-rules">{() => <SuperAdminRoute component={FeeRulesPage} />}</Route>
      <Route path="/eta-escalations">{() => <ProtectedRoute resource="dispatch" component={EtaEscalationsPage} />}</Route>
      <Route path="/zero-touch-dialysis">{() => <ProtectedRoute resource="dispatch" component={ZeroTouchDialysisPage} />}</Route>
      <Route path="/timecards">{() => <ProtectedRoute resource="time_entries" component={TimecardsPage} />}</Route>
      <Route path="/tp-payroll">{() => <ProtectedRoute resource="payroll" component={TpPayrollPage} />}</Route>
      <Route path="/payroll/runs/:id">{() => <ProtectedRoute resource="payroll" component={PayrollDetailPage} />}</Route>
      <Route path="/payroll-settings">{() => <ProtectedRoute resource="payroll" component={PayrollSettingsPage} />}</Route>
      <Route path="/driver-earnings">{() => <ProtectedRoute resource="payroll" component={DriverEarningsPage} />}</Route>
      <Route path="/billing-config">{() => <ProtectedRoute resource="billing" component={BillingTariffsPage} />}</Route>
      <Route path="/platform-fees">{() => <ProtectedRoute resource="billing" component={PlatformFeesPage} />}</Route>
      <Route path="/admin/subscriptions">{() => { window.location.href = "/platform-fees?tab=subscription"; return null; }}</Route>
      <Route path="/clinic-billing-v2">{() => <ClinicOrPermissionRoute resource="billing" component={ClinicBillingV2Page} />}</Route>
      <Route path="/support-chat">{() => <ClinicOrPermissionRoute resource="support" component={SupportChatPage} />}</Route>
      <Route path="/unauthorized" component={UnauthorizedPage} />
      <Route component={NotFound} />
    </Switch>
    </React.Suspense>
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

function DriverHostUnauthorized() {
  const { logout } = useAuth();
  return (
    <div className="flex items-center justify-center min-h-screen" data-testid="driver-host-unauthorized">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="flex flex-row items-center gap-3">
          <AlertTriangle className="h-6 w-6 text-destructive flex-shrink-0" />
          <CardTitle data-testid="text-driver-host-unauthorized-title">Driver Access Only</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground" data-testid="text-driver-host-unauthorized-message">
            This portal is exclusively for drivers. Your account does not have driver access. Please use the main application instead.
          </p>
          <Button
            onClick={() => logout()}
            variant="destructive"
            className="w-full"
            data-testid="button-driver-host-logout"
          >
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

const showDebugDetails = UCM_DEBUG || (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug"));

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode; label?: string },
  { hasError: boolean; error: Error | null; errorInfo: React.ErrorInfo | null; detailsOpen: boolean }
> {
  constructor(props: { children: React.ReactNode; label?: string }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, detailsOpen: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const label = this.props.label || "App";
    console.error(`[UCM] ${label}ErrorBoundary caught:`, error.message);
    console.error(`[UCM] Component stack:`, errorInfo.componentStack);
    console.error(`[UCM] Stack trace:`, error.stack);
    this.setState({ errorInfo });
  }
  render() {
    if (this.state.hasError) {
      const canShowDetails = showDebugDetails || isDriverHost;
      const label = this.props.label || "Application";
      return (
        <div className="flex items-center justify-center min-h-screen" data-testid="app-error-boundary">
          <Card className="w-full max-w-md mx-4">
            <CardHeader className="flex flex-row items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
              <CardTitle>Something went wrong</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {label === "Driver" 
                  ? "The driver app encountered an unexpected error. Please reload the page."
                  : "An unexpected error occurred. Please reload the page to continue."}
              </p>
              {canShowDetails && this.state.error && (
                <div>
                  <button
                    onClick={() => this.setState({ detailsOpen: !this.state.detailsOpen })}
                    className="text-xs text-muted-foreground underline mb-2"
                    data-testid="button-toggle-error-details"
                  >
                    {this.state.detailsOpen ? "Hide error details" : "Show error details"}
                  </button>
                  {this.state.detailsOpen && (
                    <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-60 break-all whitespace-pre-wrap" data-testid="text-error-detail">
                      {this.state.error.message}
                      {"\n\n"}
                      {this.state.error.stack}
                      {this.state.errorInfo?.componentStack && (
                        <>
                          {"\n\nComponent Stack:"}
                          {this.state.errorInfo.componentStack}
                        </>
                      )}
                    </pre>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={() => window.location.reload()} className="flex-1" data-testid="button-reload">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Reload
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.open("mailto:support@unitedcaremobility.com?subject=App%20Error%20Report&body=" + encodeURIComponent("Error: " + (this.state.error?.message || "Unknown") + "\n\nSteps to reproduce:\n"), "_blank")}
                  className="flex-1"
                  data-testid="button-report-issue"
                >
                  <AlertTriangle className="mr-2 h-4 w-4" />
                  Report
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

function AuthenticatedApp() {
  const { user, loading, error, retry, mustChangePassword, cityRequired, logout } = useAuth();

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
    const isSessionError = /session|expired|auth|401|403|token/i.test(error);
    if (isSessionError) {
      try { localStorage.removeItem(getTokenKey()); } catch {}
      return <LoginPage />;
    }
    return <ErrorPanel message={error} onRetry={retry} />;
  }

  if (!user) {
    return <LoginPage />;
  }

  if (mustChangePassword) {
    return <ChangePasswordPage />;
  }

  if (isClinicHost) {
    const role = user.role.toUpperCase();
    const clinicAllowed = ["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER", "CLINIC", "SUPER_ADMIN"];
    if (!clinicAllowed.includes(role)) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-[#0a0f1e]">
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-8 max-w-md text-center space-y-4">
            <h2 className="text-xl font-semibold text-white">Access Denied</h2>
            <p className="text-gray-400">This portal is restricted to clinic users only.</p>
            <button onClick={() => logout()} className="px-6 py-2 bg-emerald-600 text-white rounded-lg">Sign Out</button>
          </div>
        </div>
      );
    }
    return (
      <AppErrorBoundary label="Clinic">
        <React.Suspense fallback={<PageLoadingFallback />}>
          <ClinicPortalLayout />
        </React.Suspense>
      </AppErrorBoundary>
    );
  }

  if (isDriverHost) {
    const role = user.role.toUpperCase();
    if (role !== "DRIVER") {
      return <DriverHostUnauthorized />;
    }
    return (
      <AppErrorBoundary label="Driver">
        <main className="h-screen w-full overflow-auto">
          <DriverSubdomainRouter />
          <AuthDebugPanel />
        </main>
      </AppErrorBoundary>
    );
  }

  if (cityRequired) {
    return <CitySelectionModal />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <AppErrorBoundary label="Admin">
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
        <AuthDebugPanel />
      </SidebarProvider>
    </AppErrorBoundary>
  );
}

function AppWithVersionCheck() {
  useAppVersion();
  return (
    <>
      <NetworkStatus />
      <React.Suspense fallback={<PageLoadingFallback />}>
      <Switch>
        <Route path="/t/:token" component={PublicTrackingPage} />
        <Route path="/privacy" component={PrivacyPolicyPage} />
        <Route path="/terms" component={TermsOfServicePage} />
        <Route path="/delete-account" component={DeleteAccountPage} />
        <Route path="/driver-v4" component={DriverAppV4} />
        <Route>
          <AuthProvider>
            <AuthenticatedApp />
          </AuthProvider>
        </Route>
      </Switch>
      </React.Suspense>
      <Toaster />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AppWithVersionCheck />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;

if (isDriverHost) {
  window.onerror = (message, source, lineno, colno, error) => {
    console.error("[UCM] Global error:", { message, source, lineno, colno, stack: error?.stack });
    pushError({
      ts: Date.now(),
      type: "error",
      message: String(message),
      source: source ? String(source) : undefined,
      line: lineno ?? undefined,
      col: colno ?? undefined,
      stack: error?.stack,
    });
  };
  window.onunhandledrejection = (event: PromiseRejectionEvent) => {
    console.error("[UCM] Unhandled promise rejection:", event.reason?.message || event.reason, event.reason?.stack);
    pushError({
      ts: Date.now(),
      type: "rejection",
      message: event.reason?.message || String(event.reason),
      stack: event.reason?.stack,
    });
  };
}
