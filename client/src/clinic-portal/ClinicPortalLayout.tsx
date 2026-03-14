import { Switch, Route, Redirect, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useRealtimeTrips } from "@/hooks/use-realtime-trips";
import { ClinicSidebar } from "./components/ClinicSidebar";
import ClinicDashboard from "./pages/ClinicDashboard";
import ClinicTrips from "./pages/ClinicTrips";
import ClinicLiveView from "./pages/ClinicLiveView";
import ClinicBilling from "./pages/ClinicBilling";
import ClinicProfile from "./pages/ClinicProfile";
import ClinicTripRequests from "./pages/ClinicTripRequests";
import ClinicTripRequestNew from "./pages/ClinicTripRequestNew";
import ClinicTripRequestDetail from "./pages/ClinicTripRequestDetail";
import ClinicPatients from "./pages/ClinicPatients";
import ClinicScheduling from "./pages/ClinicScheduling";
import ClinicUsers from "./pages/ClinicUsers";
import ClinicRecurringSchedules from "./pages/ClinicRecurringSchedules";
import ClinicProviderDirectory from "./pages/ClinicProviderDirectory";
import LoginPage from "@/pages/login";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Menu, X, AlertTriangle, Bell } from "lucide-react";
import { SkipToContent } from "@/components/SkipToContent";
import { useTranslation } from "react-i18next";

const CLINIC_ROLES = ["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"];
const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"];
const ALLOWED_ROLES = [...CLINIC_ROLES, ...ADMIN_ROLES];

function ClinicPortalRoutes() {
  return (
    <Switch>
      <Route path="/" component={ClinicDashboard} />
      <Route path="/requests/new" component={ClinicTripRequestNew} />
      <Route path="/requests/:id" component={ClinicTripRequestDetail} />
      <Route path="/requests" component={ClinicTripRequests} />
      <Route path="/trips" component={ClinicTrips} />
      <Route path="/patients" component={ClinicPatients} />
      <Route path="/live" component={ClinicLiveView} />
      <Route path="/scheduling" component={ClinicScheduling} />
      <Route path="/recurring-schedules" component={ClinicRecurringSchedules} />
      <Route path="/providers" component={ClinicProviderDirectory} />
      <Route path="/billing" component={ClinicBilling} />
      <Route path="/users" component={ClinicUsers} />
      <Route path="/profile" component={ClinicProfile} />
      <Route>{() => <Redirect to="/" />}</Route>
    </Switch>
  );
}

function ClinicHostUnauthorized() {
  const { logout } = useAuth();
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0a0f1e]">
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-8 max-w-md text-center space-y-4">
        <div className="w-16 h-16 mx-auto bg-red-500/10 rounded-full flex items-center justify-center">
          <X className="w-8 h-8 text-red-400" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-semibold text-white">{t('clinic.layout.accessDenied', 'Access Denied')}</h2>
        <p className="text-gray-400">
          {t('clinic.layout.accessDeniedMessage', 'This portal is restricted to clinic users only. Please contact your administrator if you believe this is an error.')}
        </p>
        <button
          onClick={() => logout()}
          className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
          data-testid="button-clinic-logout"
        >
          {t('common.logout', 'Sign Out')}
        </button>
      </div>
    </div>
  );
}

function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data } = useQuery<any>({
    queryKey: ["/api/clinic/notifications"],
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiRequest("POST", "/api/clinic/notifications/mark-read", { notificationIds: ids });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/notifications"] });
    },
  });

  const notifications = (data as any)?.notifications || [];
  const unreadCount = (data as any)?.unreadCount || 0;

  const handleMarkAllRead = () => {
    const unreadIds = notifications.filter((n: any) => !n.read).map((n: any) => n.id);
    if (unreadIds.length > 0) markReadMutation.mutate(unreadIds);
  };

  const typeIcons: Record<string, string> = {
    trip_completed: "text-emerald-400",
    trip_cancelled: "text-red-400",
    driver_assigned: "text-blue-400",
    request_approved: "text-purple-400",
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 hover:bg-white/5 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        data-testid="notification-bell"
        aria-label={t('clinic.layout.notifications', 'Notifications ({{count}} unread)', { count: unreadCount })}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="w-5 h-5 text-gray-400" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center" data-testid="notification-badge">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} role="presentation" aria-hidden="true" />
          <div className="absolute right-0 top-full mt-2 w-80 bg-[#111827] border border-[#1e293b] rounded-xl shadow-2xl z-50 overflow-hidden" data-testid="notification-dropdown" role="menu" aria-label="Notifications">
            <div className="px-4 py-3 border-b border-[#1e293b] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">{t('clinic.layout.notificationsTitle', 'Notifications')}</h3>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  {t('notifications.markAllRead')}
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-[#1e293b]/50">
              {notifications.length === 0 ? (
                <div className="p-6 text-center">
                  <Bell className="w-8 h-8 text-gray-700 mx-auto mb-2" aria-hidden="true" />
                  <p className="text-xs text-gray-500">{t('notifications.noNotifications')}</p>
                </div>
              ) : (
                notifications.slice(0, 20).map((n: any) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (!n.read) markReadMutation.mutate([n.id]);
                    }}
                    className={`w-full text-left px-4 py-3 hover:bg-white/[0.02] transition-colors ${!n.read ? "bg-emerald-500/[0.03]" : ""}`}
                    data-testid={`notification-${n.id}`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-1.5" />}
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium ${typeIcons[n.type] || "text-gray-400"}`}>{n.title}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">{n.message}</p>
                        <p className="text-[10px] text-gray-600 mt-1">
                          {new Date(n.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ClinicPortalLayout() {
  const { t } = useTranslation();
  const { user, token, loading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [location] = useLocation();

  useRealtimeTrips({
    clinicId: user?.clinicId || null,
    enabled: !!token && !!user?.clinicId,
    invalidateKeys: [
      "/api/clinic/trip-requests",
      "/api/clinic/trips",
      "/api/clinic/active-trips",
      "/api/clinic/ops",
    ],
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0f1e]" role="status" aria-live="polite">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          <p className="text-gray-400 text-sm">{t('common.loading')}</p>
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
  if (!ALLOWED_ROLES.includes(role)) {
    return <ClinicHostUnauthorized />;
  }

  // Admin users without a clinicId can't use the clinic portal — redirect to admin panel
  if (ADMIN_ROLES.includes(role) && !user.clinicId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0f1e]">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-8 max-w-md text-center space-y-4">
          <div className="w-16 h-16 mx-auto bg-amber-500/10 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-amber-400" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-semibold text-white">{t('clinic.layout.noClinicAssigned', 'No Clinic Assigned')}</h2>
          <p className="text-gray-400">
            {t('clinic.layout.noClinicMessage', 'Your account is not linked to a specific clinic. Use the admin panel to manage clinic billing and settings.')}
          </p>
          <a
            href={window.location.hostname === "localhost" || window.location.hostname.startsWith("127.") ? "/?portal=admin" : "/"}
            className="inline-block px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
          >
            {t('clinic.layout.goToAdmin', 'Go to Admin Panel')}
          </a>
        </div>
      </div>
    );
  }

  // Clinic-scoped users must have a clinicId
  if (CLINIC_ROLES.includes(role) && !user.clinicId) {
    return <ClinicHostUnauthorized />;
  }

  return (
    <div className="flex h-screen w-full bg-[#0a0f1e] text-white overflow-hidden" data-testid="clinic-portal-layout">
      <SkipToContent />
      <ClinicSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        currentPath={location}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-[#1e293b] bg-[#0f172a]/80 backdrop-blur-sm flex items-center px-4 shrink-0" role="banner">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 hover:bg-white/5 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            data-testid="button-toggle-sidebar"
            aria-label={sidebarOpen ? t('clinic.layout.closeSidebar', 'Close sidebar menu') : t('clinic.layout.openSidebar', 'Open sidebar menu')}
            aria-expanded={sidebarOpen}
          >
            <Menu className="w-5 h-5 text-gray-400" aria-hidden="true" />
          </button>
          <div className="flex items-center gap-3 ml-2 lg:ml-0">
            <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-400 rounded-full flex items-center justify-center text-white font-bold text-sm">
              UC
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white leading-none">{t('clinic.layout.portalTitle', 'UCM Clinic Portal')}</h1>
              <p className="text-xs text-gray-500 leading-none mt-0.5">{user.clinicId ? t('clinic.dashboard') : t('clinic.layout.administrator', 'Administrator')}</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell />
            <div className="text-right">
              <p className="text-xs text-gray-400">{user.email}</p>
              <p className="text-[10px] text-gray-600 uppercase">{user.role}</p>
            </div>
            <div className="w-8 h-8 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
              {user.email?.[0]?.toUpperCase() || "U"}
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto" role="main" aria-label={t('clinic.layout.portalContent', 'Clinic portal content')}>
          <ClinicPortalRoutes />
        </main>
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          role="presentation"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
